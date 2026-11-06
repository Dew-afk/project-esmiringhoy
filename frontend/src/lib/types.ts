// Domain types for AIsmering.
// Event fields mirror the shipped EventsFlags contract
// (ML_HANDOFF.md §3.2 / SYSTEM_DOCUMENTATION.md §9) — do not rename.

export type Severity = "low" | "medium" | "high" | "critical";
export type Role = "student" | "proctor" | "admin" | "appeals";

export const EVENT_TYPES = [
  "gaze_deviation",
  "head_pose_deviation",
  "second_voice",
  "unauthorized_object",
  "second_person",
  "focus_loss",
  "copy_paste",
  "connectivity_interruption",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** One flagged monitoring event — the EventsFlags row shape. */
export interface EventFlag {
  event_id: string;
  session_id: string;
  event_type: EventType;
  severity: Severity;
  start_s: number;
  end_s: number;
  duration_s: number;
  peak_yaw_dev?: number;
  peak_gaze_dev?: number;
  detector: "pose_mediapipe" | "yolo11n";
  policy_ref: string;
  /** SDD §4.2: EventsFlags carries review status — added by the review backend. */
  review_status?: "pending" | "acknowledged" | "dismissed" | "escalated";
  reviewer_note?: string;
  severity_override?: Severity;
}

export interface DetectionBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  conf: number;
  label: string;
}

/** Normalized gaze origin + direction from the pose pipeline. Relative
 *  direction only — never presented as screen-accurate eye tracking. */
export interface GazeVector {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export type MonitorPhase = "calibrating" | "live";

/** Reply shape of machine learning/webcam_demo.py `GET /ws`.
 *  Note: on a bad frame the server omits `gaze` entirely — treat as null. */
export interface WsReply {
  boxes: DetectionBox[];
  gaze: GazeVector | null;
  ms: number;
  state: MonitorPhase;
  seconds_remaining: number;
  events: EventFlag[];
}

export type ExamStatus =
  | "draft"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "archived";
export type SessionStatus = "scheduled" | "active" | "completed";

export interface Institution {
  institution_id: string;
  name: string;
  code: string;
  isTest?: boolean;
}

export interface ProctoringPolicyTemplate {
  policy_template_id: string;
  name: string;
  description: string;
  severity_map: Partial<Record<EventType, Severity>>;
}

export interface Exam {
  exam_id: string;
  title: string;
  course_code: string;
  institution_id: string;
  window_start: string; // ISO
  window_end: string; // ISO
  duration_min: number;
  allowed_materials: string[];
  policy_template_id: string;
  status: ExamStatus;
  roster_ids: string[];
  accommodations: { student_id: string; detail: string }[];
}

export interface ExamSession {
  session_id: string;
  exam_id: string;
  student_id: string;
  status: SessionStatus;
  start_time: string | null;
  end_time: string | null;
  /** Advisory only. null = risk-scoring service not connected. */
  risk_score: number | null;
  last_event_at: string | null;
  recording_available: boolean;
  monitoring_state: "active" | "recording_only" | "unavailable";
}

export interface UserAccount {
  user_id: string;
  role: Role;
  full_name: string;
  email: string;
  institution_id: string;
  roster_id?: string;
  department?: string;
  approval_status?: "approved" | "pending";
  consent_status?: "granted" | "revoked" | "none";
  consent_history?: { date: string; action: "granted" | "revoked" }[];
}

export interface AuditLogRow {
  log_id: string;
  actor: string;
  action: string;
  target: string;
  at: string;
}

export interface AppealsCase {
  case_id: string;
  session_id: string;
  student_name: string;
  exam_title: string;
  opened_at: string;
  status: "open" | "under_review" | "closed";
  notes: { author: string; text: string; at: string }[];
}
