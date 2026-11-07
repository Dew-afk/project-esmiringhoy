"""Shared FastAPI dependencies: DB session, current user, role guards,
institution scoping. Role and institution are NEVER taken from the client —
only from the authenticated user row."""

from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .security import decode_token
from .. import models

_bearer = HTTPBearer(auto_error=False)

ROLE_ORDER = {"student": 1, "proctor": 2, "admin": 3, "appeals": 4}


def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.UserAccount:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    payload = decode_token(creds.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(models.UserAccount, payload["sub"])
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found")
    if user.password_hash and user.approval_status == "pending":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account pending approval")
    return user


def require_roles(*roles: str):
    def guard(user: models.UserAccount = Depends(get_current_user)) -> models.UserAccount:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return user

    return guard


def require_proctor_or_admin(user: models.UserAccount = Depends(get_current_user)):
    return require_roles("proctor", "admin")(user)


def same_institution(user: models.UserAccount, other_institution_id: str) -> bool:
    return user.institution_id == other_institution_id


def current_consent(db: Session, user_id: str) -> str:
    row = (
        db.query(models.Consents)
        .filter(models.Consents.user_id == user_id)
        .order_by(models.Consents.at.desc())
        .first()
    )
    return row.action if row else "none"
