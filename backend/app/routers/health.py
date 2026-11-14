"""Health check команды и оценка встречи.

Подключается с тем же префиксом, что и доски, и раньше них: статические
пути (`/health/questions`, `/health-trends`) не должен перехватить `/{board_id}`.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app import health, models, schemas
from app.database import get_db
from app.limiter import TEAM_READ_LIMIT, TEAM_WRITE_LIMIT, limiter
from app.utils import get_or_404, require_live_board
from app.workspace_auth import get_current_participant, get_current_workspace
from app.ws_manager import manager

router = APIRouter()


def _live_board(db: Session, board_id: str, workspace_id: str) -> models.Board:
    # Опрос и оценка встречи доступны и на заблокированной доске: встреча уже прошла
    return require_live_board(get_or_404(db, models.Board, board_id, "Board not found"), workspace_id)


async def _broadcast_summary(db: Session, board_id: str) -> None:
    """Разослать сводку без личных ответов: свои ответы клиент знает сам."""
    summary = health.board_summary(db, board_id, None)
    summary.pop("mine", None)
    await manager.broadcast(board_id, "health_updated", summary)


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
    board = _live_board(db, board_id, workspace.id)
    health.save_answers(db, board.id, participant.id, body.answers)
    db.commit()
    await _broadcast_summary(db, board.id)
    return health.board_summary(db, board.id, participant.id)


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
    board = _live_board(db, board_id, workspace.id)
    health.save_answers(db, board.id, participant.id, {health.ROTI_KEY: body.value})
    db.commit()
    await _broadcast_summary(db, board.id)
    return health.board_summary(db, board.id, participant.id)
