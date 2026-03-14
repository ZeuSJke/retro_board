import uuid
from fastapi import APIRouter, Depends, HTTPException
from slugify import slugify
from sqlalchemy.orm import Session

from app.database import get_db
from app import models, schemas

router = APIRouter()

DEFAULT_COLUMNS = [
    {"title": "😊 Что хорошо", "color": "#006E1C"},
    {"title": "😟 Что улучшить", "color": "#BA1A1A"},
    {"title": "💡 Идеи", "color": "#E8760A"},
]


def _make_slug(name: str) -> str:
    return slugify(name, max_length=80, word_boundary=True) or "board"


@router.get("/", response_model=list[schemas.BoardListItem])
def list_boards(db: Session = Depends(get_db)):
    return db.query(models.Board).order_by(models.Board.created_at.desc()).all()


@router.post("/", response_model=schemas.BoardOut, status_code=201)
def create_board(body: schemas.BoardCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Board).filter(models.Board.name == body.name).first()
    if existing:
        raise HTTPException(409, "Измени название, такая доска уже есть")
    uid = str(uuid.uuid4())
    board = models.Board(id=uid, name=body.name, slug=_make_slug(body.name))
    db.add(board)
    db.flush()
    for i, col in enumerate(DEFAULT_COLUMNS):
        db.add(models.Column(
            id=str(uuid.uuid4()),
            board_id=board.id,
            title=col["title"],
            color=col["color"],
            position=i,
        ))
    db.commit()
    db.refresh(board)
    return board


@router.get("/by-slug/{slug}", response_model=schemas.BoardOut)
def get_board_by_slug(slug: str, db: Session = Depends(get_db)):
    board = db.query(models.Board).filter(models.Board.slug == slug).first()
    if not board:
        raise HTTPException(404, "Board not found")
    return board


@router.get("/{board_id}", response_model=schemas.BoardOut)
def get_board(board_id: str, db: Session = Depends(get_db)):
    board = db.get(models.Board, board_id)
    if not board:
        raise HTTPException(404, "Board not found")
    return board


@router.patch("/{board_id}", response_model=schemas.BoardOut)
def update_board(board_id: str, body: schemas.BoardUpdate, db: Session = Depends(get_db)):
    board = db.get(models.Board, board_id)
    if not board:
        raise HTTPException(404, "Board not found")
    if body.name is not None:
        existing = db.query(models.Board).filter(
            models.Board.name == body.name, models.Board.id != board_id
        ).first()
        if existing:
            raise HTTPException(409, "Измени название, такая доска уже есть")
        board.name = body.name
        board.slug = _make_slug(body.name)
    db.commit()
    db.refresh(board)
    return board


@router.delete("/{board_id}", status_code=204)
def delete_board(board_id: str, db: Session = Depends(get_db)):
    board = db.get(models.Board, board_id)
    if not board:
        raise HTTPException(404, "Board not found")
    db.delete(board)
    db.commit()
