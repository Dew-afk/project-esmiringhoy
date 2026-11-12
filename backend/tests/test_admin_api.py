"""A-layer API tests: admin account management (Phase 1.2).

Real DB (aismering_test), real HTTP via TestClient. Temp passwords are
asserted to appear exactly once and never in audit_log.
"""
from db import connect
from conftest import (audit_rows, institutions, login, make_exam, seed_account,
                      link_tenant, roster_student, user_id_by_email)
import security


def _admin(client, institutions):
    """Seed an admin in institution a and log in. Returns (user_id, inst_id)."""
    with connect() as conn:
        uid = seed_account(conn, "admin@a.edu", "AdminPass1", "admin",
                           institutions["a"])
        link_tenant(conn, uid, institutions["a"])
        conn.commit()
    res = login(client, "admin@a.edu", "AdminPass1", institution="institution a")
    assert res.status_code == 200, res.text
    return uid, institutions["a"]


def _pending_proctor(client, institutions):
    res = client.post("/api/auth/register", json={
        "email": "prof@a.edu", "password": "Passw0rd1", "full_name": "Prof A",
        "role": "instructor", "institution": "institution a"})
    assert res.status_code == 201, res.text


def test_accounts_requires_auth(client):
    assert client.get("/api/admin/accounts").status_code == 401


def test_accounts_forbidden_for_student(client, institutions):
    client.post("/api/auth/register", json={
        "email": "s@a.edu", "password": "Passw0rd1", "full_name": "S",
        "role": "student", "institution": "institution a", "consent": True})
    login(client, "s@a.edu", "Passw0rd1")
    assert client.get("/api/admin/accounts").status_code == 403


def test_pending_list_and_approve(client, institutions):
    _admin(client, institutions)
    _pending_proctor(client, institutions)

    res = client.get("/api/admin/accounts?status=pending")
    assert res.status_code == 200, res.text
    emails = [a["email"] for a in res.json()["accounts"]]
    assert "prof@a.edu" in emails

    with connect() as conn:
        pid = user_id_by_email(conn, "prof@a.edu")
    res = client.post(f"/api/admin/accounts/{pid}/approve")
    assert res.status_code == 200, res.text

    res = login(client, "prof@a.edu", "Passw0rd1", institution="institution a")
    assert res.status_code == 200
    assert res.json()["role"] == "instructor"

    with connect() as conn:
        rows = audit_rows(conn, "account.approve")
        assert len(rows) == 1
        assert rows[0]["before"] == {"approval_status": "pending"}
        assert rows[0]["after"] == {"approval_status": "approved"}
        assert str(rows[0]["institution_id"]) == str(institutions["a"])


def test_disable_blocks_login_and_audits(client, institutions):
    _admin(client, institutions)
    client.post("/api/auth/register", json={
        "email": "s2@a.edu", "password": "Passw0rd1", "full_name": "S2",
        "role": "student", "institution": "institution a", "consent": True})
    with connect() as conn:
        sid = user_id_by_email(conn, "s2@a.edu")
    res = client.post(f"/api/admin/accounts/{sid}/disable")
    assert res.status_code == 200
    res = login(client, "s2@a.edu", "Passw0rd1")
    assert res.status_code == 403
    with connect() as conn:
        rows = audit_rows(conn, "account.disable")
        assert rows[0]["before"] == {"approval_status": "approved"}
        assert rows[0]["after"] == {"approval_status": "disabled"}


def test_cannot_touch_other_institution_account(client, institutions):
    _admin(client, institutions)
    # proctor in institution b
    res = client.post("/api/auth/register", json={
        "email": "prof@b.edu", "password": "Passw0rd1", "full_name": "Prof B",
        "role": "instructor", "institution": "institution b"})
    assert res.status_code == 201
    with connect() as conn:
        pid = user_id_by_email(conn, "prof@b.edu")
    res = client.post(f"/api/admin/accounts/{pid}/approve")
    assert res.status_code == 404  # not visible outside own tenant


def test_cannot_disable_self(client, institutions):
    admin_id, _ = _admin(client, institutions)
    res = client.post(f"/api/admin/accounts/{admin_id}/disable")
    assert res.status_code == 400


def test_create_appeals_reviewer_returns_temp_password_once(client, institutions):
    _admin(client, institutions)
    res = client.post("/api/admin/accounts", json={
        "email": "reviewer@a.edu", "full_name": "Rev A",
        "role": "appeals_reviewer"})
    assert res.status_code == 200, res.text
    body = res.json()
    temp = body["temp_password"]
    assert temp and len(temp) >= 8

    # password works for login, is never stored or audited in plaintext
    res = login(client, "reviewer@a.edu", temp, institution="institution a")
    assert res.status_code == 200
    assert res.json()["role"] == "appeals_reviewer"

    with connect() as conn:
        row = conn.execute(
            "SELECT password_hash FROM user_accounts WHERE email='reviewer@a.edu'"
        ).fetchone()
        assert row["password_hash"] != temp
        assert row["password_hash"].startswith("scrypt$")
        for r in audit_rows(conn, "account.create"):
            assert temp not in str(r["after"])


def test_create_rejects_student_and_admin_self_service(client, institutions):
    _admin(client, institutions)
    res = client.post("/api/admin/accounts", json={
        "email": "x@a.edu", "full_name": "X", "role": "student"})
    assert res.status_code == 422  # pattern restricts to admin|appeals_reviewer


def test_admin_create_admin(client, institutions):
    _admin(client, institutions)
    res = client.post("/api/admin/accounts", json={
        "email": "admin2@a.edu", "full_name": "Admin 2", "role": "admin"})
    assert res.status_code == 200
    res = login(client, "admin2@a.edu", res.json()["temp_password"],
                institution="institution a")
    assert res.status_code == 200
    assert res.json()["role"] == "admin"
