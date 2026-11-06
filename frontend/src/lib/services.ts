// Service layer — typed boundaries between the UI and the future backend.
// Today every service reads deterministic demo fixtures (or reports itself
// unavailable). When the backend lands, replace each body with calls to
// config.apiBaseUrl; the signatures stay the same and no UI code changes.

import type {
  Exam,
  ExamSession,
  EventFlag,
  Role,
  Severity,
  UserAccount,
} from "./types";
import {
  auditLog,
  exams,
  institutions,
  sessions,
  sessionEvents,
  users,
} from "./fixtures";

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

export function backendRequired(feature: string): { ok: false; reason: string } {
  return {
    ok: false,
    reason: `${feature} requires the backend API, which is not implemented yet. Nothing was sent or persisted.`,
  };
}

// In-memory copies so demo mutations are deterministic per page load.
const examStore: Exam[] = exams.map((e) => ({ ...e, allowed_materials: [...e.allowed_materials], roster_ids: [...e.roster_ids], accommodations: [...e.accommodations] }));

export const AuthService = {
  demoOnly: true,
  /** Demo login only — no credentials are verified anywhere. */
  login(email: string, role: Role): UserAccount | null {
    return (
      users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.role === role) ?? null
    );
  },
  register(user: UserAccount): UserAccount {
    // Demo memory only; the account disappears on reload.
    users.push(user);
    return user;
  },
};

export const ExamService = {
  demoOnly: true,
  list(): Exam[] {
    return examStore;
  },
  get(examId: string): Exam | null {
    return examStore.find((e) => e.exam_id === examId) ?? null;
  },
  /** Adds to the in-memory demo store only — not persisted. */
  create(exam: Exam): void {
    examStore.unshift(exam);
  },
  /** Demo-memory transition only — a real backend enforces the lifecycle map. */
  transition(examId: string, status: Exam["status"]): void {
    const exam = examStore.find((e) => e.exam_id === examId);
    if (exam) exam.status = status;
  },
};

export const SessionService = {
  demoOnly: true,
  list(): ExamSession[] {
    return sessions;
  },
  get(sessionId: string): ExamSession | null {
    return sessions.find((s) => s.session_id === sessionId) ?? null;
  },
};

export const EventService = {
  demoOnly: true,
  forSession(sessionId: string): EventFlag[] {
    return sessionEvents.filter((e) => e.session_id === sessionId);
  },
};

export const ReviewService = {
  available: false,
  acknowledge() {
    return backendRequired("Acknowledge/dismiss");
  },
  escalate() {
    return backendRequired("Escalate to academic integrity case");
  },
  addNote() {
    return backendRequired("Reviewer notes");
  },
  overrideSeverity(_eventId: string, _severity: Severity) {
    return backendRequired("Severity override");
  },
  bulkReview(_eventIds: string[]) {
    return backendRequired("Bulk review");
  },
};

export const RecordingService = {
  available: false,
  export(_sessionId: string) {
    return backendRequired(
      "Recording export (requires object storage, presigned URLs, and audit logging)"
    );
  },
};

export const ReportService = {
  available: false,
  generate(_reportType: string) {
    return backendRequired("Report generation");
  },
};

export const AdminService = {
  demoOnly: true,
  listUsers(): UserAccount[] {
    return users;
  },
  listInstitutions() {
    return institutions;
  },
  listAuditLog() {
    return auditLog;
  },
  importRoster() {
    return backendRequired("CSV roster import");
  },
  approveProctor() {
    return backendRequired("Proctor account approval");
  },
  deleteRecord(_table: string, _recordId: string) {
    return backendRequired(
      "Delete operations (role-gated, test-institution-verified, audit-logged — backend enforced)"
    );
  },
};
