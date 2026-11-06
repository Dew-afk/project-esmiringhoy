// Deterministic development fixtures. Every consumer of this file must label
// the data as demo fixtures (the app shell renders a persistent demo banner).
// Nothing here is ever presented as live operational data.

import type {
  AppealsCase,
  AuditLogRow,
  EventFlag,
  Exam,
  ExamSession,
  Institution,
  ProctoringPolicyTemplate,
  UserAccount,
} from "./types";

export const institutions: Institution[] = [
  { institution_id: "inst_westbridge", name: "Westbridge State University", code: "WSU" },
  { institution_id: "inst_northfield", name: "Northfield Polytechnic College", code: "NPC" },
  { institution_id: "inst_test", name: "AIsmering Test Institution", code: "TEST", isTest: true },
];

export const policyTemplates: ProctoringPolicyTemplate[] = [
  {
    policy_template_id: "pol_standard",
    name: "Standard Monitoring",
    description: "All live detectors enabled with policy.yaml (pose_v2) thresholds.",
    severity_map: {
      gaze_deviation: "medium",
      head_pose_deviation: "medium",
      second_voice: "high",
      unauthorized_object: "high",
      second_person: "critical",
      focus_loss: "medium",
      copy_paste: "low",
      connectivity_interruption: "low",
    },
  },
  {
    policy_template_id: "pol_lenient",
    name: "Lenient Monitoring",
    description: "Behavioral and connectivity events disabled; visual detectors only.",
    severity_map: {
      gaze_deviation: "medium",
      head_pose_deviation: "medium",
      unauthorized_object: "high",
      second_person: "critical",
    },
  },
  {
    policy_template_id: "pol_strict",
    name: "Strict Monitoring",
    description: "All event types enabled, including not-yet-implemented detectors (audio, browser).",
    severity_map: {
      gaze_deviation: "medium",
      head_pose_deviation: "medium",
      second_voice: "high",
      unauthorized_object: "high",
      second_person: "critical",
      focus_loss: "medium",
      copy_paste: "low",
      connectivity_interruption: "low",
    },
  },
];

export const users: UserAccount[] = [
  {
    user_id: "u_stu_1001",
    role: "student",
    full_name: "Maria Santos",
    email: "maria.santos@westbridge.edu",
    institution_id: "inst_westbridge",
    roster_id: "2024-01821",
    consent_status: "granted",
    consent_history: [
      { date: "2026-10-28T09:12:00", action: "granted" },
    ],
  },
  {
    user_id: "u_stu_1002",
    role: "student",
    full_name: "Joaquin Reyes",
    email: "joaquin.reyes@westbridge.edu",
    institution_id: "inst_westbridge",
    roster_id: "2024-01866",
    consent_status: "granted",
    consent_history: [
      { date: "2026-10-30T14:03:00", action: "granted" },
    ],
  },
  {
    user_id: "u_stu_1003",
    role: "student",
    full_name: "Aira Mendoza",
    email: "aira.mendoza@northfield.edu",
    institution_id: "inst_northfield",
    roster_id: "NPC-2025-1104",
    consent_status: "none",
    consent_history: [],
  },
  {
    user_id: "u_pro_2001",
    role: "proctor",
    full_name: "Elena Cruz",
    email: "e.cruz@westbridge.edu",
    institution_id: "inst_westbridge",
    department: "College of Science",
    approval_status: "approved",
  },
  {
    user_id: "u_pro_2002",
    role: "proctor",
    full_name: "Ramon Dela Paz",
    email: "r.delapaz@westbridge.edu",
    institution_id: "inst_westbridge",
    department: "College of Engineering",
    approval_status: "pending",
  },
  {
    user_id: "u_adm_3001",
    role: "admin",
    full_name: "Daryl Bacusmo",
    email: "d.bacusmo@aism.edu",
    institution_id: "inst_westbridge",
  },
  {
    user_id: "u_app_4001",
    role: "appeals",
    full_name: "Atty. Paulo Mendoza",
    email: "p.mendoza@appeals.aism.edu",
    institution_id: "inst_westbridge",
  },
];

export const exams: Exam[] = [
  {
    exam_id: "exm_math101_final",
    title: "MATH 101 — Final Examination",
    course_code: "MATH 101",
    institution_id: "inst_westbridge",
    window_start: "2026-10-31T09:00:00",
    window_end: "2026-10-31T11:30:00",
    duration_min: 90,
    allowed_materials: ["Scientific calculator", "Provided formula sheet"],
    policy_template_id: "pol_standard",
    status: "in_progress",
    roster_ids: ["2024-01821", "2024-01866"],
    accommodations: [{ student_id: "u_stu_1002", detail: "Extended time (+30 min)" }],
  },
  {
    exam_id: "exm_chem210_mid",
    title: "CHEM 210 — Midterm Examination",
    course_code: "CHEM 210",
    institution_id: "inst_westbridge",
    window_start: "2026-11-03T13:00:00",
    window_end: "2026-11-03T15:00:00",
    duration_min: 75,
    allowed_materials: ["Periodic table (provided)"],
    policy_template_id: "pol_standard",
    status: "scheduled",
    roster_ids: ["2024-01821"],
    accommodations: [],
  },
  {
    exam_id: "exm_cs101_quiz",
    title: "CS 101 — Online Quiz 4",
    course_code: "CS 101",
    institution_id: "inst_northfield",
    window_start: "2026-10-29T10:00:00",
    window_end: "2026-10-29T10:45:00",
    duration_min: 30,
    allowed_materials: [],
    policy_template_id: "pol_lenient",
    status: "completed",
    roster_ids: ["NPC-2025-1104"],
    accommodations: [],
  },
  {
    exam_id: "exm_phys130_draft",
    title: "PHYS 130 — Pre-final (draft)",
    course_code: "PHYS 130",
    institution_id: "inst_westbridge",
    window_start: "2026-11-10T09:00:00",
    window_end: "2026-11-10T11:00:00",
    duration_min: 60,
    allowed_materials: [],
    policy_template_id: "pol_strict",
    status: "draft",
    roster_ids: [],
    accommodations: [],
  },
  {
    exam_id: "exm_bio115_archived",
    title: "BIO 115 — Term Paper (archived)",
    course_code: "BIO 115",
    institution_id: "inst_westbridge",
    window_start: "2026-09-15T09:00:00",
    window_end: "2026-09-15T12:00:00",
    duration_min: 120,
    allowed_materials: ["Open notes"],
    policy_template_id: "pol_standard",
    status: "archived",
    roster_ids: [],
    accommodations: [],
  },
];

export const sessions: ExamSession[] = [
  {
    session_id: "ses_math101_1001",
    exam_id: "exm_math101_final",
    student_id: "u_stu_1001",
    status: "active",
    start_time: "2026-10-31T09:02:14",
    end_time: null,
    risk_score: 34,
    last_event_at: "2026-10-31T09:41:05",
    recording_available: false,
    monitoring_state: "active",
  },
  {
    session_id: "ses_math101_1002",
    exam_id: "exm_math101_final",
    student_id: "u_stu_1002",
    status: "active",
    start_time: "2026-10-31T09:04:40",
    end_time: null,
    risk_score: 12,
    last_event_at: "2026-10-31T09:38:22",
    recording_available: false,
    monitoring_state: "active",
  },
  {
    session_id: "ses_cs101_1104",
    exam_id: "exm_cs101_quiz",
    student_id: "u_stu_1003",
    status: "completed",
    start_time: "2026-10-29T10:01:02",
    end_time: "2026-10-29T10:31:44",
    risk_score: 58,
    last_event_at: "2026-10-29T10:26:19",
    recording_available: false,
    monitoring_state: "unavailable",
  },
];

const base = {
  session_id: "ses_math101_1001",
  policy_ref: "pose_v2",
} as const;

export const sessionEvents: EventFlag[] = [
  {
    ...base,
    event_id: "ev_001",
    event_type: "gaze_deviation",
    severity: "medium",
    start_s: 412.4,
    end_s: 415.1,
    duration_s: 2.7,
    peak_gaze_dev: 0.94,
    detector: "pose_mediapipe",
    review_status: "pending",
  },
  {
    ...base,
    event_id: "ev_002",
    event_type: "head_pose_deviation",
    severity: "medium",
    start_s: 603.8,
    end_s: 606.5,
    duration_s: 2.7,
    peak_yaw_dev: 19.3,
    detector: "pose_mediapipe",
    review_status: "acknowledged",
    reviewer_note: "Student glanced at calculator; allowed material.",
  },
  {
    ...base,
    event_id: "ev_003",
    event_type: "unauthorized_object",
    severity: "high",
    start_s: 1240.1,
    end_s: 1243.0,
    duration_s: 2.9,
    detector: "yolo11n",
    review_status: "pending",
  },
  {
    ...base,
    event_id: "ev_004",
    event_type: "connectivity_interruption",
    severity: "low",
    start_s: 1690.0,
    end_s: 1695.5,
    duration_s: 5.5,
    detector: "pose_mediapipe",
    review_status: "dismissed",
    reviewer_note: "Brief network blip; monitoring resumed on its own.",
  },
  {
    ...base,
    event_id: "ev_005",
    event_type: "second_person",
    severity: "critical",
    start_s: 2130.2,
    end_s: 2133.9,
    duration_s: 3.7,
    detector: "yolo11n",
    review_status: "escalated",
    reviewer_note: "Escalated for formal review.",
  },
  {
    ...base,
    event_id: "ev_006",
    event_type: "gaze_deviation",
    severity: "medium",
    start_s: 2405.0,
    end_s: 2407.2,
    duration_s: 2.2,
    peak_gaze_dev: 0.81,
    detector: "pose_mediapipe",
    review_status: "pending",
  },
];

export const auditLog: AuditLogRow[] = [
  {
    log_id: "log_01",
    actor: "e.cruz@westbridge.edu",
    action: "REVIEW_EVENT: acknowledge",
    target: "ev_002",
    at: "2026-10-31T09:52:10",
  },
  {
    log_id: "log_02",
    actor: "e.cruz@westbridge.edu",
    action: "REVIEW_EVENT: dismiss",
    target: "ev_004",
    at: "2026-10-31T10:02:41",
  },
  {
    log_id: "log_03",
    actor: "e.cruz@westbridge.edu",
    action: "REVIEW_EVENT: escalate",
    target: "ev_005",
    at: "2026-10-31T10:11:05",
  },
];

export const appealsCases: AppealsCase[] = [
  {
    case_id: "case_2026_041",
    session_id: "ses_math101_1001",
    student_name: "Maria Santos",
    exam_title: "MATH 101 — Final Examination",
    opened_at: "2026-10-31T10:11:05",
    status: "under_review",
    notes: [
      {
        author: "Elena Cruz",
        text: "Escalated: second person visible in frame at ~35 min.",
        at: "2026-10-31T10:11:05",
      },
    ],
  },
  {
    case_id: "case_2026_038",
    session_id: "ses_cs101_1104",
    student_name: "Aira Mendoza",
    exam_title: "CS 101 — Online Quiz 4",
    opened_at: "2026-10-29T10:40:00",
    status: "open",
    notes: [
      {
        author: "Ramon Dela Paz",
        text: "Frequent gaze deviations in the last 10 minutes.",
        at: "2026-10-29T10:40:00",
      },
    ],
  },
];

/** Row fixtures for the read-only database viewer (SDD §5.8). */
export const dbTables: Record<string, Record<string, unknown>[]> = {
  UserAccount: users.map((u) => ({ ...u })),
  Institution: institutions.map((i) => ({ ...i })),
  Exam: exams.map((e) => ({
    exam_id: e.exam_id,
    title: e.title,
    status: e.status,
    institution_id: e.institution_id,
  })),
  ExamSession: sessions.map((s) => ({ ...s })),
  EventsFlags: sessionEvents.map((e) => ({ ...e })),
  RiskScores: sessions
    .filter((s) => s.risk_score !== null)
    .map((s) => ({
      session_id: s.session_id,
      running_score: s.risk_score,
      last_updated: s.last_event_at,
    })),
  Recordings: [],
  SessionSummaries: [],
  AuditLog: auditLog.map((r) => ({ ...r })),
  RetentionLog: [],
  ProctoringPolicy: policyTemplates.map((p) => ({ ...p })),
  Consents: [
    {
      user_id: "u_stu_1001",
      action: "granted",
      at: "2026-10-28T09:12:00",
    },
    {
      user_id: "u_stu_1002",
      action: "granted",
      at: "2026-10-30T14:03:00",
    },
  ],
  RosterAssignment: [
    { exam_id: "exm_math101_final", student_id: "u_stu_1001", accommodation: null },
    { exam_id: "exm_math101_final", student_id: "u_stu_1002", accommodation: "Extended time (+30 min)" },
  ],
};

export const sessionById = (id: string) =>
  sessions.find((s) => s.session_id === id) ?? null;

export const examById = (id: string) => exams.find((e) => e.exam_id === id) ?? null;

export const userById = (id: string) => users.find((u) => u.user_id === id) ?? null;

export const institutionById = (id: string) =>
  institutions.find((i) => i.institution_id === id) ?? null;
