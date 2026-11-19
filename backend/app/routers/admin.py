import logging
import secrets
from typing import Optional

import anyio
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.ai.ai_client import fetch_ai_models, probe_ai_connection
from app.config import settings
from app.database import get_db, release_connection
from app.limiter import entry_limit_key, limiter
from app.services import agent_tokens as agent_token_service
from app.services import ai_settings as ai_settings_service
from app.workspace_auth import (
    create_admin_token,
    get_admin_user,
    hash_access_key,
    new_invite_token,
    verify_admin_token,
)
from app.ws_manager import manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/login")
@limiter.limit("10/minute", key_func=entry_limit_key)
def admin_login(request: Request, body: schemas.AdminLoginRequest, response: Response):
    """Администраторский вход."""
    # compare_digest принимает str только из ASCII, поэтому сравниваем байты
    login_ok = secrets.compare_digest(
        body.login.encode(), settings.admin_login.encode()
    )
    password_ok = secrets.compare_digest(
        body.password.encode(), settings.admin_password.encode()
    )
    if not (login_ok and password_ok):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    token = create_admin_token()
    response.set_cookie(
        key="admin_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=86400,
        secure=settings.secure_cookies,
    )
    return {"ok": True}


@router.post("/logout")
def admin_logout(response: Response):
    """Выход администратора."""
    response.delete_cookie(
        "admin_token",
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/",
    )
    return {"ok": True}


@router.get("/session", response_model=schemas.AdminSessionOut)
@limiter.limit("30/minute")
def admin_session(request: Request, response: Response):
    """Проверить сессию администратора без 401.

    Эндпоинт нужен странице `/admin`, чтобы отличить «не входил» от «сессия
    закончилась», не получая 401 в консоли браузера. Ответ всегда 200:
    признак входа — в теле.
    """
    token = request.cookies.get("admin_token")
    response.headers["Cache-Control"] = "no-store"
    return schemas.AdminSessionOut(
        authenticated=bool(token and verify_admin_token(token))
    )


@router.get("/workspaces", response_model=list[schemas.WorkspaceListItem])
@limiter.limit("30/minute")
def list_workspaces(
    request: Request,
    response: Response,
    limit: Optional[int] = Query(default=None, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Список всех workspaces с количеством досок."""
    total = db.query(func.count(models.Workspace.id)).scalar() or 0
    response.headers["X-Total-Count"] = str(total)

    q = db.query(models.Workspace).order_by(
        models.Workspace.created_at, models.Workspace.id
    )
    if offset:
        q = q.offset(offset)
    if limit is not None:
        q = q.limit(limit)
    workspaces = q.all()
    if not workspaces:
        return []

    ws_ids = [ws.id for ws in workspaces]
    # Один запрос на все команды вместо запроса на каждую
    counts = dict(
        db.query(models.Board.workspace_id, func.count(models.Board.id))
        .filter(
            models.Board.deleted_at.is_(None),
            models.Board.workspace_id.in_(ws_ids),
        )
        .group_by(models.Board.workspace_id)
        .all()
    )
    token_counts = dict(
        db.query(models.AgentToken.workspace_id, func.count(models.AgentToken.id))
        .filter(
            models.AgentToken.revoked_at.is_(None),
            models.AgentToken.workspace_id.in_(ws_ids),
        )
        .group_by(models.AgentToken.workspace_id)
        .all()
    )
    result = []
    for ws in workspaces:
        item = schemas.WorkspaceListItem.model_validate(ws)
        item.boards_count = counts.get(ws.id, 0)
        item.active_agent_tokens_count = token_counts.get(ws.id, 0)
        result.append(item)
    return result


@router.post("/workspaces", response_model=schemas.WorkspaceListItem, status_code=201)
@limiter.limit("30/minute")
def create_workspace(
    request: Request,
    body: schemas.WorkspaceCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Создать новый workspace."""
    try:
        logger.info(f"Creating workspace: {body.slug}")
        existing = (
            db.query(models.Workspace)
            .filter(models.Workspace.slug == body.slug)
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=409, detail="Команда с таким кодом уже существует"
            )
        hashed_key = hash_access_key(body.access_key)
        ws = models.Workspace(
            slug=body.slug,
            name=body.name,
            access_key_hash=hashed_key,
            invite_token=new_invite_token(),
        )
        db.add(ws)
        try:
            db.commit()
        except IntegrityError as err:
            db.rollback()
            raise HTTPException(
                status_code=409, detail="Команда с таким кодом уже существует"
            ) from err
        db.refresh(ws)
        logger.info(f"Successfully created workspace: {body.slug}")
        return ws
    except HTTPException:
        raise
    except Exception:
        logger.exception(f"Failed to create workspace {body.slug}")
        raise


@router.patch("/workspaces/{workspace_id}", response_model=schemas.WorkspaceOut)
@limiter.limit("30/minute")
def update_workspace(
    request: Request,
    workspace_id: str,
    body: schemas.WorkspaceUpdate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Обновить workspace."""
    ws = db.get(models.Workspace, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    if body.name is not None:
        ws.name = body.name
    if body.access_key is not None:
        ws.access_key_hash = hash_access_key(body.access_key)
        # Смена ключа закрывает доступ участникам по JWT и ссылке-приглашению;
        # токены MCP-агентов независимы и отзываются только при явном флаге.
        ws.token_epoch += 1
        ws.invite_token = new_invite_token()
        # Открытые сокеты сессию не перепроверяют — закрываем их, иначе отозванный
        # участник продолжал бы получать события и управлять сессией ведущего.
        background.add_task(manager.disconnect_workspace_sessions, ws.id)
    if body.revoke_agent_tokens:
        agent_token_service.revoke_all_agent_tokens(db, ws.id, commit=False)
    db.commit()
    db.refresh(ws)
    return ws


@router.get("/workspaces/{workspace_id}/invite", response_model=schemas.InviteOut)
@limiter.limit("30/minute")
def get_workspace_invite(
    request: Request,
    workspace_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Токен ссылки-приглашения команды; создаётся при первом обращении."""
    ws = db.get(models.Workspace, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    if not ws.invite_token:
        ws.invite_token = new_invite_token()
        db.commit()
    return schemas.InviteOut(invite_token=ws.invite_token)


@router.post("/workspaces/{workspace_id}/invite/rotate", response_model=schemas.InviteOut)
@limiter.limit("30/minute")
def rotate_workspace_invite(
    request: Request,
    workspace_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Перевыпустить ссылку-приглашение: старая перестаёт работать.

    Уже вошедшие участники остаются в команде — их сессии отзывает смена ключа.
    """
    ws = db.get(models.Workspace, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    ws.invite_token = new_invite_token()
    db.commit()
    return schemas.InviteOut(invite_token=ws.invite_token)


@router.delete("/workspaces/{workspace_id}", status_code=204)
@limiter.limit("30/minute")
async def delete_workspace(
    request: Request,
    workspace_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Удалить workspace и все его доски."""
    from app.routers.websocket import cancel_board_summary_tasks

    def _op() -> list[str]:
        ws = db.get(models.Workspace, workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Команда не найдена")
        board_ids = [
            row[0]
            for row in db.query(models.Board.id)
            .filter(models.Board.workspace_id == workspace_id)
            .all()
        ]
        db.delete(ws)
        db.commit()
        release_connection(db)
        return board_ids

    board_ids = await anyio.to_thread.run_sync(_op)
    for bid in board_ids:
        cancel_board_summary_tasks(bid)
        await manager.cleanup_board(bid)
    await manager.disconnect_workspace_sessions(workspace_id)


@router.get(
    "/workspaces/{workspace_id}/agent-tokens",
    response_model=list[schemas.AgentTokenOut],
)
@limiter.limit("30/minute")
def admin_list_agent_tokens(
    request: Request,
    workspace_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Список токенов MCP-агентов команды (для администратора)."""
    ws = db.get(models.Workspace, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    return agent_token_service.list_agent_tokens(db, ws.id)


@router.post(
    "/workspaces/{workspace_id}/agent-tokens",
    response_model=schemas.AgentTokenCreatedOut,
    status_code=201,
)
@limiter.limit("30/minute")
def admin_create_agent_token(
    request: Request,
    workspace_id: str,
    body: schemas.AgentTokenCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Выпустить токен MCP-агента для команды (от имени администратора)."""
    ws = db.get(models.Workspace, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    token, secret = agent_token_service.create_agent_token(
        db,
        ws.id,
        name=body.name,
        scope=body.scope,
        created_by_id=None,
    )
    return schemas.AgentTokenCreatedOut(
        token=schemas.AgentTokenOut.model_validate(token),
        secret=secret,
    )


@router.delete(
    "/workspaces/{workspace_id}/agent-tokens/{token_id}",
    response_model=schemas.AgentTokenOut,
)
@limiter.limit("30/minute")
def admin_revoke_agent_token(
    request: Request,
    workspace_id: str,
    token_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Отозвать токен MCP-агента команды (от имени администратора)."""
    ws = db.get(models.Workspace, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Команда не найдена")
    return agent_token_service.revoke_agent_token(db, ws.id, token_id)


@router.get("/ai-settings", response_model=schemas.AdminAiSettingsOut)
@limiter.limit("30/minute")
def admin_get_ai_settings(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Текущие настройки OpenAI-совместимого ИИ."""
    response.headers["Cache-Control"] = "no-store"
    return ai_settings_service.get_admin_ai_settings(db)


@router.put("/ai-settings", response_model=schemas.AdminAiSettingsOut)
@limiter.limit("20/minute")
def admin_update_ai_settings(
    request: Request,
    response: Response,
    body: schemas.AdminAiSettingsUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Сохранить настройки ИИ в БД и обновить кэш процесса без рестарта."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return ai_settings_service.save_admin_ai_settings(
            db,
            enabled=body.enabled,
            base_url=body.base_url,
            model=body.model,
            reasoning_effort=body.reasoning_effort,
            api_key=body.api_key,
            clear_api_key=body.clear_api_key,
        )
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err


async def _resolve_probe_creds_async(
    db: Session,
    *,
    base_url: str,
    api_key: str | None,
    clear_api_key: bool,
) -> tuple[str, str]:
    def _prepare() -> tuple[str, str]:
        try:
            return ai_settings_service.resolve_probe_credentials(
                db,
                base_url=base_url,
                api_key=api_key,
                clear_api_key=clear_api_key,
            )
        finally:
            release_connection(db)

    try:
        return await anyio.to_thread.run_sync(_prepare)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err


@router.post("/ai-settings/test", response_model=schemas.AdminAiSettingsTestOut)
@limiter.limit("10/minute")
async def admin_test_ai_settings(
    request: Request,
    response: Response,
    body: schemas.AdminAiSettingsTestRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Выполнить пробный запрос `/chat/completions` с переданными настройками."""
    response.headers["Cache-Control"] = "no-store"
    model = body.model.strip()
    if not model:
        release_connection(db)
        raise HTTPException(status_code=422, detail="Укажите имя модели")
    base_url, api_key = await _resolve_probe_creds_async(
        db,
        base_url=body.base_url,
        api_key=body.api_key,
        clear_api_key=body.clear_api_key,
    )

    ok, latency_ms, reply_preview, error, reasoning_used = await anyio.to_thread.run_sync(
        lambda: probe_ai_connection(
            base_url=base_url,
            api_key=api_key,
            model=model,
            reasoning_effort=body.reasoning_effort,
        )
    )
    return schemas.AdminAiSettingsTestOut(
        ok=ok,
        latency_ms=latency_ms,
        reply_preview=reply_preview,
        error=error,
        reasoning_used=reasoning_used,
    )


@router.post("/ai-settings/models", response_model=schemas.AdminAiModelsOut)
@limiter.limit("20/minute")
async def admin_list_ai_models(
    request: Request,
    response: Response,
    body: schemas.AdminAiModelsRequest,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Загрузить список доступных моделей через `GET {base_url}/models`."""
    response.headers["Cache-Control"] = "no-store"
    base_url, api_key = await _resolve_probe_creds_async(
        db,
        base_url=body.base_url,
        api_key=body.api_key,
        clear_api_key=body.clear_api_key,
    )

    try:
        models_list = await anyio.to_thread.run_sync(
            lambda: fetch_ai_models(base_url=base_url, api_key=api_key)
        )
    except RuntimeError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err
    return schemas.AdminAiModelsOut(models=models_list)
