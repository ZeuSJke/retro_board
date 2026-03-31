"""
Shared fixtures for RetroBoard backend tests.

Uses SQLite in-memory so no running PostgreSQL is needed.
The ARRAY(String) column (Card.likes) is patched to use a JSON-based
TypeDecorator that stores Python lists as JSON text in SQLite.
"""

import os, json, bcrypt

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
os.environ["TESTING"] = "true"

# ---------------------------------------------------------------------------
# WebSocket test workspace and token
# ---------------------------------------------------------------------------
# Create a dedicated workspace for WebSocket tests before other imports
from app.workspace_auth import create_workspace_token

_test_ws_id = "ws-for-websocket-tests"
_test_ws_slug = "ws-test"
_test_ws_name = "WebSocket Test Workspace"

# We'll create this workspace in the test DB via a fixture

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import TypeDecorator, Text

from fastapi.testclient import TestClient

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
from app.database import Base, get_db
from app.models import Card, ActionItem, BoardSummary

# Import app but patch lifespan so alembic is not invoked during tests
from contextlib import asynccontextmanager
import main as _main_module


@asynccontextmanager
async def _test_lifespan(app):
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


# Patch the underlying SA column type so SQLite can handle list<->json
Card.__table__.c.likes.type = JSONEncodedList()
ActionItem.__table__.c.source_card_ids.type = JSONEncodedList()
BoardSummary.__table__.c.key_themes.type = JSONEncodedList()
BoardSummary.__table__.c.recommendations.type = JSONEncodedList()

# ---------------------------------------------------------------------------
# Engine (single in-memory database shared across all threads)
# ---------------------------------------------------------------------------

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


@pytest.fixture()
def client():
    """FastAPI TestClient with the DB dependency overridden to use SQLite."""

    def _override():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
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


@pytest.fixture()
def workspace_headers(client, test_workspace):
    """Получить заголовки с X-Workspace-Token для тестовых запросов."""
    resp = client.post(
        "/api/workspaces/login",
        json={
            "workspace_slug": "test-team",
            "access_key": "testkey123",
        },
    )
    assert resp.status_code == 200
    token = resp.json()["token"]
    return {"X-Workspace-Token": token}


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
    from app.workspace_auth import create_workspace_token

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
def ws_token(ws_workspace):
    """Generate a valid workspace token for WebSocket tests."""
    from app.workspace_auth import create_workspace_token

    return create_workspace_token(
        workspace_id=ws_workspace.id,
        workspace_slug=ws_workspace.slug,
        workspace_name=ws_workspace.name,
    )


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
        ("Что прошло хорошо", "positive"),
        ("Что можно улучшить", "negative"),
        ("Благодарности", "neutral"),
    ]
    for i, (title, col_type) in enumerate(default_columns):
        col = Column(
            board_id=board.id,
            title=title,
            position=i,
            color="#6750A4",
        )
        db_session.add(col)
    db_session.commit()

    return board
