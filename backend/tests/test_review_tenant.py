from conftest import ingest_event, start_session


def test_review_flow_audits_and_retains_original_severity(client, world, tokens, db):
    from app import models
    sid = start_session(client, tokens)
    ingest_event(client, tokens, sid, event_id="ev_r")
    from app.workers.event_worker import process_queued
    process_queued(db)

    r = client.post("/api/v1/events/ev_r/review",
                    json={"action": "override", "severity": "high"},
                    headers=tokens["proctor"])
    assert r.status_code == 200
    assert r.json()["severity"] == "medium"  # original retained
    assert r.json()["severity_override"] == "high"

    r = client.post("/api/v1/events/ev_r/review",
                    json={"action": "note", "note": "context for appeal"},
                    headers=tokens["proctor"])
    assert r.status_code == 200

    r = client.post("/api/v1/events/ev_r/review",
                    json={"action": "acknowledge"}, headers=tokens["proctor"])
    assert r.status_code == 200

    audits = db.query(models.AuditLog).all()
    actions = {a.action for a in audits}
    assert "REVIEW_EVENT:override" in actions
    assert "REVIEW_EVENT:note" in actions
    assert "REVIEW_EVENT:acknowledge" in actions


def test_bulk_review_only_low_severity(client, world, tokens, db):
    from app.workers.event_worker import process_queued
    sid = start_session(client, tokens)
    ingest_event(client, tokens, sid, event_id="ev_low", severity="low")
    ingest_event(client, tokens, sid, event_id="ev_crit2", severity="critical")
    process_queued(db)
    r = client.post(f"/api/v1/sessions/{sid}/bulk-review",
                    json={"event_ids": ["ev_low"], "action": "dismiss"},
                    headers=tokens["proctor"])
    assert r.status_code == 200
    r = client.post(f"/api/v1/sessions/{sid}/bulk-review",
                    json={"event_ids": ["ev_crit2"], "action": "dismiss"},
                    headers=tokens["proctor"])
    assert r.status_code == 422


def test_tenant_isolation_sessions(client, world, tokens):
    sid = start_session(client, tokens)
    # Institution B's student cannot read A's session
    r = client.get(f"/api/v1/sessions/{sid}", headers=tokens["student_b"])
    assert r.status_code == 403


def test_tenant_isolation_review(client, world, tokens, db):
    from app.workers.event_worker import process_queued
    sid = start_session(client, tokens)
    ingest_event(client, tokens, sid, event_id="ev_iso")
    process_queued(db)
    # Institution B student cannot review events
    r = client.post("/api/v1/events/ev_iso/review",
                    json={"action": "dismiss"}, headers=tokens["student_b"])
    assert r.status_code == 403


def test_proctor_sees_only_own_institution_sessions(client, world, tokens):
    start_session(client, tokens)
    r = client.get("/api/v1/sessions", headers=tokens["proctor"])
    assert all(s["exam_id"] == "exm_a" for s in r.json())
