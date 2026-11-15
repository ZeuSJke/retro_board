"""Контекст аутентифицированного MCP-агента и доступ к сессии БД."""

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.database import SessionLocal


@dataclass(frozen=True)
class AgentContext:
    token_id: str
    workspace_id: str
    participant_id: str
    agent_name: str
    scope: str  # "read_only" | "read_write"


_agent_ctx_var: ContextVar[AgentContext | None] = ContextVar("mcp_agent_ctx", default=None)
_session_factory: Callable[[], Session] = SessionLocal


def set_db_session_factory(factory: Callable[[], Session] | None) -> None:
    """Настроить фабрику DB-сессий для MCP (`None` возвращает `SessionLocal`)."""
    global _session_factory
    _session_factory = factory if factory is not None else SessionLocal


def set_agent_context(ctx: AgentContext) -> Token[AgentContext | None]:
    return _agent_ctx_var.set(ctx)


def reset_agent_context(token: Token[AgentContext | None]) -> None:
    _agent_ctx_var.reset(token)


def get_agent_context() -> AgentContext:
    ctx = _agent_ctx_var.get()
    if ctx is None:
        raise RuntimeError("MCP AgentContext is not set for the current request")
    return ctx


@contextmanager
def open_db_session() -> Iterator[Session]:
    """Открыть DB-сессию через настроенную фабрику сессий."""
    db = _session_factory()
    try:
        yield db
    finally:
        db.close()
