"""A-layer API tests: proctor read endpoints, review actions, appeals lane
(Phases 1.3, 2.4-2.6).
"""
from db import connect
from conftest import (audit_rows, login, make_exam, register_student,
                      roster_student, seed_account, link_tenant,
                      user_id_by_email, STUDENT)


def _world(client, institutions):
    """Student + in-progress exam + session + two flags + proctor/admin.
    Returns dict of ids/tokens."""
    register_student(client)
    login(client, STUDENT["email"], STUDENT["password"])
    with connect() as conn:
        sid = user_id_by_email(conn, STUDENT["email"])
        exam_id = make_exam(conn, institutions["a"])
        roster_student(conn, exam_id, sid)
        # approved proctor in institution a
        pid = seed_account(conn, "prof@a.edu", "ProfPass1", "instructor", institutions["a"], approval="approved")
        # seed_account doesn't link tenant; do it here
        link_tenant(conn, pid, institutions["a"])
        conn.commit()
    sess = client.post("/api/sessions/start", json={"exam_id": str(exam_id)})
    assert sess.status_code == 200, sess.text
    stoken = sess.json()["session_token"]

    def ev(eid, etype, sev, dur=2.0):
        return {"event_id": eid, "event_type": etype, "severity": sev,
                "start_s": 1.0, "end_s": 1.0 + dur, "duration_s": dur,
                "detector": "pose_mediapipe", "policy_ref": "pose_v2"}

    client.post(f"/api/sessions/{stoken}/events",
                json=ev("f-low-1", "copy_paste", "low"))
    client.post(f"/api/sessions/{stoken}/events",
                json=ev("f-med-1", "gaze_deviation", "medium"))
    client.post(f"/api/sessions/{stoken}/events",
                json=ev("f-low-2", "copy_paste", "low"))

    client.post("/api/auth/logout")
    res = login(client, "prof@a.edu", "ProfPass1", institution="institution a")
    assert res.status_code == 200, res.text
    return {"session_token": stoken, "exam_id": exam_id,
            "session_id": sess.json()["session_id"]}


def _session_id(client, world):
    res = client.get("/api/proctor/sessions")
    assert res.status_code == 200
    rows = [s for s in res.json()["sessions"]
            if s["id"] == world["session_id"]]
    assert rows, "session missing from proctor list"
    return world["session_id"]


# ---------------- proctor read endpoints (Phase 2.4) ----------------

def test_proctor_sessions_requires_role(client, institutions):
    assert client.get("/api/proctor/sessions").status_code == 401


def test_proctor_sessions_lists_with_counts(client, institutions):
    world = _world(client, institutions)
    res = client.get("/api/proctor/sessions")
    assert res.status_code == 200, res.text
    row = [s for s in res.json()["sessions"]
           if s["id"] == world["session_id"]][0]
    assert row["flag_count"] == 3 and row["unreviewed_count"] == 3
    assert row["exam"] == "midterm 1"
    assert row["risk_score"] is not None


def test_student_cannot_read_proctor_endpoints(client, institutions):
    _world(client, institutions)
    client.post("/api/auth/logout")
    login(client, STUDENT["email"], STUDENT["password"])
    assert client.get("/api/proctor/sessions").status_code == 403


def test_flags_endpoint_and_cross_institution_404(client, institutions):
    world = _world(client, institutions)
    res = client.get(f"/api/proctor/sessions/{world['session_id']}/flags")
    assert res.status_code == 200, res.text
    flags = res.json()["flags"]
    assert len(flags) == 3
    assert flags[0]["event_type"] in ("copy_paste", "gaze_deviation")

    # admin/proctor of institution b cannot see institution a's session
    with connect() as conn:
        conn.execute("INSERT INTO institutions (name) VALUES ('institution c')")
        inst_c = conn.execute(
            "SELECT id FROM institutions WHERE name='institution c'").fetchone()["id"]
        aid = seed_account(conn, "adminc@c.edu", "AdminPass1", "admin", inst_c, approval="approved")
        link_tenant(conn, aid, inst_c)
        conn.commit()
    client.post("/api/auth/logout")
    login(client, "adminc@c.edu", "AdminPass1", institution="institution c")
    res = client.get(f"/api/proctor/sessions/{world['session_id']}/flags")
    assert res.status_code == 404


# ---------------- review actions (Phase 2.5) ----------------

def test_acknowledge_and_note_with_audit(client, institutions):
    world = _world(client, institutions)
    res = client.post("/api/flags/f-med-1/review",
                      json={"action": "acknowledged", "note": "checked, ok"})
    assert res.status_code == 200, res.text
    with connect() as conn:
        row = conn.execute(
            "SELECT review_action, review_note, reviewed_by FROM events_flags "
            "WHERE event_id='f-med-1'").fetchone()
        assert row["review_action"] == "acknowledged"
        assert row["review_note"] == "checked, ok"
        assert row["reviewed_by"] is not None
        audits = audit_rows(conn, "flag.acknowledged")
        assert audits[0]["before"]["review_action"] is None
        assert audits[0]["after"]["note"] == "checked, ok"


def test_severity_override_keeps_original(client, institutions):
    world = _world(client, institutions)
    res = client.post("/api/flags/f-med-1/severity",
                      json={"severity": "low"})
    assert res.status_code == 200, res.text
    with connect() as conn:
        row = conn.execute(
            "SELECT severity, severity_override FROM events_flags "
            "WHERE event_id='f-med-1'").fetchone()
        assert row["severity"] == "medium"        # original kept
        assert row["severity_override"] == "low"
        audits = audit_rows(conn, "flag.severity_override")
        assert audits[0]["before"]["severity"] == "medium"


def test_bulk_dismiss_only_low_same_type(client, institutions):
    world = _world(client, institutions)
    res = client.post("/api/flags/bulk-dismiss", json={
        "exam_session_id": world["session_id"], "event_type": "copy_paste"})
    assert res.status_code == 200, res.text
    assert res.json()["dismissed"] == 2  # the two copy_paste lows
    with connect() as conn:
        rows = conn.execute(
            "SELECT event_id, review_action FROM events_flags "
            "WHERE exam_session_id=%s", (world["session_id"],)).fetchall()
        by_id = {r["event_id"]: r["review_action"] for r in rows}
        assert by_id["f-low-1"] == "dismissed" and by_id["f-low-2"] == "dismissed"
        assert by_id["f-med-1"] is None  # medium untouched
        audits = audit_rows(conn, "flag.bulk_dismiss")
        assert audits[0]["after"]["count"] == 2


def test_escalate_stores_recording_ref(client, institutions):
    world = _world(client, institutions)
    res = client.post("/api/flags/f-med-1/escalate",
                      json={"recording_ref": "rec_abc123", "note": "suspicious"})
    assert res.status_code == 200, res.text
    with connect() as conn:
        row = conn.execute(
            "SELECT review_action, escalation_recording_ref FROM events_flags "
            "WHERE event_id='f-med-1'").fetchone()
        assert row["review_action"] == "escalated"
        assert row["escalation_recording_ref"] == "rec_abc123"
        assert audit_rows(conn, "flag.escalate")


def test_review_actions_require_proctor_role(client, institutions):
    world = _world(client, institutions)
    client.post("/api/auth/logout")
    login(client, STUDENT["email"], STUDENT["password"])
    res = client.post("/api/flags/f-med-1/review", json={"action": "dismissed"})
    assert res.status_code == 403


# ---------------- appeals lane (Phase 2.6) ----------------

def test_appeals_sees_only_escalated(client, institutions):
    world = _world(client, institutions)
    client.post("/api/flags/f-med-1/escalate",
                json={"recording_ref": "rec_abc123"})

    # appeals reviewer in institution a
    with connect() as conn:
        rid = seed_account(conn, "rev@a.edu", "RevPass1", "appeals_reviewer", institutions["a"], approval="approved")
        link_tenant(conn, rid, institutions["a"])
        conn.commit()
    client.post("/api/auth/logout")
    res = login(client, "rev@a.edu", "RevPass1", institution="institution a")
    assert res.status_code == 200

    res = client.get("/api/appeals/escalated")
    assert res.status_code == 200, res.text
    rows = res.json()["escalated"]
    assert len(rows) == 1
    assert rows[0]["event_id"] == "f-med-1"
    assert rows[0]["escalation_recording_ref"] == "rec_abc123"
    assert rows[0]["exam"] == "midterm 1"

    # appeals reviewer cannot call write endpoints
    res = client.post("/api/flags/f-low-1/review", json={"action": "dismissed"})
    assert res.status_code == 403


def test_appeals_cannot_see_other_institution(client, institutions):
    world = _world(client, institutions)
    client.post("/api/flags/f-med-1/escalate", json={})
    with connect() as conn:
        conn.execute("INSERT INTO institutions (name) VALUES ('institution d')")
        inst_d = conn.execute(
            "SELECT id FROM institutions WHERE name='institution d'").fetchone()["id"]
        rid = seed_account(conn, "rev@d.edu", "RevPass1", "appeals_reviewer", inst_d, approval="approved")
        link_tenant(conn, rid, inst_d)
        conn.commit()
    client.post("/api/auth/logout")
    login(client, "rev@d.edu", "RevPass1", institution="institution d")
    res = client.get("/api/appeals/escalated")
    assert res.status_code == 200
    assert res.json()["escalated"] == []


# ---------------- human-in-the-loop invariant ----------------

def test_no_cheating_outcome_anywhere(client, institutions):
    """No table column or API response may carry a cheating determination."""
    world = _world(client, institutions)
    client.post("/api/flags/f-med-1/escalate", json={})
    with connect() as conn:
        cols = conn.execute(
            """SELECT table_name, column_name FROM information_schema.columns
               WHERE table_schema='public'
                 AND (column_name ILIKE '%cheat%' OR column_name ILIKE '%guilty%'
                      OR column_name ILIKE '%violation%')""").fetchall()
        assert cols == [], f"cheating-outcome columns exist: {cols}"
    for path in ("/api/proctor/sessions", f"/api/proctor/sessions/{world['session_id']}/flags",
                 "/api/appeals/escalated"):
        body = client.get(path).text.lower()
        for banned in ("cheating", "guilty", "violation"):
            assert banned not in body, f"{banned} in {path}"
