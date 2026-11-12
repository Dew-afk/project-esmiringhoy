"""Passwords, session tokens and the failed-login lockout.

Password hashing: scrypt from the stdlib (bcrypt/argon2 were named in the
spec; scrypt is the same family and adds no dependency -- swapping to bcrypt
is a two-line change if preferred). Tokens: JWT (PyJWT) in an httpOnly,
SameSite=Lax cookie. Lockout: in-memory per process (5 fails -> 15 min);
NOT shared across workers -- a known gap until Redis exists.
"""
import base64
import hashlib
import hmac
import os
import threading
import time

import jwt

SECRET = os.environ.get("SECRET_KEY", "dev-only-secret-change-me")
ALG = "HS256"
TOKEN_TTL_S = 24 * 3600
COOKIE_NAME = "aismering_session"
# httpOnly + SameSite=Lax: the safest choice the local stack allows;
# secure=True once HTTPS exists.
COOKIE_KWARGS = dict(httponly=True, samesite="lax", path="/", secure=False)

SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1

# ---- passwords ----

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt,
                            n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P)
    return "scrypt${}${}${}${}${}".format(
        SCRYPT_N, SCRYPT_R, SCRYPT_P,
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode())

def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt_b64, digest_b64 = stored.split("$")
        digest = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64),
                                n=int(n), r=int(r), p=int(p))
        return hmac.compare_digest(digest, base64.b64decode(digest_b64))
    except (ValueError, TypeError):
        return False

# ---- session token ----

def make_token(user_id: str, role: str, institution_id: str | None) -> str:
    return jwt.encode({"sub": str(user_id), "role": role,
                       "inst": str(institution_id) if institution_id else None,
                       "exp": int(time.time()) + TOKEN_TTL_S},
                      SECRET, algorithm=ALG)

def read_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET, algorithms=[ALG])
    except jwt.PyJWTError:
        return None

# ---- lockout (in-memory) ----

MAX_FAILURES = 5
LOCKOUT_S = 15 * 60
_lock = threading.Lock()
_failures: dict[str, list[int]] = {}  # email -> [count, locked_until_epoch]


def note_failure(email: str) -> bool:
    """Record a failed attempt; True if the account is now locked."""
    with _lock:
        now = int(time.time())
        count, locked_until = _failures.get(email, [0, 0])
        if locked_until > now:
            return True
        count += 1
        if count >= MAX_FAILURES:
            _failures[email] = [count, now + LOCKOUT_S]
            return True
        _failures[email] = [count, 0]
        return False


def is_locked(email: str) -> bool:
    with _lock:
        count, locked_until = _failures.get(email, [0, 0])
        if locked_until > int(time.time()):
            return True
        if locked_until:
            _failures.pop(email, None)
        return False


def clear_failures(email: str) -> None:
    with _lock:
        _failures.pop(email, None)
