from datetime import datetime, timedelta, UTC
import logging

from fastapi import Depends, HTTPException, Request
import bcrypt
import jwt
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from app.database import get_db
from app import models
from app.config import settings

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"

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


def create_workspace_token(
    workspace_id: str, workspace_slug: str, workspace_name: str
) -> str:
    """Создать JWT токен для workspace."""
    expire = datetime.now(UTC) + timedelta(hours=settings.workspace_jwt_expire_hours)
    payload = {
        "workspace_id": workspace_id,
        "workspace_slug": workspace_slug,
        "workspace_name": workspace_name,
        "exp": expire,
    }
    return jwt.encode(payload, settings.workspace_jwt_secret, algorithm=ALGORITHM)


def decode_workspace_token(token: str) -> dict:
    """Декодировать JWT токен workspace."""
    try:
        return jwt.decode(token, settings.workspace_jwt_secret, algorithms=[ALGORITHM])
    except InvalidTokenError as err:
        raise HTTPException(
            status_code=401, detail="Invalid or expired workspace token"
        ) from err


def get_current_workspace(
    request: Request,
    db: Session = Depends(get_db),
) -> models.Workspace:
    """Dependency: получить текущий workspace из headers или cookie."""
    token = request.headers.get("X-Workspace-Token")
    if not token:
        token = request.cookies.get("workspace_token")
    if not token:
        raise HTTPException(status_code=401, detail="Workspace authentication required")
    payload = decode_workspace_token(token)
    workspace = db.get(models.Workspace, payload["workspace_id"])
    if not workspace:
        raise HTTPException(status_code=401, detail="Workspace not found")
    return workspace


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
        raise HTTPException(status_code=401, detail="Admin authentication required")
    return True
