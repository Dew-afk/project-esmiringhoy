"""Standalone event worker: `python -m app.workers.event_worker`.
Three jobs in one process (kept small, independently runnable):
  1. process the durable event queue (claim → persist → risk → ack/nack)
  2. tail ML events: the demo server writes live_*.jsonl under
     ML_EVENTS_DIR — mapped sessions only are ingested as trusted events
  3. hourly retention purge (only when retention is explicitly configured)
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy.orm import Session  # noqa: E402

from ..core.config import settings  # noqa: E402
from ..core.database import SessionLocal  # noqa: E402
from .. import models  # noqa: E402
from ..services import queue, retention  # noqa: E402
from ..services.risk import apply_event  # noqa: E402

RETENTION_INTERVAL_S = 3600


def process_queued(db: Session) -> int:
    handled = 0
    for item in queue.claim(db, limit=20):
        try:
            payload = json.loads(item.payload)
            if payload.get("kind") != "ml_event":
                queue.ack(db, item)
                handled += 1
                continue
            if (
                db.query(models.EventsFlags)
                .filter(models.EventsFlags.event_id == payload["event_id"])
                .first()
            ):
                queue.ack(db, item)  # duplicate — stable event_id, drop safely
                handled += 1
                continue
            db.add(models.EventsFlags(
                event_id=payload["event_id"],
                session_id=payload["exam_session_id"],
                event_type=payload["event_type"],
                severity=payload["severity"],
                start_s=payload["start_s"],
                end_s=payload["end_s"],
                duration_s=payload["duration_s"],
                peak_yaw_dev=payload.get("peak_yaw_dev"),
                peak_gaze_dev=payload.get("peak_gaze_dev"),
                confidence=payload.get("confidence"),
                detector=payload["detector"],
                policy_ref=payload.get("policy_ref", ""),
                source="ml",
            ))
            apply_event(db, payload["exam_session_id"], payload)
            db.commit()
            queue.ack(db, item)
            handled += 1
        except Exception as exc:  # bounded retry → dead letter
            db.rollback()
            queue.nack(db, item, str(exc)[:500])
    return handled


def tail_ml_events(db: Session) -> int:
    """Read live_*.jsonl files the demo server appends to. Ingest only
    sessions with a verified mapping; unmapped rows are skipped (never guessed)."""
    if not settings.ml_events_dir.is_dir():
        return 0
    accepted = 0
    for path in sorted(settings.ml_events_dir.glob("live_*.jsonl")):
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            ml_session_id = event.get("session_id", "")
            mapping = db.query(models.MlSessionMap).filter(
                models.MlSessionMap.ml_session_id == ml_session_id
            ).first()
            if mapping is None:
                continue
            event_id = event.get("event_id", "")
            if (
                event_id
                and not db.query(models.EventsFlags)
                .filter(models.EventsFlags.event_id == event_id)
                .first()
            ):
                queue.enqueue(
                    db,
                    kind="ml_event",
                    payload={"exam_session_id": mapping.exam_session_id, **event},
                )
                accepted += 1
    if accepted:
        db.commit()
    return accepted


def run() -> None:
    print(f"event_worker: queue={settings.database_url} ml_dir={settings.ml_events_dir}")
    last_retention = 0.0
    while True:
        db = SessionLocal()
        try:
            queued = process_queued(db)
            tailed = tail_ml_events(db)
            now = time.time()
            if now - last_retention >= RETENTION_INTERVAL_S:
                retention.purge_expired(db, by="worker")
                db.commit()
                last_retention = now
            if queued or tailed:
                print(f"worker: processed {queued}, tailed {tailed}")
        except Exception as exc:
            print(f"worker: {exc}")
        finally:
            db.close()
        time.sleep(settings.queue_poll_s)


if __name__ == "__main__":
    run()
