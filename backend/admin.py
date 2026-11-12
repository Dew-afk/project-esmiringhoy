"""Admin account management, scoped to the token's institution.

Approve/disable act on accounts that share the admin's institution
(user_tenants). Provisioned accounts (admin, appeals_reviewer) cannot
self-register; the admin creates them here. Temporary passwords are
returned ONCE and never stored or logged in plaintext.
"""
import secrets

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from db import connect, write_audit
from deps import parse_uuid, require_institution, require_role

router = APIRouter(prefix="/api/admin")

PROVISIONABLE_ROLES = ("admin", "appeals_reviewer")


def _target_in_institution(conn, user_id: str, inst: str) -> dict | None:
    return conn.execute(
        """SELECT u.id, u.email, u.role, u.approval_status
           FROM user_accounts u
           JOIN user_tenants t ON t.user_id = u.id
           WHERE u.id = %s AND t.institution_id = %s""",
        (user_id, inst)).fetchone()


@router.get("/accounts")
def list_accounts(request: Request, status: str = "pending"):
    token = require_role(request, "admin")
    inst = require_institution(token)
    if status not in ("pending", "approved", "disabled", "all"):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="invalid status filter")
    with connect() as conn:
        if status == "all":
            rows = conn.execute(
                """SELECT u.id, u.email, u.full_name, u.role, u.approval_status,
                          u.created_at
                   FROM user_accounts u
                   JOIN user_tenants t ON t.user_id = u.id
                   WHERE t.institution_id = %s
                   ORDER BY u.created_at DESC""", (inst,)).fetchall()
        else:
            rows = conn.execute(
                """SELECT u.id, u.email, u.full_name, u.role, u.approval_status,
                          u.created_at
                   FROM user_accounts u
                   JOIN user_tenants t ON t.user_id = u.id
                   WHERE t.institution_id = %s AND u.approval_status = %s
                   ORDER BY u.created_at DESC""", (inst, status)).fetchall()
    return {"accounts": rows}


def _set_status(user_id: str, new_status: str, request: Request, action: str):
    token = require_role(request, "admin")
    inst = require_institution(token)
    uid = parse_uuid(user_id, "user_id")
    with connect() as conn:
        target = _target_in_institution(conn, uid, inst)
        if not target:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="account not found")
        if str(target["id"]) == token["sub"]:
            from fastapi import HTTPException
            raise HTTPException(status_code=400,
                                detail="cannot change your own account here")
        before = {"approval_status": target["approval_status"]}
        conn.execute(
            "UPDATE user_accounts SET approval_status = %s WHERE id = %s",
            (new_status, uid))
        write_audit(conn, actor_id=token["sub"], action=action,
                    target_type="user_accounts", target_id=uid,
                    before=before, after={"approval_status": new_status},
                    institution_id=inst)
    return {"ok": True, "user_id": uid, "approval_status": new_status}


@router.post("/accounts/{user_id}/approve")
def approve_account(user_id: str, request: Request):
    return _set_status(user_id, "approved", request, "account.approve")


@router.post("/accounts/{user_id}/disable")
def disable_account(user_id: str, request: Request):
    return _set_status(user_id, "disabled", request, "account.disable")


class CreateAccount(BaseModel):
    email: str = Field(max_length=254)
    full_name: str = Field(max_length=200)
    role: str = Field(pattern="^(admin|appeals_reviewer)$")


@router.post("/accounts")
def create_account(body: CreateAccount, request: Request):
    token = require_role(request, "admin")
    inst = require_institution(token)

    from main import EMAIL_RE, WEAK_PASSWORD_RE
    if not EMAIL_RE.match(body.email):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="invalid email")

    temp_password = "Aa1!" + secrets.token_urlsafe(9)
    assert WEAK_PASSWORD_RE.match(temp_password)

    with connect() as conn:
        dup = conn.execute(
            "SELECT 1 FROM user_accounts WHERE email = %s",
            (body.email,)).fetchone()
        if dup:
            from fastapi import HTTPException
            raise HTTPException(status_code=409,
                                detail="an account with this email already exists")
        import security
        row = conn.execute(
            """INSERT INTO user_accounts
                 (email, password_hash, full_name, role, auth_provider,
                  approval_status)
               VALUES (%s, %s, %s, %s, 'password', 'approved')
               RETURNING id""",
            (body.email, security.hash_password(temp_password),
             body.full_name, body.role)).fetchone()
        conn.execute(
            "INSERT INTO user_tenants (user_id, institution_id) VALUES (%s, %s)",
            (row["id"], inst))
        write_audit(conn, actor_id=token["sub"], action="account.create",
                    target_type="user_accounts", target_id=row["id"],
                    after={"email": body.email, "role": body.role,
                           "full_name": body.full_name},
                    institution_id=inst)
    # temp_password leaves this function exactly once, in this response
    return {"id": str(row["id"]), "email": body.email, "role": body.role,
            "temp_password": temp_password}
