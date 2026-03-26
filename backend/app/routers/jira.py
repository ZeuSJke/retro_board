import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas
from app.config import settings
from app.ws_manager import manager
from app.limiter import limiter

router = APIRouter()


@router.get("/status", response_model=schemas.JiraStatus)
@limiter.limit("30/minute")
async def jira_status(request: Request):
    return schemas.JiraStatus(configured=settings.jira_configured)


@router.post("/create-issue", response_model=schemas.JiraIssueResult)
@limiter.limit("10/minute")
async def create_jira_issue(request: Request, body: schemas.JiraCreateIssue, db: Session = Depends(get_db)):
    if not settings.jira_configured:
        raise HTTPException(503, "Jira integration is not configured")

    item = db.get(models.ActionItem, body.action_item_id)
    if not item:
        raise HTTPException(404, "Action item not found")
    if item.jira_issue_key:
        raise HTTPException(409, f"Action item already linked to Jira issue {item.jira_issue_key}")

    jira_payload = {
        "fields": {
            "project": {"key": body.project_key},
            "summary": body.summary,
            "description": body.description,
            "issuetype": {"name": body.issue_type},
        }
    }

    try:
        async with httpx.AsyncClient(timeout=15.0, verify=settings.jira_verify_ssl) as client:
            resp = await client.post(
                f"{settings.jira_url.rstrip('/')}/rest/api/2/issue",
                json=jira_payload,
                auth=(settings.jira_email, settings.jira_api_token),
            )
            if resp.status_code >= 400:
                detail = resp.text[:500]
                raise HTTPException(502, f"Jira API error ({resp.status_code}): {detail}")
            result = resp.json()
    except httpx.RequestError as e:
        raise HTTPException(502, f"Failed to connect to Jira: {e}")

    jira_key = result.get("key", "")
    item.jira_issue_key = jira_key
    db.commit()
    db.refresh(item)

    out = schemas.ActionItemOut.model_validate(item)
    await manager.broadcast(item.board_id, "action_item_updated", out.model_dump(mode="json"))

    jira_url = f"{settings.jira_url.rstrip('/')}/browse/{jira_key}"
    return schemas.JiraIssueResult(jira_issue_key=jira_key, jira_url=jira_url)
