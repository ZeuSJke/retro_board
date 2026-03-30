import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, Request
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app import models, schemas
from app.workspace_auth import hash_access_key, get_admin_user, create_admin_token
from app.config import settings
from app.limiter import limiter

router = APIRouter()


@router.post("/login")
@limiter.limit("10/minute")
def admin_login(request: Request, body: schemas.AdminLoginRequest, response: Response):
    """Администраторский вход."""
    login_ok = secrets.compare_digest(body.login, settings.admin_login)
    password_ok = secrets.compare_digest(body.password, settings.admin_password)
    if not (login_ok and password_ok):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    token = create_admin_token()
    response.set_cookie(
        key="admin_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=86400,
        secure=True,
    )
    return {"ok": True}


@router.post("/logout")
def admin_logout(response: Response):
    """Выход администратора."""
    response.delete_cookie("admin_token")
    return {"ok": True}


@router.get("/workspaces", response_model=list[schemas.WorkspaceListItem])
@limiter.limit("30/minute")
def list_workspaces(
    request: Request,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Список всех workspaces с количеством досок."""
    workspaces = db.query(models.Workspace).all()
    result = []
    for ws in workspaces:
        count = (
            db.query(func.count(models.Board.id))
            .filter(
                models.Board.workspace_id == ws.id,
                models.Board.deleted_at.is_(None),
            )
            .scalar()
        )
        item = schemas.WorkspaceListItem.model_validate(ws)
        item.boards_count = count or 0
        result.append(item)
    return result


@router.post("/workspaces", response_model=schemas.WorkspaceOut, status_code=201)
@limiter.limit("30/minute")
def create_workspace(
    request: Request,
    body: schemas.WorkspaceCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Создать новый workspace."""
    existing = (
        db.query(models.Workspace).filter(models.Workspace.slug == body.slug).first()
    )
    if existing:
        raise HTTPException(
            status_code=409, detail="Workspace with this slug already exists"
        )
    ws = models.Workspace(
        slug=body.slug,
        name=body.name,
        access_key_hash=hash_access_key(body.access_key),
    )
    db.add(ws)
    db.commit()
    db.refresh(ws)
    return ws


@router.patch("/workspaces/{workspace_id}", response_model=schemas.WorkspaceOut)
@limiter.limit("30/minute")
def update_workspace(
    request: Request,
    workspace_id: str,
    body: schemas.WorkspaceUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Обновить workspace."""
    ws = db.get(models.Workspace, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if body.name is not None:
        ws.name = body.name
    if body.access_key is not None:
        ws.access_key_hash = hash_access_key(body.access_key)
    db.commit()
    db.refresh(ws)
    return ws


@router.delete("/workspaces/{workspace_id}", status_code=204)
@limiter.limit("30/minute")
def delete_workspace(
    request: Request,
    workspace_id: str,
    db: Session = Depends(get_db),
    _: bool = Depends(get_admin_user),
):
    """Удалить workspace и все его доски."""
    ws = db.get(models.Workspace, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    db.delete(ws)
    db.commit()
