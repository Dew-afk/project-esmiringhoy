"""AIsmering auth API -- the minimum routes the account-flow test needs.

Run:  uvicorn main:app --port 8001   (from backend/; DATABASE_URL from db/.env)
Never prints or returns passwords or hashes.
"""
import re

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from db import connect, write_audit
from deps import current_user
import security
import admin
import review
import sessions

app = FastAPI(title="AIsmering Auth API")
app.include_router(sessions.router)
app.include_router(review.router)
app.include_router(admin.router)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
WEAK_PASSWORD_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d).{8,}$")
GENERIC_LOGIN_ERROR = "invalid email or password"


class RegisterBody(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)
    full_name: str = Field(max_length=200)
    role: str = Field(pattern="^(student|instructor|admin)$")
    institution: str = Field(max_length=200)
    roster_id: str | None = Field(default=None, max_length=100)
    staff_id: str | None = Field(default=None, max_length=100)
    department: str | None = Field(default=None, max_length=100)
    consent: bool | None = None


class LoginBody(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)
    institution: str | None = Field(default=None, max_length=200)


@app.post("/api/auth/register")
def register(body: RegisterBody):
    if body.role == "admin":
        return JSONResponse(status_code=400,
            content={"detail": "admin accounts are not self-registered"})
    if not EMAIL_RE.match(body.email):
        return JSONResponse(status_code=400, content={"detail": "invalid email"})
    if not WEAK_PASSWORD_RE.match(body.password):
        return JSONResponse(status_code=400,
            content={"detail": "password needs 8+ characters with a letter and a digit"})
    if body.role == "student" and not body.consent:
        # SPEC: no consent -> registration rejected and nothing stored
        return JSONResponse(status_code=400,
            content={"detail": "biometric-monitoring consent is required"})

    with connect() as conn:
        row = conn.execute(
            "SELECT id FROM institutions WHERE name = %s", (body.institution,)
        ).fetchone()
        if not row:
            return JSONResponse(status_code=404,
                content={"detail": "institution not found"})
        institution_id = row["id"]

        dup = conn.execute(
            "SELECT 1 FROM user_accounts WHERE email = %s", (body.email,)
        ).fetchone()
        if dup:
            return JSONResponse(status_code=409,
                content={"detail": "an account with this email already exists"})

        approval = "pending" if body.role == "instructor" else "approved"
        user = conn.execute(
            """INSERT INTO user_accounts (email, password_hash, full_name, role,
                                          auth_provider, approval_status,
                                          roster_id, staff_id, department)
               VALUES (%s, %s, %s, %s, 'password', %s, %s, %s, %s)
               RETURNING id, email, role, approval_status""",
            (body.email, security.hash_password(body.password), body.full_name,
             body.role, approval, body.roster_id, body.staff_id, body.department),
        ).fetchone()
        conn.execute(
            "INSERT INTO user_tenants (user_id, institution_id) VALUES (%s, %s)",
            (user["id"], institution_id))
        if body.role == "student":
            conn.execute(
                """INSERT INTO consents (user_id, exam_id, status, granted_at)
                   VALUES (%s, NULL, 'granted', now())""", (user["id"],))
            write_audit(conn, actor_id=user["id"], action="consent.grant",
                        target_type="consents", target_id=user["id"],
                        after={"status": "granted", "scope": "institution"},
                        institution_id=institution_id)
        conn.commit()
    return JSONResponse(status_code=201,
                        content={**user, "id": str(user["id"])})


@app.post("/api/auth/login")
def login(body: LoginBody, response: Response):
    if security.is_locked(body.email):
        with connect() as conn:
            write_audit(conn, actor_id=None, action="auth.login_locked",
                        target_type="user_accounts", target_id=body.email)
        return JSONResponse(status_code=429,
            content={"detail": "too many attempts, try again later"})

    with connect() as conn:
        row = conn.execute(
            "SELECT id, password_hash, role, approval_status FROM user_accounts WHERE email = %s",
            (body.email,)).fetchone()
        if row and security.verify_password(body.password, row["password_hash"]):
            if row["approval_status"] == "pending":
                return JSONResponse(status_code=403,
                    content={"detail": "account pending approval"})
            if row["approval_status"] == "disabled":
                return JSONResponse(status_code=403,
                    content={"detail": "account disabled"})

            memberships = conn.execute(
                "SELECT institution_id FROM user_tenants WHERE user_id = %s",
                (row["id"],)).fetchall()
            institution_id = None
            if body.institution:
                member = conn.execute(
                    """SELECT t.institution_id FROM user_tenants t
                       JOIN institutions i ON i.id = t.institution_id
                       WHERE t.user_id = %s AND i.name = %s""",
                    (row["id"], body.institution)).fetchone()
                if not member:
                    return JSONResponse(status_code=403,
                        content={"detail": "not authorized for this institution"})
                institution_id = member["institution_id"]
            elif len(memberships) == 1:
                # single-tenant users get their institution automatically
                institution_id = memberships[0]["institution_id"]
            elif len(memberships) > 1:
                return JSONResponse(status_code=400,
                    content={"detail": "select an institution"})
            if row["role"] == "admin" and not institution_id:
                # SPEC: admin login requires a tenant selection
                return JSONResponse(status_code=400,
                    content={"detail": "select an institution"})
            security.clear_failures(body.email)
            token = security.make_token(row["id"], row["role"], institution_id)
            response.set_cookie(security.COOKIE_NAME, token, **security.COOKIE_KWARGS)
            write_audit(conn, actor_id=row["id"], action="auth.login",
                        target_type="user_accounts", target_id=row["id"],
                        after={"role": row["role"]},
                        institution_id=institution_id)
            return {"role": row["role"], "institution": body.institution}
        security.note_failure(body.email)
        write_audit(conn, actor_id=None, action="auth.login_failed",
                    target_type="user_accounts", target_id=body.email)
        return JSONResponse(status_code=401,
            content={"detail": GENERIC_LOGIN_ERROR})


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(security.COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(request: Request):
    token = current_user(request)
    if not token:
        return JSONResponse(status_code=401, content={"detail": "not authenticated"})
    with connect() as conn:
        row = conn.execute(
            """SELECT email, role, approval_status FROM user_accounts WHERE id = %s""",
            (token["sub"],)).fetchone()
    if not row:
        return JSONResponse(status_code=401, content={"detail": "not authenticated"})
    return {**row, "institution_id": token.get("inst")}


@app.get("/api/institutions")
def list_institutions():
    """Public: institution names for the login tenant selector. Names only —
    no other institution data is exposed pre-auth."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT name FROM institutions ORDER BY name").fetchall()
    return {"institutions": [r["name"] for r in rows]}


def _consent_row(conn, user_id):
    return conn.execute(
        """SELECT id, status FROM consents
           WHERE user_id = %s AND exam_id IS NULL
           ORDER BY created_at DESC LIMIT 1""", (user_id,)).fetchone()


@app.get("/api/consent")
def consent_status(request: Request):
    token = current_user(request)
    if not token:
        return JSONResponse(status_code=401, content={"detail": "not authenticated"})
    with connect() as conn:
        row = _consent_row(conn, token["sub"])
    return {"status": row["status"] if row else "none"}


@app.post("/api/consent/grant")
def consent_grant(request: Request):
    token = current_user(request)
    if not token:
        return JSONResponse(status_code=401, content={"detail": "not authenticated"})
    with connect() as conn:
        row = _consent_row(conn, token["sub"])
        before = {"status": row["status"]} if row else {"status": "none"}
        if row and row["status"] == "granted":
            return {"status": "granted"}
        if row:
            conn.execute(
                """UPDATE consents SET status = 'granted', granted_at = now(),
                       revoked_at = NULL WHERE id = %s""", (row["id"],))
        else:
            conn.execute(
                """INSERT INTO consents (user_id, exam_id, status, granted_at)
                   VALUES (%s, NULL, 'granted', now())""", (token["sub"],))
        inst = token.get("inst")
        write_audit(conn, actor_id=token["sub"], action="consent.grant",
                    target_type="consents", target_id=token["sub"],
                    before=before, after={"status": "granted"},
                    institution_id=inst)
        conn.commit()
    return {"status": "granted"}


@app.post("/api/consent/revoke")
def revoke_consent(request: Request):
    token = current_user(request)
    if not token:
        return JSONResponse(status_code=401, content={"detail": "not authenticated"})
    with connect() as conn:
        row = _consent_row(conn, token["sub"])
        before = {"status": row["status"]} if row else {"status": "none"}
        conn.execute(
            """UPDATE consents SET status = 'revoked', revoked_at = now()
               WHERE user_id = %s AND exam_id IS NULL AND status = 'granted'""",
            (token["sub"],))
        inst = token.get("inst")
        write_audit(conn, actor_id=token["sub"], action="consent.revoke",
                    target_type="consents", target_id=token["sub"],
                    before=before, after={"status": "revoked"},
                    institution_id=inst)
        conn.commit()
    return {"ok": True}


if __name__ == "__main__":
    # Guard required on Windows (spawn re-imports the module).
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001)
