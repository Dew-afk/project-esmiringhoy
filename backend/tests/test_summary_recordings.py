import json
from datetime import datetime, timedelta, timezone

from conftest import ingest_event, start_session


def test_summary_unavailable_without_llm(client, world, tokens, db):
    from app.workers.event_worker import process_queued
    sid = start_session(client, tokens)
    ingest_event(client, tokens, sid)
    process_queued(db)
    r = client.post(f"/api/v1/sessions/{sid}/summary", headers=tokens["proctor"])
    assert r.status_code == 503  # honest unavailable — never fabricated
    assert "unavailable" in r.json()["detail"]


def test_summary_traceability_validation(monkeypatch, client, world, tokens, db):
    """Every statement must reference a real event of the session."""
    from app.workers.event_worker import process_queued
    from app.core.config import settings
    from app.services import summary as summary_service
    from app import models

    monkeypatch.setattr(settings, "llm_api_key", "k")
    monkeypatch.setattr(settings, "llm_base_url", "https://llm.example/v1")
    monkeypatch.setattr(settings, "llm_model", "test-model")

    sid = start_session(client, tokens)
    ingest_event(client, tokens, sid, event_id="ev_sum")
    process_queued(db)

    def fake_post(url, **kwargs):
        class Resp:
            def raise_for_status(self):
                pass

            def json(self):
                return {"choices": [{"message": {"content": json.dumps({
                    "statements": [
                        {"event_id": "ev_sum", "text": "The student looked away at 10 s.", "t_s": 10},
                        {"event_id": "ev_does_not_exist", "text": "Fabricated.", "t_s": 99},
                    ]
                })}}]}

        return Resp()

    monkeypatch.setattr(summary_service.httpx, "post", fake_post)
    r = client.post(f"/api/v1/sessions/{sid}/summary", headers=tokens["proctor"])
    assert r.status_code == 503
    assert "unknown events" in r.json()["detail"].lower()
    assert db.query(models.SessionSummaries).count() == 0


def test_summary_stored_when_valid(monkeypatch, client, world, tokens, db):
    from app.workers.event_worker import process_queued
    from app.core.config import settings
    from app.services import summary as summary_service
    from app import models

    monkeypatch.setattr(settings, "llm_api_key", "k")
    monkeypatch.setattr(settings, "llm_base_url", "https://llm.example/v1")
    monkeypatch.setattr(settings, "llm_model", "test-model")

    sid = start_session(client, tokens)
    ingest_event(client, tokens, sid, event_id="ev_ok")
    process_queued(db)

    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"content": json.dumps({
                "statements": [{"event_id": "ev_ok", "text": "Advisory note.", "t_s": 10}]
            })}}]}

    monkeypatch.setattr(summary_service.httpx, "post", lambda *a, **k: Resp())
    r = client.post(f"/api/v1/sessions/{sid}/summary", headers=tokens["proctor"])
    assert r.status_code == 201
    assert r.json()["advisory"] is True
    assert db.query(models.SessionSummaries).count() == 1


def test_recording_upload_export_flow(client, world, tokens, db):
    from app import models
    sid = start_session(client, tokens)
    # student uploads (dev local adapter)
    r = client.post(
        f"/api/v1/sessions/{sid}/recordings",
        files={"file": ("clip.mp4", b"\x00fakevideo", "video/mp4")},
        headers=tokens["student"],
    )
    assert r.status_code == 201, r.text
    assert r.json()["dev_local"] is True
    recording_id = r.json()["recording_id"]

    # proctor exports a completed session only
    r = client.post(f"/api/v1/sessions/recordings/{recording_id}/export",
                    headers=tokens["proctor"])
    assert r.status_code == 409  # still active
    client.post(f"/api/v1/sessions/{sid}/end", headers=tokens["student"])
    r = client.post(f"/api/v1/sessions/recordings/{recording_id}/export",
                    headers=tokens["proctor"])
    assert r.status_code == 200
    url = r.json()["url"]
    assert url.startswith("/api/v1/sessions/recordings/")

    # download with the signed token works; without it, denied
    r = client.get(url, headers=tokens["proctor"])
    assert r.status_code == 200
    assert r.content == b"\x00fakevideo"
    r = client.get(f"/api/v1/sessions/recordings/{recording_id}/download",
                   headers=tokens["proctor"])
    assert r.status_code == 403

    # student cannot export (proctors only)
    r = client.post(f"/api/v1/sessions/recordings/{recording_id}/export",
                    headers=tokens["student"])
    assert r.status_code == 403

    # export is audit-logged
    assert db.query(models.AuditLog).filter(
        models.AuditLog.action == "EXPORT_RECORDING"
    ).count() == 1


def test_retention_purges_only_configured(client, world, tokens, db):
    from app import models
    from app.services.retention import purge_expired

    sid = start_session(client, tokens)
    client.post(f"/api/v1/sessions/{sid}/end", headers=tokens["student"])
    session = db.get(models.ExamSession, sid)
    session.end_time = datetime.now(timezone.utc) - timedelta(days=400)
    db.commit()

    # no retention configured anywhere → nothing is purged
    result = purge_expired(db)
    db.commit()
    assert result["purged_sessions"] == 0
    assert db.get(models.ExamSession, sid) is not None

    # configure the institution explicitly → purged, logged, idempotent
    db.get(models.Institution, "inst_a").retention_days = 30
    db.commit()
    result = purge_expired(db, by="test")
    db.commit()
    assert result["purged_sessions"] == 1
    assert db.get(models.ExamSession, sid) is None
    assert db.query(models.RetentionLog).count() == 1
    assert purge_expired(db)["purged_sessions"] == 0


def test_db_viewer_delete_guards(client, world, tokens, db):
    from app import models
    # institution A is NOT a test institution → deletion refused
    r = client.delete("/api/v1/admin/db/UserAccount/u_stu", headers=tokens["admin"])
    assert r.status_code == 403
    # protected tables are never deletable
    r = client.delete("/api/v1/admin/db/AuditLog/1", headers=tokens["admin"])
    assert r.status_code == 403
    # unknown table
    r = client.get("/api/v1/admin/db/UserAccount2", headers=tokens["admin"])
    assert r.status_code == 404
    # a test-institution user IS deletable, with audit
    test_user = models.UserAccount(
        id="u_test_del", institution_id=world["test_inst"].id, role="student",
        full_name="Test Student", email="ts@test.edu",
    )
    db.add(test_user)
    db.commit()
    r = client.delete("/api/v1/admin/db/UserAccount/u_test_del", headers=tokens["admin"])
    assert r.status_code == 200
    db.expire_all()
    assert db.get(models.UserAccount, "u_test_del") is None
    assert db.query(models.AuditLog).filter(
        models.AuditLog.action == "DELETE:UserAccount"
    ).count() == 1


def test_db_viewer_scoped_to_institution(client, world, tokens, db):
    from app import models
    # institution A admin must not see institution B's accounts
    r = client.get("/api/v1/admin/db/UserAccount", headers=tokens["admin"])
    ids = {row["id"] for row in r.json()["rows"]}
    assert "u_stu" in ids
    assert "u_stu_b" not in ids
