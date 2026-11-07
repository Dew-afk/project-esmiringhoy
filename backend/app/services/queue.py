"""Durable event queue with two interchangeable backends behind one interface:

- `db` (default): the EventQueue table — works everywhere, replaceable.
- `redis`: Redis lists using the reliable-queue pattern (BRPOPLPUSH into a
  processing list; ack removes it; nack returns it to the queue with an
  attempt counter; max attempts → dead list).

Interface: enqueue(db, kind, payload) / claim(db, limit) / ack(db, item) /
nack(db, item, error). The `db` session is only used by the db backend; the
worker and producers never change when the backend switches."""

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import redis as redis_lib
from sqlalchemy.orm import Session

from ..core.config import settings
from .. import models


@dataclass
class QueueItem:
    id: str
    payload: str
    handle: Any = field(default=None)


def _redis() -> redis_lib.Redis:
    return redis_lib.Redis.from_url(settings.redis_url, decode_responses=True)


def _redis_keys():
    return {
        "in": "aism:q:in",
        "proc": "aism:q:proc",
        "dead": "aism:q:dead",
        "attempts": "aism:q:attempts",
    }


def enqueue(db: Session, kind: str, payload: dict) -> Any:
    # kind is embedded in the payload so both backends see the same shape.
    body = json.dumps({"kind": kind, **payload})
    if settings.queue_backend == "redis":
        _redis().rpush(_redis_keys()["in"], body)
        return None
    row = models.EventQueue(kind=kind, payload=body)
    db.add(row)
    return row


def claim(db: Session, limit: int = 20) -> list[QueueItem]:
    if settings.queue_backend == "redis":
        r = _redis()
        keys = _redis_keys()
        items = []
        for _ in range(limit):
            payload = r.brpoplpush(keys["in"], keys["proc"], timeout=1)
            if payload is None:
                break
            r.hincrby(keys["attempts"], _digest(payload), 1)
            items.append(QueueItem(id=_digest(payload), payload=payload))
        return items
    now = datetime.now(timezone.utc)
    rows = (
        db.query(models.EventQueue)
        .filter(
            models.EventQueue.status == "pending",
            models.EventQueue.next_attempt_at <= now,
        )
        .order_by(models.EventQueue.created_at.asc())
        .limit(limit)
        .all()
    )
    for row in rows:
        row.status = "processing"
        row.attempts += 1
    db.commit()
    return [QueueItem(id=str(row.id), payload=row.payload, handle=row) for row in rows]


def ack(db: Session, item: QueueItem) -> None:
    if settings.queue_backend == "redis":
        r = _redis()
        keys = _redis_keys()
        r.lrem(keys["proc"], 1, item.payload)
        r.hdel(keys["attempts"], item.id)
        return
    db.delete(item.handle)
    db.commit()


def nack(db: Session, item: QueueItem, error: str) -> None:
    if settings.queue_backend == "redis":
        r = _redis()
        keys = _redis_keys()
        attempts = int(r.hget(keys["attempts"], item.id) or 0)
        r.lrem(keys["proc"], 1, item.payload)
        if attempts >= settings.queue_max_retries:
            r.lpush(keys["dead"], item.payload)  # dead letter
            r.hdel(keys["attempts"], item.id)
        else:
            r.lpush(keys["in"], item.payload)  # retry, FIFO-ish
        return
    row = item.handle
    if row.attempts >= settings.queue_max_retries:
        row.status = "dead"
        row.last_error = error
    else:
        row.status = "pending"
        row.last_error = error
        row.next_attempt_at = datetime.now(timezone.utc) + timedelta(
            seconds=2 ** row.attempts
        )
    db.commit()


def _digest(payload: str) -> str:
    return hashlib.sha1(payload.encode()).hexdigest()[:16]
