# AI-Driven Online Proctoring & Anti-Cheat System — Project Plan

> Consolidated from the project's SRS, SDD, and SPMP. This file is the plan of record for the full project implementation.
> Generated: 2026-10-01

## 1. System Summary

A browser-based remote exam monitoring platform. It analyzes webcam, microphone, and browser behavior in real time, scores anomalies, and shows them to human proctors. **No automated accusations are ever made.** An LLM produces advisory, timestamped session summaries from structured event data only.

## 2. Architecture

Style: layered, event-driven, with stateless processing services decoupled by a message queue.

```text
┌─────────────────────── CLIENT LAYER ───────────────────────┐
│  Test-Taker Client            Proctor Dashboard            │
│  (capture, calibration,       (risk scores, flag review,   │
│   exam UI, notices)            AI summary, playback/export,│
│                                DB viewer)                  │
└───────┬─────────────────────────────▲──────────────────────┘
        │ signals/events              │ live scores & flags
        ▼                             │
┌─────────────── API & INGESTION LAYER ──────────────────────┐
│  REST/WebSocket Ingestion API  →  Message Queue (Kafka/    │
│                                   Kinesis)                 │
└───────┬────────────────────────────────────────────────────┘
        ▼
┌─────────────────── PROCESSING LAYER ───────────────────────┐
│  CV/ML Inference     Stream Processor        LLM Summarizer│
│  (pose, gaze,        (fusion, risk score,    (reads only   │
│   audio, visual)      persist)                EventsFlags) │
└───────┬──────────────────────────┬─────────────────────────┘
        ▼                          ▼
┌───────────────────────── DATA LAYER ───────────────────────┐
│  Relational DB                    Encrypted Object Storage │
│  (users, exams, sessions,         (audio/video; DB holds   │
│   events, scores, summaries,       only pointers)          │
│   audit/retention logs)                                    │
└───────┬────────────────────────────────────────────────────┘
        ▼
┌──────────────────── MANAGEMENT LAYER ──────────────────────┐
│  Exam Lifecycle · User/Account Mgmt · Reporting & Compliance│
│  · Scheduled Retention/Purge Job                           │
└────────────────────────────────────────────────────────────┘
```

### The ten subsystems

| # | Subsystem | Responsibility |
|---|-----------|----------------|
| 1 | Test-Taker Client | Consent, device check, calibration, capture, exam UI, non-punitive notices, tech-support button |
| 2 | CV/ML Inference Services | Head pose, gaze, audio classification, object/person detection |
| 3 | Ingestion API + Message Queue | Absorb load spikes from concurrent sessions |
| 4 | Stream Processor | Multimodal fusion, risk scoring, persistence, live push |
| 5 | Storage Layer | Relational schema, encrypted object storage, retention |
| 6 | LLM Summarization Service | Chronological, timestamped, advisory narratives |
| 7 | Proctor Dashboard | Monitoring, review actions, playback/export, DB viewer |
| 8 | User & Account Management | Roles, tenants, SSO, consent |
| 9 | Exam Management & Delivery | Exam config, policies, rosters, lifecycle state machine |
| 10 | Reporting & Compliance | Integrity reports, cohort analytics, appeals packages, audit reports |

### Key data flow

1. The client captures signals, and ML flags are published to the ingestion API, then the queue.
2. The stream processor fuses modalities, applies the policy severity map, and writes `EventsFlags` and `RiskScores`.
3. Recordings stream to encrypted object storage, and only a pointer goes in `Recordings`.
4. The dashboard receives live updates.
5. At exam end or on demand, the summarizer reads `EventsFlags` rows, validates that every statement maps to a row, and stores the result in `SessionSummaries`.
6. Recording export uses short-lived presigned URLs, and every export is audit-logged.

### Data model

- **Identity and exam:** `UserAccount`, `Institution`, `Exam`, `ExamSession`, `ProctoringPolicy`, `RosterAssignment`, `Consents`
- **Monitoring:** `EventsFlags`, `RiskScores`
- **Media and AI:** `Recordings`, `SessionSummaries`
- **Governance:** `AuditLog`, `RetentionLog`

`ExamSession` is the anchor record. It has many `EventsFlags`, one `RiskScores` row, many `Recordings`, and at most one `SessionSummary`.

### Design rationale

- **Event-driven over synchronous:** client latency would otherwise grow with ML load.
- **Human-in-the-loop over automation:** false positives are unacceptable in high-stakes exams.
- **Media separated from metadata:** keeps the database small and simplifies encryption and retention.
- **LLM data minimization:** only structured, non-biometric fields are sent.
- **Stateless services over a monolith:** horizontal scaling, with graceful degradation to recording-only mode.

## 3. Core Requirements

### Functional

| Area | Key requirements |
|------|------------------|
| Image processing | Pitch/yaw/roll head pose; gaze and pupil tracking; baseline calibration with configurable drift threshold |
| Machine learning | Acoustic classification; object/person detection; multimodal fusion; bias mitigation; confidence thresholds |
| Behavioral monitoring | Tab-switch, copy-paste, focus-loss tracking; encrypted session recording; real-time risk dashboard |
| Event catalog | Gaze Deviation (Medium), Head-Pose Deviation (Medium), Second Voice (High), Unauthorized Object (High), Second Person (Critical), Focus Loss (Medium), Copy-Paste (Low), Connectivity Interruption (Low) |
| Proctor review actions | Acknowledge/dismiss, escalate, add note, override severity (original retained), bulk-dismiss low-severity |
| Data pipeline | Queue-based ingestion, stream processing, structured and media storage, scheduled retention purge |
| AI summary | Auto or on-demand; reads only structured rows; chronological and timestamped; stored with model version; shown in a separate labeled panel |
| Accounts | Four roles (Student, Instructor/Proctor, Admin, Appeals Reviewer); tenant provisioning; CSV/SIS import; password and SAML/OAuth SSO; consent grant/revoke |
| Exam management | Exam config, accommodations, policy templates, lifecycle (Draft → Scheduled → In Progress → Completed → Archived) |
| Student experience | Check-in, calibration, timer UI, non-punitive notices, tech-support escalation without pausing proctoring |
| Reports | Session integrity (PDF/CSV), cohort analytics, appeals package, audit/compliance |
| Proctor enhancements (SDD v01.01) | Completed-session recording export, read-only DB viewer, guarded deletion of mock/test data |

### Non-functional

- **Usability:** prioritized dashboard; low-friction setup; flags with timestamp and thumbnail context; AI panel visibly distinct from raw flags.
- **Reliability:** continuous monitoring; transient interruptions logged; fallback to recording-only mode; the dashboard keeps working if the LLM is down.
- **Performance:** near-continuous frame analysis; low-latency risk updates; scales with concurrent sessions; summaries in seconds.
- **Security:** encryption in transit and at rest; role-restricted access with audit trail; LLM data minimization.

### Design constraints

- FERPA/GDPR alignment.
- Human-in-the-loop is a hard architectural constraint, not a setting.
- Every summary statement must trace to `EventsFlags` rows.
- Interfaces: client, dashboard, LMS integration, database/storage, and LLM service contract.

## 4. Limitations and Constraints

### Out of scope

- Exam question authoring and item banks
- Grading and scoring
- Identity verification at account creation (assumed upstream)
- Optional live view of active sessions (SDD 5.9): documented only, with no WBS package and no schedule
- Project scheduling, staffing, and budget detail (these are in the SPMP, not the SRS)

### Project constraints

- A four-person student team within one academic term, so depth is limited compared to a production system
- Third-party services (queue, object storage, LLM API) on free or academic tiers
- Webcam and microphone are needed for development and testing
- Pilot institution dependencies: SSO/IdP integration and LMS metadata exchange
- Possible ethics review before any pilot with real students

### Technical and design limitations

- **Test data identification:** mock/test records are assumed to live in a dedicated test Institution. A per-record marker is an open question.
- **Hard deletion only:** there are no soft-delete columns. `AuditLog`, `RetentionLog`, and `Consents` can never be deleted through the viewer.
- **Live view mechanism undecided:** WebRTC, WebSocket frame push, or periodic snapshots, pending a bandwidth and server-load study.
- **Large recording exports** may be slow, so the UI shows progress.
- **Recording unavailable** if never captured, already purged, or failing an integrity check.
- **Advisory-only AI:** summaries and flags never constitute findings.

### Top risks (from the SPMP risk log)

| Risk | Likelihood / Impact | Mitigation |
|------|---------------------|------------|
| False positives harm students | Medium / High | Thresholds, fusion, mandatory human review |
| LLM summary contains unsupported statements | Medium / High | Traceability validation before storage |
| Team can't finish all 10 subsystems | Medium / High | Core pipeline first; use change control |
| Live-view scope creep | Medium / Medium | Explicitly deferred; unscheduled |
| Model bias (accents, lighting) | Medium / Medium | Diverse training data; monitor flag-rate disparities |
| Deletion tool hits production data | Low / High | Role gating, test-institution check, confirmation, audit log |
| Recording export exposes media | Low / High | Short-lived URLs, role/institution checks, audit log |
| FERPA/GDPR non-compliance | Low / High | Encryption, consent, minimization, retention |

## 5. Implementation Plan

### Milestones (12 weeks)

| Weeks | Milestone |
|-------|-----------|
| Done | SRS v1.2 and SDD v1.0 (+ v01.01 addendum) baselines |
| 1–4 | Core monitoring pipeline: client, CV/ML services, ingestion API, stream processor |
| 3–5 | Storage layer and retention job |
| 5–6 | LLM summarization integrated and traceability-validated |
| 6–8 | Proctor dashboard, review workflow, recording export, guarded DB viewer |
| 7–9 | User/account management and exam management |
| 9–10 | Reporting and compliance service |
| 10–11 | Integration, performance, and compliance testing |
| 12 | Pilot deployment, documentation, final defense |

### Key dependencies

- The stream processor needs the ingestion API and queue first.
- The LLM service needs a stable `EventsFlags` schema.
- The dashboard needs the stream processor and the LLM service.
- Recording export needs object storage, presigned URLs, and populated `Recordings` rows.
- The DB viewer needs RBAC and a working `AuditLog`.
- Reporting needs `RiskScores`, `SessionSummaries`, and `AuditLog` populated.

### Deployment

Dev → Staging → Pilot (small, consenting class) → Production.

**Pilot gates:**

- Consent management and retention are verified operational.
- The DB viewer is verified to restrict deletion to the test Institution and to deny and log everything else.
- Presigned URLs are verified for expiry, scoping, and audit logging.

### Quality assurance

- Unit tests for the CV/ML and pipeline components
- Integration tests across the full pipeline: client → ingestion → processor → storage → dashboard
- UAT of the review workflow, export, and DB viewer
- Verification passes confirming summaries contain no unsupported statements
- Negative tests confirming unauthorized delete and export attempts are denied and logged
- Confirmation that the live view stays undeployed

### Change control

Submit a change request, assess impact against the SRS/SDD, get adviser approval, then record it in a new revision.

## 6. Inconsistencies in the Source Documents

Known issues to fix before submission:

1. **Version labels conflict.** The SRS header says v01.00, but the SDD and SPMP cite "SRS v1.2." The SDD header says v01.00 while its text refers to v01.01 enhancements.
2. **Revision dates are out of order.** The SRS revision entry (09/12) and SDD entry (09/05) predate the documents' header dates (09/20), and the SPMP revision entry says 09/12 but the header says 09/26.
3. **SRS gap.** The SDD adds recording export, the DB viewer, and delete operations as SDD-defined requirements (SDD-1.1 to 2.2) that have no SRS parent. Consider back-porting them to the SRS for clean traceability.
4. **SDD/SPMP baseline consistency.** The SDD references the SPMP as separate, but it only describes the v01.01 changes in passing — confirm the baseline wording is consistent across all three.
5. **Possible minimization gap.** The LLM receives `student_id`, which is an identifier. This is consistent with the SRS, but consider pseudonymizing it, since the stated principle is non-biometric minimal data.
