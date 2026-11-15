"""Сессии команды и участника.

Вход в команду создаёт участника (`models.Participant`) и выдаёт подписанный
JWT в httpOnly-cookie. В токене — идентификаторы команды и участника и номер
поколения токенов команды. Личность участника сервер берёт только отсюда:
имя, автор, голос и роль ведущего из тела запроса или WebSocket-сообщения
не принимаются.
"""

from datetime import datetime, timedelta, UTC
import logging
import secrets

from fastapi import Depends, HTTPException, Request, Response
import bcrypt
import jwt
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.config import settings

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
SESSION_COOKIE = "workspace_token"
# Токен старше этого возраста перевыпускается при обращении к /workspaces/me:
# пока человек пользуется доской, сессия не истекает.
SESSION_RENEW_AFTER = timedelta(days=1)

# bcrypt учитывает только первые 72 байта пароля, а начиная с 5-й версии
# отказывается принимать более длинный ввод. Новые ключи длиннее лимита
# отклоняет схема, а при проверке ввод обрезается — как это молча делали
# прежние версии библиотеки, чтобы уже выданные длинные ключи продолжали работать.
BCRYPT_MAX_BYTES = 72


def hash_access_key(key: str) -> str:
    """Хэшировать ключ доступа using bcrypt."""
    try:
        hashed = bcrypt.hashpw(key.encode(), bcrypt.gensalt(rounds=12)).decode()
        return hashed
    except Exception as e:
        logger.error("bcrypt hash error: %s: %s", type(e).__name__, e)
        raise


def verify_access_key(key: str, key_hash: str) -> bool:
    """Проверить ключ доступа against hash."""
    try:
        return bcrypt.checkpw(key.encode()[:BCRYPT_MAX_BYTES], key_hash.encode())
    except ValueError:
        # Повреждённый хеш в БД — это отказ во входе, а не ошибка сервера.
        logger.warning("bcrypt rejected stored access key hash")
        return False


def new_invite_token() -> str:
    """Случайный токен ссылки-приглашения."""
    return secrets.token_urlsafe(24)


def create_workspace_token(
    workspace_id: str,
    workspace_slug: str,
    workspace_name: str,
    participant_id: str,
    epoch: int = 0,
) -> str:
    """Создать JWT сессии: команда, участник и поколение токенов команды."""
    now = datetime.now(UTC)
    payload = {
        "workspace_id": workspace_id,
        "workspace_slug": workspace_slug,
        "workspace_name": workspace_name,
        "pid": participant_id,
        "epoch": epoch,
        "iat": now,
        "exp": now + timedelta(hours=settings.workspace_jwt_expire_hours),
    }
    return jwt.encode(payload, settings.workspace_jwt_secret, algorithm=ALGORITHM)


def issue_session_token(workspace: models.Workspace, participant: models.Participant) -> str:
    return create_workspace_token(
        workspace.id, workspace.slug, workspace.name, participant.id, workspace.token_epoch
    )


def decode_workspace_token(token: str) -> dict:
    """Декодировать JWT токен workspace."""
    try:
        return jwt.decode(token, settings.workspace_jwt_secret, algorithms=[ALGORITHM])
    except InvalidTokenError as err:
        raise HTTPException(
            status_code=401, detail="Сессия недействительна или истекла, войдите снова"
        ) from err


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.workspace_jwt_expire_hours * 3600,
        secure=settings.secure_cookies,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
    )


def token_from_request(request: Request) -> str | None:
    """Токен сессии: заголовок для неинтерактивных клиентов, иначе cookie."""
    return request.headers.get("X-Workspace-Token") or request.cookies.get(SESSION_COOKIE)


def resolve_session(
    db: Session, payload: dict
) -> tuple[models.Workspace, models.Participant]:
    """По содержимому токена найти команду и участника или ответить 401.

    Сессия недействительна, если токен выпущен до появления участников
    (нет `pid`), участник или команда удалены, участник вышел либо ключ
    доступа команды сменили после выдачи токена (поколение не совпадает).
    """
    participant_id = payload.get("pid")
    if not participant_id or not isinstance(participant_id, str):
        raise HTTPException(status_code=401, detail="Сессия устарела, войдите снова")
    participant = db.get(models.Participant, participant_id)
    if participant is None or participant.workspace_id != payload.get("workspace_id"):
        raise HTTPException(status_code=401, detail="Сессия устарела, войдите снова")
    if participant.revoked_at is not None:
        raise HTTPException(status_code=401, detail="Сессия завершена, войдите снова")
    workspace = db.get(models.Workspace, participant.workspace_id)
    if workspace is None:
        raise HTTPException(status_code=401, detail="Команда не найдена")
    if payload.get("epoch") != workspace.token_epoch:
        raise HTTPException(status_code=401, detail="Доступ отозван, войдите снова")
    return workspace, participant


def get_current_participant(
    request: Request,
    db: Session = Depends(get_db),
) -> models.Participant:
    """Dependency: участник текущей сессии."""
    token = token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Требуется вход в команду")
    payload = decode_workspace_token(token)
    workspace, participant = resolve_session(db, payload)
    # Содержимое токена нужно тем, кто решает, пора ли его перевыпускать
    request.state.session_claims = payload
    request.state.workspace = workspace
    return participant


def get_current_workspace(
    request: Request,
    participant: models.Participant = Depends(get_current_participant),
) -> models.Workspace:
    """Dependency: команда текущей сессии."""
    return request.state.workspace


def revoke_session(db: Session, token: str | None) -> str | None:
    """Завершить сессию участника по его токену. Возвращает идентификатор участника.

    Недействительный или чужой токен — не ошибка: выходить всё равно нечем.
    """
    participant_id = participant_key_from_token(token)
    if participant_id is None:
        return None
    participant = db.get(models.Participant, participant_id)
    if participant is None:
        return None
    if participant.revoked_at is None:
        participant.revoked_at = datetime.now(UTC)
        db.commit()
    return participant.id


def session_needs_renewal(payload: dict) -> bool:
    issued_at = payload.get("iat")
    if not isinstance(issued_at, (int, float)):
        return True
    age = datetime.now(UTC) - datetime.fromtimestamp(issued_at, UTC)
    return age >= SESSION_RENEW_AFTER


def participant_key_from_token(token: str | None) -> str | None:
    """Идентификатор участника из токена без обращения к БД (для лимита запросов)."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.workspace_jwt_secret, algorithms=[ALGORITHM])
    except InvalidTokenError:
        return None
    participant_id = payload.get("pid")
    return participant_id if isinstance(participant_id, str) and participant_id else None


def create_admin_token() -> str:
    """Создать JWT токен для администратора."""
    expire = datetime.now(UTC) + timedelta(hours=24)
    payload = {"sub": "admin", "exp": expire}
    return jwt.encode(payload, settings.admin_jwt_secret, algorithm=ALGORITHM)


def verify_admin_token(token: str) -> bool:
    """Проверить администраторский токен."""
    try:
        payload = jwt.decode(token, settings.admin_jwt_secret, algorithms=[ALGORITHM])
        return payload.get("sub") == "admin"
    except InvalidTokenError:
        return False


def get_admin_user(request: Request) -> bool:
    """Dependency: проверить администраторскую аутентификацию."""
    token = request.cookies.get("admin_token")
    if not token or not verify_admin_token(token):
        raise HTTPException(status_code=401, detail="Требуется вход администратора")
    return True
