"use client";

// Session detail & event review (SDD §5.6). All review actions, the AI
// summary, and recordings REQUIRE backend services — the UI shows exactly
// that, honestly, instead of pretending writes succeeded.

import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Download,
  Flag,
  MessageSquarePlus,
  Scale,
  Sparkles,
  Video,
} from "lucide-react";
import { useRequireRole } from "@/lib/auth";
import { EventService, SessionService } from "@/lib/services";
import { examById, institutionById, userById } from "@/lib/fixtures";
import { apiConnected, LiveApi, useLiveData } from "@/lib/live-api";
import { config } from "@/lib/config";
import type { ApiEvent } from "@/lib/api";
import { SEVERITY_META, SeverityBadge, detectorLabel, eventTypeLabel, reviewStatusLabel } from "@/components/severity";
import type { EventFlag, Severity } from "@/lib/types";
import { formatClock, formatDateTime, formatDuration } from "@/lib/format";
import { Badge, Banner, Button, Card, CardHeader, Modal, Select, Textarea, useToast } from "@/components/ui";

function apiEventToFlag(e: ApiEvent): EventFlag {
  return {
    event_id: e.event_id,
    session_id: e.session_id,
    event_type: e.event_type as EventFlag["event_type"],
    severity: e.severity as Severity,
    start_s: e.start_s,
    end_s: e.end_s,
    duration_s: e.duration_s,
    peak_yaw_dev: e.peak_yaw_dev ?? undefined,
    peak_gaze_dev: e.peak_gaze_dev ?? undefined,
    detector: (e.detector as "pose_mediapipe" | "yolo11n") || "pose_mediapipe",
    policy_ref: e.policy_ref,
    review_status: (e.review_status as EventFlag["review_status"]) ?? "pending",
    reviewer_note: e.reviewer_note ?? undefined,
    severity_override: (e.severity_override as Severity | null) ?? undefined,
  };
}

export default function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SessionReview sessionId={id} />;
}

function SessionReview({ sessionId }: { sessionId: string }) {
  const user = useRequireRole(["proctor"]);
  const toast = useToast();
  const live = apiConnected();
  const liveSession = useLiveData(() => LiveApi.session(sessionId), live);
  const liveEvents = useLiveData(() => LiveApi.sessionEvents(sessionId), live);
  const fixtureSession = SessionService.get(sessionId);
  const fixtureEvents = EventService.forSession(sessionId);
  const session = live ? (liveSession.data ? { ...fixtureSession, session_id: liveSession.data.session_id, exam_id: liveSession.data.exam_id, student_id: liveSession.data.student_id, status: liveSession.data.status, start_time: liveSession.data.start_time, end_time: liveSession.data.end_time, risk_score: liveSession.data.risk_score, last_event_at: liveSession.data.last_event_at, recording_available: false, monitoring_state: "active" as const } : fixtureSession) : fixtureSession;
  const events = live ? (liveEvents.data ?? []).map(apiEventToFlag) : fixtureEvents;
  const [selected, setSelected] = useState<EventFlag | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideSeverity, setOverrideSeverity] = useState<Severity>("medium");
  const [noteText, setNoteText] = useState("");

  if (!user) return null;
  if (!session) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <Link href="/proctor" className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to monitoring
        </Link>
        <Banner tone="warning">
          {live ? "Session not found in the backend." : "Session not found in demo fixtures."}
        </Banner>
      </div>
    );
  }

  const student = userById(session.student_id);
  const exam = examById(session.exam_id);
  const bySeverity = SEVERITY_META && (Object.keys(SEVERITY_META) as Severity[])
    .map((s) => ({ s, count: events.filter((e) => e.severity === s).length }))
    .filter((x) => x.count > 0);

  const reviewUnavailable = (feature: string) =>
    toast.push("warning", `${feature} requires the backend review API — nothing was sent or persisted.`);

  const doReview = (eventId: string, action: string, note?: string, severity?: Severity) => {
    if (!live) {
      reviewUnavailable(action);
      return;
    }
    LiveApi.reviewEvent(eventId, action, note, severity)
      .then(() => {
        toast.push("success", `${action} recorded — audit-logged by the backend.`);
        liveEvents.reload();
        setSelected(null);
      })
      .catch((e) => toast.push("danger", e instanceof Error ? e.message : "Review failed"));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/proctor" className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to monitoring
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">
            {student?.full_name ?? session.student_id} — {exam?.title ?? session.exam_id}
          </h1>
          <p className="text-xs text-slate-500">
            {institutionById(student?.institution_id ?? "")?.name} · Session{" "}
            <code className="rounded bg-slate-100 px-1">{session.session_id}</code> ·{" "}
            {session.start_time ? `Started ${formatDateTime(session.start_time)}` : "Not started"}
          </p>
        </div>
        <Badge tone={session.status === "active" ? "success" : "neutral"}>
          {session.status === "active" ? "Active session" : "Completed session"}
        </Badge>
      </div>

      {live ? (
        <Banner tone="success">
          <strong>Backend connected.</strong> Events and review actions are real, server-enforced,
          and audit-logged. Risk scores are advisory. The AI summary and recording export remain
          unavailable until those services are configured.
        </Banner>
      ) : (
        <Banner tone="demo">
          <strong>Demo session.</strong> Events below are labeled fixtures. Review actions, the AI
          summary, and recording export require the backend — the buttons show their real
          unavailable state and nothing is persisted.
        </Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Advisory risk score</p>
          <p className="mt-1.5 text-3xl font-semibold tabular-nums text-slate-900">
            {session.risk_score ?? "—"}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            {session.risk_score === null
              ? "Risk-scoring service not connected."
              : "Demo fixture. Advisory indicator — a human proctor decides; never a finding."}
          </p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Severity breakdown</p>
          <ul className="mt-2 space-y-1.5">
            {bySeverity.length === 0 && <li className="text-xs text-slate-400">No events</li>}
            {bySeverity.map(({ s, count }) => (
              <li key={s} className="flex items-center justify-between text-xs text-slate-700">
                <SeverityBadge severity={s} />
                <span className="tabular-nums font-medium">{count} event{count === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Timeline</p>
          <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
            {events.map((e) => (
              <div
                key={e.event_id}
                title={`${eventTypeLabel(e.event_type)} at ${formatClock(e.start_s)}`}
                className="h-full"
                style={{ width: `${Math.max(4, (e.duration_s / 3600) * 100)}%`, background: SEVERITY_META[e.severity].hex }}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Each segment is a flagged event (fixtures).</p>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Flagged events"
          subtitle={`${events.length} events (demo fixtures) · every row is an EventsFlags record`}
          action={
            <Button
              size="sm"
              variant="secondary"
              disabled={!live}
              title={live ? "Dismisses all low-severity events of this session" : "Bulk review requires the backend review API"}
              onClick={() => {
                const eligible = events
                  .filter((ev) => (ev.severity_override ?? ev.severity) === "low")
                  .map((ev) => ev.event_id);
                if (eligible.length === 0) {
                  toast.push("info", "No low-severity events eligible for bulk review.");
                  return;
                }
                LiveApi.bulkReview(sessionId, eligible)
                  .then(() => {
                    toast.push("success", `Dismissed ${eligible.length} low-severity events — audit-logged.`);
                    liveEvents.reload();
                  })
                  .catch((err) => toast.push("danger", err instanceof Error ? err.message : "Bulk review failed"));
              }}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Bulk review low-severity
            </Button>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-5 py-2.5 font-semibold">Event</th>
                <th className="px-3 py-2.5 font-semibold">Severity</th>
                <th className="px-3 py-2.5 font-semibold">Window</th>
                <th className="px-3 py-2.5 font-semibold">Duration</th>
                <th className="px-3 py-2.5 font-semibold">Detector</th>
                <th className="px-3 py-2.5 font-semibold">Peak deviation</th>
                <th className="px-3 py-2.5 font-semibold">Review</th>
                <th className="px-3 py-2.5 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {events.map((ev) => (
                <tr key={ev.event_id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{eventTypeLabel(ev.event_type)}</p>
                    <p className="text-[10px] text-slate-400">{ev.event_id}</p>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <SeverityBadge severity={ev.severity_override ?? ev.severity} />
                      {ev.severity_override && (
                        <span className="text-[10px] text-slate-400">
                          original: {ev.severity} (retained for audit)
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-slate-600">
                    {formatClock(ev.start_s)}–{formatClock(ev.end_s)}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-slate-600">{ev.duration_s.toFixed(1)} s</td>
                  <td className="px-3 py-3 text-slate-600">{detectorLabel(ev.detector)}</td>
                  <td className="px-3 py-3 tabular-nums text-slate-600">
                    {ev.peak_yaw_dev != null && `yaw ${ev.peak_yaw_dev.toFixed(1)}°`}
                    {ev.peak_gaze_dev != null && `gaze ${ev.peak_gaze_dev.toFixed(2)}`}
                    {ev.peak_yaw_dev == null && ev.peak_gaze_dev == null && "—"}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{reviewStatusLabel(ev.review_status)}</td>
                  <td className="px-3 py-3">
                    <Button size="sm" variant="ghost" onClick={() => setSelected(ev)}>Inspect</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {selected && (
        <Card className="border-brand-200">
          <CardHeader
            title={`${eventTypeLabel(selected.event_type)} — ${formatClock(selected.start_s)}`}
            subtitle={`${selected.detector} · policy ${selected.policy_ref} · session ${selected.session_id}`}
            action={<Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>}
          />
          <div className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <SeverityBadge severity={selected.severity} />
              <span>{formatDuration(selected.duration_s)}</span>
              {selected.peak_yaw_dev != null && <span>Peak yaw {selected.peak_yaw_dev.toFixed(1)}°</span>}
              {selected.peak_gaze_dev != null && <span>Peak gaze {selected.peak_gaze_dev.toFixed(2)}</span>}
            </div>
            {selected.reviewer_note && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <strong>Reviewer note:</strong> {selected.reviewer_note}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!live} title={live ? "Server-enforced + audit-logged" : "Requires the backend review API"} onClick={() => doReview(selected.event_id, "acknowledge")}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Acknowledge
              </Button>
              <Button size="sm" variant="secondary" disabled={!live} title={live ? "Server-enforced + audit-logged" : "Requires the backend review API"} onClick={() => doReview(selected.event_id, "dismiss")}>
                <Ban className="h-3.5 w-3.5" /> Dismiss
              </Button>
              <Button size="sm" variant="secondary" disabled={!live} title={live ? "Server-enforced + audit-logged" : "Requires the backend review API"} onClick={() => doReview(selected.event_id, "escalate")}>
                <Scale className="h-3.5 w-3.5" /> Escalate
              </Button>
              <Button size="sm" variant="secondary" disabled={!live} title={live ? "Server-enforced + audit-logged" : "Requires the backend review API"} onClick={() => setNoteOpen(true)}>
                <MessageSquarePlus className="h-3.5 w-3.5" /> Add note
              </Button>
              <Button size="sm" variant="secondary" disabled={!live} title={live ? "Server-enforced + audit-logged" : "Requires the backend review API"} onClick={() => setOverrideOpen(true)}>
                <Flag className="h-3.5 w-3.5" /> Override severity
              </Button>
            </div>
            <p className="text-[11px] text-slate-400">
              All review actions write to AuditLog and retain the original severity — enforced by
              the backend review API (SDD §5.6){live ? " (connected)." : " — not available in demo mode."}
            </p>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Advisory AI summary — distinct panel, honestly unavailable */}
        <Card className="border-violet-200">
          <CardHeader
            title={
              <span className="flex items-center gap-1.5 text-violet-800">
                <Sparkles className="h-4 w-4" /> AI session summary
              </span>
            }
            subtitle="AI-generated · advisory only"
          />
          <div className="px-5 py-4">
            <Banner tone="demo">
              <strong>Summarization service unavailable.</strong> The LLM summarizer is not
              implemented in this repository. When available, it will read only structured
              EventsFlags rows (never raw media or biometric features), produce a chronological,
              timestamped narrative, and every statement will be validated against an event row
              before storage (SRS 3.1.5). No summary is fabricated here.
            </Banner>
          </div>
        </Card>

        {/* Recording panel */}
        <Card>
          <CardHeader title={<span className="flex items-center gap-1.5"><Video className="h-4 w-4 text-slate-500" /> Session recording</span>} subtitle="Completed-session playback & export" />
          <div className="px-5 py-4">
            {live ? (
              <LiveRecordingsPanel sessionId={sessionId} />
            ) : (
              <>
                <Banner tone="info">
                  <strong>Recording unavailable.</strong> Recordings stream to encrypted object
                  storage through a backend that is not implemented here. Playback, timeline
                  markers, and export (presigned URL + audit log) will appear once connected. No
                  recording is fabricated.
                </Banner>
                <Button size="sm" className="mt-3" disabled title="Requires object storage + backend authorization">
                  <Download className="h-3.5 w-3.5" /> Export recording
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>

      <Modal
        open={noteOpen}
        title="Add reviewer note"
        onClose={() => setNoteOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button disabled={!live} onClick={() => { if (selected) doReview(selected.event_id, "note", noteText); setNoteOpen(false); }}>
              Save note
            </Button>
          </>
        }
      >
        {live ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">The note is attached to the event and audit-logged.</p>
            <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Context for later review or appeal…" />
          </div>
        ) : (
          <p>Reviewer notes require the backend review API and are audit-logged — not available.</p>
        )}
      </Modal>
      <Modal
        open={overrideOpen}
        title="Override severity"
        onClose={() => setOverrideOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOverrideOpen(false)}>Cancel</Button>
            <Button
              disabled={!live}
              onClick={() => { if (selected) doReview(selected.event_id, "override", undefined, overrideSeverity); setOverrideOpen(false); }}
            >
              Apply override
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            The backend retains <strong>both</strong> the original and overridden severity for
            audit (SDD §5.6).
          </p>
          {live ? (
            <Select value={overrideSeverity} onChange={(e) => setOverrideSeverity(e.target.value as Severity)}>
              {(["low", "medium", "high", "critical"] as Severity[]).map((s) => (
                <option key={s} value={s}>{SEVERITY_META[s].label}</option>
              ))}
            </Select>
          ) : (
            <p>This operation requires the backend — not available in demo mode.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}

function LiveRecordingsPanel({ sessionId }: { sessionId: string }) {
  const toast = useToast();
  const recs = useLiveData(() => LiveApi.recordings(sessionId), true);
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  if (recs.loading) return <p className="text-xs text-slate-500">Loading recordings…</p>;
  if (recs.error) return <Banner tone="danger">Recording service error: {recs.error}</Banner>;
  const list = recs.data ?? [];
  if (list.length === 0) {
    return (
      <Banner tone="info">
        <strong>No recordings captured for this session.</strong> Client-side recording capture is
        not implemented yet — nothing is fabricated here.
      </Banner>
    );
  }
  return (
    <div className="space-y-3">
      {list.map((r) => (
        <div key={r.recording_id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-slate-800">{r.recording_id}.{r.format}</p>
              <p className="text-[11px] text-slate-400">
                {r.size_bytes} bytes · {r.available ? "available" : "unavailable"} ·{" "}
                {r.dev_local ? "dev-local storage (plaintext — not production)" : "object storage"}
              </p>
            </div>
            <Button
              size="sm"
              disabled={!r.available}
              title={r.available ? "Generates a short-lived signed URL (audit-logged)" : "Recording unavailable"}
              onClick={() =>
                LiveApi.exportRecording(r.recording_id)
                  .then((res) => {
                    setExportUrl(`${config.apiBaseUrl}${res.url}`);
                    toast.push("success", "Export link issued (~5 min validity, audit-logged).");
                  })
                  .catch((e) => toast.push("danger", e instanceof Error ? e.message : "Export refused"))
              }
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </div>
          {exportUrl && (
            <p className="mt-2 break-all text-[11px] text-brand-700">
              <a href={exportUrl} target="_blank" rel="noreferrer">Open signed download link</a>{" "}
              (short-lived, scoped to this recording)
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
