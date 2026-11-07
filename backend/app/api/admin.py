"""Administration: users, institutions, approvals, roster import, guarded
database viewer (SDD §5.8). Read-only by default; deletion restricted to a
verified dedicated test institution with confirmation + audit."""

import csv
import io
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.deps import require_roles, current_consent
from .. import models
from ..schemas import model_to_user_out
from ..services.audit import audit

router = APIRouter(prefix="/admin", tags=["admin"])

admin_only = require_roles("admin")

# DB viewer allowlist — never arbitrary SQL, never arbitrary tables.
VIEWER_TABLES = {
    "UserAccount": models.UserAccount,
    "Institution": models.Institution,
    "Exam": models.Exam,
    "ExamSession": models.ExamSession,
    "ProctoringPolicy": models.ProctoringPolicy,
    "RosterAssignment": models.RosterAssignment,
    "Consents": models.Consents,
    "EventsFlags": models.EventsFlags,
    "RiskScores": models.RiskScores,
    "Recordings": models.Recordings,
    "SessionSummaries": models.SessionSummaries,
    "AuditLog": models.AuditLog,
    "RetentionLog": models.RetentionLog,
}
PROTECTED = {"AuditLog", "RetentionLog", "Consents"}
VIEW_ONLY = {"Institution", "ProctoringPolicy", "RosterAssignment"}
DELETABLE = {"UserAccount", "Exam", "ExamSession"}


@router.get("/users")
def list_users(user: models.UserAccount = Depends(admin_only), db: Session = Depends(get_db)):
    rows = db.query(models.UserAccount).filter(
        models.UserAccount.institution_id == user.institution_id
    ).all()
    return [model_to_user_out(u, current_consent(db, u.id)).model_dump() for u in rows]


@router.post("/users/{user_id}/approve")
def approve_proctor(
    user_id: str,
    user: models.UserAccount = Depends(admin_only),
    db: Session = Depends(get_db),
):
    target = db.get(models.UserAccount, user_id)
    if target is None or target.institution_id != user.institution_id:
        raise HTTPException(404, "User not found")
    if target.role != "proctor":
        raise HTTPException(422, "Only proctor accounts need approval")
    target.approval_status = "approved"
    audit(db, actor=user.email, action="APPROVE_PROCTOR", target=user_id)
    db.commit()
    return {"approved": user_id}


@router.post("/rosters/import")
async def import_roster(
    exam_id: str | None = None,
    file: UploadFile = File(...),
    user: models.UserAccount = Depends(admin_only),
    db: Session = Depends(get_db),
):
    """Validated CSV import: name,email,roster_id. Accounts are created without
    a password — they cannot log in until an admin sets one (no credential
    materialization in this repository)."""
    text = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    created, skipped = [], []
    for row in reader:
        name = (row.get("full_name") or row.get("name") or "").strip()
        email = (row.get("email") or "").strip().lower()
        if not name or "@" not in email:
            skipped.append(row)
            continue
        if db.query(models.UserAccount).filter(models.UserAccount.email == email).first():
            skipped.append(row)
            continue
        account = models.UserAccount(
            id=f"u_{uuid.uuid4().hex[:12]}",
            institution_id=user.institution_id,
            role="student",
            full_name=name,
            email=email,
            roster_id=(row.get("roster_id") or "").strip() or None,
            password_hash=None,  # login disabled until a password is set
        )
        db.add(account)
        created.append(email)
        if exam_id:
            db.add(models.RosterAssignment(exam_id=exam_id, student_id=account.id))
    audit(db, actor=user.email, action="ROSTER_IMPORT", target=str(exam_id or "global"),
          detail=f"created={len(created)} skipped={len(skipped)}")
    db.commit()
    return {"created": created, "skipped": len(skipped)}


@router.get("/institutions")
def list_institutions(user: models.UserAccount = Depends(admin_only), db: Session = Depends(get_db)):
    return [
        {"institution_id": i.id, "name": i.name, "code": i.code,
         "is_test": i.is_test, "retention_days": i.retention_days}
        for i in db.query(models.Institution).all()
    ]


@router.get("/db/tables")
def db_tables(user: models.UserAccount = Depends(admin_only)):
    return {"tables": list(VIEWER_TABLES), "protected": sorted(PROTECTED),
            "view_only": sorted(VIEW_ONLY), "deletable": sorted(DELETABLE)}


@router.get("/db/{table}")
def db_rows(
    table: str,
    user: models.UserAccount = Depends(admin_only),
    db: Session = Depends(get_db),
    limit: int = 50,
    offset: int = 0,
):
    model = VIEWER_TABLES.get(table)
    if model is None:
        raise HTTPException(404, "Unknown table")
    limit = min(max(limit, 1), 200)
    q = db.query(model)
    if table == "Institution" or table in ("ProctoringPolicy",):
        pass  # shared reference data
    elif table in ("AuditLog", "RetentionLog"):
        pass  # governance rows are global by design
    elif hasattr(model, "institution_id"):
        q = q.filter(model.institution_id == user.institution_id)
    elif table == "Consents":
        q = q.filter(
            model.user_id.in_(
                db.query(models.UserAccount.id).filter(
                    models.UserAccount.institution_id == user.institution_id
                )
            )
        )
    elif table == "RosterAssignment":
        q = q.filter(
            model.student_id.in_(
                db.query(models.UserAccount.id).filter(
                    models.UserAccount.institution_id == user.institution_id
                )
            )
        )
    else:
        q = q.join(models.ExamSession).join(models.Exam).filter(
            models.Exam.institution_id == user.institution_id
        )
    rows = q.offset(offset).limit(limit).all()
    columns = [c.name for c in sa_inspect(model).columns]
    return {"columns": columns, "rows": [
        {c: _serialize(getattr(r, c)) for c in columns} for r in rows
    ], "total": q.count()}


@router.delete("/db/{table}/{record_id}")
def db_delete(
    table: str,
    record_id: str,
    user: models.UserAccount = Depends(admin_only),
    db: Session = Depends(get_db),
):
    """Guarded mock/test deletion. Hard refusal for everything but test-
    institution rows of UserAccount/Exam/ExamSession; dependents deleted in
    dependency order; every deletion audit-logged (SDD §5.8)."""
    model = VIEWER_TABLES.get(table)
    if model is None:
        raise HTTPException(404, "Unknown table")
    if table not in DELETABLE:
        raise HTTPException(403, f"'{table}' is never deletable through the viewer")
    record = db.get(model, record_id)
    if record is None:
        raise HTTPException(404, "Record not found")
    institution_id = (
        record.exam.institution_id if table == "ExamSession" else record.institution_id
    )
    institution = db.get(models.Institution, institution_id)
    if institution is None or not institution.is_test:
        raise HTTPException(403, "Only records of the dedicated test institution are deletable")
    if table == "ExamSession":
        for dep_model, key in [
            (models.EventsFlags, models.EventsFlags.session_id),
            (models.RiskScores, models.RiskScores.session_id),
            (models.Recordings, models.Recordings.session_id),
            (models.SessionSummaries, models.SessionSummaries.session_id),
        ]:
            db.query(dep_model).filter(key == record_id).delete(synchronize_session=False)
    if table == "Exam":
        db.query(models.RosterAssignment).filter(
            models.RosterAssignment.exam_id == record_id
        ).delete(synchronize_session=False)
        for s in db.query(models.ExamSession).filter(models.ExamSession.exam_id == record_id).all():
            for dep_model, key in [
                (models.EventsFlags, models.EventsFlags.session_id),
                (models.RiskScores, models.RiskScores.session_id),
                (models.Recordings, models.Recordings.session_id),
                (models.SessionSummaries, models.SessionSummaries.session_id),
            ]:
                db.query(dep_model).filter(key == s.id).delete(synchronize_session=False)
            db.delete(s)
    if table == "UserAccount":
        db.query(models.Consents).filter(models.Consents.user_id == record_id).delete(
            synchronize_session=False
        )
        db.query(models.RosterAssignment).filter(
            models.RosterAssignment.student_id == record_id
        ).delete(synchronize_session=False)
        for s in db.query(models.ExamSession).filter(
            models.ExamSession.student_id == record_id
        ).all():
            for dep_model, key in [
                (models.EventsFlags, models.EventsFlags.session_id),
                (models.RiskScores, models.RiskScores.session_id),
                (models.Recordings, models.Recordings.session_id),
                (models.SessionSummaries, models.SessionSummaries.session_id),
            ]:
                db.query(dep_model).filter(key == s.id).delete(synchronize_session=False)
            db.delete(s)
    db.delete(record)
    audit(db, actor=user.email, action=f"DELETE:{table}", target=record_id,
          detail="test-institution record")
    db.commit()
    return {"deleted": f"{table}:{record_id}"}


def _serialize(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
