"""
Shared fixtures for RetroBoard backend tests.

Uses SQLite in-memory so no running PostgreSQL is needed.
The ARRAY(String) column (Card.likes) is patched to use a JSON-based
TypeDecorator that stores Python lists as JSON text in SQLite.
"""
import os, json

# Must be set before any app import — pydantic Settings needs it.
os.environ.setdefault("DATABASE_URL", "sqlite://")

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
from app.models import Card
from main import app

# Patch the underlying SA column type so SQLite can handle list<->json
Card.__table__.c.likes.type = JSONEncodedList()

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


# ── Helper fixtures ─────────────────────────────────────────────────────────


@pytest.fixture()
def sample_board(client):
    """Create a board and return its JSON."""
    resp = client.post("/api/boards/", json={"name": "Test Board"})
    assert resp.status_code == 201
    return resp.json()


@pytest.fixture()
def sample_column(client, sample_board):
    """Return the first default column of the sample board."""
    board = client.get(f"/api/boards/{sample_board['id']}").json()
    return board["columns"][0]


@pytest.fixture()
def sample_card(client, sample_column):
    """Create a card in the sample column and return its JSON."""
    resp = client.post("/api/cards/", json={
        "column_id": sample_column["id"],
        "text": "Test card",
        "author": "Tester",
        "color": "#FFEB3B",
    })
    assert resp.status_code == 201
    return resp.json()


@pytest.fixture()
def sample_group(client, sample_column):
    """Create a group in the sample column and return its JSON."""
    resp = client.post("/api/groups/", json={
        "column_id": sample_column["id"],
        "title": "Test Group",
    })
    assert resp.status_code == 201
    return resp.json()
