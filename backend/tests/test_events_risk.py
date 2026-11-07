from conftest import ingest_event, start_session


def test_ingest_requires_ml_token(client, world, tokens):
    sid = start_session(client, tokens)
    r = client.post("/api/v1/ml/events",
                    json={"ml_session_id": "live_x", "events": []})
    assert r.status_code == 401


def test_unmapped_ml_session_rejected(client, world, tokens):
    # correct token but no mapping → never guess
    r = client.post("/api/v1/ml/events",
                    json={"ml_session_id": "live_unknown", "events": []},
                    headers={"X-ML-Token": "dev-ml-token-change-me"})
    assert r.status_code == 422


def test_unknown_event_type_rejected(client, world, tokens):
    sid = start_session(client, tokens)
    r = client.post(f"/api/v1/sessions/{sid}/ml-register",
                    json={"ml_session_id": "live_x"}, headers=tokens["student"])
    assert r.status_code == 200
    r = client.post("/api/v1/ml/events",
                    json={"ml_session_id": "live_x", "events": [{
                        "event_id": "bad", "event_type": "nonsense",
                        "severity": "medium", "start_s": 1, "end_s": 2,
                        "duration_s": 1, "detector": "pose_mediapipe"}]},
                    headers={"X-ML-Token": "dev-ml-token-change-me"})
    assert r.status_code == 422


def test_duplicate_event_id_dropped_by_worker(client, world, tokens, db):
    from app.workers.event_worker import process_queued
    from app import models
    sid = start_session(client, tokens)
    ingest_event(client, tokens, sid, event_id="dup_ev")
    ingest_event(client, tokens, sid, event_id="dup_ev")
    assert process_queued(db) == 2  # both claimed; second is dropped as dup
    rows = db.query(models.EventsFlags).filter(models.EventsFlags.event_id == "dup_ev").all()
    assert len(rows) == 1


def test_risk_score_accumulates_once_per_event(client, world, tokens, db):
    from app.workers.event_worker import process_queued
    from app import models
    sid = start_session(client, tokens)
    ingest_event(client, tokens, sid, event_id="e_med", severity="medium")
    ingest_event(client, tokens, sid, event_id="e_crit", severity="critical")
    process_queued(db)
    score = db.query(models.RiskScores).filter(models.RiskScores.session_id == sid).first()
    # dev defaults: medium 8 + critical 50
    assert score.score == 58.0


def test_queue_nack_retries_then_dead_letter(client, world, tokens, db):
    from datetime import datetime, timedelta, timezone
    from app.services import queue as q
    from app import models
    from app.workers.event_worker import process_queued

    q.enqueue(db, kind="ml_event", payload={"exam_session_id": "nope"})
    db.commit()
    process_queued(db)  # attempt 1 fails → nack schedules a backoff
    row = db.query(models.EventQueue).first()
    assert row.status == "pending"
    assert row.attempts == 1
    from app.models import ensure_utc
    assert ensure_utc(row.next_attempt_at) > datetime.now(timezone.utc)

    # fast-forward the schedule for the remaining attempts
    for expected in (2, 3):
        row.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        process_queued(db)
        row = db.query(models.EventQueue).first()
        assert row.attempts == expected
    assert row.status == "dead"
    assert row.last_error


def test_risk_weights_endpoint_explainable(client, world, tokens):
    r = client.get("/api/v1/ml/weights", headers=tokens["proctor"])
    assert r.status_code == 200
    assert r.json()["status"] == "unapproved implementation defaults"
    assert r.json()["weights"]["critical"] == 50.0
