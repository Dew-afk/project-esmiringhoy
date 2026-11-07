"""Integration tests for the four wired frontend modules (admin, reports,
recordings, appeals) against a LIVE backend. Skips when the API is down.

Run: uvicorn app.main:app --port 8010  +  worker  →  pytest tests/integration -q
"""

import time

import httpx
import pytest

API = "http://127.0.0.1:8010"
ADMIN = ("admin@aism.local", "change-this-too")


@pytest.fixture(scope="module")
def live():
    try:
        httpx.get(f"{API}/health", timeout=3).raise_for_status()
    except Exception:
        pytest.skip("live API not running on :8010")
    return API


def _login(client, email, password):
    r = client.post(f"{API}/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_admin_module(live):
    with httpx.Client(timeout=10) as c:
        admin = _login(c, *ADMIN)
        r = c.get(f"{API}/api/v1/admin/users", headers=admin)
        assert r.status_code == 200
        assert any(u["email"] == "e.cruz@westbridge.edu" for u in r.json())
        r = c.get(f"{API}/api/v1/admin/institutions", headers=admin)
        assert any(i["is_test"] for i in r.json())


def test_reports_module(live):
    with httpx.Client(timeout=10) as c:
        admin = _login(c, *ADMIN)
        exams = c.get(f"{API}/api/v1/exams", headers=admin).json()
        assert exams, "seed an exam via scripts/bootstrap.py"
        r = c.get(f"{API}/api/v1/reports/cohort/{exams[0]['exam_id']}", headers=admin)
        assert r.status_code == 200
        body = r.json()
        assert "flag_distribution" in body and "event_type_breakdown" in body


def test_db_viewer_module(live):
    with httpx.Client(timeout=10) as c:
        admin = _login(c, *ADMIN)
        r = c.get(f"{API}/api/v1/admin/db/tables", headers=admin)
        assert r.status_code == 200
        assert "AuditLog" in r.json()["protected"]
        r = c.get(f"{API}/api/v1/admin/db/UserAccount", headers=admin)
        assert r.status_code == 200
        assert r.json()["total"] >= 1
        # deletion of a NON-test-institution record is refused
        row = next(x for x in r.json()["rows"] if x["id"] == "u_stu_boot")
        r = c.delete(f"{API}/api/v1/admin/db/UserAccount/{row['id']}", headers=admin)
        assert r.status_code == 403
        # protected table is never deletable
        r = c.delete(f"{API}/api/v1/admin/db/AuditLog/1", headers=admin)
        assert r.status_code == 403


def test_recordings_module(live):
    with httpx.Client(timeout=10) as c:
        student = _login(c, "maria.santos@westbridge.edu", "demo1234")
        proctor = _login(c, "e.cruz@westbridge.edu", "demo1234")
        sessions = c.get(f"{API}/api/v1/sessions/mine", headers=student).json()
        assert sessions, "start a session first (integration e2e test)"
        sid = sessions[0]["session_id"]
        r = c.get(f"{API}/api/v1/sessions/{sid}/recordings", headers=proctor)
        assert r.status_code == 200  # may be an empty list — honest state


def test_appeals_module(live):
    with httpx.Client(timeout=10) as c:
        admin = _login(c, *ADMIN)
        r = c.get(f"{API}/api/v1/reports/appeals", headers=admin)
        assert r.status_code == 200  # list; empty until an event is escalated
