"""Frontend-workflow integration test against a LIVE backend + worker.

Replays exactly what the frontend does (login → exams → start session →
register ML mapping → trusted ingestion → worker → proctor review) so the
frontend/backend contracts stay verified together. Skips when no live API is
running.

Run:
  uvicorn app.main:app --port 8010          (terminal 1)
  python -m app.workers.event_worker         (terminal 2)
  python -m pytest tests/integration -q
"""

import time

import httpx
import pytest

API = "http://127.0.0.1:8010"
STUDENT = ("maria.santos@westbridge.edu", "demo1234")
PROCTOR = ("e.cruz@westbridge.edu", "demo1234")


@pytest.fixture(scope="module")
def live():
    try:
        r = httpx.get(f"{API}/health", timeout=3)
        r.raise_for_status()
    except Exception:
        pytest.skip("live API not running on :8010")
    return API


def _login(client, email, password):
    r = client.post(f"{API}/api/v1/auth/login",
                    json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_student_to_proctor_flow(live):
    with httpx.Client(timeout=10) as c:
        student = _login(c, *STUDENT)
        proctor = _login(c, *PROCTOR)

        # 1. student sees their exams (frontend: /student dashboard)
        r = c.get(f"{API}/api/v1/exams/mine", headers=student)
        assert r.status_code == 200
        exam = next((e for e in r.json() if e["status"] in ("scheduled", "in_progress")), None)
        assert exam is not None, "bootstrap exam missing — run scripts/bootstrap.py"

        # 2. start session (idempotent resume)
        r = c.post(f"{API}/api/v1/sessions", json={"exam_id": exam["exam_id"]}, headers=student)
        assert r.status_code == 201, r.text
        session_id = r.json()["session_id"]
        r2 = c.post(f"{API}/api/v1/sessions", json={"exam_id": exam["exam_id"]}, headers=student)
        assert r2.json()["session_id"] == session_id

        # 3. register the ML session mapping (frontend: exam page, first event)
        ml_session_id = f"live_e2e_{int(time.time())}"
        r = c.post(f"{API}/api/v1/sessions/{session_id}/ml-register",
                   json={"ml_session_id": ml_session_id}, headers=student)
        assert r.status_code == 200, r.text

        # 4. trusted ingestion (ML bridge path with token)
        event = {
            "event_id": f"e2e_ev_{int(time.time())}",
            "event_type": "gaze_deviation",
            "severity": "medium",
            "start_s": 15.0, "end_s": 17.5, "duration_s": 2.5,
            "peak_gaze_dev": 0.9,
            "detector": "pose_mediapipe", "policy_ref": "pose_v2",
        }
        r = c.post(f"{API}/api/v1/ml/events",
                   json={"ml_session_id": ml_session_id, "events": [event]},
                   headers={"X-ML-Token": "dev-ml-token-change-me"})
        assert r.status_code == 202, r.text

        # 5. the worker picks the event up (poll a few seconds)
        for _ in range(15):
            r = c.get(f"{API}/api/v1/sessions/{session_id}/events", headers=proctor)
            if r.json():
                break
            time.sleep(1)
        events = r.json()
        assert len(events) == 1
        assert events[0]["event_id"] == event["event_id"]

        # 6. risk score visible to the proctor (advisory)
        r = c.get(f"{API}/api/v1/sessions/{session_id}", headers=proctor)
        assert r.json()["risk_score"] == 8.0  # dev default medium weight

        # 7. proctor reviews + audit trail records it
        r = c.post(f"{API}/api/v1/events/{event['event_id']}/review",
                   json={"action": "acknowledge"}, headers=proctor)
        assert r.status_code == 200
        r = c.get(f"{API}/api/v1/reports/audit", headers=_login(c, "admin@aism.local", "change-this-too"))
        assert any(a["action"] == "REVIEW_EVENT:acknowledge" for a in r.json())

        # 8. session ends idempotently
        r = c.post(f"{API}/api/v1/sessions/{session_id}/end", headers=student)
        assert r.status_code == 200
