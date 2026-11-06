# UI Implementation — AIsmering Frontend

Frontend for **AIsmering — AI-Driven Online Proctoring & Anti-Cheat System** (SD3 capstone).
Lives in `frontend/` and integrates with the existing ML inference demo
(`machine learning/webcam_demo.py`) over WebSocket.

Generated: 2026-11-06.

## 1. Frontend architecture

- **Framework:** Next.js 15 (App Router), TypeScript strict, Tailwind CSS v4.
- **Client/server split:** every interactive page is a Client Component; the root
  layout is a server component (metadata) wrapping client providers.
- **Design system:** hand-rolled primitives in `src/components/ui.tsx`
  (Button, Card, Badge, Tabs, Modal, Toast, Pagination, banners, form fields) +
  design tokens in `src/app/globals.css` (`@theme`: navy, brand blue,
  severity colors low/medium/high/critical). Severity is always shown with a
  text label, never color alone.
- **Charts:** dependency-free SVG (`src/components/charts.tsx`) — bar chart +
  sparkline, no charting library.
- **Data layer:** `src/lib/services.ts` is the typed boundary between UI and
  future backend (AuthService, ExamService, SessionService, EventService,
  ReviewService, RecordingService, ReportService, AdminService). Today they
  read deterministic fixtures (`src/lib/fixtures.ts`) or report themselves
  unavailable; swapping in real API calls changes no UI code.
- **Auth:** `src/lib/auth.tsx` — demo-only auth (localStorage session, role
  gating is UI convenience only). The app shell renders a persistent demo
  banner so nobody mistakes it for real authorization.

### Deviations from the preferred stack (deliberate)

- shadcn/ui, Radix, TanStack Query, React Hook Form, Zod, Zustand, Recharts
  were **not** added. The same visual result and validation behavior is
  achieved with one hand-rolled primitives file and strict manual validation —
  a fraction of the dependencies. `lucide-react` is the only UI dependency.
- ESLint, Vitest, and the Next build are the validation toolchain.

## 2. Routes and implemented screens

| Route | Module | Notes |
|---|---|---|
| `/login` | A — Authentication | Role tabs (Student/Proctor/Admin), show/hide password, validation, forgot-password (honest unavailable), SSO disabled with reason, appeals reviewer entry point |
| `/register` | A — Registration | Student/Proctor toggle, consent checkbox (required for students), proctor approval notice, demo-memory creation (labeled) |
| `/student` | B — Student dashboard | Upcoming/available/completed exams, lifecycle-appropriate actions, monitoring requirements, consent status |
| `/student/check-in` | C — Pre-exam check-in | 8-step wizard: overview → consent → camera (real permission) → microphone (real permission, released after check) → positioning → **calibration (real ML server state)** → readiness |
| `/student/exam` | D — Exam interface | Distraction-minimized: question area (labeled dev preview), navigation, session-local countdown, submit confirmation, live monitoring sidebar with camera overlay, calibration, real event feed, non-punitive notices derived from real ML state |
| `/proctor` | E — Proctor dashboard | Stat cards, severity distribution, activity sparkline, sortable/filterable/searchable session table with pagination, advisory risk pills, ML-service health probe (real WS probe) |
| `/proctor/sessions/[id]` | F — Session detail & review | Timeline, severity breakdown, EventsFlags table, inspect drawer, review actions (disabled + reason), AI summary panel (unavailable), recording panel (unavailable) |
| `/admin/exams` | I — Examination management | List, create (demo memory), lifecycle transitions (demo memory), read-only policy templates mirroring policy.yaml |
| `/admin/users` | J — Users & institutions | Directory with search/filter/pagination, institutions, pending proctor approvals (disabled), CSV roster import (parse + preview; import disabled) |
| `/admin/reports` | K — Reports | Report types, date/exam filters, labeled fixture charts, exports disabled with reason |
| `/admin/db` | M — Database viewer | Table selector, search, pagination, read-only rows; deletion **permanently disabled** with the SDD §5.8 safeguard rules displayed |
| `/appeals` | L — Appeals review | Case list + detail, event history, reviewer notes, AI summary unavailable state, explicit no-automated-adjudication notice |

**Deferred feature (per SDD §5.9):** proctor live camera view is **not
implemented** — the SDD marks it as a future enhancement, out of the core build.

## 3. Component structure

```
frontend/src/
├── app/            # routes (above) + layout.tsx (server shell)
├── components/
│   ├── ui.tsx              # primitives + toast provider
│   ├── severity.tsx        # severity meta, badges, labels
│   ├── charts.tsx          # SVG BarChart / Sparkline
│   ├── app-shell.tsx       # sidebar nav, role badge, ML service probe
│   ├── root-providers.tsx  # auth + toast providers
│   └── monitoring/
│       ├── use-monitoring.ts   # WS lifecycle, camera capture, backpressure
│       ├── camera-preview.tsx  # mirrored video + box/gaze overlay
│       ├── calibration-panel.tsx
│       └── event-feed.tsx
└── lib/
    ├── types.ts    # domain types (EventsFlags contract preserved 1:1)
    ├── events.ts   # event catalog mirroring policy.yaml (pose_v2)
    ├── parse-ws.ts # runtime validation + mirror transforms
    ├── config.ts   # all env access
    ├── format.ts
    ├── fixtures.ts # deterministic demo data
    ├── services.ts # typed backend boundaries
    └── auth.tsx    # demo auth context
tests/               # vitest unit tests (pure logic)
```

## 4. ML WebSocket integration

Verified against `machine learning/webcam_demo.py` **source** (read 2026-10-31):

- **Contract:** client sends binary JPEG frames (~15 fps); server replies
  `{ boxes, gaze, ms, state, seconds_remaining, events }`. On a bad frame the
  server **omits `gaze`** — the parser defaults it to null.
- **`state`** is `"calibrating"` then `"live"` (~10 s baseline from
  `policy.yaml`); `seconds_remaining` is authoritative server state — the UI
  never simulates calibration.
- **`events`** arrive as full EventsFlags rows (`event_id`, `session_id`,
  `event_type`, `severity`, `start_s/end_s/duration_s`, `peak_*_dev`,
  `detector`, `policy_ref`) — field names preserved in `src/lib/types.ts`.
- **Backpressure preserved:** the next frame is sent only after the previous
  frame's results arrive (same strategy as the reference `webcam.html`).
- **Runtime validation:** `src/lib/parse-ws.ts` filters malformed boxes/events
  and never trusts payloads.
- **Overlay geometry:** video is selfie-mirrored; boxes are mirrored
  (`x' = W − x`) so they align with the flipped video — this *fixes* the known
  quirk of the reference demo, which drew boxes unmirrored. Gaze ray uses the
  same transform as `webcam.html`. Gaze is labeled as relative direction, not
  screen-accurate eye tracking.
- **Lifecycle:** camera tracks and socket are released on unmount/session end;
  reconnects with exponential backoff (1 s → 8 s).
- **Health probe:** the app shell opens/closes a real WS to the ML URL to show
  Connected/Unavailable in the header (refreshable).

## 5. Environment variables (`.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_ML_WS_URL` | `ws://127.0.0.1:8000/ws` | ML inference demo server |
| `NEXT_PUBLIC_API_BASE_URL` | `http://127.0.0.1:8000/api` | Future backend (not implemented) |
| `NEXT_PUBLIC_DEMO_MODE` | `true` | Demo fixtures + demo auth; set `false` for production honesty |

## 6. Local development

```powershell
# 1. ML inference server (separate terminal, repo root)
cd "machine learning"
python webcam_demo.py            # needs torch + ultralytics + mediapipe on system Python

# 2. Frontend
cd frontend
npm install
npm run dev                      # http://localhost:3000
```

Sign in with a demo account (Student: `maria.santos@westbridge.edu`, Proctor:
`e.cruz@westbridge.edu`, Admin: `d.bacusmo@aism.edu`, Appeals:
`p.mendoza@appeals.aism.edu` — any password).

## 7. Implemented vs unavailable

**Implemented & real:** login/registration UI, all 13 module screens, camera +
microphone permission flows, live calibration + detection display driven by the
actual ML server, event feed, camera overlay, reconnect handling, resource
cleanup, sorting/filtering/pagination, forms with validation, responsive
layouts, demo fixtures.

**Unavailable (honest states shown, nothing fabricated):** authentication
backend (demo only), ingestion API/queue, stream processor + risk scoring
(scores shown are labeled fixtures), review actions (buttons disabled with the
reason), AI summarization (panel shows unavailable state + traceability
requirements), recordings/export (unavailable + export disabled), report
generation, CSV import, proctor approvals, database deletion (disabled with the
SDD §5.8 safeguard rules on screen), SSO, live proctor view (deferred by design).

## 8. Known limitations

- Exam content is a labeled development preview — no LMS exists (question
  authoring is out of scope per SRS).
- The exam countdown is session-local; authoritative timing requires the backend.
- Demo fixtures are deterministic and in-memory; mutations (create exam,
  register, lifecycle moves) reset on reload and always say so.
- `policy.yaml` is displayed read-only; it is never modified from the UI.
- The `webcam_demo.py` server binds `127.0.0.1:8000` — one demo session at a
  time, no auth, no persistence beyond `events/live_*.jsonl`.

## 9. Pending backend dependencies

Ingestion API + queue; Stream Processor (fusion, RiskScores); relational DB;
object storage + presigned URLs; LLM summarizer with traceability validation;
review API + AuditLog; reporting service; SSO/IdP. Each maps onto the typed
service stubs in `src/lib/services.ts`.

## 10. Tests executed and results (2026-11-06)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ pass |
| `npx eslint .` | ✅ pass (0 errors, 0 warnings) |
| `npx vitest run` | ✅ 2 files, 13 tests passed |
| `npx next build` | ✅ 15 routes built |

Unit tests cover: WS message parsing against the real server contract
(including the missing-`gaze` bad-frame case and EventsFlags field
preservation), mirrored box/gaze transforms (verified against `webcam.html`
math), gaze direction labels, clock/duration formatting, severity ranking.

Live end-to-end smoke test (2026-11-06): installed the missing
`ultralytics` + `mediapipe` into system Python, started
`machine learning/webcam_demo.py` (loads `train-4/best.pt` + FaceLandmarker),
and ran `node tests/ws-smoke.mjs ws://127.0.0.1:8000/ws` twice:

- **SMOKE PASS** — reply `{state:"calibrating", seconds_remaining:10, boxes:0,
  gaze:null, ms:2777.9, events:0}` on the first frame (includes the ~1.7 s
  CUDA warmup) and `ms:134.3` on the second (steady state).
- Confirms the exact reply shape the frontend parser expects, including the
  null gaze for a faceless frame. The smoke script lives at
  `tests/ws-smoke.mjs` (needs `tests/frame.jpg`).

## 11. Future integration recommendations

1. Stand up the ingestion API first, then the Stream Processor — both consume
   the EventsFlags shape this UI already uses.
2. Move `policy.yaml` values into a `/api/policy` endpoint so the calibration
   bar doesn't rely on the hardcoded 10 s baseline constant.
3. Replace service fixtures with real fetches behind the same signatures.
4. Keep the live camera view deferred until bandwidth/load is measured (SDD 5.9).
