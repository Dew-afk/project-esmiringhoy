"""A-layer API tests: consent-gated session start, WS validation, event
ingest and advisory risk (Phases 1.3, 1.5, 2.1-2.3).
"""
from db import connect
from conftest import (audit_rows, login, make_exam, register_student,
                      roster_student, user_id_by_email, STUDENT)


def _student_with_exam(client, institutions, lifecycle="in_progress",
                       roster=True, consent=True):
    """Register student, build exam in institution a, return ids."""
    res = register_student(client, consent=consent)
    assert res.status_code == 201, res.text
    login(client, STUDENT["email"], STUDENT["password"])
    with connect() as conn:
        sid = user_id_by_email(conn, STUDENT["email"])
        exam_id = make_exam(conn, institutions["a"], lifecycle=lifecycle)
        if roster:
            roster_student(conn, exam_id, sid)
        conn.commit()
    return sid, exam_id


def _start(client, exam_id):
    return client.post("/api/sessions/start", json={"exam_id": str(exam_id)})


# ---------------- consent status / grant / revoke (Phase 1.5 backend) ----------------

def test_consent_status_and_grant_audit(client, institutions):
    register_student(client)
    login(client, STUDENT["email"], STUDENT["password"])
    assert client.get("/api/consent").json()["status"] == "granted"
    client.post("/api/consent/revoke")
    assert client.get("/api/consent").json()["status"] == "revoked"
    res = client.post("/api/consent/grant")
    assert res.status_code == 200
    assert client.get("/api/consent").json()["status"] == "granted"
    with connect() as conn:
        actions = [r["action"] for r in audit_rows(conn)]
        assert "consent.revoke" in actions and "consent.grant" in actions


# ---------------- session start preconditions (Phase 2.1) ----------------

def test_start_requires_auth(client, institutions):
    assert client.post("/api/sessions/start", json={"exam_id": "x"}).status_code == 401


def test_start_happy_path_and_audit(client, institutions):
    sid, exam_id = _student_with_exam(client, institutions)
    res = _start(client, exam_id)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["session_token"] and body["status"] == "in_progress"
    with connect() as conn:
        sess = conn.execute(
            "SELECT student_id, status FROM exam_sessions WHERE session_token=%s",
            (body["session_token"],)).fetchone()
        assert str(sess["student_id"]) == str(sid)
        assert audit_rows(conn, "session.start")


def test_start_blocked_without_consent(client, institutions):
    register_student(client, consent=True)
    login(client, STUDENT["email"], STUDENT["password"])
    client.post("/api/consent/revoke")
    with connect() as conn:
        exam_id = make_exam(conn, institutions["a"])
        roster_student(conn, exam_id, user_id_by_email(conn, STUDENT["email"]))
        conn.commit()
    res = _start(client, exam_id)
    assert res.status_code == 403
    assert "consent" in res.json()["detail"]


def test_start_blocked_without_roster(client, institutions):
    sid, exam_id = _student_with_exam(client, institutions, roster=False)
    res = _start(client, exam_id)
    assert res.status_code == 403
    assert "roster" in res.json()["detail"]


def test_start_blocked_when_exam_not_in_progress(client, institutions):
    sid, exam_id = _student_with_exam(client, institutions, lifecycle="scheduled")
    res = _start(client, exam_id)
    assert res.status_code == 409


def test_start_exam_of_other_institution_404(client, institutions):
    sid, _ = _student_with_exam(client, institutions)
    with connect() as conn:
        exam_b = make_exam(conn, institutions["b"])
        conn.commit()
    res = _start(client, exam_b)
    assert res.status_code == 404


def test_student_cannot_start_as_proctor(client, institutions):
    sid, exam_id = _student_with_exam(client, institutions)
    res = client.post("/api/sessions/start", json={"exam_id": str(exam_id)})
    assert res.status_code == 200  # sanity: student path works


# ---------------- WS validation (Phase 2.2 backend half) ----------------

def test_ws_validate_binds_session_to_owner(client, institutions):
    sid, exam_id = _student_with_exam(client, institutions)
    token = _start(client, exam_id).json()["session_token"]

    res = client.get("/api/sessions/ws-validate", params={"session_token": token})
    assert res.status_code == 200, res.text
    assert res.json()["session_token"] == token

    # a second student cannot validate the first student's session
    register_student(client, email="other@a.edu", consent=True)
    # same TestClient shares cookies; log out first
    client.post("/api/auth/logout")
    login(client, "other@a.edu", STUDENT["password"])
    res = client.get("/api/sessions/ws-validate", params={"session_token": token})
    assert res.status_code == 403


def test_ws_validate_unauthenticated_401(client):
    res = client.get("/api/sessions/ws-validate", params={"session_token": "nope"})
    assert res.status_code == 401


# ---------------- event ingest + advisory risk (Phase 2.3) ----------------

def _bound_session(client, institutions):
    sid, exam_id = _student_with_exam(client, institutions)
    return _start(client, exam_id).json()["session_token"]


def _event(eid="sess-0001", etype="gaze_deviation", sev="medium", dur=2.0):
    return {"event_id": eid, "event_type": etype, "severity": sev,
            "start_s": 1.0, "end_s": 1.0 + dur, "duration_s": dur,
            "peak_yaw_dev": 5.0, "peak_gaze_dev": 0.8, "conf": None,
            "detector": "pose_mediapipe", "policy_ref": "pose_v2"}


def test_event_ingest_persists_and_scores(client, institutions):
    token = _bound_session(client, institutions)
    res = client.post(f"/api/sessions/{token}/events", json=_event())
    assert res.status_code == 200, res.text
    assert res.json()["stored"] is True
    assert res.json()["score"] > 0

    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM events_flags WHERE event_id='sess-0001'").fetchone()
        assert row["severity"] == "medium"          # from policy catalog
        assert row["exam_session_id"] is not None   # bound server-side
        assert row["occurred_at"] is not None       # started_at + start_s
        risk = conn.execute("SELECT * FROM risk_scores").fetchone()
        assert risk and "advisory" in risk["version"]


def test_event_duplicate_is_not_double_counted(client, institutions):
    token = _bound_session(client, institutions)
    client.post(f"/api/sessions/{token}/events", json=_event())
    res = client.post(f"/api/sessions/{token}/events", json=_event())
    assert res.json()["stored"] is False
    with connect() as conn:
        assert conn.execute(
            "SELECT count(*) n FROM events_flags WHERE event_id='sess-0001'"
        ).fetchone()["n"] == 1


def test_event_ingest_requires_owner(client, institutions):
    token = _bound_session(client, institutions)
    register_student(client, email="thief@a.edu", consent=True)
    client.post("/api/auth/logout")
    login(client, "thief@a.edu", STUDENT["password"])
    res = client.post(f"/api/sessions/{token}/events", json=_event())
    assert res.status_code == 403


def test_event_severity_comes_from_policy_catalog(client, institutions):
    token = _bound_session(client, institutions)
    # lie about severity: catalog says second_person is critical
    ev = _event(eid="ev-x", etype="second_person", sev="low", dur=1.0)
    ev["detector"] = "yolo11n"
    res = client.post(f"/api/sessions/{token}/events", json=ev)
    assert res.status_code == 200
    with connect() as conn:
        row = conn.execute(
            "SELECT severity FROM events_flags WHERE event_id='ev-x'").fetchone()
        assert row["severity"] == "critical"
