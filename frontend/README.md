# AIsmering Frontend

Browser UI for the AI-Driven Online Proctoring & Anti-Cheat System —
student exam workflow with live ML monitoring, proctor review dashboard,
and administration modules. See [UI_IMPLEMENTATION.md](./UI_IMPLEMENTATION.md)
for the full picture.

## Run

From the repository root, run `.\run-project.ps1` in PowerShell to start the
frontend. The script installs dependencies with `npm ci` if they are missing.

```powershell
# 1. ML inference server (repo root, separate terminal)
cd "machine learning"
python webcam_demo.py              # http://127.0.0.1:8000

# 2. This app
npm install
npm run dev                        # http://localhost:3000
```

Demo sign-ins (any password): student `maria.santos@westbridge.edu`,
proctor `e.cruz@westbridge.edu`, admin `d.bacusmo@aism.edu`,
appeals `p.mendoza@appeals.aism.edu`.

## Validate

```powershell
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest
npm run build       # next build
```

## Environment

Copy `.env.example` to `.env.local` and adjust:
`NEXT_PUBLIC_ML_WS_URL` (ML demo server), `NEXT_PUBLIC_API_BASE_URL`
(future backend), `NEXT_PUBLIC_DEMO_MODE` (demo fixtures — keep `false` for
any production-like deployment).

## Guardrails (why some buttons stay disabled)

- Detections and risk scores are **advisory** — human proctors decide.
- Review actions, exports, imports, approvals, and deletion require backend
  services with audit logging that don't exist yet — the UI says so instead of
  faking success.
- `machine learning/policy.yaml` is the source of truth and is never modified
  from the UI.
- The proctor live camera view (SDD §5.9) is a deferred enhancement and is
  deliberately not implemented.
