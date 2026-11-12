"""Shared auth helpers for the API routers."""
import uuid

from fastapi import HTTPException, Request

import security


def current_user(request: Request) -> dict | None:
    token = request.cookies.get(security.COOKIE_NAME)
    if not token:
        return None
    return security.read_token(token)


def require_user(request: Request) -> dict:
    """401 when there is no valid session cookie."""
    token = current_user(request)
    if not token:
        raise HTTPException(status_code=401, detail="not authenticated")
    return token


def require_role(request: Request, *roles: str) -> dict:
    """401 without a session, 403 for the wrong role."""
    token = require_user(request)
    if token["role"] not in roles:
        raise HTTPException(status_code=403, detail="not authorised for this role")
    return token


def require_institution(token: dict) -> str:
    """The token's institution claim; 403 when the session has none."""
    inst = token.get("inst")
    if not inst:
        raise HTTPException(status_code=403,
                            detail="no institution selected for this session")
    return inst


def parse_uuid(value: str, field: str = "id") -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=400, detail=f"invalid {field}")
