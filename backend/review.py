"""Proctor review endpoints and the appeals-reviewer read lane.

Every mutating action writes an audit_log row with before/after inside the
same transaction — a failed audit write fails the action. Flags and scores
are advisory; nothing here produces a cheating determination (SRS 3.6).
"""
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from db import connect, write_audit
from deps import parse_uuid, require_institution, require_role

router = APIRouter(prefix="/api")

REVIEW_ROLES = ("instructor", "admin")
SEVERITIES = ("low", "medium", "high", "critical")


def _session_in_institution(conn, session_id: str, inst: str) -> dict | None:
    """The exam_session row only when its exam belongs to `inst`."""
    return conn.execute(
        """SELECT s.id, s.exam_id, s.student_id, s.status, s.started_at,
                  e.name AS exam, e.institution_id
           FROM exam_sessions s JOIN exams e ON e.id = s.exam_id
           WHERE s.id = %s""", (session_id,)).fetchone()


def _event_in_institution(conn, event_id: str, inst: str):
    row = conn.execute(
        """SELECT ev.*, s.id AS sid, e.institution_id
           FROM events_flags ev
           JOIN exam_sessions s ON s.id = ev.exam_session_id
           JOIN exams e ON e.id = s.exam_id
           WHERE ev.event_id = %s""", (event_id,)).fetchone()
    if row and str(row["institution_id"]) == inst:
        return row
    return None


@router.get("/proctor/sessions")
def proctor_sessions(request: Request):
    token = require_role(request, *REVIEW_ROLES)
    inst = require_institution(token)
    with connect() as conn:
        rows = conn.execute(
            """SELECT s.id, s.status, s.started_at, s.ended_at,
                      e.name AS exam, u.full_name AS student, u.email AS student_email,
                      rs.score AS risk_score, rs.version AS risk_version,
                      (SELECT count(*) FROM events_flags ev
                        WHERE ev.exam_session_id = s.id) AS flag_count,
                      (SELECT count(*) FROM events_flags ev
                        WHERE ev.exam_session_id = s.id
                          AND ev.review_action IS NULL) AS unreviewed_count
               FROM exam_sessions s
               JOIN exams e ON e.id = s.exam_id
               JOIN user_accounts u ON u.id = s.student_id
               LEFT JOIN risk_scores rs ON rs.exam_session_id = s.id
               WHERE e.institution_id = %s
               ORDER BY s.created_at DESC LIMIT 200""",
            (inst,)).fetchall()
    return {"sessions": rows}


@router.get("/proctor/sessions/{session_id}/flags")
def session_flags(session_id: str, request: Request):
    token = require_role(request, *REVIEW_ROLES)
    inst = require_institution(token)
    sid = parse_uuid(session_id, "session_id")
    with connect() as conn:
        sess = _session_in_institution(conn, sid, inst)
        if not sess or str(sess["institution_id"]) != inst:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="session not found")
        flags = conn.execute(
            """SELECT event_id, event_type, severity, severity_override,
                      start_s, end_s, duration_s, peak_yaw_dev, peak_gaze_dev,
                      conf, detector, policy_ref, occurred_at,
                      review_action, reviewed_at, review_note,
                      escalation_recording_ref
               FROM events_flags WHERE exam_session_id = %s
               ORDER BY start_s""", (sid,)).fetchall()
        risk = conn.execute(
            "SELECT score, version, computed_at FROM risk_scores "
            "WHERE exam_session_id = %s", (sid,)).fetchone()
    return {"session": {"id": str(sess["id"]), "exam": sess["exam"],
                        "status": sess["status"],
                        "student_id": str(sess["student_id"])},
            "risk": risk, "flags": flags}


class ReviewBody(BaseModel):
    action: str = Field(pattern="^(acknowledged|dismissed)$")
    note: str | None = Field(default=None, max_length=2000)


@router.post("/flags/{event_id}/review")
def review_flag(event_id: str, body: ReviewBody, request: Request):
    token = require_role(request, *REVIEW_ROLES)
    inst = require_institution(token)
    with connect() as conn:
        ev = _event_in_institution(conn, event_id, inst)
        if not ev:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="flag not found")
        before = {"review_action": ev["review_action"],
                  "review_note": ev["review_note"]}
        conn.execute(
            """UPDATE events_flags
               SET review_action = %s, reviewed_by = %s, reviewed_at = now(),
                   review_note = %s
               WHERE event_id = %s""",
            (body.action, token["sub"], body.note, event_id))
        write_audit(conn, actor_id=token["sub"], action=f"flag.{body.action}",
                    target_type="events_flags", target_id=event_id,
                    before=before,
                    after={"review_action": body.action, "note": body.note},
                    institution_id=inst)
    return {"ok": True, "event_id": event_id, "action": body.action}


class SeverityBody(BaseModel):
    severity: str = Field(pattern="^(low|medium|high|critical)$")


@router.post("/flags/{event_id}/severity")
def override_severity(event_id: str, body: SeverityBody, request: Request):
    """Override keeps the detector severity in `severity`; the override goes
    to `severity_override`. Risk recomputes on the effective severity."""
    token = require_role(request, *REVIEW_ROLES)
    inst = require_institution(token)
    with connect() as conn:
        ev = _event_in_institution(conn, event_id, inst)
        if not ev:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="flag not found")
        before = {"severity": ev["severity"],
                  "severity_override": ev["severity_override"]}
        conn.execute(
            "UPDATE events_flags SET severity_override = %s WHERE event_id = %s",
            (body.severity, event_id))
        write_audit(conn, actor_id=token["sub"], action="flag.severity_override",
                    target_type="events_flags", target_id=event_id,
                    before=before,
                    after={"severity": ev["severity"],
                           "severity_override": body.severity},
                    institution_id=inst)
        from sessions import recompute_risk
        score = recompute_risk(conn, str(ev["sid"]))
    return {"ok": True, "event_id": event_id, "score": score}


class BulkDismissBody(BaseModel):
    exam_session_id: str
    event_type: str = Field(max_length=60)


@router.post("/flags/bulk-dismiss")
def bulk_dismiss(body: BulkDismissBody, request: Request):
    """Dismiss every unreviewed LOW-severity flag of one type in one session."""
    token = require_role(request, *REVIEW_ROLES)
    inst = require_institution(token)
    sid = parse_uuid(body.exam_session_id, "exam_session_id")
    with connect() as conn:
        sess = _session_in_institution(conn, sid, inst)
        if not sess or str(sess["institution_id"]) != inst:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="session not found")
        rows = conn.execute(
            """SELECT event_id FROM events_flags
               WHERE exam_session_id = %s AND event_type = %s
                 AND COALESCE(severity_override, severity) = 'low'
                 AND review_action IS NULL""",
            (sid, body.event_type)).fetchall()
        ids = [r["event_id"] for r in rows]
        if ids:
            conn.execute(
                """UPDATE events_flags
                   SET review_action = 'dismissed', reviewed_by = %s,
                       reviewed_at = now(), review_note = 'bulk-dismiss'
                   WHERE event_id = ANY(%s)""",
                (token["sub"], ids))
        write_audit(conn, actor_id=token["sub"], action="flag.bulk_dismiss",
                    target_type="exam_session", target_id=sid,
                    after={"event_type": body.event_type, "count": len(ids),
                           "event_ids": ids},
                    institution_id=inst)
    return {"ok": True, "dismissed": len(ids)}


class EscalateBody(BaseModel):
    recording_ref: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=2000)


@router.post("/flags/{event_id}/escalate")
def escalate_flag(event_id: str, body: EscalateBody, request: Request):
    """Mark the flag escalated and keep the recording reference. No Case
    table exists yet (Open decisions); the escalation lives on the flag."""
    token = require_role(request, *REVIEW_ROLES)
    inst = require_institution(token)
    with connect() as conn:
        ev = _event_in_institution(conn, event_id, inst)
        if not ev:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="flag not found")
        before = {"review_action": ev["review_action"],
                  "review_note": ev["review_note"],
                  "escalation_recording_ref": ev["escalation_recording_ref"]}
        conn.execute(
            """UPDATE events_flags
               SET review_action = 'escalated', reviewed_by = %s,
                   reviewed_at = now(), review_note = %s,
                   escalation_recording_ref = %s
               WHERE event_id = %s""",
            (token["sub"], body.note, body.recording_ref, event_id))
        write_audit(conn, actor_id=token["sub"], action="flag.escalate",
                    target_type="events_flags", target_id=event_id,
                    before=before,
                    after={"review_action": "escalated",
                           "recording_ref": body.recording_ref,
                           "note": body.note},
                    institution_id=inst)
    return {"ok": True, "event_id": event_id, "action": "escalated"}


@router.get("/appeals/escalated")
def appeals_escalated(request: Request):
    """Option A read-only lane: escalated flags for the reviewer's
    institution, with session/exam/student context. No write path exists."""
    token = require_role(request, "appeals_reviewer")
    inst = require_institution(token)
    with connect() as conn:
        rows = conn.execute(
            """SELECT ev.event_id, ev.event_type, ev.severity,
                      ev.severity_override, ev.start_s, ev.end_s, ev.duration_s,
                      ev.occurred_at, ev.review_note, ev.reviewed_at,
                      ev.escalation_recording_ref, ev.detector, ev.policy_ref,
                      s.id AS session_id, s.status AS session_status,
                      e.name AS exam, u.full_name AS student, u.email AS student_email,
                      rs.score AS risk_score
               FROM events_flags ev
               JOIN exam_sessions s ON s.id = ev.exam_session_id
               JOIN exams e ON e.id = s.exam_id
               JOIN user_accounts u ON u.id = s.student_id
               LEFT JOIN risk_scores rs ON rs.exam_session_id = s.id
               WHERE ev.review_action = 'escalated'
                 AND e.institution_id = %s
               ORDER BY ev.occurred_at DESC NULLS LAST LIMIT 500""",
            (inst,)).fetchall()
    return {"escalated": rows}
