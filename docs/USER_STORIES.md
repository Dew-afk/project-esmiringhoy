# User stories by role

These follow the corrected role definitions. Each statement is SPEC (stated in the
SRS or SDD) or INFERRED (reasonable but unstated). Status values:

- **BUILT** — implemented and covered by a test (evidence cited)
- **PARTIAL** — some part exists; the rest is missing or unwired
- **DESIGNED** — schema/UI placeholder exists, no working path
- **NOT STARTED** — nothing exists

Role enforcement is server-side on every endpoint added in Phase 1–2
(`deps.require_role` + institution checks, covered by API tests). Frontend
guards are not security.

## 1. Student (test taker)

### Does

| Story | Status | Evidence |
|---|---|---|
| As a student, I want to register with my institutional email, roster ID and consent so I can take monitored exams. | PARTIAL — SPEC (SDD Fig. 6-3) | `backend/main.py` register; `test_auth_api.py`. Roster ID + consent enforced; "institutional email" domain is not enforced (Open decisions). |
| As a student, I want to review, grant or revoke monitoring consent so I control how my data is used. | BUILT — SPEC (SRS 3.1.6) | `GET/POST /api/consent*` in `main.py`; consent panel in `Student.jsx`; audit-logged; `test_sessions_api.py::test_consent_status_and_grant_audit`. |
| As a student, I want a check-in (device check, camera and mic calibration, baseline capture) so my exam starts correctly. | PARTIAL — SPEC (SRS 3.1.8) | `LiveSession.jsx` + `ml/webcam_demo.py`: camera + 10 s pose baseline over WebSocket, now bound to a real `exam_sessions` row (`?session=` + cookie validation). Mic capture and device check not built. |
| As a student, I want to see my exam, timer and a monitoring status panel so I know what is happening. | PARTIAL — SPEC (SDD Fig. 6-1) | `Student.jsx` lists real rostered exams (`GET /api/exams/mine`) and starts sessions; exam timer UI not built. |
| As a student, I want gentle notices like "face not visible" so I can fix a problem myself. | NOT STARTED — SPEC (SRS 3.1.8) | Browser/network event pipeline not built. |
| As a student, I want to flag a technical issue to support without pausing my exam or proctoring. | NOT STARTED — SPEC (SRS 3.1.8) | No endpoint or UI. |

### Limitations

| Limitation | Status | Evidence |
|---|---|---|
| No exam session can start without consent, and revoking consent must be enforced. | BUILT — SPEC | `POST /api/sessions/start` checks consent + roster + lifecycle + institution; `test_sessions_api.py` covers all four rejections. Revoke takes effect on next start. |
| Cannot open proctor, admin, reports or appeals screens. | BUILT — INFERRED | `ROLE_PERMS` (`auth.jsx`) + server-side `require_role` on every proctor/admin/appeals endpoint; `test_review_api.py::test_student_cannot_read_proctor_endpoints`, `test_review_actions_require_proctor_role`. |
| Cannot see other students' data. | BUILT — INFERRED | `GET /api/sessions/mine` and `/api/exams/mine` return only the caller's rows; WS validate and event ingest verify ownership (`test_sessions_api.py`). |
| Sees flags only as non-punitive notices, never as findings or scores. | NOT STARTED — SPEC | Students have no flag surface yet. |
| Cannot view or export recordings. | NOT STARTED — INFERRED | No recording endpoints exist. |

## 2. Instructor / Proctor

### Does

| Story | Status | Evidence |
|---|---|---|
| As a proctor, I want a prioritized view of risk scores and flags across my institution's live sessions so I can monitor many students. | PARTIAL — SPEC (SRS 3.2) | `GET /api/proctor/sessions` (risk + flag counts, institution-scoped) + `Dashboard.jsx` sessions table; `test_review_api.py::test_proctor_sessions_lists_with_counts`. "Prioritized" ordering and live-session focus are minimal. |
| As a proctor, I want each flag's timestamp, type, confidence and snippet so I can judge quickly. | PARTIAL | `GET /api/proctor/sessions/{id}/flags` returns type/severity/timing/conf/occurred_at; no snippet/media yet. |
| As a proctor, I want to acknowledge/dismiss a flag so reviewed items leave my queue. | BUILT | `POST /api/flags/{id}/review`; `test_review_api.py::test_acknowledge_and_note_with_audit`. |
| As a proctor, I want to escalate a flag to an academic integrity case, with its recording reference and risk context. | PARTIAL | `POST /api/flags/{id}/escalate` marks escalated + stores recording ref; **no Case table** (Open decisions). |
| As a proctor, I want to add a reviewer note so context is kept for later or an appeal. | BUILT | `review_note` via review/escalate bodies; shown in Dashboard + Appeals; audit before/after. |
| As a proctor, I want to override a severity, with the original kept, so I can correct the system. | BUILT | `POST /api/flags/{id}/severity` → `severity_override`, original kept; `test_review_api.py::test_severity_override_keeps_original`. |
| As a proctor, I want to bulk-dismiss low-severity flags of the same type in one session. | BUILT | `POST /api/flags/bulk-dismiss`; one audit row with all event ids; `test_bulk_dismiss_only_low_same_type`. |
| As a proctor, I want to read the AI summary beside the raw flags so I can triage faster. | NOT STARTED | `session_summaries` table exists; no summarizer. |
| As a proctor, I want to play back and export a completed session's recording via a short-lived link. | NOT STARTED — SPEC (SDD 5.6) | Phase 3 deferred. |
| As a proctor, I want to create and configure exams and rosters, and view cohort analytics. | NOT STARTED — SPEC (SRS 3.1.7, 3.1.10) | `Admin.jsx` placeholders; only exams *list* exists. |
| As a proctor, I want a read-only database viewer scoped to my institution. | NOT STARTED — SPEC (SDD 5.8, Tier 3) | Phase 3 deferred. |

### Limitations

| Limitation | Status | Evidence |
|---|---|---|
| Every flag and summary is advisory. No action marks a student as cheating. | BUILT — SPEC (SRS 3.6) | `test_review_api.py::test_no_cheating_outcome_anywhere` asserts no cheating-outcome column or API text exists. |
| Sees only its own institution's data. Cross-institution access is denied and logged. | BUILT — SPEC | Institution check on every proctor/appeals endpoint; 404 across tenants (`test_flags_endpoint_and_cross_institution_404`, `test_appeals_cannot_see_other_institution`); actions audit-logged with institution_id. |
| Can export only completed sessions. | NOT STARTED — SPEC | No export exists. |
| Can delete mock/test data only, inside the dedicated test Institution, with confirmation and an audit log. | NOT STARTED — SPEC (SDD 5.8) | Phase 3 deferred. |
| Cannot delete production data, or AuditLog, RetentionLog or Consents. | DESIGNED — SPEC | No viewer backend exists; nothing can delete anything yet. |
| Cannot manage accounts, tenants or approve other proctors. | BUILT — INFERRED | Admin endpoints require `role='admin'`; `test_accounts_forbidden_for_student`, role guards in `deps.require_role`. |
| Registered proctors cannot log in until an admin approves them. | BUILT — SPEC | Pending at register → 403 at login; admin approve API + UI (`test_admin_api.py`). |

## 3. Administrator

### Does

| Story | Status | Evidence |
|---|---|---|
| As an admin, I want to provision institution tenants and accounts for all four roles. | PARTIAL — SPEC (SRS 3.1.6) | `POST /api/admin/accounts` creates admin + appeals_reviewer with one-time temp password (`test_admin_api.py`); students/proctors still self-register. Tenants still created via SQL. |
| As an admin, I want to approve pending proctor accounts so they can sign in. | BUILT | `GET /api/admin/accounts?status=pending` + `POST .../approve` + Admin.jsx UI; `test_pending_list_and_approve`. |
| As an admin, I want to create exams, set windows, durations, allowed materials, policy templates and rosters with accommodations. | NOT STARTED — SPEC (SRS 3.1.7) | Tables exist; `Admin.jsx` exam/policy/roster tabs are placeholders. |
| As an admin, I want to move an exam through Draft, Scheduled, In Progress, Completed and Archived. | DESIGNED — SPEC | `exam_lifecycle` enum; session start requires `in_progress`; no transition endpoint. |
| As an admin, I want session integrity reports, cohort analytics and audit/compliance reports. | NOT STARTED — SPEC (SRS 3.1.10) | `Reports.jsx` skeleton. |
| As an admin, I want to choose which institution I'm administering at sign-in. | BUILT — SPEC (Fig. 6-4) | `main.py` login requires institution for admins; `SignInPage.jsx` tenant select. |
| As an admin, I want to use the database viewer and export recordings. | NOT STARTED — SPEC (SDD 5.6, 5.8) | Phase 3 deferred. |

### Limitations

| Limitation | Status | Evidence |
|---|---|---|
| Works in one tenant at a time, the one selected at login. | BUILT — SPEC | `inst` JWT claim; membership re-checked per request; admin endpoints scoped to token institution (`test_cannot_touch_other_institution_account`). |
| Cannot self-register. The account must be seeded or provisioned. | BUILT — SPEC | Register rejects `role='admin'`; provisioning via admin API only. |
| Deletion is limited to mock/test data in the test Institution, with confirmation and logging. | NOT STARTED — SPEC | Phase 3 deferred. |
| AuditLog, RetentionLog and Consents can never be deleted through the viewer. | DESIGNED — SPEC | `DbViewer.jsx` blocks them in UI; no backend exists. `audit_log` now receives writes (`db.write_audit`). |
| Cannot produce an automated cheating determination, and no summary or flag does so either. | BUILT — SPEC (SRS 3.6) | Same invariant test as proctor. |
| SSO and CSV/SIS import are deferred (Tier 4). | BUILT as deferral | "not connected" notes; `auth_provider` column reserved. |

## 4. Appeals Reviewer (minimal version)

### Does

| Story | Status | Evidence |
|---|---|---|
| As an appeals reviewer, I want read-only access to escalated events, their summaries and recordings so I can examine a contested case. | PARTIAL — SPEC (SDD 4.3) | `GET /api/appeals/escalated` + `Appeals.jsx` table (event, exam, student, note, recording ref, advisory risk); `test_appeals_sees_only_escalated`. Summaries/recordings not built. |
| As an appeals reviewer, I want to see the proctor's notes, recording reference and risk context. | BUILT — INFERRED | `review_note`, `escalation_recording_ref`, `risk_score` returned by the endpoint. |
| As an appeals reviewer, I want an appeals package export of the evidence. | NOT STARTED — SPEC (SRS 3.1.10, Tier 3) | Phase 3 deferred. |

### Limitations

| Limitation | Status | Evidence |
|---|---|---|
| Read-only. Cannot dismiss, override or edit flags. | BUILT — INFERRED | Only GET endpoint exists for the role; write endpoints require instructor/admin (`test_appeals_sees_only_escalated` asserts 403 on review). |
| Cannot touch live sessions, exams, accounts or deletion. | BUILT — INFERRED | Same role guard; no write endpoints exist for this role. |
| Cannot self-register. The account must be provisioned. | BUILT — SPEC | Register rejects the role; admin provisioning creates it (`test_create_appeals_reviewer_returns_temp_password_once`). |
| Case notes and decisions are not implemented and need a change request and a Case table first. | NOT STARTED — Gap | Accurate: no `cases` table; escalate stores state on the flag itself. |
| The login wireframe has no Appeals Reviewer tab, so decide how this role signs in. | OPEN DECISION — Gap | UI offers it; SDD Fig. 6-4 does not. |

## Rules that apply to every role

| Rule | Status | Evidence |
|---|---|---|
| Every review action, export and delete writes an AuditLog row. Review actions keep before and after values. | BUILT (for built actions) — SPEC | `db.write_audit` inside the same transaction; used by login, consent, approvals, session start, all flag actions; asserted in `test_admin_api.py`, `test_sessions_api.py`, `test_review_api.py`. Exports/deletes don't exist yet. |
| No automated flag or AI summary decides a cheating outcome without human review. | BUILT — SPEC | `test_no_cheating_outcome_anywhere`. |
| The server decides a user's role from their account. The sign-in role selector must not. | BUILT — INFERRED | Login returns DB role; `UI_ROLE`/`API_ROLE` maps in `SignInPage.jsx`; `test_login_role_comes_from_server_record`. |
| Failed logins give the same generic message, and repeated failures lock the account. | BUILT — INFERRED | `test_wrong_password_and_unknown_email_same_message`, `test_lockout_after_repeated_failures`. Failures/lockouts now audit-logged. Caveat: lockout is in-memory per process. |

## Known gaps

- ~~`user_accounts.active` is unused and overlaps `approval_status`~~ — **resolved**: `active` dropped (Option A); `approval_status` is the single source of account state and the only thing login checks.
- **Non-admin tokens could carry `inst=null`** — mostly fixed: single-membership users get `inst` automatically, multi-membership users must select (400 otherwise). Users with **zero** memberships can still get `inst=null`.
- **Lockout is in-memory per process** — resets on restart, not shared across workers (`security.py` docstring).
- **Email domain is not tied to the institution** — any unique email can register for any institution by name. INFERRED rule; see Open decisions.
- **Appeals Reviewer has no sign-in tab in the SDD wireframe** — the UI offers it anyway; needs a design decision.
- ~~**Schema drift** — `db/schema.sql` lacks migration-001 columns and the 002/003 additions.~~ **Resolved**: migrations merged into `db/schema.sql`; it is the single source of truth.
- **ML WS persistence is best-effort** — if the backend is down, events still write to `events/*.jsonl` and the client sees `"db": "down"`; there is no replay/backfill path yet.
- **`session_summaries`, `recordings`, `retention_log` are write-never tables** — no code path inserts into them yet.

## Open decisions

1. **Email/institution rule (INFERRED)** — options: (a) add a per-institution allowed email-domain column and enforce at register; (b) leave as is. Awaiting decision; not enforced.
2. ~~**`user_accounts.active` vs `approval_status`** — drop `active` (Option A) or keep both (Option B).~~ **Decided**: Option A applied — `active` is gone from `schema.sql`, login and the dev DB.
3. **Appeals Reviewer sign-in** — SDD Fig. 6-4 has no tab for this role. Keep the UI selector, add a wireframe change request, or gate it differently?
4. **Case entity for escalations** — escalate currently stores state on the flag (`review_action='escalated'` + recording ref). A real appeals workflow needs a `cases` table — change request required.
5. **EventsFlags field naming** — `events_flags` keeps contract names (`start_s`, `duration_s`); the SRS mapping (`timestamp`, `duration` semantics) is unresolved. `occurred_at` was added in migration 003 as the wall-clock time.
6. **Risk score formula** — `policy.yaml` `risk:` weights are a first cut (0.05/0.15/0.4/0.7 over 300 s). Needs proctor-facing validation before it means anything.
