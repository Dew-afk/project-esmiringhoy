-- AIsmering database schema (PostgreSQL 15+, run against the Docker instance
-- on port 5433 -- never the native 5432).
--
-- THE single schema file: no migrations directory, no sync proposals.
-- Everything the backend expects is in this one file.
-- Contract sources: ARCHITECTURE.md section 3 (data model + EventsFlags),
-- docs/ROLES.md (four roles, Instructor/Proctor as ONE role).
-- Re-runnable for dev: drops everything below first.

BEGIN;

DROP TABLE IF EXISTS retention_log, audit_log, session_summaries, recordings,
  risk_scores, events_flags, consents, roster_assignments, exam_sessions,
  exams, proctoring_policies, user_tenants, user_accounts, institutions CASCADE;
DROP TYPE IF EXISTS user_role, severity, exam_lifecycle, session_status,
  consent_status, recording_status CASCADE;

-- ---------------------------------------------------------------- types

CREATE TYPE user_role AS ENUM (
  'student',          -- test taker
  'instructor',       -- Instructor/Proctor: ONE role, do not split (ROLES.md)
  'admin',            -- Administrator
  'appeals_reviewer'  -- read-only on escalated items (SDD 4.3 Option A)
);

CREATE TYPE severity AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE exam_lifecycle AS ENUM
  ('draft', 'scheduled', 'in_progress', 'completed', 'archived');

CREATE TYPE session_status AS ENUM
  ('authorized', 'in_progress', 'completed', 'interrupted');

CREATE TYPE consent_status AS ENUM ('granted', 'revoked');

CREATE TYPE recording_status AS ENUM ('capturing', 'stored', 'purged', 'corrupt');

-- ---------------------------------------------------------------- identity

CREATE TABLE institutions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The dedicated test institution is the ONLY place mock/test data may live,
-- and the only place the guarded delete may touch (SDD 5.8).

CREATE TABLE user_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,            -- hashed; never store plaintext
  full_name     TEXT NOT NULL DEFAULT '',
  role          user_role NOT NULL,
  auth_provider TEXT NOT NULL DEFAULT 'password'
                CHECK (auth_provider IN ('password', 'sso')),
  approval_status TEXT NOT NULL DEFAULT 'approved'
                CHECK (approval_status IN ('pending', 'approved', 'disabled')),
                -- the single source of account state; no separate `active` flag
  roster_id     TEXT,                     -- student registration field
  staff_id      TEXT,                     -- proctor registration field
  department    TEXT,                     -- proctor registration field
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Multi-tenant scoping: an admin may belong to more than one tenant
-- (SDD Fig. 6-4); every user works within ONE tenant at a time.
CREATE TABLE user_tenants (
  user_id        UUID NOT NULL REFERENCES user_accounts (id),
  institution_id UUID NOT NULL REFERENCES institutions (id),
  PRIMARY KEY (user_id, institution_id)
);

-- ---------------------------------------------------------------- exams

CREATE TABLE proctoring_policies (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions (id),
  name           TEXT NOT NULL,
  version        TEXT NOT NULL,           -- the policy_ref, e.g. 'pose_v2'
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,
                -- severity map + pose thresholds + yolo conf floors,
                -- loaded from policy.yaml by the backend, never hardcoded
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (institution_id, name, version)
);

CREATE TABLE exams (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id    UUID NOT NULL REFERENCES institutions (id),
  name              TEXT NOT NULL,
  window_start      TIMESTAMPTZ NOT NULL,
  window_end        TIMESTAMPTZ NOT NULL,
  duration_minutes  INTEGER NOT NULL,
  allowed_materials TEXT NOT NULL DEFAULT '',
  lifecycle         exam_lifecycle NOT NULL DEFAULT 'draft',
  policy_id         UUID NOT NULL REFERENCES proctoring_policies (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (window_end > window_start)
);

CREATE TABLE roster_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id       UUID NOT NULL REFERENCES exams (id),
  student_id    UUID NOT NULL REFERENCES user_accounts (id),
  accommodations TEXT NOT NULL DEFAULT '',
  UNIQUE (exam_id, student_id)
);

CREATE TABLE consents (
  -- Never deletable through the viewer (SDD 5.8).
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES user_accounts (id),
  exam_id     UUID REFERENCES exams (id),  -- NULL = institution-wide consent
  status      consent_status NOT NULL,
  granted_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- sessions

CREATE TABLE exam_sessions (
  -- The anchor record: many events, one risk score, many recordings,
  -- at most one summary.
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token TEXT NOT NULL UNIQUE,  -- the id the client/ML side carries
  exam_id       UUID NOT NULL REFERENCES exams (id),
  student_id    UUID NOT NULL REFERENCES user_accounts (id),
  status        session_status NOT NULL DEFAULT 'authorized',
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  -- A session may be created ONLY after consent is granted; the backend
  -- enforces this (no consent row, no session row).
);

CREATE TABLE events_flags (
  -- Mirrors the EventsFlags JSON contract 1:1 (ARCHITECTURE.md section 3):
  -- event_id, session_id, event_type, severity, start_s, end_s, duration_s,
  -- peak_yaw_dev, peak_gaze_dev, detector, policy_ref, conf.
  event_id        TEXT PRIMARY KEY,       -- '<session>-NNNN' from the ML side
  session_id      TEXT NOT NULL,          -- the contract's session id
  exam_session_id UUID REFERENCES exam_sessions (id),  -- bound to the real session
  event_type      TEXT NOT NULL,
  severity        severity NOT NULL,
  start_s         REAL NOT NULL,
  end_s           REAL NOT NULL,
  duration_s      REAL NOT NULL,
  peak_yaw_dev    REAL,
  peak_gaze_dev   REAL,
  conf            REAL,                   -- YOLO events only (pose events omit)
  detector        TEXT NOT NULL,          -- 'pose_mediapipe' | 'yolo11n'
  policy_ref      TEXT NOT NULL,          -- which policy version produced this
  -- proctor review state (review.py): the detector severity in `severity`
  -- is never overwritten; an override lives in severity_override.
  occurred_at     TIMESTAMPTZ,            -- wall clock: started_at + start_s
  review_action   TEXT
      CHECK (review_action IN ('acknowledged', 'dismissed', 'escalated')),
  reviewed_by     UUID REFERENCES user_accounts (id),
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT,
  severity_override severity,
  escalation_recording_ref TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Note: the SRS field mapping (start_s -> 'timestamp', end_s -> 'duration'
  -- semantics) is an open naming decision; these columns keep the contract
  -- names until the SRS/SDD settle it.
);
CREATE INDEX ON events_flags (session_id);
CREATE INDEX ON events_flags (exam_session_id);
CREATE INDEX ON events_flags (review_action);
CREATE INDEX ON events_flags (occurred_at);

CREATE TABLE risk_scores (
  -- Advisory only (SRS 3.6): a score, never a determination.
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_session_id UUID NOT NULL UNIQUE REFERENCES exam_sessions (id),
  score       REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  version     TEXT NOT NULL,              -- scoring model/version
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recordings (
  -- Media lives in encrypted object storage; the DB holds only the pointer.
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_session_id UUID NOT NULL REFERENCES exam_sessions (id),
  storage_key TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'video/webm',
  size_bytes  BIGINT,
  status      recording_status NOT NULL DEFAULT 'capturing',
  -- 'purged' and 'corrupt' are the honest unavailable states
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE session_summaries (
  -- At most one advisory summary per session, stored with its model version.
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_session_id UUID NOT NULL UNIQUE REFERENCES exam_sessions (id),
  summary_text   TEXT NOT NULL,
  model_version  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- governance
-- These two tables (and consents) are NEVER deletable through the viewer.

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES user_accounts (id),
  action      TEXT NOT NULL,              -- e.g. 'flag.dismiss', 'export.recording'
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  before      JSONB,                      -- review actions carry before/after
  after       JSONB,                      -- exports/deletes log actor, target,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),  -- action, timestamp
  institution_id UUID REFERENCES institutions (id)  -- admin/proctor actions
                                                    -- are tenant-scoped
);
CREATE INDEX ON audit_log (at);
CREATE INDEX ON audit_log (institution_id);

CREATE TABLE retention_log (
  id          BIGSERIAL PRIMARY KEY,
  job_run_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  rows_purged INTEGER NOT NULL DEFAULT 0,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMIT;
