import json
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base, get_db
from app.core.security import hash_password
from app.main import app
from app import models

# Set AISM_TEST_DATABASE_URL to run the whole suite against PostgreSQL:
#   AISM_TEST_DATABASE_URL=postgresql+psycopg://aism:aism-dev@localhost:5432/aism
TEST_DATABASE_URL = os.getenv("AISM_TEST_DATABASE_URL", "")


@pytest.fixture()
def db_engine(tmp_path):
    if TEST_DATABASE_URL:
        engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
        Base.metadata.drop_all(engine)
        Base.metadata.create_all(engine)
    else:
        engine = create_engine(
            f"sqlite:///{tmp_path / 'test.db'}",
            connect_args={"check_same_thread": False},
        )
        from sqlalchemy import event

        @event.listens_for(engine, "connect")
        def _fk_on(dbapi_conn, _record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        Base.metadata.create_all(engine)
    return engine


@pytest.fixture()
def db(db_engine):
    Session = sessionmaker(bind=db_engine, expire_on_commit=False)
    session = Session()
    yield session
    session.close()


@pytest.fixture()
def client(db_engine):
    from app.core.limiter import limiter

    Session = sessionmaker(bind=db_engine, expire_on_commit=False)

    def override():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override
    limiter.enabled = False  # the rate-limit policy gets its own test
    with TestClient(app) as c:
        c.db_session = Session
        yield c
    limiter.enabled = True
    app.dependency_overrides.pop(get_db, None)


def make_user(db, *, uid, role, email, institution, password="pw123456", **kwargs):
    user = models.UserAccount(
        id=uid,
        institution_id=institution.id,
        role=role,
        full_name=f"{role} {uid}",
        email=email,
        password_hash=hash_password(password),
        **kwargs,
    )
    db.add(user)
    return user


@pytest.fixture()
def world(client):
    """Two institutions, admin+proctor+student in A, student in B, a policy,
    an exam, a roster, consent — everything the tests need."""
    db = client.db_session()
    inst_a = models.Institution(id="inst_a", name="Institution A", code="A")
    inst_b = models.Institution(id="inst_b", name="Institution B", code="B")
    test_inst = models.Institution(id="inst_test", name="Test Inst", code="T", is_test=True)
    db.add_all([inst_a, inst_b, test_inst])
    db.flush()
    make_user(db, uid="u_admin", role="admin", email="admin@a.edu", institution=inst_a)
    make_user(db, uid="u_pro", role="proctor", email="proctor@a.edu", institution=inst_a)
    stu = make_user(db, uid="u_stu", role="student", email="stu@a.edu", institution=inst_a)
    make_user(db, uid="u_stu_b", role="student", email="stub@b.edu", institution=inst_b)
    db.flush()  # users must exist before FK rows (Postgres enforces this)
    db.add(models.Consents(user_id=stu.id, action="granted"))
    db.add(models.ProctoringPolicy(
        id="pol_std", name="Standard",
        severity_map=json.dumps({"gaze_deviation": "medium", "second_person": "critical"}),
    ))
    db.flush()
    exam = models.Exam(
        id="exm_a",
        institution_id=inst_a.id,
        title="Exam A",
        window_start=datetime.fromisoformat("2026-01-01T00:00:00+00:00"),
        window_end=datetime.fromisoformat("2027-01-01T00:00:00+00:00"),
        duration_min=60,
        allowed_materials="[]",
        policy_template_id="pol_std",
        status="scheduled",
        created_by="u_admin",
    )
    db.add(exam)
    db.flush()
    db.add(models.RosterAssignment(exam_id=exam.id, student_id=stu.id))
    db.commit()
    return {
        "inst_a": inst_a,
        "inst_b": inst_b,
        "test_inst": test_inst,
        "exam": exam,
        "student": stu,
    }


def login(client, email, password="pw123456"):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def tokens(client, world):
    return {
        "admin": login(client, "admin@a.edu"),
        "proctor": login(client, "proctor@a.edu"),
        "student": login(client, "stu@a.edu"),
        "student_b": login(client, "stub@b.edu"),
    }


def start_session(client, tokens, exam_id="exm_a"):
    r = client.post("/api/v1/sessions", json={"exam_id": exam_id}, headers=tokens["student"])
    assert r.status_code == 201, r.text
    return r.json()["session_id"]


def ingest_event(client, tokens, session_id, ml_session_id="live_x", event_id="ev_1", event_type="gaze_deviation", severity="medium"):
    """Trusted-path ingestion: owner registers the ML mapping, then the ML
    bridge (token-authenticated) submits the event."""
    r = client.post(
        f"/api/v1/sessions/{session_id}/ml-register",
        json={"ml_session_id": ml_session_id},
        headers=tokens["student"],
    )
    assert r.status_code == 200, r.text
    event = {
        "event_id": event_id,
        "event_type": event_type,
        "severity": severity,
        "start_s": 10.0,
        "end_s": 12.0,
        "duration_s": 2.0,
        "detector": "pose_mediapipe",
        "policy_ref": "pose_v2",
    }
    r = client.post(
        "/api/v1/ml/events",
        json={"ml_session_id": ml_session_id, "events": [event]},
        headers={"X-ML-Token": "dev-ml-token-change-me"},
    )
    assert r.status_code == 202, r.text
    return event
