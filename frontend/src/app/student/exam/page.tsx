"use client";

// Distraction-minimized exam interface with the live monitoring sidebar.
// The camera pipeline here is the REAL ML service (webcam_demo.py `/ws`);
// exam content is a clearly labeled development preview (no LMS exists).

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Headset, MonitorX, Send, Timer } from "lucide-react";
import { useRequireRole } from "@/lib/auth";
import { config } from "@/lib/config";
import { ExamService } from "@/lib/services";
import { Badge, Banner, Button, Card, CardHeader, Modal, cn, useToast } from "@/components/ui";
import { CameraPreview } from "@/components/monitoring/camera-preview";
import { CalibrationPanel } from "@/components/monitoring/calibration-panel";
import { EventFeed } from "@/components/monitoring/event-feed";
import { useMonitoring } from "@/components/monitoring/use-monitoring";
import { formatClock } from "@/lib/format";

const PREVIEW_QUESTIONS = [
  { id: 1, text: "Development preview — real exam content requires LMS integration." },
  { id: 2, text: "This question area is a placeholder that the exam platform fills in." },
  { id: 3, text: "The monitoring sidebar on the right is fully live, however." },
  { id: 4, text: "No exam content, grading, or question authoring is part of this system." },
];

export default function ExamPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading exam…</div>}>
      <ExamInterface />
    </Suspense>
  );
}

function ExamInterface() {
  const user = useRequireRole(["student"]);
  const params = useSearchParams();
  const toast = useToast();
  const exam = ExamService.get(params.get("exam") ?? "") ?? ExamService.list().find((e) => e.status === "in_progress");

  const monitor = useMonitoring(config.mlWsUrl);
  const [current, setCurrent] = useState(0);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  // Session-local countdown — authoritative session timing requires the backend.
  const [secondsLeft, setSecondsLeft] = useState((exam?.duration_min ?? 90) * 60);

  useEffect(() => {
    if (finished) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [finished]);

  const submit = () => {
    setSubmitOpen(false);
    monitor.stop(); // release camera + socket cleanly at session end
    setFinished(true);
    toast.push(
      "info",
      "Exam submitted in demo mode. With the ML service connected, flagged events were persisted by the server to events/live_*.jsonl."
    );
  };

  // Non-punitive notice derived from REAL monitoring state.
  const faceNotice =
    monitor.phase === "live" && monitor.gaze === null && monitor.status === "live";

  if (!user) return null;

  if (finished) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Card className="px-6 py-10 text-center">
          <MonitorX className="mx-auto h-10 w-10 text-green-600" />
          <h1 className="mt-3 text-lg font-semibold text-slate-900">Session complete</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
            Your camera and monitoring connection have been released. Any flagged events were
            advisory and are queued for human proctor review — the system never issues automated
            accusations.
          </p>
          <p className="mt-3 text-xs text-slate-400">
            When the ML service was connected, events were written by the server to{" "}
            <code className="rounded bg-slate-100 px-1">machine learning/events/live_*.jsonl</code>.
          </p>
        </Card>
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="mx-auto max-w-xl">
        <Banner tone="warning">No active examination found for this session.</Banner>
      </div>
    );
  }

  const expired = secondsLeft <= 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      {/* Main examination area */}
      <div className="space-y-4">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h1 className="text-sm font-semibold text-slate-900">{exam.title}</h1>
              <p className="mt-0.5 text-xs text-slate-500">
                {user.full_name} · {user.roster_id}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={expired ? "danger" : "neutral"}>
                <Timer className="h-3 w-3" /> {formatClock(secondsLeft)} remaining
              </Badge>
              <Badge tone="warning">Session-local timer — authoritative timing requires backend</Badge>
            </div>
          </div>

          <div className="px-5 py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700">
                Question {current + 1} of {PREVIEW_QUESTIONS.length}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  toast.push("info", "Save requires the exam-content backend — nothing was saved.")
                }
              >
                <Send className="h-3.5 w-3.5" /> Save &amp; continue
              </Button>
            </div>
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center">
              <p className="text-sm font-medium text-slate-700">
                {PREVIEW_QUESTIONS[current].text}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Clearly identified development preview — not real exam content (SRS: question
                authoring is out of scope; content is supplied by the LMS).
              </p>
            </div>

            <div className="mt-5 flex flex-wrap gap-2" role="navigation" aria-label="Question navigation">
              {PREVIEW_QUESTIONS.map((q, i) => (
                <button
                  key={q.id}
                  onClick={() => setCurrent(i)}
                  aria-label={`Question ${i + 1}`}
                  aria-current={i === current ? "true" : undefined}
                  className={cn(
                    "h-9 w-9 rounded-lg border text-xs font-medium transition-colors",
                    i === current
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-brand-300"
                  )}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5">
            <Button variant="ghost" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}>
              Previous
            </Button>
            <Button variant="ghost" onClick={() => setCurrent((c) => Math.min(PREVIEW_QUESTIONS.length - 1, c + 1))} disabled={current === PREVIEW_QUESTIONS.length - 1}>
              Next
            </Button>
            <Button variant="danger" onClick={() => setSubmitOpen(true)}>
              Submit examination
            </Button>
          </div>
        </Card>

        <Banner tone="info">
          All monitoring results are <strong>advisory</strong> and reviewed by a human proctor. No
          automated cheating determination is ever made.
        </Banner>
      </div>

      {/* Monitoring sidebar */}
      <div className="space-y-3">
        <Card>
          <CardHeader
            title="Monitoring"
            subtitle={
              monitor.status === "live"
                ? "Live — ML service connected"
                : monitor.status === "calibrating"
                  ? "Calibrating baseline"
                  : monitor.status === "reconnecting"
                    ? "Reconnecting…"
                    : "Connecting…"
            }
          />
          <div className="space-y-3 px-4 py-4">
            <CameraPreview monitor={monitor} showStatusLine />
            {monitor.phase !== "live" && monitor.status !== "error" && (
              <CalibrationPanel phase={monitor.phase} secondsRemaining={monitor.secondsRemaining} />
            )}
            {monitor.status === "error" && (
              <Banner tone="danger">
                Monitoring service unavailable: {monitor.error}. Start{" "}
                <code className="rounded bg-red-100 px-1">python webcam_demo.py</code> in{" "}
                <code className="rounded bg-red-100 px-1">machine learning/</code>.
              </Banner>
            )}
          </div>
        </Card>

        {faceNotice && (
          <Banner tone="warning">
            <strong>Camera can&apos;t see your face clearly.</strong> This is a non-punitive notice
            — please reposition so your face is in view. (Based on the live ML service: no face
            detected in recent frames.)
          </Banner>
        )}
        {monitor.status === "reconnecting" && (
          <Banner tone="warning">
            <strong>Connection interrupted.</strong> Reconnecting automatically — monitoring will
            resume; the interruption itself is logged as a low-severity event by the pipeline.
          </Banner>
        )}

        <Card>
          <CardHeader title="Flagged events (this session)" subtitle="Advisory — produced by the live ML service" />
          <div className="px-4 py-3">
            <EventFeed events={monitor.events} />
          </div>
        </Card>

        <Button variant="secondary" className="w-full" onClick={() => setSupportOpen(true)}>
          <Headset className="h-4 w-4" /> Technical support
        </Button>
      </div>

      <Modal
        open={submitOpen}
        title="Submit examination?"
        onClose={() => setSubmitOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSubmitOpen(false)}>Keep working</Button>
            <Button variant="danger" onClick={submit}>Submit now</Button>
          </>
        }
      >
        <p>
          Submitting ends your session, releases the camera, and stops monitoring. This cannot be
          undone. {expired && <strong>Your timer has reached zero.</strong>}
        </p>
      </Modal>

      <Modal
        open={supportOpen}
        title="Technical support"
        onClose={() => setSupportOpen(false)}
        footer={<Button variant="secondary" onClick={() => setSupportOpen(false)}>Close</Button>}
      >
        <p>
          Support escalation requires the live-support backend, which is not implemented in this
          repository — <strong>your request was not sent</strong>. In the target system this action
          contacts a proctor without pausing your monitoring (SRS 3.1.8).
        </p>
      </Modal>
    </div>
  );
}
