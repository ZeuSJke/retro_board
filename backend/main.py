from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from app.config import settings
from app.database import engine
from app.routers import boards, cards, columns, groups, websocket
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    alembic_cfg = Config("alembic.ini")
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    if tables and "alembic_version" not in tables:
        # Existing DB without Alembic — stamp current state
        command.stamp(alembic_cfg, "head")
    else:
        command.upgrade(alembic_cfg, "head")
    yield


app = FastAPI(
    title="RetroBoard API",
    description="Agile Retro Board — FastAPI + PostgreSQL",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(boards.router, prefix="/api/boards", tags=["boards"])
app.include_router(columns.router, prefix="/api/columns", tags=["columns"])
app.include_router(cards.router, prefix="/api/cards", tags=["cards"])
app.include_router(groups.router, prefix="/api/groups", tags=["groups"])
app.include_router(websocket.router, tags=["websocket"])


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}
