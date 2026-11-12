# AIsmering — Roles and Permissions

> **Caveat:** role enforcement is **designed but not built**. The frontend renders each role's screens, but the server does not yet exist to assign roles, enforce them, or write audit rows. Everything here is the contract the backend must implement.
>
> **Verification flag:** the source documents (SRS 3.1.6/3.1.7/3.1.10/3.6, SDD 3.3/4.3/5.6/5.8/6.1/6.3a/Fig. 6-4, SPMP 2.3) are **not present in this repository**, so the citations below come from the role-correction instruction sheet (2026-11-11), not from re-reading the documents themselves. Statements are tagged SPEC (stated there) or INFERRED (reasonable but unstated) — verify against the actual SRS/SDD before the defense.

## Roles

### Instructor / Proctor — one role, never split

| Capability | Tag | Source |
|---|---|---|
| Live risk scores (advisory) and flags for its own institution | SPEC | SRS 3.1.6 |
| Review actions: acknowledge/dismiss, escalate, add note, override severity (original retained), bulk-dismiss low severity (same type, same session) | SPEC | SRS 3.1.6 |
| Advisory AI summary, recording playback, export of **completed sessions only** via short-lived presigned URL | SPEC | SRS 3.1.6, SDD 6.1 |
| Create and configure exams and rosters | SPEC | SRS 3.1.7 |
| View cohort analytics | SPEC | SRS 3.1.10 |
| Read-only DB viewer scoped to its institution; may delete **mock/test data only**, in the dedicated test Institution, with confirmation and an audit log of every attempt | SPEC | SDD 5.8 |
| Cannot manage accounts or tenants | SPEC | SDD 6.1 |
| Cannot delete production data | SPEC | SDD 5.8 |
| Sees only its own institution (tenant isolation) | SPEC | SRS 3.1.6 |

### Administrator

| Capability | Tag | Source |
|---|---|---|
| Institution and account management for all four roles, tenant provisioning, policy configuration, lifecycle changes | SPEC | SRS 3.1.7, SDD 6.1 |
| Reports: session integrity, cohort analytics, audit/compliance | SPEC | SRS 3.1.10 |
| May use the DB viewer, export recordings and delete mock/test data under the same guardrails as the proctor | SPEC | SDD 5.8 |
| Works within the tenant selected at sign-in; an admin may be scoped to **more than one tenant** — so: one tenant at a time, not "cannot see other tenants" | SPEC | SDD Fig. 6-4 |
| AuditLog, RetentionLog and Consents are **never deletable** through the viewer | SPEC | SDD 5.8 |

### Student

| Capability | Tag | Source |
|---|---|---|
| Sign in, grant or revoke consent (a session cannot start without consent; revocation is enforced) | SPEC | SRS 3.1.6 |
| Check-in, calibration, exam interface, non-punitive notices, tech-support escalation that does not pause proctoring | SPEC | SRS 3.1.6 |
| Cannot open proctor or admin screens or see other students' data | SPEC | SRS 3.1.6 |
| Flags are shown only as non-punitive notices, never verdicts | SPEC | SRS 3.1.6 |

### Appeals Reviewer — Option A, minimal

| Capability | Tag | Source |
|---|---|---|
| **Read-only** access to summaries, events and recordings for escalated items | SPEC | SDD 4.3 |
| No dismiss or override controls | SPEC | SDD 4.3 |
| No exam or account tools, no deletion, no live sessions | INFERRED | SDD 4.3 (absence of any grant) |
| Case notes, decisions, a Case entity, the full appeals workflow | NOT IMPLEMENTED — requires a change request first | SDD 4.3 (Option A) |

## System-wide rules

- Every review action writes an `AuditLog` row **with before/after values** (SDD 5.6).
- Exports and deletes are logged with **actor, target, action and timestamp** (SDD 5.6, 5.8) — the documents do **not** claim before/after values for them.
- No automated flag or AI summary produces a cheating determination without human review (SRS 3.6). Note: this is the real rule — it is **not** "no role can set an outcome"; the docs allow a human review outcome to exist, they forbid *automated* determinations.
- Role enforcement is designed but not built (see the caveat).

## Open decisions for the adviser

1. **Split Instructor and Proctor?** The SRS/SDD treat them as one role. Splitting needs a change request.
2. **Should proctors AND admins delete mock data?** SDD 5.8 says both. Confirm.
3. **Do appeals decisions exist?** They need a Case entity and the full workflow — currently Option A (read-only), everything else is a change request.
4. **The login wireframe (SDD Fig. 6-4) has no Appeals Reviewer tab** — how does an appeals reviewer reach their screen?
5. **Source documents absent from the repository** — the SRS/SDD/SPMP files were consolidated away; restore or re-add them so the citations above can be verified.

## Frontend mapping (single source: `frontend/src/auth.jsx`)

| Route | Student | Proctor | Admin | Appeals Reviewer |
|---|---|---|---|---|
| `#/student` | yes | — | — | — |
| `#/dashboard` | — | yes | yes | — |
| `#/admin` | — | — | yes | — |
| `#/reports` | — | yes | yes | — |
| `#/db` | — | yes | yes | — |
| `#/appeals` | — | — | — | yes |

UI tests cover this table (see `frontend/src/__tests__/roles.test.jsx`); they do **not** prove server-side RBAC.
