"""Development bootstrap: creates tables, the policy templates (mirroring
machine learning/policy.yaml — the source of truth), a test institution, an
admin account (env-configured; no hardcoded credentials), a proctor, and a
demo student + exam + roster. Idempotent.

Run:  python -m scripts.bootstrap   (from backend/)
"""

import json
import sys
from datetime import datetime
from os import getenv
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import yaml  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app import models  # noqa: E402


def load_event_catalog() -> dict:
    policy_path = (
        Path(__file__).resolve().parent.parent.parent
        / "machine learning"
        / "policy.yaml"
    )
    if policy_path.is_file():
        policy = yaml.safe_load(policy_path.read_text(encoding="utf-8"))
        return policy.get("event_catalog", {})
    return {
        "gaze_deviation": "medium", "head_pose_deviation": "medium",
        "second_voice": "high", "unauthorized_object": "high",
        "second_person": "critical", "focus_loss": "medium",
        "copy_paste": "low", "connectivity_interruption": "low",
    }


def main() -> None:
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        catalog = load_event_catalog()

        def ensure(model, pk, **kwargs):
            row = db.get(model, pk)
            if row is None:
                row = model(id=pk, **kwargs)
                db.add(row)
            return row

        real = ensure(models.Institution, "inst_westbridge",
                      name="Westbridge State University", code="WSU")
        ensure(models.Institution, "inst_test",
               name="AIsmering Test Institution", code="TEST", is_test=True)
        ensure(models.Institution, "inst_northfield",
               name="Northfield Polytechnic College", code="NPC")

        ensure(
            models.ProctoringPolicy, "pol_standard",
            name="Standard Monitoring (pose_v2)",
            description="Severity catalog mirroring machine learning/policy.yaml",
            severity_map=json.dumps(catalog),
        )

        admin_email = getenv("BOOTSTRAP_ADMIN_EMAIL", "admin@aism.local")
        admin_password = getenv("BOOTSTRAP_ADMIN_PASSWORD", "change-this-too")
        if db.query(models.UserAccount).filter(models.UserAccount.email == admin_email).first() is None:
            db.add(models.UserAccount(
                id="u_admin_boot",
                institution_id=real.id,
                role="admin",
                full_name="System Administrator",
                email=admin_email,
                password_hash=hash_password(admin_password),
            ))
        if db.query(models.UserAccount).filter(models.UserAccount.email == "e.cruz@westbridge.edu").first() is None:
            db.add(models.UserAccount(
                id="u_pro_boot",
                institution_id=real.id,
                role="proctor",
                full_name="Elena Cruz",
                email="e.cruz@westbridge.edu",
                password_hash=hash_password("demo1234"),
                department="College of Science",
            ))
        if db.query(models.UserAccount).filter(models.UserAccount.email == "maria.santos@westbridge.edu").first() is None:
            student = models.UserAccount(
                id="u_stu_boot",
                institution_id=real.id,
                role="student",
                full_name="Maria Santos",
                email="maria.santos@westbridge.edu",
                password_hash=hash_password("demo1234"),
                roster_id="2024-01821",
            )
            db.add(student)
            db.flush()
            db.add(models.Consents(user_id=student.id, action="granted"))
            db.add(models.Exam(
                id="exm_boot",
                institution_id=real.id,
                title="MATH 101 — Final Examination",
                course_code="MATH 101",
                window_start=datetime.fromisoformat("2026-11-01T00:00:00+00:00"),
                window_end=datetime.fromisoformat("2026-12-31T23:59:00+00:00"),
                duration_min=90,
                allowed_materials=json.dumps(["Scientific calculator"]),
                policy_template_id="pol_standard",
                status="scheduled",
                created_by="u_admin_boot",
            ))
            db.add(models.RosterAssignment(
                exam_id="exm_boot", student_id=student.id
            ))
        db.commit()
        print("bootstrap done")
        print(f"  admin login: {admin_email} / {admin_password}")
        print("  demo logins: maria.santos@westbridge.edu / demo1234 (student)")
        print("               e.cruz@westbridge.edu / demo1234 (proctor)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
