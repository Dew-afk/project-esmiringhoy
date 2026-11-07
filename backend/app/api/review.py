"""Proctor review workflow (SRS 3.1.3, SDD §5.6). Every mutation is
audit-logged; severity overrides retain the original detector-assigned value."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.deps import require_proctor_or_admin
from .. import models, schemas
from ..services.audit import audit

router = APIRouter(tags=["review"])

BULK_ELIGIBLE = {"low"}


def _own_event(db: Session, user: models.UserAccount, event_id: str) -> models.EventsFlags:
    e = db.query(models.EventsFlags).filter(models.EventsFlags.event_id == event_id).first()
    if e is None:
        raise HTTPException(404, "Event not found")
    session = db.get(models.ExamSession, e.session_id)
    if session is None or session.exam.institution_id != user.institution_id:
        raise HTTPException(403, "Not your institution")
    return e


@router.post("/events/{event_id}/review")
def review_event(
    event_id: str,
    body: schemas.ReviewRequest,
    user: models.UserAccount = Depends(require_proctor_or_admin),
    db: Session = Depends(get_db),
):
    e = _own_event(db, user, event_id)
    action_map = {
        "acknowledge": "acknowledged",
        "dismiss": "dismissed",
        "escalate": "escalated",
    }
    if body.action in action_map:
        e.review_status = action_map[body.action]
    elif body.action == "note":
        e.reviewer_note = body.note
    elif body.action == "override":
        if body.severity is None:
            raise HTTPException(422, "severity is required for override")
        e.severity_override = body.severity  # original stays in e.severity
    audit(
        db,
        actor=user.email,
        action=f"REVIEW_EVENT:{body.action}",
        target=event_id,
        detail=f"note={body.note!r}" if body.note else f"severity={body.severity}" if body.severity else "",
    )
    db.commit()
    return {"event_id": event_id, "review_status": e.review_status,
            "severity": e.severity, "severity_override": e.severity_override}


@router.post("/sessions/{session_id}/bulk-review")
def bulk_review(
    session_id: str,
    body: schemas.BulkReviewRequest,
    user: models.UserAccount = Depends(require_proctor_or_admin),
    db: Session = Depends(get_db),
):
    session = db.get(models.ExamSession, session_id)
    if session is None or session.exam.institution_id != user.institution_id:
        raise HTTPException(403, "Not your institution")
    rows = (
        db.query(models.EventsFlags)
        .filter(models.EventsFlags.session_id == session_id)
        .filter(models.EventsFlags.event_id.in_(body.event_ids))
        .all()
    )
    invalid = [e.event_id for e in rows if (e.severity_override or e.severity) not in BULK_ELIGIBLE]
    if invalid:
        raise HTTPException(422, f"Bulk review only applies to low-severity events: {invalid}")
    for e in rows:
        e.review_status = "dismissed"
    audit(db, actor=user.email, action="BULK_DISMISS", target=session_id, detail=str(body.event_ids))
    db.commit()
    return {"dismissed": len(rows)}
