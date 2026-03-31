import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.workspace_auth import verify_access_key, create_workspace_token
from app.config import settings
from app.limiter import limiter

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/login", response_model=schemas.WorkspaceTokenResponse)
@limiter.limit("30/minute")
def workspace_login(
    request: Request,
    response: Response,
    body: schemas.WorkspaceLoginRequest,
    db: Session = Depends(get_db),
):
    """Вход в workspace с кодом команды и ключом доступа."""
    try:
        workspace = (
            db.query(models.Workspace)
            .filter(models.Workspace.slug == body.workspace_slug)
            .first()
        )
        if not workspace:
            raise HTTPException(
                status_code=401, detail="Неверный код команды или ключ доступа"
            )

        if not verify_access_key(body.access_key, workspace.access_key_hash):
            raise HTTPException(
                status_code=401, detail="Неверный код команды или ключ доступа"
            )

        token = create_workspace_token(workspace.id, workspace.slug, workspace.name)

        response.set_cookie(
            key="workspace_token",
            value=token,
            httponly=True,
            samesite="lax",
            max_age=settings.workspace_jwt_expire_hours * 3600,
            secure=True,
        )

        return schemas.WorkspaceTokenResponse(
            token=token,
            workspace_id=workspace.id,
            workspace_slug=workspace.slug,
            workspace_name=workspace.name,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Workspace login error: {type(e).__name__}: {e}")
        raise
