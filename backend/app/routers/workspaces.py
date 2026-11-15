import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.database import get_db, release_connection
from app import models, schemas
from app.models import now_utc
from app.workspace_auth import (
    clear_session_cookie,
    get_current_participant,
    get_current_workspace,
    issue_session_token,
    new_invite_token,
    revoke_session,
    session_needs_renewal,
    set_session_cookie,
    token_from_request,
    verify_access_key,
)
from app.config import settings
from app.limiter import (
    INVITE_LIMIT,
    TEAM_READ_LIMIT,
    TEAM_WRITE_LIMIT,
    entry_limit_key,
    limiter,
)
from app.ws_manager import manager

logger = logging.getLogger(__name__)

router = APIRouter()

_LOGIN_FAILED = "Неверный код команды или ключ доступа"
# Хеш несуществующего ключа: проверяем его, когда команды с таким кодом нет,
# чтобы ответ и время ответа не выдавали, существует ли команда.
_DUMMY_KEY_HASH = "$2b$12$dhMXNy6NKdeJiDaewnvYGeOFacdLDbSAp4l9gpJf5trkvAoabBeHq"


def _start_session(
    db: Session, response: Response, workspace: models.Workspace, name: str
) -> schemas.SessionOut:
    """Создать участника и выдать ему сессию в httpOnly-cookie.

    Участник создаётся на каждый вход: имя — подпись, а не личность, поэтому
    человек с тем же именем, что уже есть в команде, — это новый участник.
    Выдать себя за коллегу, назвавшись его именем, нельзя.
    """
    participant = models.Participant(workspace_id=workspace.id, name=name)
    db.add(participant)
    db.commit()
    db.refresh(participant)
    set_session_cookie(response, issue_session_token(workspace, participant))
    return schemas.SessionOut(
        workspace_id=workspace.id,
        workspace_slug=workspace.slug,
        workspace_name=workspace.name,
        participant=schemas.ParticipantOut.model_validate(participant),
    )


@router.post("/login", response_model=schemas.SessionOut)
@limiter.limit("30/minute", key_func=entry_limit_key)
def workspace_login(
    request: Request,
    response: Response,
    body: schemas.WorkspaceLoginRequest,
    db: Session = Depends(get_db),
):
    """Вход в команду по коду и ключу доступа."""
    workspace = (
        db.query(models.Workspace)
        .filter(models.Workspace.slug == body.workspace_slug)
        .first()
    )
    key_hash = workspace.access_key_hash if workspace else _DUMMY_KEY_HASH
    key_ok = verify_access_key(body.access_key, key_hash)
    if not workspace or not key_ok:
        raise HTTPException(status_code=401, detail=_LOGIN_FAILED)
    return _start_session(db, response, workspace, body.name)


@router.post("/join", response_model=schemas.SessionOut)
@limiter.limit(INVITE_LIMIT, key_func=entry_limit_key)
def workspace_join(
    request: Request,
    response: Response,
    body: schemas.WorkspaceJoinRequest,
    db: Session = Depends(get_db),
):
    """Вход по ссылке-приглашению: токен из ссылки и имя."""
    workspace = _workspace_by_invite(db, body.invite_token)
    return _start_session(db, response, workspace, body.name)


def _workspace_by_invite(db: Session, token: str) -> models.Workspace:
    workspace = (
        db.query(models.Workspace).filter(models.Workspace.invite_token == token).first()
    )
    # Сравнение в постоянное время — на случай, если СУБД сравнивает строки иначе
    if not workspace or not secrets.compare_digest(
        (workspace.invite_token or "").encode(), token.encode()
    ):
        raise HTTPException(status_code=404, detail="Ссылка-приглашение недействительна")
    return workspace


@router.get("/invite/{token}", response_model=schemas.InviteInfoOut)
@limiter.limit(INVITE_LIMIT, key_func=entry_limit_key)
def invite_info(request: Request, token: str, db: Session = Depends(get_db)):
    """Название команды для страницы приглашения (без входа)."""
    if not (8 <= len(token) <= 64):
        raise HTTPException(status_code=404, detail="Ссылка-приглашение недействительна")
    workspace = _workspace_by_invite(db, token)
    return schemas.InviteInfoOut(workspace_name=workspace.name)


@router.get("/invite", response_model=schemas.InviteOut)
@limiter.limit(TEAM_READ_LIMIT)
def get_invite(
    request: Request,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Токен ссылки-приглашения в команду; создаётся при первом обращении."""
    if not workspace.invite_token:
        workspace.invite_token = new_invite_token()
        db.commit()
    return schemas.InviteOut(invite_token=workspace.invite_token)


@router.post("/logout", status_code=204)
async def workspace_logout(
    request: Request, response: Response, db: Session = Depends(get_db)
):
    """Завершить сессию: токен участника больше не принимается, cookie сбрасывается."""
    participant_id = revoke_session(db, token_from_request(request))
    release_connection(db)
    if participant_id is not None:
        await manager.disconnect_participant(participant_id)
    clear_session_cookie(response)
    response.status_code = 204


@router.get("/me", response_model=schemas.WorkspaceMeOut)
@limiter.limit(TEAM_READ_LIMIT)
def get_current_workspace_info(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    participant: models.Participant = Depends(get_current_participant),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Текущая сессия: команда, участник и возможности инстанса.

    Заодно продлевает сессию: пока человек пользуется доской, она не истекает.
    """
    if session_needs_renewal(request.state.session_claims):
        participant.last_seen_at = now_utc()
        db.commit()
        set_session_cookie(response, issue_session_token(workspace, participant))
    return schemas.WorkspaceMeOut(
        id=workspace.id,
        slug=workspace.slug,
        name=workspace.name,
        created_at=workspace.created_at,
        participant=schemas.ParticipantOut.model_validate(participant),
        ai_enabled=settings.ai_configured,
    )


@router.patch("/me/participant", response_model=schemas.ParticipantOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def rename_participant(
    request: Request,
    body: schemas.ParticipantUpdate,
    db: Session = Depends(get_db),
    participant: models.Participant = Depends(get_current_participant),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Сменить имя. Карточки, голоса, оценки и роль ведущего остаются за участником."""
    name = body.name
    participant.name = name
    # Имя в карточках и оценках — снимок для отображения: обновляем его вместе с участником
    db.query(models.Card).filter(models.Card.author_id == participant.id).update(
        {models.Card.author: name}, synchronize_session=False
    )
    db.query(models.BoardMood).filter(
        models.BoardMood.participant_id == participant.id
    ).update({models.BoardMood.author: name}, synchronize_session=False)
    db.query(models.Board).filter(
        models.Board.active_facilitator_id == participant.id
    ).update({models.Board.active_facilitator: name}, synchronize_session=False)
    db.commit()
    db.refresh(participant)
    out = schemas.ParticipantOut.model_validate(participant)

    touched_boards = manager.rename(participant.id, name)
    await manager.broadcast_workspace(
        workspace.id, "participant_renamed", {"participant_id": participant.id, "name": name}
    )
    for board_id in touched_boards:
        await manager.broadcast(board_id, "presence_update", manager.presence_payload(board_id))
        if manager.get_facilitator(board_id) == participant.id:
            await manager.broadcast(
                board_id, "facilitator_update", manager.facilitator_payload(board_id)
            )
    return out
