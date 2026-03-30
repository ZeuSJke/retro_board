from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.workspace_auth import verify_access_key, create_workspace_token
from app.limiter import limiter

router = APIRouter()


@router.post("/login", response_model=schemas.WorkspaceTokenResponse)
@limiter.limit("30/minute")
def workspace_login(request: Request, body: schemas.WorkspaceLoginRequest, db: Session = Depends(get_db)):
    """Вход в workspace с кодом команды и ключом доступа."""
    workspace = db.query(models.Workspace).filter(
        models.Workspace.slug == body.workspace_slug
    ).first()
    if not workspace or not verify_access_key(body.access_key, workspace.access_key_hash):
        raise HTTPException(status_code=401, detail="Неверный код команды или ключ доступа")
    token = create_workspace_token(workspace.id, workspace.slug, workspace.name)
    return schemas.WorkspaceTokenResponse(
        token=token,
        workspace_id=workspace.id,
        workspace_slug=workspace.slug,
        workspace_name=workspace.name,
    )
