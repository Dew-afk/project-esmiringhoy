"""Retention purge (SRS 3.1.4, SDD §5.7). Never invents legal periods:
only institutions with an explicit retention_days (or the configured
RETENTION_DAYS_DEFAULT) have data purged; everything is RetentionLog-ed."""

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..core.config import settings
from .. import models
from . import storage

SESSION_DEPENDENTS = [
    (models.EventsFlags, "session_id"),
    (models.RiskScores, "session_id"),
    (models.Recordings, "session_id"),
    (models.SessionSummaries, "session_id"),
]


def purge_expired(db: Session, by: str = "system") -> dict:
    now = datetime.now(timezone.utc)
    purged = 0
    logs = []
    for institution in db.query(models.Institution).all():
        days = institution.retention_days or settings.retention_days_default
        if days <= 0:
            continue  # not configured → nothing to do, no invented policy
        cutoff = now - timedelta(days=days)
        expired = (
            db.query(models.ExamSession)
            .filter(
                models.ExamSession.end_time < cutoff,
                models.ExamSession.student_id.in_(
                    db.query(models.UserAccount.id).filter(
                        models.UserAccount.institution_id == institution.id
                    )
                ),
            )
            .all()
        )
        for session in expired:
            recording_rows = db.query(models.Recordings).filter(
                models.Recordings.session_id == session.id
            ).all()
            for r in recording_rows:
                storage.delete(r.object_key)
            for dep_model, key in SESSION_DEPENDENTS:
                db.query(dep_model).filter(
                    getattr(dep_model, key) == session.id
                ).delete(synchronize_session=False)
            db.delete(session)
            purged += 1
        if expired:
            logs.append(
                models.RetentionLog(
                    target_type="exam_sessions",
                    target_id=institution.id,
                    purged_count=len(expired),
                    by=by,
                )
            )
    db.add_all(logs)
    return {"purged_sessions": purged, "logged": len(logs)}
