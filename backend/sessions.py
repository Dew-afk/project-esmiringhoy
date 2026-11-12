"""Exam sessions: start, list, WS validation, event ingest, advisory risk.

The ML side (ml/webcam_demo.py) validates the session cookie through
/api/sessions/ws-validate and posts finished events to
/api/sessions/{session_token}/events. Events land in events_flags; the
advisory score in risk_scores is policy-weighted and never a cheating
likelihood (SRS 3.6).
"""
import json
import secrets
from pathlib import Path

import yaml
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from db import connect, write_audit
from deps import parse_uuid, require_institution, require_role

router = APIRouter(prefix="/api")

POLICY_PATH = Path(__file__).resolve().parent.parent / "ml" / "policy.yaml"
SEVERITIES = ("low", "medium", "high", "critical")


def load_policy() -> dict:
    try:
        return yaml.safe_load(POLICY_PATH.read_text(encoding="utf-8")) or {}
    except OSError:
        return {}


def severity_for(event_type: str, fallback: str) -> str:
    """Severity comes from policy.yaml's catalog, never hardcoded."""
    catalog = load_policy().get("event_catalog", {})
    sev = catalog.get(event_type, fallback)
    return sev if sev in SEVERITIES else "medium"


def recompute_risk(conn, exam_session_id: str) -> float:
    """Advisory indicator: sum of policy severity weights x duration over a
    policy window, clamped to [0, 1]. Labelled advisory via version string."""
    cfg = load_policy().get("risk", {})
    weights = cfg.get("weights", {})
    window = float(cfg.get("window_s", 300))
    rows = conn.execute(
        """SELECT COALESCE(severity_override, severity) AS sev, duration_s
           FROM events_flags WHERE exam_session_id = %s""",
        (exam_session_id,)).fetchall()
    total = sum(float(weights.get(r["sev"], 0.0)) * float(r["duration_s"])
                for r in rows)
    score = min(1.0, total / window) if window > 0 else 0.0
    version = f"{load_policy().get('policy_version', 'policy')}-advisory"
    conn.execute(
        """INSERT INTO risk_scores (exam_session_id, score, version)
           VALUES (%s, %s, %s)
           ON CONFLICT (exam_session_id)
           DO UPDATE SET score = EXCLUDED.score,
                         version = EXCLUDED.version,
                         computed_at = now()""",
        (exam_session_id, score, version))
    return score


class SessionStart(BaseModel):
    exam_id: str


@router.post("/sessions/start")
def start_session(body: SessionStart, request: Request):
    token = require_role(request, "student")
    inst = require_institution(token)
    exam_id = parse_uuid(body.exam_id, "exam_id")

    with connect() as conn:
        exam = conn.execute(
            "SELECT id, name, institution_id, lifecycle FROM exams WHERE id = %s",
            (exam_id,)).fetchone()
        if not exam or str(exam["institution_id"]) != inst:
            raise _deny(404, "exam not found")
        if exam["lifecycle"] != "in_progress":
            raise _deny(409, f"exam is {exam['lifecycle']}, not in progress")

        rostered = conn.execute(
            "SELECT 1 FROM roster_assignments WHERE exam_id = %s AND student_id = %s",
            (exam_id, token["sub"])).fetchone()
        if not rostered:
            raise _deny(403, "not rostered for this exam")

        consent = conn.execute(
            """SELECT 1 FROM consents
               WHERE user_id = %s AND status = 'granted'
                 AND (exam_id = %s OR exam_id IS NULL)""",
            (token["sub"], exam_id)).fetchone()
        if not consent:
            raise _deny(403, "active consent required")

        session_token = secrets.token_urlsafe(24)
        row = conn.execute(
            """INSERT INTO exam_sessions
                 (session_token, exam_id, student_id, status, started_at)
               VALUES (%s, %s, %s, 'in_progress', now())
               RETURNING id""",
            (session_token, exam_id, token["sub"])).fetchone()
        write_audit(conn, actor_id=token["sub"], action="session.start",
                    target_type="exam_session", target_id=row["id"],
                    after={"exam_id": exam_id, "exam": exam["name"]},
                    institution_id=inst)
        return {"session_id": str(row["id"]), "session_token": session_token,
                "exam": exam["name"], "status": "in_progress"}


def _deny(status: int, detail: str):
    from fastapi import HTTPException
    return HTTPException(status_code=status, detail=detail)


@router.get("/sessions/mine")
def my_sessions(request: Request):
    token = require_role(request, "student")
    with connect() as conn:
        rows = conn.execute(
            """SELECT s.id, s.status, s.started_at, s.ended_at, e.name AS exam
               FROM exam_sessions s JOIN exams e ON e.id = s.exam_id
               WHERE s.student_id = %s ORDER BY s.created_at DESC""",
            (token["sub"],)).fetchall()
    return {"sessions": rows}


@router.get("/exams/mine")
def my_exams(request: Request):
    """Rostered exams for the signed-in student (exam picker for start)."""
    token = require_role(request, "student")
    with connect() as conn:
        rows = conn.execute(
            """SELECT e.id, e.name, e.lifecycle, e.window_start, e.window_end,
                      e.duration_minutes
               FROM exams e JOIN roster_assignments r ON r.exam_id = e.id
               WHERE r.student_id = %s ORDER BY e.window_start""",
            (token["sub"],)).fetchall()
    return {"exams": rows}


@router.get("/sessions/ws-validate")
def ws_validate(request: Request, session_token: str):
    """Called server-to-server by the ML WS endpoint with the user's cookie
    forwarded. Returns the bound session only when the cookie's user owns it;
    the client never supplies identity, only the session token."""
    from deps import current_user
    token = current_user(request)
    if not token:
        raise _deny(401, "not authenticated")
    with connect() as conn:
        row = conn.execute(
            """SELECT s.id, s.session_token, s.student_id, s.exam_id, s.status,
                      s.started_at
               FROM exam_sessions s WHERE s.session_token = %s""",
            (session_token,)).fetchone()
    if not row or str(row["student_id"]) != token["sub"]:
        raise _deny(403, "session not found or not yours")
    return {"session_id": str(row["id"]), "session_token": row["session_token"],
            "student_id": str(row["student_id"]), "exam_id": str(row["exam_id"]),
            "status": row["status"],
            "started_at": row["started_at"].isoformat() if row["started_at"] else None}


class EventIn(BaseModel):
    event_id: str = Field(max_length=100)
    event_type: str = Field(max_length=60)
    severity: str = Field(max_length=10)
    start_s: float
    end_s: float
    duration_s: float
    peak_yaw_dev: float | None = None
    peak_gaze_dev: float | None = None
    conf: float | None = None
    detector: str = Field(max_length=40)
    policy_ref: str = Field(max_length=40)


@router.post("/sessions/{session_token}/events")
def ingest_event(session_token: str, body: EventIn, request: Request):
    """Persist one finished ML event. The cookie user must own the session;
    student_id/exam_session_id are derived server-side, never trusted."""
    from deps import current_user
    token = current_user(request)
    if not token:
        raise _deny(401, "not authenticated")

    with connect() as conn:
        sess = conn.execute(
            """SELECT s.id, s.student_id, s.status, s.started_at
               FROM exam_sessions s WHERE s.session_token = %s""",
            (session_token,)).fetchone()
        if not sess or str(sess["student_id"]) != token["sub"]:
            raise _deny(403, "session not found or not yours")

        sev = severity_for(body.event_type, body.severity)
        occurred = None
        if sess["started_at"] is not None:
            occurred = conn.execute(
                "SELECT %s::timestamptz + (%s * interval '1 second') AS t",
                (sess["started_at"], body.start_s)).fetchone()["t"]

        ins = conn.execute(
            """INSERT INTO events_flags
                 (event_id, session_id, exam_session_id, event_type, severity,
                  start_s, end_s, duration_s, peak_yaw_dev, peak_gaze_dev,
                  conf, detector, policy_ref, occurred_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (event_id) DO NOTHING""",
            (body.event_id, session_token, sess["id"], body.event_type, sev,
             body.start_s, body.end_s, body.duration_s, body.peak_yaw_dev,
             body.peak_gaze_dev, body.conf, body.detector, body.policy_ref,
             occurred))
        stored = ins.rowcount == 1
        score = recompute_risk(conn, str(sess["id"]))
        return {"stored": stored, "score": score}
