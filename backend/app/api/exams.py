import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.deps import get_current_user, require_proctor_or_admin
from .. import models, schemas

router = APIRouter(prefix="/exams", tags=["exams"])

# Server-enforced lifecycle (SDD §5.7 TRANSITION).
LIFECYCLE = {
    "draft": {"scheduled", "archived"},
    "scheduled": {"in_progress", "completed", "archived"},
    "in_progress": {"completed"},
    "completed": {"archived"},
    "archived": set(),
}


def _scoped_exams(db: Session, user: models.UserAccount):
    q = db.query(models.Exam).filter(models.Exam.institution_id == user.institution_id)
    if user.role == "student":
        q = q.join(models.RosterAssignment).filter(
            models.RosterAssignment.student_id == user.id
        )
    return q.order_by(models.Exam.window_start.desc()).all()


@router.get("")
def list_exams(
    user: models.UserAccount = Depends(require_proctor_or_admin),
    db: Session = Depends(get_db),
):
    return [_exam_out(e) for e in _scoped_exams(db, user)]


@router.get("/policies/list")
def policies(
    user: models.UserAccount = Depends(require_proctor_or_admin),
    db: Session = Depends(get_db),
):
    return [
        {
            "policy_template_id": p.id,
            "name": p.name,
            "description": p.description,
            "severity_map": json.loads(p.severity_map),
        }
        for p in db.query(models.ProctoringPolicy).all()
    ]


@router.get("/mine")
def my_exams(
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Student's assigned exams (any lifecycle state)."""
    if user.role != "student":
        return [_exam_out(e) for e in _scoped_exams(db, user)]
    rows = (
        db.query(models.Exam)
        .join(models.RosterAssignment)
        .filter(models.RosterAssignment.student_id == user.id)
        .all()
    )
    return [_exam_out(e) for e in rows]


@router.post("", status_code=201)
def create_exam(
    body: schemas.ExamIn,
    user: models.UserAccount = Depends(require_proctor_or_admin),
    db: Session = Depends(get_db),
):
    if body.institution_id != user.institution_id:
        raise HTTPException(403, "Exams must belong to your institution")
    if body.window_end <= body.window_start:
        raise HTTPException(422, "window_end must be after window_start")
    policy = db.get(models.ProctoringPolicy, body.policy_template_id)
    if policy is None:
        raise HTTPException(404, "Unknown policy template")
    exam = models.Exam(
        id=f"exm_{int(datetime.now(timezone.utc).timestamp())}",
        institution_id=body.institution_id,
        title=body.title,
        course_code=body.course_code,
        window_start=body.window_start,
        window_end=body.window_end,
        duration_min=body.duration_min,
        allowed_materials=json.dumps(body.allowed_materials),
        policy_template_id=body.policy_template_id,
        status="draft",
        created_by=user.id,
    )
    db.add(exam)
    db.commit()
    return _exam_out(exam)


@router.get("/{exam_id}")
def get_exam(
    exam_id: str,
    user: models.UserAccount = Depends(require_proctor_or_admin),
    db: Session = Depends(get_db),
):
    exam = db.get(models.Exam, exam_id)
    if exam is None or exam.institution_id != user.institution_id:
        raise HTTPException(404, "Exam not found")
    return _exam_out(exam)


@router.patch("/{exam_id}")
def patch_exam(
    exam_id: str,
    body: schemas.ExamPatch,
    user: models.UserAccount = Depends(require_proctor_or_admin),
    db: Session = Depends(get_db),
):
    exam = db.get(models.Exam, exam_id)
    if exam is None or exam.institution_id != user.institution_id:
        raise HTTPException(404, "Exam not found")
    if exam.status in ("in_progress", "completed", "archived"):
        raise HTTPException(409, f"Cannot edit an exam in '{exam.status}' state")
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "allowed_materials" and value is not None:
            value = json.dumps(value)
        setattr(exam, field, value)
    db.commit()
    return _exam_out(exam)


@router.post("/{exam_id}/transition")
def transition(
    exam_id: str,
    body: schemas.TransitionRequest,
    user: models.UserAccount = Depends(require_proctor_or_admin),
    db: Session = Depends(get_db),
):
    exam = db.get(models.Exam, exam_id)
    if exam is None or exam.institution_id != user.institution_id:
        raise HTTPException(404, "Exam not found")
    if body.to not in LIFECYCLE[exam.status]:
        raise HTTPException(409, f"Illegal transition: {exam.status} → {body.to}")
    exam.status = body.to
    db.commit()
    return _exam_out(exam)


@router.post("/{exam_id}/roster")
def assign_roster(
    exam_id: str,
    body: schemas.RosterIn,
    user: models.UserAccount = Depends(require_proctor_or_admin),
    db: Session = Depends(get_db),
):
    exam = db.get(models.Exam, exam_id)
    if exam is None or exam.institution_id != user.institution_id:
        raise HTTPException(404, "Exam not found")
    for student_id in body.student_ids:
        student = db.get(models.UserAccount, student_id)
        if student is None or student.institution_id != user.institution_id or student.role != "student":
            raise HTTPException(422, f"Not a student of your institution: {student_id}")
        db.merge(models.RosterAssignment(
            exam_id=exam_id,
            student_id=student_id,
            accommodation=body.accommodations.get(student_id),
        ))
    db.commit()
    return {"assigned": len(body.student_ids)}


def _exam_out(exam: models.Exam) -> dict:
    return {
        "exam_id": exam.id,
        "title": exam.title,
        "course_code": exam.course_code,
        "institution_id": exam.institution_id,
        "window_start": exam.window_start.isoformat(),
        "window_end": exam.window_end.isoformat(),
        "duration_min": exam.duration_min,
        "allowed_materials": json.loads(exam.allowed_materials or "[]"),
        "policy_template_id": exam.policy_template_id,
        "status": exam.status,
    }
