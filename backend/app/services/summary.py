"""Advisory LLM summarization with traceability validation (SRS 3.1.5).
Input: structured EventsFlags metadata only — never media, never biometrics.
Output must reference exact event IDs; unsupported statements are rejected."""

import json
import re

import httpx
from sqlalchemy.orm import Session

from ..core.config import settings
from .. import models


class SummaryUnavailable(Exception):
    pass


def generate_summary(db: Session, session_id: str) -> dict:
    if not (settings.llm_api_key and settings.llm_base_url and settings.llm_model):
        raise SummaryUnavailable(
            "No LLM provider configured (LLM_API_KEY / LLM_BASE_URL / LLM_MODEL)"
        )
    events = (
        db.query(models.EventsFlags)
        .filter(models.EventsFlags.session_id == session_id)
        .order_by(models.EventsFlags.start_s.asc())
        .all()
    )
    if not events:
        raise SummaryUnavailable("Session has no events to summarize")

    # Data minimization: only structured, non-biometric fields leave the system.
    rows = [
        {
            "event_id": e.event_id,
            "event_type": e.event_type,
            "severity": e.severity_override or e.severity,
            "start_s": e.start_s,
            "end_s": e.end_s,
            "detector": e.detector,
        }
        for e in events
    ]
    prompt = (
        "You are summarizing proctoring events for a human reviewer. "
        "Write a chronological, factual, advisory narrative. "
        "Do not accuse anyone of cheating. "
        f'Respond ONLY with JSON: {{"statements":[{{"event_id":"...","text":"one factual sentence","t_s":<number>}}]}}. '
        f"Events: {json.dumps(rows)}"
    )
    resp = httpx.post(
        f"{settings.llm_base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {settings.llm_api_key}"},
        json={
            "model": settings.llm_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
        },
        timeout=30,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    parsed = _extract_json(content)
    statements = parsed.get("statements", [])
    if not isinstance(statements, list) or not statements:
        raise SummaryUnavailable("LLM returned no statements")

    valid_ids = {e.event_id for e in events}
    for stmt in statements:
        if not isinstance(stmt, dict) or stmt.get("event_id") not in valid_ids:
            raise SummaryUnavailable(
                "LLM output references unknown events — rejected (traceability)"
            )
        text = str(stmt.get("text", ""))
        if not text.strip():
            raise SummaryUnavailable("Empty statement rejected")

    summary_text = " ".join(str(s["text"]) for s in statements)
    row = models.SessionSummaries(
        session_id=session_id,
        summary_text=summary_text,
        statements=json.dumps(statements),
        model_version=settings.llm_model,
    )
    db.query(models.SessionSummaries).filter(
        models.SessionSummaries.session_id == session_id
    ).delete(synchronize_session=False)
    db.add(row)
    db.commit()
    return {
        "session_id": session_id,
        "summary_text": summary_text,
        "generated_at": row.generated_at.isoformat(),
        "model_version": settings.llm_model,
        "statements": statements,
        "advisory": True,
    }


def _extract_json(content: str) -> dict:
    """Tolerate ```json fences around the model's response."""
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        raise
