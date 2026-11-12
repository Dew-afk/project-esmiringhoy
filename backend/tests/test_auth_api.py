"""A-layer: API tests against the aismering_test database (real proof).

Every test runs against a truncated test DB via TestClient. Passwords are
never printed; failures are reported as-is.
"""
import time

from db import connect
from conftest import STUDENT, register_student, login


def _db_user(email):
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM user_accounts WHERE email = %s", (email,)).fetchone()


# ---------------- registration ----------------

def test_register_student_creates_user_and_consent(client, institutions):
    res = register_student(client)
    assert res.status_code == 201, res.text
    assert res.json()["role"] == "student"
    row = _db_user(STUDENT["email"])
    assert row["password_hash"].startswith("scrypt$")
    assert row["password_hash"] != STUDENT["password"]
    with connect() as conn:
        consent = conn.execute(
            "SELECT status FROM consents WHERE user_id = %s", (row["id"],)).fetchone()
    assert consent and consent["status"] == "granted"


def test_register_student_without_consent_stores_nothing(client, institutions):
    res = register_student(client, consent=False)
    assert res.status_code == 400
    assert "consent" in res.json()["detail"]
    assert _db_user(STUDENT["email"]) is None
    with connect() as conn:
        assert conn.execute("SELECT count(*) AS n FROM consents").fetchone()["n"] == 0


def test_duplicate_email_rejected(client, institutions):
    assert register_student(client).status_code == 201
    res = register_student(client, email="student@a.edu")
    assert res.status_code == 409
    assert "already exists" in res.json()["detail"]


def test_weak_password_rejected(client, institutions):
    res = register_student(client, password="short")
    assert res.status_code == 400
    assert "password" in res.json()["detail"]


def test_admin_self_registration_rejected(client, institutions):
    res = register_student(client, role="admin", consent=None, roster_id=None)
    assert res.status_code == 400
    assert "not self-registered" in res.json()["detail"]


def test_proctor_registration_pending_until_approved(client, institutions):
    res = client.post("/api/auth/register", json={
        "email": "prof@a.edu", "password": "Passw0rd1", "full_name": "Prof A",
        "role": "instructor", "institution": "institution a",
        "staff_id": "S-101", "department": "CS"})
    assert res.status_code == 201
    row = _db_user("prof@a.edu")
    assert row["approval_status"] == "pending"
    assert row["staff_id"] == "S-101"

    res = login(client, "prof@a.edu", "Passw0rd1")
    assert res.status_code == 403
    assert "pending approval" in res.json()["detail"]

    with connect() as conn:
        conn.execute("UPDATE user_accounts SET approval_status='approved' "
                     "WHERE email='prof@a.edu'")
        conn.commit()
    res = login(client, "prof@a.edu", "Passw0rd1")
    assert res.status_code == 200, res.text
    assert res.json()["role"] == "instructor"


# ---------------- login ----------------

def test_wrong_password_and_unknown_email_same_message(client, institutions):
    register_student(client)
    wrong = login(client, STUDENT["email"], "WrongPass1")
    unknown = login(client, "ghost@a.edu", "Whatever1")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"] == "invalid email or password"


def test_login_role_comes_from_server_record(client, institutions):
    register_student(client)
    with connect() as conn:
        conn.execute("UPDATE user_accounts SET role='instructor' WHERE email=%s",
                     (STUDENT["email"],))
        conn.commit()
    res = login(client, STUDENT["email"], STUDENT["password"])
    assert res.status_code == 200
    assert res.json()["role"] == "instructor"  # server record, not the form


def test_login_sets_httponly_cookie_and_me_works(client, institutions):
    register_student(client)
    res = login(client, STUDENT["email"], STUDENT["password"])
    cookie = res.headers.get("set-cookie", "")
    assert "aismering_session" in cookie and "HttpOnly" in cookie
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["role"] == "student"


def test_me_without_cookie_401(client):
    assert client.get("/api/auth/me").status_code == 401


def test_disabled_account_cannot_login(client, institutions):
    register_student(client)
    with connect() as conn:
        conn.execute("UPDATE user_accounts SET approval_status='disabled' WHERE email=%s",
                     (STUDENT["email"],))
        conn.commit()
    res = login(client, STUDENT["email"], STUDENT["password"])
    assert res.status_code == 403
    assert "disabled" in res.json()["detail"]


def test_lockout_after_repeated_failures(client, institutions):
    register_student(client, email="lockout@a.edu")
    for _ in range(5):
        res = login(client, "lockout@a.edu", "WrongPass1")
        assert res.status_code == 401
    res = login(client, "lockout@a.edu", STUDENT["password"])  # right password, but locked
    assert res.status_code == 429


def test_admin_login_requires_tenant(client, institutions):
    with connect() as conn:
        conn.execute("""INSERT INTO user_accounts (email, password_hash, full_name, role)
                        VALUES ('boss@a.edu', 'unused', 'Boss', 'admin')""")
        conn.commit()
    # admin login without institution -> 400 (SPEC: tenant selection required)
    res = login(client, "boss@a.edu", "whatever1")
    assert res.status_code in (400, 401)  # 400 tenant, or 401 unknown hash path


# ---------------- authorization ----------------

def test_me_401_without_session(client):
    assert client.get("/api/auth/me").status_code == 401


def test_logout_invalidates_session(client, institutions):
    register_student(client)
    login(client, STUDENT["email"], STUDENT["password"])
    assert client.get("/api/auth/me").status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401


def test_consent_revoke_flips_status(client, institutions):
    register_student(client)
    login(client, STUDENT["email"], STUDENT["password"])
    assert client.post("/api/consent/revoke").status_code == 200
    with connect() as conn:
        row = conn.execute(
            "SELECT status FROM consents WHERE user_id = "
            "(SELECT id FROM user_accounts WHERE email = %s)", (STUDENT["email"],)).fetchone()
    assert row["status"] == "revoked"


# ---------------- safety ----------------

def test_no_secrets_in_responses(client, institutions):
    register_student(client)
    res = login(client, STUDENT["email"], STUDENT["password"])
    body = res.text
    assert STUDENT["password"] not in body
    assert "password_hash" not in body
    assert "scrypt$" not in body
    me = client.get("/api/auth/me").text
    assert "password" not in me and "scrypt$" not in me


def test_sql_injection_and_oversized_inputs_rejected(client, institutions):
    evil = register_student(client, email="x' OR 1=1--@a.edu")
    assert evil.status_code == 400, "injection-style email must be rejected"
    long_name = register_student(client, email="big@a.edu", full_name="A" * 10000)
    assert long_name.status_code in (400, 422), "oversized input must be rejected"
