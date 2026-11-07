"""Trusted ML event ingestion. Client-submitted event content is NOT accepted
(authoritative detections come from the ML pipeline via the token-authenticated
ingest path or the bridge worker). The client may only register the ML↔exam
session mapping (sessions.py)."""

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import get_db
from ..core.deps import require_proctor_or_admin
from .. import models, schemas
from ..services import queue

router = APIRouter(prefix="/ml", tags=["ml"])


@router.post("/events", status_code=202)
def ingest_ml_events(
    body: schemas.MlEventIngest,
    x_ml_token: str = Header(default=""),
    db: Session = Depends(get_db),
):
    """Trusted path: token-authenticated, mapped ML session required."""
    if x_ml_token != settings.ml_ingest_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid ML ingest token")
    mapping = db.query(models.MlSessionMap).filter(
        models.MlSessionMap.ml_session_id == body.ml_session_id
    ).first()
    if mapping is None:
        # Unmapped ML sessions are not exam sessions — never guess.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "ML session is not mapped to an exam session")
    for event in body.events:
        queue.enqueue(
            db,
            kind="ml_event",
            payload={
                "exam_session_id": mapping.exam_session_id,
                "ml_session_id": body.ml_session_id,
                **event.model_dump(),
            },
        )
    db.commit()
    return {"accepted": len(body.events)}


@router.get("/weights")
def risk_weights(user: models.UserAccount = Depends(require_proctor_or_admin)):
    """Explainable, configurable severity weights (UNNAPPROVED implementation
    defaults until the team adopts them — never presented as policy)."""
    return {
        "weights": settings.risk_weights,
        "status": "unapproved implementation defaults",
    }
