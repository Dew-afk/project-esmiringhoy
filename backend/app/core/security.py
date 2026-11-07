"""Password hashing (bcrypt), JWT session tokens (PyJWT), and short-lived
HMAC-signed download tokens. Secrets come from settings; nothing is hardcoded
except the dev-only defaults in core/config.py."""

import base64
import hashlib
import hmac
import time
from typing import Optional

import bcrypt
import jwt

from .config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": int(time.time()) + settings.jwt_expire_min * 60,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def sign_download_token(object_key: str, expires_s: Optional[int] = None) -> str:
    """Short-lived, scoped, HMAC-signed reference to one recording object.
    Format: <b64url(key)>.<expiry>.<sig> — three dot-separated parts, so dots
    inside the key (Windows paths, file extensions) cannot corrupt parsing."""
    ttl = expires_s or settings.download_url_ttl_s
    exp = int(time.time()) + ttl
    key_b64 = base64.urlsafe_b64encode(object_key.encode()).decode()
    sig = hmac.new(
        settings.jwt_secret.encode(), f"{object_key}.{exp}".encode(), hashlib.sha256
    ).hexdigest()[:32]
    return f"{key_b64}.{exp}.{sig}"


def verify_download_token(token: str, object_key: str) -> bool:
    try:
        key_b64, exp, sig = token.split(".")
        key = base64.urlsafe_b64decode(key_b64.encode()).decode()
        expected = hmac.new(
            settings.jwt_secret.encode(), f"{key}.{exp}".encode(), hashlib.sha256
        ).hexdigest()[:32]
        return (
            hmac.compare_digest(sig, expected)
            and key == object_key
            and int(exp) >= int(time.time())
        )
    except Exception:
        return False
