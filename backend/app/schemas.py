"""Pydantic request/response schemas. Event field names preserve the
EventsFlags contract from ML_HANDOFF.md §3.2 — never renamed."""

import json
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

Severity = Literal["low", "medium", "high", "critical"]


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    role: Literal["student", "proctor"]
    full_name: str
    email: str
    institution_id: str
    password: str
    roster_id: Optional[str] = None
    staff_id: Optional[str] = None
    department: Optional[str] = None
    consent: bool = False


class ConsentRequest(BaseModel):
    action: Literal["granted", "revoked"]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    user_id: str
    role: str
    full_name: str
    email: str
    institution_id: str
    roster_id: Optional[str] = None
    department: Optional[str] = None
    approval_status: str
    consent_status: str = "none"


class ExamIn(BaseModel):
    title: str
    course_code: str = ""
    institution_id: str
    window_start: datetime
    window_end: datetime
    duration_min: int = Field(gt=0)
    allowed_materials: list[str] = []
    policy_template_id: str


class ExamPatch(BaseModel):
    title: Optional[str] = None
    window_start: Optional[datetime] = None
    window_end: Optional[datetime] = None
    duration_min: Optional[int] = Field(default=None, gt=0)
    allowed_materials: Optional[list[str]] = None
    policy_template_id: Optional[str] = None


class TransitionRequest(BaseModel):
    to: Literal["draft", "scheduled", "in_progress", "completed", "archived"]


class RosterIn(BaseModel):
    student_ids: list[str]
    accommodations: dict[str, str] = {}


class SessionCreate(BaseModel):
    exam_id: str


class MlRegisterRequest(BaseModel):
    ml_session_id: str


class EventFlagIn(BaseModel):
    """One EventsFlags row from the ML pipeline (ML_HANDOFF.md §3.2)."""

    event_id: str
    event_type: str
    severity: Severity
    start_s: float
    end_s: float
    duration_s: float
    peak_yaw_dev: Optional[float] = None
    peak_gaze_dev: Optional[float] = None
    confidence: Optional[float] = None
    detector: str
    policy_ref: str = ""

    @field_validator("event_type")
    @classmethod
    def known_type(cls, v: str) -> str:
        allowed = {
            "gaze_deviation", "head_pose_deviation", "second_voice",
            "unauthorized_object", "second_person", "focus_loss",
            "copy_paste", "connectivity_interruption",
        }
        if v not in allowed:
            raise ValueError(f"unknown event_type: {v}")
        return v


class MlEventIngest(BaseModel):
    ml_session_id: str
    events: list[EventFlagIn]


class ReviewRequest(BaseModel):
    action: Literal["acknowledge", "dismiss", "escalate", "note", "override"]
    note: Optional[str] = None
    severity: Optional[Severity] = None


class BulkReviewRequest(BaseModel):
    event_ids: list[str]
    action: Literal["dismiss"]


class EventOut(EventFlagIn):
    session_id: str
    source: str = "ml"
    review_status: str = "pending"
    reviewer_note: Optional[str] = None
    severity_override: Optional[Severity] = None


class SessionOut(BaseModel):
    session_id: str
    exam_id: str
    student_id: str
    status: str
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    risk_score: Optional[float] = None
    last_event_at: Optional[datetime] = None
    flag_count: int = 0
    highest_severity: Optional[Severity] = None


class RecordingOut(BaseModel):
    recording_id: str
    session_id: str
    format: str
    size_bytes: int
    available: bool
    created_at: datetime


class SummaryOut(BaseModel):
    session_id: str
    summary_text: str
    generated_at: datetime
    model_version: str
    statements: list[dict]


class RosterCsvRow(BaseModel):
    full_name: str
    email: str
    roster_id: str = ""


def model_to_user_out(user, consent_status: str = "none") -> UserOut:
    return UserOut(
        user_id=user.id,
        role=user.role,
        full_name=user.full_name,
        email=user.email,
        institution_id=user.institution_id,
        roster_id=user.roster_id,
        department=user.department,
        approval_status=user.approval_status,
        consent_status=consent_status,
    )


def parse_json(text: str, default):
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return default
