"""Shared fixtures: points the API at aismering_test, never the dev DB."""
import os
import sys
from pathlib import Path

import pytest

# backend/ is one level up; make `db` importable
BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))


def _test_url() -> str:
    """DATABASE_URL from db/.env, database swapped to aismering_test."""
    if os.environ.get("TEST_DATABASE_URL"):
        return os.environ["TEST_DATABASE_URL"]
    env_file = BACKEND.parent / "db" / ".env"
    url = "postgresql://localhost/aismering"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("DATABASE_URL="):
                url = line.strip().split("=", 1)[1]
    return url.rsplit("/", 1)[0] + "/aismering_test"


os.environ["DATABASE_URL"] = _test_url()
assert os.environ["DATABASE_URL"].endswith("/aismering_test"), \
    "tests must run against aismering_test"

from fastapi.testclient import TestClient  # noqa: E402
from db import connect  # noqa: E402
from main import app  # noqa: E402

ALL_TABLES = ["retention_log", "audit_log", "session_summaries", "recordings",
              "risk_scores", "events_flags", "consents", "roster_assignments",
              "exam_sessions", "exams", "proctoring_policies", "user_tenants",
              "user_accounts", "institutions"]


@pytest.fixture(autouse=True)
def clean_db():
    """Empty every table before each test; the schema itself is untouched."""
    with connect() as conn:
        conn.execute("TRUNCATE " + ", ".join(ALL_TABLES) + " RESTART IDENTITY CASCADE")
        conn.commit()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def institutions():
    with connect() as conn:
        a = conn.execute("INSERT INTO institutions (name) VALUES ('institution a') RETURNING id").fetchone()["id"]
        b = conn.execute("INSERT INTO institutions (name) VALUES ('institution b') RETURNING id").fetchone()["id"]
        conn.commit()
    return {"a": a, "b": b}


STUDENT = dict(email="student@a.edu", password="Passw0rd1", full_name="Test Student",
               role="student", institution="institution a", roster_id="R-0001", consent=True)


def register_student(client, **overrides):
    return client.post("/api/auth/register", json={**STUDENT, **overrides})


def login(client, email, password, institution=None):
    payload = {"email": email, "password": password}
    if institution:
        payload["institution"] = institution
    return client.post("/api/auth/login", json=payload)


# ---------------- shared fixtures/helpers (API layer) ----------------

def make_exam(conn, inst_id, lifecycle="in_progress", name="midterm 1"):
    """Insert policy + exam; returns exam_id."""
    pol = conn.execute(
        """INSERT INTO proctoring_policies (institution_id, name, version)
           VALUES (%s, 'test policy', 'v1') RETURNING id""", (inst_id,)
    ).fetchone()
    return conn.execute(
        """INSERT INTO exams
             (institution_id, name, window_start, window_end,
              duration_minutes, lifecycle, policy_id)
           VALUES (%s, %s, now() - interval '1 hour',
                   now() + interval '1 hour', 60, %s, %s)
           RETURNING id""",
        (inst_id, name, lifecycle, pol["id"])).fetchone()["id"]


def roster_student(conn, exam_id, student_id):
    conn.execute(
        "INSERT INTO roster_assignments (exam_id, student_id) VALUES (%s, %s)",
        (exam_id, student_id))


def seed_account(conn, email, password, role, inst_id, approval="approved"):
    """Direct-SQL account (admin/appeals_reviewer path). Returns user id."""
    import security
    return conn.execute(
        """INSERT INTO user_accounts
             (email, password_hash, full_name, role, auth_provider,
              approval_status)
           VALUES (%s, %s, %s, %s, 'password', %s)
           RETURNING id""",
        (email, security.hash_password(password), f"Seed {role}", role,
         approval)).fetchone()["id"]


def link_tenant(conn, user_id, inst_id):
    conn.execute(
        "INSERT INTO user_tenants (user_id, institution_id) VALUES (%s, %s)",
        (user_id, inst_id))


def user_id_by_email(conn, email):
    return conn.execute(
        "SELECT id FROM user_accounts WHERE email = %s", (email,)).fetchone()["id"]


def audit_rows(conn, action=None):
    if action:
        return conn.execute(
            "SELECT * FROM audit_log WHERE action = %s ORDER BY id",
            (action,)).fetchall()
    return conn.execute("SELECT * FROM audit_log ORDER BY id").fetchall()
