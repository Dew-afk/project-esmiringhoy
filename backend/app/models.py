"""All tables in one module (small team). SDD §4.2 entities plus the two
infrastructure tables the design needs: EventQueue (durable, replaceable by
Redis Streams) and MlSessionMap (verified ML↔exam session mapping)."""

import json
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(dt: datetime) -> datetime:
    """SQLite returns naive datetimes on read; treat naive values as UTC so
    comparisons against aware `now` never raise."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def json_default(value) -> str:
    return json.dumps(value)


class Institution(Base):
    __tablename__ = "institutions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    code: Mapped[str] = mapped_column(String(20), unique=True)
    is_test: Mapped[bool] = mapped_column(Boolean, default=False)
    retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True)


class UserAccount(Base):
    __tablename__ = "user_accounts"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    institution_id: Mapped[str] = mapped_column(ForeignKey("institutions.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # student|proctor|admin|appeals
    full_name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    roster_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    approval_status: Mapped[str] = mapped_column(String(20), default="approved")


class Consents(Base):
    __tablename__ = "consents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("user_accounts.id"), index=True)
    action: Mapped[str] = mapped_column(String(10))  # granted|revoked
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProctoringPolicy(Base):
    __tablename__ = "proctoring_policies"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    severity_map: Mapped[str] = mapped_column(Text)  # JSON {event_type: severity}


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    institution_id: Mapped[str] = mapped_column(ForeignKey("institutions.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    course_code: Mapped[str] = mapped_column(String(40), default="")
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    window_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_min: Mapped[int] = mapped_column(Integer)
    allowed_materials: Mapped[str] = mapped_column(Text, default="[]")  # JSON list
    policy_template_id: Mapped[str] = mapped_column(
        ForeignKey("proctoring_policies.id")
    )
    status: Mapped[str] = mapped_column(String(20), default="draft")
    created_by: Mapped[str] = mapped_column(ForeignKey("user_accounts.id"))


class RosterAssignment(Base):
    __tablename__ = "roster_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    exam_id: Mapped[str] = mapped_column(ForeignKey("exams.id"), index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("user_accounts.id"), index=True)
    accommodation: Mapped[str | None] = mapped_column(String(200), nullable=True)
    __table_args__ = (UniqueConstraint("exam_id", "student_id"),)


class ExamSession(Base):
    __tablename__ = "exam_sessions"

    id: Mapped[str] = mapped_column(String(60), primary_key=True)
    exam_id: Mapped[str] = mapped_column(ForeignKey("exams.id"), index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("user_accounts.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="scheduled")
    start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    exam = relationship("Exam")
    student = relationship("UserAccount")


class EventsFlags(Base):
    __tablename__ = "events_flags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(80), unique=True)  # stable, dedupe key
    session_id: Mapped[str] = mapped_column(ForeignKey("exam_sessions.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(40), index=True)
    severity: Mapped[str] = mapped_column(String(20))
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    duration_s: Mapped[float] = mapped_column(Float)
    peak_yaw_dev: Mapped[float | None] = mapped_column(Float, nullable=True)
    peak_gaze_dev: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    detector: Mapped[str] = mapped_column(String(40))
    policy_ref: Mapped[str] = mapped_column(String(40), default="")
    source: Mapped[str] = mapped_column(String(20), default="ml")  # ml|client|system
    review_status: Mapped[str] = mapped_column(String(20), default="pending")
    reviewer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity_override: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RiskScores(Base):
    __tablename__ = "risk_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("exam_sessions.id"), unique=True
    )
    score: Mapped[float] = mapped_column(Float, default=0.0)
    last_updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Recordings(Base):
    __tablename__ = "recordings"

    id: Mapped[str] = mapped_column(String(60), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("exam_sessions.id"), index=True)
    object_key: Mapped[str] = mapped_column(String(255))
    format: Mapped[str] = mapped_column(String(20), default="mp4")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    encryption_note: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SessionSummaries(Base):
    __tablename__ = "session_summaries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("exam_sessions.id"), unique=True)
    summary_text: Mapped[str] = mapped_column(Text)
    statements: Mapped[str] = mapped_column(Text, default="[]")  # JSON [{event_id, text, t_s}]
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    model_version: Mapped[str] = mapped_column(String(120), default="")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(120))
    target: Mapped[str] = mapped_column(String(255), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class RetentionLog(Base):
    __tablename__ = "retention_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    target_type: Mapped[str] = mapped_column(String(60))
    target_id: Mapped[str] = mapped_column(String(255), default="")
    purged_count: Mapped[int] = mapped_column(Integer, default=0)
    by: Mapped[str] = mapped_column(String(60), default="system")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class EventQueue(Base):
    """Durable event queue. Replaceable by Redis Streams without touching the
    producer/consumer interfaces (services/queue.py)."""

    __tablename__ = "event_queue"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(40), default="ml_event")
    payload: Mapped[str] = mapped_column(Text)  # JSON
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MlSessionMap(Base):
    """Verified mapping: ML demo session id → authenticated ExamSession.
    Registered only by the authenticated session owner."""

    __tablename__ = "ml_session_maps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ml_session_id: Mapped[str] = mapped_column(String(80), unique=True)
    exam_session_id: Mapped[str] = mapped_column(ForeignKey("exam_sessions.id"), index=True)
    registered_by: Mapped[str] = mapped_column(ForeignKey("user_accounts.id"))
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
