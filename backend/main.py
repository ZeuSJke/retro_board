from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.database import engine, Base
from app.routers import boards, columns, cards, websocket


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="RetroBoard API",
    description="Agile Retro Board — FastAPI + PostgreSQL",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(boards.router, prefix="/api/boards", tags=["boards"])
app.include_router(columns.router, prefix="/api/columns", tags=["columns"])
app.include_router(cards.router, prefix="/api/cards", tags=["cards"])
app.include_router(websocket.router, tags=["websocket"])


@app.get("/health")
def health():
    return {"status": "ok"}
