"use client";

// Pre-exam check-in: guided 8-step flow (SDD §6.1 student flow).
// Consent gates camera access; device checks use real permissions; the
// calibration step runs the REAL ML pipeline (webcam_demo.py `/ws`) and
// never simulates success.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ClipboardList,
  Mic,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useRequireRole } from "@/lib/auth";
import { config } from "@/lib/config";
import { ExamService } from "@/lib/services";
import { institutionById } from "@/lib/fixtures";
import { apiConnected, LiveApi, useLiveData } from "@/lib/live-api";
import type { ApiExam } from "@/lib/api";
import type { Exam } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { Badge, Banner, Button, Card, cn, useToast } from "@/components/ui";
import { CameraPreview } from "@/components/monitoring/camera-preview";
import { CalibrationPanel } from "@/components/monitoring/calibration-panel";
import { useMonitoring } from "@/components/monitoring/use-monitoring";

function apiExamToExam(a: ApiExam): Exam {
  return {
    exam_id: a.exam_id,
    title: a.title,
    course_code: a.course_code,
    institution_id: a.institution_id,
    window_start: a.window_start,
    window_end: a.window_end,
    duration_min: a.duration_min,
    allowed_materials: a.allowed_materials,
    policy_template_id: a.policy_template_id,
    status: a.status as Exam["status"],
    roster_ids: [],
    accommodations: [],
  };
}

const STEPS = [
  "Overview",
  "Consent",
  "Camera",
  "Microphone",
  "Positioning",
  "Calibration",
  "Readiness",
] as const;

type DeviceCheck = "untested" | "granted" | "denied";

export default function CheckInPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading check-in…</div>}>
      <CheckInFlow />
    </Suspense>
  );
}

function CheckInFlow() {
  const user = useRequireRole(["student"]);
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();

  const live = apiConnected();
  const liveExams = useLiveData(LiveApi.myExams, live);
  const fixtureExams = ExamService.list();
  const exam =
    (live
      ? (liveExams.data ?? []).map(apiExamToExam).find((e) => e.exam_id === params.get("exam"))
      : fixtureExams.find((e) => e.exam_id === params.get("exam"))) ??
    (live
      ? (liveExams.data ?? []).map(apiExamToExam).find((e) => e.status === "in_progress" || e.status === "scheduled")
      : fixtureExams.find((e) => e.status === "in_progress" || e.status === "scheduled")) ??
    null;

  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(user?.consent_status === "granted");
  const [camera, setCamera] = useState<DeviceCheck>("untested");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [mic, setMic] = useState<DeviceCheck>("untested");
  const [micError, setMicError] = useState<string | null>(null);
  const [deviceStream, setDeviceStream] = useState<MediaStream | null>(null);
  const [cameraLabel, setCameraLabel] = useState<string>("");
  const [calibrated, setCalibrated] = useState(false);

  const monitor = useMonitoring(config.mlWsUrl);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // Release the consent-gated stream when leaving the page.
  useEffect(() => {
    return () => {
      deviceStream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (previewVideoRef.current && deviceStream) {
      previewVideoRef.current.srcObject = deviceStream;
    }
  }, [deviceStream, step]);

  const requestCamera = async () => {
    setCamera("untested");
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setDeviceStream(stream);
      const track = stream.getVideoTracks()[0];
      const label = track.label || "Camera device";
      setCameraLabel(label);
      setCamera("granted");
    } catch (err) {
      setCamera("denied");
      setCameraError(
        err instanceof Error
          ? err.message
          : "Camera permission denied or no camera found."
      );
    }
  };

  const requestMic = async () => {
    setMic("untested");
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop()); // verified only — released immediately
      setMic("granted");
    } catch (err) {
      setMic("denied");
      setMicError(
        err instanceof Error ? err.message : "Microphone permission denied or no microphone found."
      );
    }
  };

  const canProceed = useMemo(() => {
    switch (step) {
      case 1:
        return consent;
      case 2:
        return camera === "granted";
      case 3:
        return mic === "granted";
      case 5:
        return calibrated || monitor.phase === "live";
      default:
        return true;
    }
  }, [step, consent, camera, mic, calibrated, monitor.phase]);

  const enterExam = () => {
    if (!calibrated && monitor.phase !== "live") return;
    monitor.stop();
    if (apiConnected() && exam) {
      LiveApi.createSession(exam.exam_id)
        .then((s) => {
          toast.push("success", "Exam session created by the backend (idempotent resume).");
          router.push(`/student/exam?exam=${exam.exam_id}&session=${s.session_id}`);
        })
        .catch((e) => {
          toast.push("danger", e instanceof Error ? e.message : "Could not create the session");
          setStep(6);
        });
      return;
    }
    toast.push("info", "Entering the examination — a fresh monitoring session will start.");
    router.push(`/student/exam?exam=${exam?.exam_id ?? ""}`);
  };

  if (!user || !exam) {
    return (
      <div className="mx-auto max-w-3xl">
        <Banner tone="warning">
          No examination is available for check-in right now. Scheduled exams appear on your
          dashboard when their window opens.
        </Banner>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Stepper */}
      <ol className="mb-6 flex flex-wrap items-center gap-x-1 gap-y-2 text-xs" aria-label="Check-in steps">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-1">
            <button
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium",
                i === step
                  ? "border-brand-600 bg-brand-600 text-white"
                  : i < step
                    ? "border-green-200 bg-green-50 text-green-800"
                    : "border-slate-200 bg-white text-slate-400"
              )}
            >
              <span className="tabular-nums">{i + 1}</span> {label}
            </button>
            {i < STEPS.length - 1 && <span className="text-slate-300">›</span>}
          </li>
        ))}
      </ol>

      <Card>
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-slate-900">{STEPS[step]}</h1>
            <Badge tone="brand">{exam.course_code}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {exam.title} · {institutionById(exam.institution_id)?.name}
          </p>
        </div>

        <div className="px-5 py-5">
          {step === 0 && (
            <div className="space-y-4">
              <dl className="grid gap-3 text-xs sm:grid-cols-2">
                <Detail label="Scheduled window" value={`${formatDateTime(exam.window_start)} — ${formatDateTime(exam.window_end)}`} />
                <Detail label="Duration" value={`${exam.duration_min} minutes`} />
                <Detail label="Allowed materials" value={exam.allowed_materials.join(", ") || "None"} />
                <Detail label="Proctoring policy" value="Standard Monitoring (policy.yaml · pose_v2)" />
              </dl>
              <Banner tone="info">
                Monitoring covers your <strong>webcam</strong> (head pose and gaze —{" "}
                <em>relative</em> direction only), <strong>microphone</strong> (when the audio
                detector ships), and <strong>browser behavior</strong> (when the browser detector
                ships). All flags are advisory and reviewed by a human proctor.
              </Banner>
              <ul className="space-y-1.5 text-xs text-slate-600">
                <CheckItem>Quiet room, steady lighting, face clearly visible</CheckItem>
                <CheckItem>Camera and microphone permission must be granted</CheckItem>
                <CheckItem>No other person or phone in view of the camera</CheckItem>
                <CheckItem>Stay seated during the whole examination</CheckItem>
              </ul>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
                <p className="mb-2 font-semibold text-slate-900">Monitoring disclosure</p>
                <p>
                  During the exam, AIsmering captures your webcam video, microphone audio, and
                  browser activity. Head-pose and gaze analysis runs locally in the ML pipeline and
                  produces <strong>advisory events</strong> reviewed by human proctors. The system
                  never issues automated accusations. Recordings are encrypted and handled per
                  FERPA/GDPR retention rules, and you may revoke consent at any time.
                </p>
              </div>
              <label className="flex items-start gap-2.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                />
                <span>
                  I understand the monitoring disclosure and <strong>grant consent</strong> to
                  biometric monitoring for this examination.
                </span>
              </label>
              {!consent && (
                <Banner tone="warning">
                  Consent is required to continue. You can decline and contact your instructor.
                </Banner>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                Camera access is only requested now — <strong>after</strong> your consent above. A
                live preview appears in the next steps.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={requestCamera} disabled={camera === "granted"}>
                  <Camera className="h-4 w-4" /> {camera === "granted" ? "Camera granted" : "Request camera access"}
                </Button>
                {camera === "granted" && <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> {cameraLabel || "Camera available"}</Badge>}
                {camera === "denied" && (
                  <Badge tone="danger"><XCircle className="h-3 w-3" /> Camera unavailable</Badge>
                )}
              </div>
              {cameraError && (
                <Banner tone="danger">
                  <strong>Camera check failed:</strong> {cameraError}. Troubleshooting: allow camera
                  access in your browser for this site, close apps using the camera, and retry.
                </Banner>
              )}
              {camera === "granted" && (
                <video
                  ref={previewVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full max-w-sm rounded-lg border border-slate-200"
                  style={{ transform: "scaleX(-1)" }}
                />
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                We verify your microphone is present and permitted. Audio is released immediately
                after this check.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={requestMic} disabled={mic === "granted"}>
                  <Mic className="h-4 w-4" /> {mic === "granted" ? "Microphone granted" : "Request microphone access"}
                </Button>
                {mic === "granted" && <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> Microphone available</Badge>}
                {mic === "denied" && <Badge tone="danger"><XCircle className="h-3 w-3" /> Microphone unavailable</Badge>}
              </div>
              {micError && (
                <Banner tone="danger">
                  <strong>Microphone check failed:</strong> {micError}. Allow microphone access for
                  this site in your browser and retry.
                </Banner>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Position yourself so your face is centered, well lit, and fully visible. This is the
                view the ML service will analyze.
              </p>
              {camera === "granted" ? (
                <video
                  ref={previewVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="mx-auto w-full max-w-md rounded-lg border border-slate-200"
                  style={{ transform: "scaleX(-1)" }}
                />
              ) : (
                <Banner tone="warning">Camera access is required — go back to the Camera step.</Banner>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                Connecting to the ML monitoring service at{" "}
                <code className="rounded bg-slate-100 px-1">{config.mlWsUrl}</code>. Sit still and
                face the camera for the ~10 s baseline calibration —{" "}
                <strong>the server drives this state</strong>; nothing is simulated.
              </p>
              {camera === "granted" ? (
                <>
                  <CameraPreview
                    monitor={monitor}
                    stream={deviceStream ?? undefined}
                    onCalibrationComplete={() => setCalibrated(true)}
                  />
                  <CalibrationPanel phase={monitor.phase} secondsRemaining={monitor.secondsRemaining} />
                  {monitor.status === "error" && (
                    <Banner tone="danger">
                      <strong>Monitoring service unavailable:</strong> {monitor.error}. Start it with{" "}
                      <code className="rounded bg-red-100 px-1">python webcam_demo.py</code> inside{" "}
                      <code className="rounded bg-red-100 px-1">machine learning/</code>, then retry.
                      Calibration cannot be simulated — it requires the real ML service.
                    </Banner>
                  )}
                </>
              ) : (
                <Banner tone="warning">Camera access is required — go back to the Camera step.</Banner>
              )}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Readiness summary</h2>
              <ul className="space-y-2">
                <ReadinessRow ok={consent} label="Monitoring consent granted" />
                <ReadinessRow ok={camera === "granted"} label={camera === "granted" ? `Camera ready (${cameraLabel})` : "Camera check"} />
                <ReadinessRow ok={mic === "granted"} label="Microphone check" />
                <ReadinessRow ok={calibrated || monitor.phase === "live"} label="Baseline calibration (ML service)" />
              </ul>
              {!canProceed && (
                <Banner tone="warning">
                  Calibration is incomplete — go back to the Calibration step and wait until the ML
                  service reports <strong>Live</strong>.
                </Banner>
              )}
              {canProceed && (
                <Banner tone="success">
                  <strong>You are ready.</strong> The examination timer starts when you enter. The
                  monitoring session that starts there is a new one, logged by the ML service.
                </Banner>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canProceed}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={enterExam} disabled={!canProceed}>
              <Sparkles className="h-4 w-4" /> Enter examination
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
      {children}
    </li>
  );
}

function ReadinessRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm text-slate-700">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : (
        <XCircle className="h-4 w-4 text-slate-300" />
      )}
      {label}
    </li>
  );
}
