"""Reporting interfaces (SRS 3.1.10): session integrity, cohort analytics,
appeals evidence, audit/compliance. Server-side filtering + pagination."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.deps import get_current_user
from .. import models

router = APIRouter(prefix="/reports", tags=["reports"])

SEV_ORDER = {"low": 1, "medium": 2, "high": 3, "critical": 4}


def _own_session(db: Session, user: models.UserAccount, session_id: str) -> models.ExamSession:
    s = db.get(models.ExamSession, session_id)
    if s is None:
        raise HTTPException(404, "Session not found")
    if not (
        user.id == s.student_id
        or (user.role in ("proctor", "admin", "appeals") and user.institution_id == s.exam.institution_id)
    ):
        raise HTTPException(403, "Not authorized for this session")
    return s


@router.get("/integrity/{session_id}")
def session_integrity(
    session_id: str,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    s = _own_session(db, user, session_id)
    events = (
        db.query(models.EventsFlags)
        .filter(models.EventsFlags.session_id == session_id)
        .order_by(models.EventsFlags.start_s.asc())
        .all()
    )
    risk = db.query(models.RiskScores).filter(models.RiskScores.session_id == session_id).first()
    summary = db.query(models.SessionSummaries).filter(
        models.SessionSummaries.session_id == session_id
    ).first()
    return {
        "session_id": session_id,
        "status": s.status,
        "start_time": s.start_time,
        "end_time": s.end_time,
        "advisory_risk_score": risk.score if risk else None,
        "events": [
            {
                "event_id": e.event_id,
                "event_type": e.event_type,
                "severity": e.severity_override or e.severity,
                "original_severity": e.severity,
                "start_s": e.start_s,
                "end_s": e.end_s,
                "detector": e.detector,
                "review_status": e.review_status,
            }
            for e in events
        ],
        "summary_available": summary is not None,
    }


@router.get("/cohort/{exam_id}")
def cohort_analytics(
    exam_id: str,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role not in ("proctor", "admin"):
        raise HTTPException(403, "Proctors and admins only")
    exam = db.get(models.Exam, exam_id)
    if exam is None or exam.institution_id != user.institution_id:
        raise HTTPException(404, "Exam not found")
    sessions = db.query(models.ExamSession).filter(models.ExamSession.exam_id == exam_id).all()
    event_rows = (
        db.query(models.EventsFlags)
        .filter(models.EventsFlags.session_id.in_([s.id for s in sessions]))
        .all()
    )
    sev_counts = {"low": 0, "medium": 0, "high": 0, "critical": 0}
    type_counts: dict[str, int] = {}
    for e in event_rows:
        sev_counts[e.severity_override or e.severity] += 1
        type_counts[e.event_type] = type_counts.get(e.event_type, 0) + 1
    scores = [
        db.query(models.RiskScores).filter(models.RiskScores.session_id == s.id).first()
        for s in sessions
    ]
    score_values = sorted(r.score for r in scores if r is not None)
    return {
        "exam_id": exam_id,
        "session_count": len(sessions),
        "flag_distribution": sev_counts,
        "event_type_breakdown": type_counts,
        "risk_score_distribution": {
            "min": score_values[0] if score_values else None,
            "max": score_values[-1] if score_values else None,
            "count": len(score_values),
            "values": score_values,
        },
    }


@router.get("/appeals-package/{session_id}")
def appeals_package(
    session_id: str,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role not in ("appeals", "admin"):
        raise HTTPException(403, "Appeals reviewers and admins only")
    s = _own_session(db, user, session_id)
    events = (
        db.query(models.EventsFlags)
        .filter(models.EventsFlags.session_id == session_id)
        .all()
    )
    recordings = db.query(models.Recordings).filter(
        models.Recordings.session_id == session_id
    ).all()
    summary = db.query(models.SessionSummaries).filter(
        models.SessionSummaries.session_id == session_id
    ).first()
    return {
        "session_id": session_id,
        "events": [e.event_id for e in events],
        "recording_references": [r.id for r in recordings],
        "summary_available": summary is not None,
        "reviewer_notes": [e.reviewer_note for e in events if e.reviewer_note],
    }


@router.get("/appeals")
def appeals_cases(
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cases = sessions with escalated events, within the reviewer's
    institution. Evidence review only — no adjudication is performed."""
    if user.role not in ("appeals", "admin"):
        raise HTTPException(403, "Appeals reviewers and admins only")
    escalated = (
        db.query(models.EventsFlags)
        .join(models.ExamSession)
        .join(models.Exam)
        .filter(
            models.EventsFlags.review_status == "escalated",
            models.Exam.institution_id == user.institution_id,
        )
        .all()
    )
    by_session: dict[str, list[models.EventsFlags]] = {}
    for e in escalated:
        by_session.setdefault(e.session_id, []).append(e)
    cases = []
    for session_id, events in by_session.items():
        session = db.get(models.ExamSession, session_id)
        cases.append({
            "case_id": f"case_{session_id}",
            "session_id": session_id,
            "student_name": session.student.full_name,
            "exam_title": session.exam.title,
            "opened_at": min(e.created_at for e in events).isoformat(),
            "status": "under_review",
            "notes": [e.reviewer_note for e in events if e.reviewer_note],
            "event_ids": [e.event_id for e in events],
        })
    return cases


@router.get("/audit")
def audit_report(
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = 100,
    offset: int = 0,
):
    if user.role != "admin":
        raise HTTPException(403, "Admins only")
    limit = min(max(limit, 1), 500)
    rows = (
        db.query(models.AuditLog)
        .order_by(models.AuditLog.at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        {"actor": r.actor, "action": r.action, "target": r.target,
         "detail": r.detail, "at": r.at.isoformat()}
        for r in rows
    ]
