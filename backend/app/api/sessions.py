import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.deps import (
    current_consent,
    get_current_user,
    require_proctor_or_admin,
)
from .. import models, schemas
from ..models import ensure_utc
from ..schemas import EventOut

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _session_out(db: Session, s: models.ExamSession) -> dict:
    risk = db.query(models.RiskScores).filter(models.RiskScores.session_id == s.id).first()
    flags = (
        db.query(models.EventsFlags)
        .filter(models.EventsFlags.session_id == s.id)
        .all()
    )
    highest = max(
        (f.severity_override or f.severity for f in flags),
        key=lambda sev: {"low": 1, "medium": 2, "high": 3, "critical": 4}.get(sev, 0),
        default=None,
    )
    return {
        "session_id": s.id,
        "exam_id": s.exam_id,
        "student_id": s.student_id,
        "student_name": s.student.full_name,
        "exam_title": s.exam.title,
        "institution_id": s.exam.institution_id,
        "status": s.status,
        "start_time": s.start_time,
        "end_time": s.end_time,
        "risk_score": risk.score if risk else None,
        "last_event_at": s.last_event_at,
        "flag_count": len(flags),
        "highest_severity": highest,
    }


def _own_session(db: Session, user: models.UserAccount, session_id: str) -> models.ExamSession:
    s = db.get(models.ExamSession, session_id)
    if s is None:
        raise HTTPException(404, "Session not found")
    allowed = (
        user.id == s.student_id
        or (user.role in ("proctor", "admin") and user.institution_id == s.exam.institution_id)
    )
    if not allowed:
        raise HTTPException(403, "Not your institution or session")
    return s


@router.get("")
def list_sessions(
    user: models.UserAccount = Depends(require_proctor_or_admin),
    db: Session = Depends(get_db),
):
    q = db.query(models.ExamSession).join(models.Exam)
    q = q.filter(models.Exam.institution_id == user.institution_id)
    return [_session_out(db, s) for s in q.order_by(models.ExamSession.start_time.desc()).all()]


@router.get("/mine")
def my_sessions(user: models.UserAccount = Depends(get_current_user), db: Session = Depends(get_db)):
    return [
        _session_out(db, s)
        for s in db.query(models.ExamSession)
        .filter(models.ExamSession.student_id == user.id)
        .order_by(models.ExamSession.start_time.desc())
        .all()
    ]


@router.get("/{session_id}")
def get_session(
    session_id: str,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _session_out(db, _own_session(db, user, session_id))


@router.post("", status_code=201)
def create_session(
    body: schemas.SessionCreate,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Start (or resume — idempotent) the caller's session for an exam."""
    if user.role != "student":
        raise HTTPException(403, "Only students start exam sessions")
    exam = db.get(models.Exam, body.exam_id)
    if exam is None:
        raise HTTPException(404, "Exam not found")
    roster = (
        db.query(models.RosterAssignment)
        .filter(
            models.RosterAssignment.exam_id == exam.id,
            models.RosterAssignment.student_id == user.id,
        )
        .first()
    )
    if roster is None:
        raise HTTPException(403, "You are not assigned to this exam")
    if exam.status not in ("in_progress", "scheduled"):
        raise HTTPException(409, f"Cannot start an exam in '{exam.status}' state")
    if current_consent(db, user.id) != "granted":
        raise HTTPException(403, "Monitoring consent is required to start an exam")
    now = datetime.now(timezone.utc)
    if now < ensure_utc(exam.window_start):
        raise HTTPException(409, "The exam window has not opened yet")
    existing = (
        db.query(models.ExamSession)
        .filter(
            models.ExamSession.exam_id == exam.id,
            models.ExamSession.student_id == user.id,
            models.ExamSession.status == "active",
        )
        .first()
    )
    if existing:
        return _session_out(db, existing)  # idempotent resume
    session = models.ExamSession(
        id=f"ses_{uuid.uuid4().hex[:16]}",
        exam_id=exam.id,
        student_id=user.id,
        status="active",
        start_time=now,
    )
    db.add(session)
    db.commit()
    return _session_out(db, session)


@router.post("/{session_id}/end")
def end_session(
    session_id: str,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Idempotent end — owner or same-institution proctor/admin."""
    s = _own_session(db, user, session_id)
    if s.status == "completed":
        return _session_out(db, s)
    s.status = "completed"
    s.end_time = datetime.now(timezone.utc)
    db.commit()
    return _session_out(db, s)


@router.post("/{session_id}/ml-register")
def register_ml_session(
    session_id: str,
    body: schemas.MlRegisterRequest,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Verified ML↔exam mapping. Only the authenticated session owner may bind
    an ML demo session id to their exam session; the bridge ingests events for
    mapped ids only (unmapped ML sessions are ignored)."""
    s = _own_session(db, user, session_id)
    if user.id != s.student_id:
        raise HTTPException(403, "Only the session owner can register its ML session")
    existing = db.query(models.MlSessionMap).filter(
        models.MlSessionMap.ml_session_id == body.ml_session_id
    ).first()
    if existing:
        if existing.exam_session_id != session_id:
            raise HTTPException(409, "ML session already mapped to another exam session")
        return {"ml_session_id": body.ml_session_id, "exam_session_id": session_id}
    db.add(models.MlSessionMap(
        ml_session_id=body.ml_session_id,
        exam_session_id=session_id,
        registered_by=user.id,
    ))
    db.commit()
    return {"ml_session_id": body.ml_session_id, "exam_session_id": session_id}


@router.get("/{session_id}/events")
def session_events(
    session_id: str,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _own_session(db, user, session_id)
    rows = (
        db.query(models.EventsFlags)
        .filter(models.EventsFlags.session_id == session_id)
        .order_by(models.EventsFlags.start_s.asc())
        .all()
    )
    return [_event_out(e) for e in rows]


def _event_out(e: models.EventsFlags) -> dict:
    return EventOut(
        event_id=e.event_id,
        event_type=e.event_type,
        severity=e.severity,
        start_s=e.start_s,
        end_s=e.end_s,
        duration_s=e.duration_s,
        peak_yaw_dev=e.peak_yaw_dev,
        peak_gaze_dev=e.peak_gaze_dev,
        confidence=e.confidence,
        detector=e.detector,
        policy_ref=e.policy_ref,
        session_id=e.session_id,
        source=e.source,
        review_status=e.review_status,
        reviewer_note=e.reviewer_note,
        severity_override=e.severity_override,
    ).model_dump()
