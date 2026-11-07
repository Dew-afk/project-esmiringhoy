"""Advisory LLM summaries. Structured metadata only (never media/biometrics);
every statement must reference an event row of the same session (traceability
validation). Unconfigured LLM → 503 unavailable, never fabricated."""

import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.deps import get_current_user
from .. import models
from ..services.summary import generate_summary

router = APIRouter(prefix="/sessions", tags=["summaries"])


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


@router.get("/{session_id}/summary")
def get_summary(
    session_id: str,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _own_session(db, user, session_id)
    row = db.query(models.SessionSummaries).filter(
        models.SessionSummaries.session_id == session_id
    ).first()
    if row is None:
        raise HTTPException(404, "No summary generated for this session")
    return {
        "session_id": session_id,
        "summary_text": row.summary_text,
        "generated_at": row.generated_at.isoformat(),
        "model_version": row.model_version,
        "statements": json.loads(row.statements or "[]"),
        "advisory": True,
    }


@router.post("/{session_id}/summary", status_code=201)
def create_summary(
    session_id: str,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role not in ("proctor", "admin", "appeals"):
        raise HTTPException(403, "Only proctors and reviewers generate summaries")
    _own_session(db, user, session_id)
    try:
        result = generate_summary(db, session_id)
    except Exception as exc:
        # LLM failures must never break event review — they just leave the
        # summary unavailable.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"Summary generation unavailable: {exc}",
        )
    return result
