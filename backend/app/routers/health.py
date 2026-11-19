"""Health check команды и оценка встречи.

Подключается с тем же префиксом, что и доски, и раньше них: статические
пути (`/health/questions`, `/health-trends`) не должен перехватить `/{board_id}`.
"""

import anyio
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app import health, models, schemas
from app.database import get_db, release_connection
from app.limiter import TEAM_READ_LIMIT, TEAM_WRITE_LIMIT, limiter
from app.utils import get_or_404, require_live_board
from app.workspace_auth import get_current_participant, get_current_workspace
from app.ws_manager import manager

router = APIRouter()


def _live_board(db: Session, board_id: str, workspace_id: str) -> models.Board:
    # Опрос и оценка встречи доступны и на заблокированной доске: встреча уже прошла
    return require_live_board(get_or_404(db, models.Board, board_id, "Доска не найдена"), workspace_id)


@router.get("/health/questions", response_model=list[schemas.HealthQuestion])
@limiter.limit(TEAM_READ_LIMIT)
def list_health_questions(
    request: Request,
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Вопросы health check: одинаковые для всех досок, чтобы спринты были сравнимы."""
    return health.QUESTIONS


@router.get("/health-trends", response_model=list[schemas.HealthTrendPoint])
@limiter.limit(TEAM_READ_LIMIT)
def get_health_trends(
    request: Request,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
):
    """Средние по вопросам и оценка встречи по доскам команды, от старых к новым."""
    return health.workspace_trends(db, workspace.id)


@router.get("/{board_id}/health", response_model=schemas.HealthSummaryOut)
@limiter.limit(TEAM_READ_LIMIT)
def get_board_health(
    request: Request,
    board_id: str,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Сводка health check по доске и собственные ответы участника."""
    board = _live_board(db, board_id, workspace.id)
    return health.board_summary(db, board.id, participant.id)


@router.post("/{board_id}/health", response_model=schemas.HealthSummaryOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def answer_board_health(
    request: Request,
    board_id: str,
    body: schemas.HealthAnswersIn,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Ответить на вопросы health check (можно частично; повторный ответ заменяет прежний)."""
    workspace_id = workspace.id
    participant_id = participant.id

    def _op():
        board = _live_board(db, board_id, workspace_id)
        health.save_answers_and_commit(db, board.id, participant_id, body.answers)
        personal = health.board_summary(db, board.id, participant_id)
        broadcast_payload = {k: v for k, v in personal.items() if k != "mine"}
        resolved_id = board.id
        release_connection(db)
        return resolved_id, personal, broadcast_payload

    resolved_id, personal, broadcast_payload = await anyio.to_thread.run_sync(_op)
    await manager.broadcast(resolved_id, "health_updated", broadcast_payload)
    return personal


@router.post("/{board_id}/roti", response_model=schemas.HealthSummaryOut)
@limiter.limit(TEAM_WRITE_LIMIT)
async def rate_meeting(
    request: Request,
    board_id: str,
    body: schemas.RotiIn,
    db: Session = Depends(get_db),
    workspace: models.Workspace = Depends(get_current_workspace),
    participant: models.Participant = Depends(get_current_participant),
):
    """Оценить встречу одним числом от 1 до 5."""
    workspace_id = workspace.id
    participant_id = participant.id

    def _op():
        board = _live_board(db, board_id, workspace_id)
        health.save_answers_and_commit(db, board.id, participant_id, {health.ROTI_KEY: body.value})
        personal = health.board_summary(db, board.id, participant_id)
        broadcast_payload = {k: v for k, v in personal.items() if k != "mine"}
        resolved_id = board.id
        release_connection(db)
        return resolved_id, personal, broadcast_payload

    resolved_id, personal, broadcast_payload = await anyio.to_thread.run_sync(_op)
    await manager.broadcast(resolved_id, "health_updated", broadcast_payload)
    return personal
