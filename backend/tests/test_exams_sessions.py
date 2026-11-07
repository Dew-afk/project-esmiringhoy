from conftest import login, start_session


def test_proctor_creates_exam_and_lifecycle(client, world, tokens):
    r = client.post("/api/v1/exams", headers=tokens["proctor"], json={
        "title": "New Exam", "course_code": "X101", "institution_id": "inst_a",
        "window_start": "2026-11-07T08:00:00+00:00",
        "window_end": "2026-11-07T10:00:00+00:00",
        "duration_min": 60, "allowed_materials": [], "policy_template_id": "pol_std",
    })
    assert r.status_code == 201
    exam_id = r.json()["exam_id"]
    assert r.json()["status"] == "draft"
    # legal transitions
    for to in ["scheduled", "in_progress", "completed", "archived"]:
        r = client.post(f"/api/v1/exams/{exam_id}/transition",
                        json={"to": to}, headers=tokens["proctor"])
        assert r.status_code == 200, r.text


def test_illegal_lifecycle_transition_rejected(client, world, tokens):
    r = client.post("/api/v1/exams/exm_a/transition",
                    json={"to": "in_progress"}, headers=tokens["proctor"])
    # exm_a is scheduled — jumping straight to in_progress is legal;
    # going backward is not:
    assert r.status_code == 200
    r = client.post("/api/v1/exams/exm_a/transition",
                    json={"to": "draft"}, headers=tokens["proctor"])
    assert r.status_code == 409


def test_student_exam_list_comes_from_roster(client, world, tokens):
    r = client.get("/api/v1/exams/mine", headers=tokens["student"])
    assert r.status_code == 200
    assert any(e["exam_id"] == "exm_a" for e in r.json())
    # student in institution B has no roster assignments here
    r2 = client.get("/api/v1/exams/mine", headers=tokens["student_b"])
    assert r2.json() == []


def test_session_start_idempotent(client, world, tokens):
    sid1 = start_session(client, tokens)
    sid2 = start_session(client, tokens)
    assert sid1 == sid2


def test_session_ownership(client, world, tokens):
    sid = start_session(client, tokens)
    # another student cannot end it
    r = client.post(f"/api/v1/sessions/{sid}/end", headers=tokens["student_b"])
    assert r.status_code == 403
    # owner can, and it is idempotent
    r = client.post(f"/api/v1/sessions/{sid}/end", headers=tokens["student"])
    assert r.status_code == 200
    r = client.post(f"/api/v1/sessions/{sid}/end", headers=tokens["student"])
    assert r.status_code == 200
    assert r.json()["status"] == "completed"


def test_session_requires_consent_and_window(client, world, tokens, db):
    from app import models
    db.query(models.Consents).delete()
    db.commit()
    r = client.post("/api/v1/sessions", json={"exam_id": "exm_a"},
                    headers=tokens["student"])
    assert r.status_code == 403  # consent revoked
