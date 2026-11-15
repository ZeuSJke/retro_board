"""Контекст аутентифицированного MCP-агента и доступ к сессии БД."""

from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Iterator

from sqlalchemy.orm import Session

from app.database import get_db


@dataclass(frozen=True)
class AgentContext:
    token_id: str
    workspace_id: str
    workspace_slug: str
    workspace_name: str
    participant_id: str
    agent_name: str
    scope: str  # "read_only" | "read_write"


_agent_ctx_var: ContextVar[AgentContext | None] = ContextVar("mcp_agent_ctx", default=None)
_app_ref = None


def bind_fastapi_app(fastapi_app) -> None:
    """Привязать FastAPI-приложение, чтобы MCP-хендлеры видели dependency_overrides."""
    global _app_ref
    _app_ref = fastapi_app


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
    """Открыть DB-сессию с учётом FastAPI dependency_overrides[get_db] в тестах."""
    dep = get_db
    if _app_ref is not None and get_db in _app_ref.dependency_overrides:
        dep = _app_ref.dependency_overrides[get_db]
    gen = dep()
    db = next(gen)
    try:
        yield db
    finally:
        try:
            next(gen)
        except StopIteration:
            pass
        else:
            gen.close()
