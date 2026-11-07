from fastapi import HTTPException

from conftest import login


def test_login_returns_token_and_user(client, world, tokens):
    r = client.post("/api/v1/auth/login",
                    json={"email": "stu@a.edu", "password": "pw123456"})
    assert r.status_code == 200
    body = r.json()
    assert body["access_token"]
    assert body["user"]["role"] == "student"
    assert body["user"]["consent_status"] == "granted"


def test_login_bad_password_same_error_as_unknown_email(client, world):
    r1 = client.post("/api/v1/auth/login",
                     json={"email": "stu@a.edu", "password": "wrong"})
    r2 = client.post("/api/v1/auth/login",
                     json={"email": "nobody@a.edu", "password": "wrong"})
    assert r1.status_code == r2.status_code == 401
    assert r1.json()["detail"] == r2.json()["detail"]  # no user enumeration


def test_protected_endpoint_requires_token(client, world):
    r = client.get("/api/v1/sessions")
    assert r.status_code == 401


def test_student_cannot_use_admin_endpoints(client, world, tokens):
    r = client.get("/api/v1/admin/users", headers=tokens["student"])
    assert r.status_code == 403


def test_register_student_requires_consent(client, world):
    r = client.post("/api/v1/auth/register", json={
        "role": "student", "full_name": "No Consent", "email": "nc@a.edu",
        "institution_id": "inst_a", "password": "pw123456", "consent": False,
    })
    assert r.status_code == 422


def test_register_proctor_is_pending_approval(client, world):
    r = client.post("/api/v1/auth/register", json={
        "role": "proctor", "full_name": "New Proctor", "email": "np@a.edu",
        "institution_id": "inst_a", "password": "pw123456",
    })
    assert r.status_code == 201
    # pending proctor cannot log in
    r2 = client.post("/api/v1/auth/login",
                     json={"email": "np@a.edu", "password": "pw123456"})
    assert r2.status_code == 403
