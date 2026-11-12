"""Database access for the auth API (psycopg 3).

DATABASE_URL comes from the environment (db/.env in local runs). Never log it.
"""
import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row


def _default_url() -> str:
    """Fall back to db/.env so local runs need no shell setup."""
    env_file = Path(__file__).resolve().parent.parent / "db" / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1]
    return "postgresql://localhost/aismering"


def connect():
    return psycopg.connect(os.environ.get("DATABASE_URL") or _default_url(),
                           row_factory=dict_row)


def write_audit(conn, *, actor_id, action, target_type, target_id,
                before=None, after=None, institution_id=None):
    """Insert one audit_log row on the caller's open transaction.

    MUST be called inside the same `with connect()` block as the action it
    records, before commit — a failed audit write fails the action. Never
    pass secrets, passwords or hashes in before/after.
    """
    import json
    conn.execute(
        """INSERT INTO audit_log
             (actor_user_id, action, target_type, target_id,
              before, after, institution_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (str(actor_id) if actor_id else None, action, target_type,
         str(target_id),
         json.dumps(before) if before is not None else None,
         json.dumps(after) if after is not None else None,
         str(institution_id) if institution_id else None))
