from fastapi import HTTPException
from sqlalchemy.orm import Session


def get_or_404(db: Session, model, entity_id: str, detail: str = "Not found"):
    """Get entity by ID or raise 404."""
    obj = db.get(model, entity_id)
    if not obj:
        raise HTTPException(404, detail)
    return obj
