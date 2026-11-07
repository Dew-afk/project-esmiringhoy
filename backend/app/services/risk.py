"""Advisory risk scoring. Additive severity weights from settings — explicit,
configurable, and labeled as UNNAPPROVED implementation defaults until the
team adopts them. A high score never determines misconduct; the original
detector severity is never overwritten by review overrides in scoring."""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..core.config import settings
from .. import models


def severity_weight(severity: str) -> float:
    return settings.risk_weights.get(severity, 0.0)


def apply_event(db: Session, session_id: str, event: dict) -> None:
    """Upsert the session's single risk row. Idempotent against duplicates
    because ingestion dedupes by event_id before this runs."""
    row = db.query(models.RiskScores).filter(
        models.RiskScores.session_id == session_id
    ).first()
    if row is None:
        row = models.RiskScores(session_id=session_id, score=0.0)
        db.add(row)
    row.score += severity_weight(event.get("severity", "low"))
    row.last_updated = datetime.now(timezone.utc)
    session = db.get(models.ExamSession, session_id)
    if session is not None:
        session.last_event_at = datetime.now(timezone.utc)
