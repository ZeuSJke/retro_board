"""
Shared fixtures for RetroBoard backend tests.

По умолчанию — SQLite in-memory: PostgreSQL для прогона не нужен, а колонки
ARRAY подменяются JSON-текстом. Чтобы прогнать тот же набор на настоящем
PostgreSQL (блокировки, типы, длины строк, проверка доски в WebSocket),
задайте TEST_DATABASE_URL — так тесты идут в CI и так их можно запустить
локально на встроенном сервере из пакета pgserver.
"""

import json
import os

import bcrypt

# Must be set before any app import — pydantic Settings needs it.
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault(
    "WORKSPACE_JWT_SECRET", "test-workspace-jwt-secret-at-least-32-chars-long"
)
os.environ.setdefault(
    "ADMIN_JWT_SECRET", "test-admin-jwt-secret-at-least-32-chars-long"
)
os.environ.setdefault("ADMIN_LOGIN", "testadmin")
os.environ.setdefault("ADMIN_PASSWORD", "testpassword123")
_existing_mcp_hosts = os.environ.get("MCP_ALLOWED_HOSTS", "")
os.environ["MCP_ALLOWED_HOSTS"] = ",".join(
    part for part in (_existing_mcp_hosts, "testserver", "testclient") if part
)
os.environ["TESTING"] = "true"

# ---------------------------------------------------------------------------
# WebSocket test workspace and token
# ---------------------------------------------------------------------------
_test_ws_id = "ws-for-websocket-tests"
_test_ws_slug = "ws-test"
_test_ws_name = "WebSocket Test Workspace"

# We'll create this workspace in the test DB via a fixture

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import Text, TypeDecorator

# ---------------------------------------------------------------------------
# TypeDecorator that stores a Python list as JSON text (for SQLite)
# ---------------------------------------------------------------------------


class JSONEncodedList(TypeDecorator):
    """Stores a Python list as a JSON string in SQLite."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return "[]"
        return json.dumps(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return []
        return json.loads(value)


# ---------------------------------------------------------------------------
# Import app AFTER env is set, then patch the likes column type
# ---------------------------------------------------------------------------
# Import app but patch lifespan so alembic is not invoked during tests
from contextlib import asynccontextmanager, contextmanager

from sqlalchemy import ARRAY

import main as _main_module
from app import models as app_models  # noqa: F401 — импорт ради регистрации мапперов
from app.database import Base, get_db


@asynccontextmanager
async def _test_lifespan(app):
    from app.mcp import mcp_lifespan

    async with mcp_lifespan():
        yield


_main_module.app.router.lifespan_context = _test_lifespan
app = _main_module.app

# Disable rate limiting in tests by default
from app.limiter import limiter

limiter.enabled = False

# Disable CSRF in tests via settings
from app.config import settings

settings.csrf_enabled = False


# Test-only endpoint to verify global error handler
@app.get("/api/test-500")
def _test_500_endpoint():
    raise RuntimeError("test error")


# ---------------------------------------------------------------------------
# Engine: SQLite in-memory по умолчанию или PostgreSQL из TEST_DATABASE_URL
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
USE_POSTGRES = TEST_DATABASE_URL.startswith(("postgresql", "postgres://"))

if USE_POSTGRES:
    from app.config import Settings

    engine = create_engine(
        Settings(database_url=TEST_DATABASE_URL).sqlalchemy_database_url, pool_pre_ping=True
    )
else:
    # Patch ALL ARRAY columns to JSONEncodedList so SQLite can handle list<->json.
    # Auto-walk every mapped model — new ARRAY columns are covered without
    # touching this file (аудит: каждая новая ARRAY-колонка обязана идти через
    # этот декоратор, иначе тесты на SQLite упадут).
    for _mapper in Base.registry.mappers:
        _table = getattr(_mapper.class_, "__table__", None)
        if _table is None:
            continue
        for _col in _table.columns:
            if isinstance(_col.type, ARRAY):
                _col.type = JSONEncodedList()

    # Single in-memory database shared across all threads
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _rec):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
        # Встроенный SQLite lower() складывает только ASCII; подменяем для кириллицы,
        # чтобы func.lower() в запросах совпадал с PostgreSQL UTF-8.
        dbapi_conn.create_function(
            "lower", 1, lambda s: s.lower() if isinstance(s, str) else s
        )


TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _setup_tables():
    """Create tables before and drop after every test."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def _reset_ws_manager():
    """Сбрасывать in-memory состояние ws_manager между тестами.

    ConnectionManager — синглтон процесса: rooms/usernames/facilitators/
    phases/timers/session_ids иначе протекают из теста в тест и дают
    ложные presence/facilitator/timer-состояния.
    """
    from app.ai import ai_client
    from app.mcp import mcp_rate_limiter
    from app.services.ai_settings import (
        invalidate_ai_settings_cache,
        set_ai_settings_db_session_factory,
    )
    from app.ws_manager import manager as _ws_manager

    _ws_manager.reset()
    mcp_rate_limiter.reset()
    set_ai_settings_db_session_factory(TestSessionLocal)
    invalidate_ai_settings_cache()
    ai_client.reset_shared_client()
    yield
    _ws_manager.reset()
    mcp_rate_limiter.reset()
    set_ai_settings_db_session_factory(None)
    invalidate_ai_settings_cache()
    ai_client.reset_shared_client()


@pytest.fixture()
def client():
    """FastAPI TestClient with the DB dependency overridden to use SQLite."""
    from app.mcp import set_db_session_factory

    def _override():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    set_db_session_factory(TestSessionLocal)
    with TestClient(app) as c:
        yield c
    set_db_session_factory(None)
    app.dependency_overrides.clear()


# ── Workspace fixtures ──────────────────────────────────────────────────────


@pytest.fixture()
def test_workspace(db_session):
    """Создать тестовый workspace в БД напрямую."""
    from app.models import Workspace

    ws = Workspace(
        id="test-workspace-id",
        slug="test-team",
        name="Test Team",
        access_key_hash=bcrypt.hashpw(b"testkey123", bcrypt.gensalt(rounds=4)).decode(),
    )
    db_session.add(ws)
    db_session.commit()
    return ws


def login_headers(client, name: str, slug: str = "test-team", key: str = "testkey123") -> dict:
    """Войти в команду под именем `name` и вернуть заголовки нового участника.

    Каждый вход создаёт отдельного участника — так тесты изображают разных людей.
    Токен сессии сервер отдаёт только в cookie; для запросов передаём его заголовком,
    который сервер принимает от неинтерактивных клиентов.
    """
    resp = client.post(
        "/api/workspaces/login",
        json={"workspace_slug": slug, "access_key": key, "name": name},
    )
    assert resp.status_code == 200, resp.text
    headers = {"X-Workspace-Token": resp.cookies["workspace_token"]}
    # Cookie в клиенте не оставляем: иначе она подмешивалась бы в запросы других участников
    client.cookies.clear()
    return headers


def participant_id_of(client, headers: dict) -> str:
    return client.get("/api/workspaces/me", headers=headers).json()["participant"]["id"]


@pytest.fixture()
def workspace_headers(client, test_workspace):
    """Заголовки участника «Tester» в тестовой команде."""
    return login_headers(client, "Tester")


@pytest.fixture()
def login_as(client, test_workspace):
    """Фабрика: `login_as("Аня")` → заголовки ещё одного участника той же команды."""
    return lambda name: login_headers(client, name)


@pytest.fixture()
def admin_headers(client):
    """Получить заголовки с admin_token cookie для тестовых запросов."""
    from app.config import settings

    resp = client.post(
        "/api/admin/login",
        json={
            "login": settings.admin_login,
            "password": settings.admin_password,
        },
    )
    assert resp.status_code == 200
    # Приходится вручную вытащить cookie из ответа
    token = resp.cookies["admin_token"]
    return {"Cookie": f"admin_token={token}"}


# ── DB session fixture ───────────────────────────────────────────────────────


@pytest.fixture()
def db_session():
    """Предоставить сессию БД для фикстур."""
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def configure_ai(
    *,
    enabled: bool = True,
    base_url: str = "https://llm.test/v1",
    model: str = "test-model",
    api_key: str = "",
    reasoning_effort: str = "default",
):
    """Временно задать настройки ИИ в тестовой БД и сбросить кэш процесса."""
    from app.models import AISettings, now_utc
    from app.services.ai_settings import encrypt_api_key, invalidate_ai_settings_cache

    with TestSessionLocal() as db:
        prev = db.get(AISettings, 1)
        prev_snapshot = (
            {
                "enabled": prev.enabled,
                "base_url": prev.base_url,
                "api_key_encrypted": prev.api_key_encrypted,
                "model": prev.model,
                "reasoning_effort": prev.reasoning_effort,
                "updated_at": prev.updated_at,
            }
            if prev is not None
            else None
        )
        if not enabled and not base_url:
            if prev is not None:
                db.delete(prev)
                db.commit()
        else:
            row = prev or AISettings(id=1)
            if prev is None:
                db.add(row)
            row.enabled = enabled
            row.base_url = base_url
            row.api_key_encrypted = encrypt_api_key(api_key) if api_key else None
            row.model = model
            row.reasoning_effort = reasoning_effort
            row.updated_at = now_utc()
            db.commit()

    invalidate_ai_settings_cache()
    try:
        yield
    finally:
        with TestSessionLocal() as db:
            row = db.get(AISettings, 1)
            if prev_snapshot is None:
                if row is not None:
                    db.delete(row)
                    db.commit()
            else:
                if row is None:
                    row = AISettings(id=1)
                    db.add(row)
                for field, value in prev_snapshot.items():
                    setattr(row, field, value)
                db.commit()
        invalidate_ai_settings_cache()


# ── Helper fixtures ─────────────────────────────────────────────────────────


@pytest.fixture()
def sample_board(client, workspace_headers):
    """Create a board and return its JSON."""
    resp = client.post(
        "/api/boards/", json={"name": "Test Board"}, headers=workspace_headers
    )
    assert resp.status_code == 201
    return resp.json()


@pytest.fixture()
def sample_column(client, sample_board, workspace_headers):
    """Return the first default column of the sample board."""
    board = client.get(
        f"/api/boards/{sample_board['id']}", headers=workspace_headers
    ).json()
    return board["columns"][0]


@pytest.fixture()
def sample_card(client, sample_column, workspace_headers):
    """Create a card in the sample column and return its JSON."""
    resp = client.post(
        "/api/cards/",
        json={
            "column_id": sample_column["id"],
            "text": "Test card",
            "author": "Tester",
            "color": "#FFEB3B",
        },
        headers=workspace_headers,
    )
    assert resp.status_code == 201
    return resp.json()


@pytest.fixture()
def sample_group(client, sample_column, workspace_headers):
    """Create a group in the sample column and return its JSON."""
    resp = client.post(
        "/api/groups/",
        json={
            "column_id": sample_column["id"],
            "title": "Test Group",
        },
        headers=workspace_headers,
    )
    assert resp.status_code == 201
    return resp.json()


# ── WebSocket test fixtures ──────────────────────────────────────────────────


@pytest.fixture()
def ws_workspace(db_session):
    """Create a workspace for WebSocket tests."""
    from app.models import Workspace

    ws = Workspace(
        id="ws-for-websocket-tests",
        slug="ws-test",
        name="WebSocket Test Workspace",
        access_key_hash=bcrypt.hashpw(
            b"ws-test-key", bcrypt.gensalt(rounds=4)
        ).decode(),
    )
    db_session.add(ws)
    db_session.commit()
    return ws


@pytest.fixture()
def ws_token_for(db_session, ws_workspace):
    """Фабрика токенов: `ws_token_for("Аня")` — новый участник команды WebSocket-тестов.

    Личность сокета сервер берёт из токена, поэтому разные люди в тесте —
    это разные токены, а не разные имена в сообщении identify.
    """
    from app.models import Participant
    from app.workspace_auth import issue_session_token

    def make(name: str = "Tester") -> str:
        participant = Participant(workspace_id=ws_workspace.id, name=name)
        db_session.add(participant)
        db_session.commit()
        db_session.refresh(participant)
        return issue_session_token(ws_workspace, participant)

    return make


@pytest.fixture()
def ws_token(ws_token_for):
    """Токен одного участника для тестов, которым не важно, кто подключён."""
    return ws_token_for("Tester")


@pytest.fixture()
def ensure_board(db_session, ws_workspace):
    """Фабрика: `ensure_board("board-1")` создаёт доску с таким идентификатором, если её нет.

    WebSocket подключается только к существующей доске своей команды, поэтому
    тестам, которым важен сам обмен сообщениями, достаточно пустой доски.
    """
    from app.models import Board

    def make(board_id: str) -> str:
        if db_session.get(Board, board_id) is None:
            db_session.add(
                Board(id=board_id, name=f"Доска {board_id}", slug=board_id, workspace_id=ws_workspace.id)
            )
            db_session.commit()
        return board_id

    return make


@pytest.fixture()
def ws_board(db_session, ws_workspace):
    """Create a board in the WebSocket test workspace."""
    from app.models import Board, Column

    board = Board(
        id="ws-test-board",
        name="WS Test Board",
        slug="ws-test-board",
        workspace_id=ws_workspace.id,
    )
    db_session.add(board)
    db_session.commit()

    default_columns = [
        "Что прошло хорошо",
        "Что можно улучшить",
        "Благодарности",
    ]
    for i, title in enumerate(default_columns):
        col = Column(
            board_id=board.id,
            title=title,
            position=i,
            color="#6750A4",
        )
        db_session.add(col)
    db_session.commit()

    return board
