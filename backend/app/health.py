"""Health check команды: фиксированные вопросы со светофором и оценка встречи.

Вместо одной оценки настроения участник отвечает на несколько вопросов о
спринте (красный / жёлтый / зелёный) и в конце встречи одним нажатием
оценивает её пользу. Наружу отдаётся только сводка по доске и собственные
ответы участника — кто как ответил, команда не видит.
"""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models

# Значения светофора
RED, YELLOW, GREEN = 1, 2, 3

# Вопросы зашиты в код: менять их состав значит ломать сравнение между спринтами
QUESTIONS: list[dict[str, str]] = [
    {
        "key": "pace",
        "title": "Темп",
        "hint": "Успеваем без переработок и не простаиваем",
    },
    {
        "key": "quality",
        "title": "Качество",
        "hint": "Довольны тем, что выпускаем, и не тонем в багах",
    },
    {
        "key": "process",
        "title": "Процесс",
        "hint": "Наш способ работы помогает, а не мешает",
    },
    {
        "key": "atmosphere",
        "title": "Атмосфера",
        "hint": "В команде комфортно и можно говорить открыто",
    },
    {
        "key": "clarity",
        "title": "Ясность целей",
        "hint": "Понимаем, что делаем и зачем",
    },
]
QUESTION_KEYS: tuple[str, ...] = tuple(q["key"] for q in QUESTIONS)

# Оценка встречи: стоила ли она потраченного времени
ROTI_KEY = "roti"
ROTI_MIN, ROTI_MAX = 1, 5


def save_answers(
    db: Session, board_id: str, participant_id: str, answers: dict[str, int]
) -> None:
    """Записать ответы участника (без commit): повторный ответ заменяет прежний."""
    existing = {
        row.question: row
        for row in db.query(models.BoardHealthAnswer).filter(
            models.BoardHealthAnswer.board_id == board_id,
            models.BoardHealthAnswer.participant_id == participant_id,
            models.BoardHealthAnswer.question.in_(list(answers)),
        )
    }
    for question, value in answers.items():
        row = existing.get(question)
        if row is None:
            db.add(
                models.BoardHealthAnswer(
                    board_id=board_id,
                    participant_id=participant_id,
                    question=question,
                    value=value,
                )
            )
        else:
            row.value = value
            row.created_at = models.now_utc()


def _empty_question(question: dict[str, str]) -> dict:
    return {**question, "red": 0, "yellow": 0, "green": 0, "answers": 0, "average": None}


def board_summary(db: Session, board_id: str, viewer_id: str | None) -> dict:
    """Сводка по доске: распределение ответов по вопросам, оценка встречи, ответы участника."""
    rows = (
        db.query(
            models.BoardHealthAnswer.question,
            models.BoardHealthAnswer.value,
            func.count(models.BoardHealthAnswer.id),
        )
        .filter(models.BoardHealthAnswer.board_id == board_id)
        .group_by(models.BoardHealthAnswer.question, models.BoardHealthAnswer.value)
        .all()
    )
    counts: dict[str, dict[int, int]] = {}
    for question, value, count in rows:
        counts.setdefault(question, {})[value] = count

    questions = []
    for q_def in QUESTIONS:
        by_value = counts.get(q_def["key"], {})
        item = _empty_question(q_def)
        item["red"] = by_value.get(RED, 0)
        item["yellow"] = by_value.get(YELLOW, 0)
        item["green"] = by_value.get(GREEN, 0)
        item["answers"] = item["red"] + item["yellow"] + item["green"]
        if item["answers"]:
            total = RED * item["red"] + YELLOW * item["yellow"] + GREEN * item["green"]
            item["average"] = round(total / item["answers"], 2)
        questions.append(item)

    roti_counts = counts.get(ROTI_KEY, {})
    roti_answers = sum(roti_counts.values())
    roti_average = (
        round(sum(value * count for value, count in roti_counts.items()) / roti_answers, 2)
        if roti_answers
        else None
    )

    participants = (
        db.query(func.count(func.distinct(models.BoardHealthAnswer.participant_id)))
        .filter(
            models.BoardHealthAnswer.board_id == board_id,
            models.BoardHealthAnswer.question != ROTI_KEY,
        )
        .scalar()
        or 0
    )

    mine: dict[str, int] = {}
    if viewer_id:
        mine = {
            row.question: row.value
            for row in db.query(models.BoardHealthAnswer).filter(
                models.BoardHealthAnswer.board_id == board_id,
                models.BoardHealthAnswer.participant_id == viewer_id,
            )
        }

    return {
        "board_id": board_id,
        "participants": participants,
        "questions": questions,
        "roti": {"average": roti_average, "answers": roti_answers},
        "mine": mine,
    }


def workspace_trends(db: Session, workspace_id: str) -> list[dict]:
    """Средние по вопросам и оценка встречи по доскам команды, от старых к новым.

    Доски без единого ответа пропускаются: пустая точка на графике ничего не говорит.
    """
    boards = (
        db.query(models.Board.id, models.Board.name, models.Board.created_at)
        .filter(
            models.Board.workspace_id == workspace_id,
            models.Board.deleted_at.is_(None),
        )
        .order_by(models.Board.created_at)
        .all()
    )
    if not boards:
        return []
    rows = (
        db.query(
            models.BoardHealthAnswer.board_id,
            models.BoardHealthAnswer.question,
            func.avg(models.BoardHealthAnswer.value),
            func.count(models.BoardHealthAnswer.id),
        )
        .filter(models.BoardHealthAnswer.board_id.in_([b.id for b in boards]))
        .group_by(models.BoardHealthAnswer.board_id, models.BoardHealthAnswer.question)
        .all()
    )
    by_board: dict[str, dict[str, tuple[float, int]]] = {}
    for board_id, question, average, count in rows:
        by_board.setdefault(board_id, {})[question] = (round(float(average), 2), count)

    points = []
    for board in boards:
        answers = by_board.get(board.id)
        if not answers:
            continue
        roti = answers.get(ROTI_KEY)
        points.append(
            {
                "board_id": board.id,
                "board_name": board.name,
                "created_at": board.created_at,
                "averages": {key: answers[key][0] for key in QUESTION_KEYS if key in answers},
                "roti_average": roti[0] if roti else None,
            }
        )
    return points
