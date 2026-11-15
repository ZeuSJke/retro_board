"""Выпуск, проверка и отзыв токенов MCP-агентов команды."""

from datetime import UTC, datetime, timedelta
import hashlib
import secrets

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import models
from app.models import gen_uuid, now_utc

TOKEN_PREFIX = "rba_"
_LAST_USED_UPDATE_INTERVAL = timedelta(seconds=60)


def _as_utc(dt: datetime) -> datetime:
    """Привести datetime к UTC (SQLite возвращает naive datetime)."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def hash_token(raw_secret: str) -> str:
    """SHA-256 хэш секрета агентского токена."""
    return hashlib.sha256(raw_secret.encode("utf-8")).hexdigest()


def create_agent_token(
    db: Session,
    workspace_id: str,
    *,
    name: str,
    scope: str = "read_only",
    created_by_id: str | None = None,
) -> tuple[models.AgentToken, str]:
    """Выпустить новый токен агента и привязанного к нему участника (`kind="agent"`)."""
    raw_secret = f"{TOKEN_PREFIX}{secrets.token_urlsafe(32)}"
    participant = models.Participant(
        id=gen_uuid(),
        workspace_id=workspace_id,
        name=name,
        kind="agent",
    )
    db.add(participant)
    db.flush()

    token = models.AgentToken(
        id=gen_uuid(),
        workspace_id=workspace_id,
        participant_id=participant.id,
        name=name,
        token_prefix=raw_secret[:12],
        token_hash=hash_token(raw_secret),
        scope=scope,
        created_by_id=created_by_id,
    )
    db.add(token)
    db.commit()
    db.refresh(token)
    return token, raw_secret


def list_agent_tokens(db: Session, workspace_id: str) -> list[models.AgentToken]:
    """Список токенов агентов команды от новых к старым."""
    return (
        db.query(models.AgentToken)
        .filter(models.AgentToken.workspace_id == workspace_id)
        .order_by(models.AgentToken.created_at.desc())
        .all()
    )


def revoke_agent_token(
    db: Session, workspace_id: str, token_id: str
) -> models.AgentToken:
    """Отозвать токен агента и связанную с ним учётку участника."""
    token = (
        db.query(models.AgentToken)
        .filter(
            models.AgentToken.id == token_id,
            models.AgentToken.workspace_id == workspace_id,
        )
        .first()
    )
    if token is None:
        raise HTTPException(404, "Токен агента не найден")

    now = now_utc()
    changed = False
    if token.revoked_at is None:
        token.revoked_at = now
        changed = True

    participant = db.get(models.Participant, token.participant_id)
    if participant is not None and participant.revoked_at is None:
        participant.revoked_at = now
        changed = True

    if changed:
        db.commit()
        db.refresh(token)
    return token


def resolve_agent_token(
    db: Session, raw_secret: str
) -> tuple[models.AgentToken, models.Workspace, models.Participant] | None:
    """Проверить Bearer-токен агента.

    Намеренно не проверяет `Workspace.token_epoch`: ротация общего ключа входа
    в команду не отзывает выданные токены агентов.
    """
    if (
        not raw_secret
        or not raw_secret.startswith(TOKEN_PREFIX)
        or len(raw_secret) < 16
        or any(ch.isspace() for ch in raw_secret)
    ):
        return None

    token = (
        db.query(models.AgentToken)
        .filter(models.AgentToken.token_hash == hash_token(raw_secret))
        .first()
    )
    if token is None or token.revoked_at is not None:
        return None

    participant = db.get(models.Participant, token.participant_id)
    if (
        participant is None
        or participant.revoked_at is not None
        or participant.workspace_id != token.workspace_id
        or participant.kind != "agent"
    ):
        return None

    workspace = db.get(models.Workspace, token.workspace_id)
    if workspace is None:
        return None

    now = now_utc()
    if (
        token.last_used_at is None
        or (now - _as_utc(token.last_used_at)) >= _LAST_USED_UPDATE_INTERVAL
    ):
        token.last_used_at = now
        participant.last_seen_at = now
        db.commit()

    return token, workspace, participant
