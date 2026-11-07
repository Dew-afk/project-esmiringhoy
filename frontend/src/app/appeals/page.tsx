"use client";

// Appeals review (SRS 3.1.10 — appeals package; role: Appeals Reviewer).
// Evidence review only — the system performs no adjudication and makes no
// guilt determination of any kind.

import { useState } from "react";
import { Scale, Sparkles } from "lucide-react";
import { useRequireRole } from "@/lib/auth";
import { appealsCases } from "@/lib/fixtures";
import { EventService, SessionService } from "@/lib/services";
import { apiConnected, LiveApi, useLiveData } from "@/lib/live-api";
import { eventTypeLabel, SeverityBadge } from "@/components/severity";
import { formatClock, formatDateTime } from "@/lib/format";
import { Badge, Banner, Card, CardHeader, EmptyState, cn } from "@/components/ui";

export default function AppealsPage() {
  const user = useRequireRole(["appeals", "admin"]);
  const live = apiConnected();
  const liveCases = useLiveData(LiveApi.appealsCases, live);
  const [selectedId, setSelectedId] = useState<string | null>(appealsCases[0]?.case_id ?? null);
  const selectedSessionId = live
    ? liveCases.data?.find((c) => c.case_id === selectedId)?.session_id ?? null
    : appealsCases.find((c) => c.case_id === selectedId)?.session_id ?? null;
  const liveEvents = useLiveData(
    () => (selectedSessionId ? LiveApi.sessionEvents(selectedSessionId) : Promise.resolve([])),
    live && !!selectedSessionId
  );
  const liveSession = useLiveData(
    () => (selectedSessionId ? LiveApi.session(selectedSessionId) : Promise.resolve(null)),
    live && !!selectedSessionId
  );

  if (!user) return null;
  const cases = live
    ? (liveCases.data ?? []).map((c) => ({
        case_id: c.case_id,
        session_id: c.session_id,
        student_name: c.student_name,
        exam_title: c.exam_title,
        opened_at: c.opened_at,
        status: c.status as "open" | "under_review" | "closed",
        notes: c.notes.map((text) => ({ author: "Proctor (escalation note)", text, at: c.opened_at })),
      }))
    : appealsCases;
  const selected = cases.find((c) => c.case_id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Appeals review</h1>
        <p className="text-sm text-slate-500">
          {user.full_name} · Cases assigned within your institution
        </p>
      </div>

      <Banner tone="info">
        Appeals review examines documented evidence and review outcomes.{" "}
        <strong>This system performs no automatic adjudication</strong> — no guilt or innocence
        determination is ever produced by the software (human-in-the-loop, SRS 3.6).
      </Banner>

      {live ? (
        <Banner tone="success">
          <strong>Backend connected.</strong> Cases come from real escalated events in your
          institution. No adjudication is performed by this system.
        </Banner>
      ) : (
        <Banner tone="demo">
          <strong>Demo fixtures.</strong> Cases, notes, and evidence references are labeled
          development fixtures; the backend appeals service is not connected.
        </Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {cases.map((c) => (
            <button
              key={c.case_id}
              onClick={() => setSelectedId(c.case_id)}
              aria-pressed={selectedId === c.case_id}
              className={cn(
                "w-full rounded-xl border bg-white p-3 text-left shadow-sm transition-colors",
                selectedId === c.case_id ? "border-brand-500 ring-2 ring-brand-100" : "border-slate-200 hover:border-brand-300"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800">{c.student_name}</p>
                <Badge tone={c.status === "under_review" ? "warning" : "neutral"}>
                  {c.status === "open" ? "Open" : "Under review"}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">{c.exam_title}</p>
              <p className="text-[10px] text-slate-400">{c.case_id} · opened {formatDateTime(c.opened_at)}</p>
            </button>
          ))}
          {cases.length === 0 && (
            <EmptyState icon={<Scale className="h-10 w-10" />} title="No cases assigned" />
          )}
        </div>

        {selected ? (
          <div className="space-y-4">
            <Card>
              <CardHeader title={`Case ${selected.case_id}`} subtitle={`${selected.student_name} · ${selected.exam_title}`} />
              <div className="space-y-3 px-5 py-4">
                {(() => {
                  const session = live ? liveSession.data : SessionService.get(selected.session_id);
                  const events = live
                    ? (liveEvents.data ?? []).map((e) => ({
                        event_id: e.event_id,
                        event_type: e.event_type,
                        severity: (e.severity_override ?? e.severity) as "low" | "medium" | "high" | "critical",
                        severity_override: undefined as "low" | "medium" | "high" | "critical" | undefined,
                        start_s: e.start_s,
                        end_s: e.end_s,
                        duration_s: e.duration_s,
                      }))
                    : EventService.forSession(selected.session_id);
                  return (
                    <>
                      {session && (
                        <p className="text-xs text-slate-600">
                          Session <code className="rounded bg-slate-100 px-1">{session.session_id}</code> ·{" "}
                          {session.start_time ? `started ${formatDateTime(String(session.start_time))}` : "timing unavailable"} ·{" "}
                          Advisory risk score: {session.risk_score ?? "not connected"}{live ? "" : " (demo fixture)"}
                        </p>
                      )}
                      <div>
                        <p className="mb-1.5 text-xs font-semibold text-slate-700">Event history ({events.length})</p>
                        <ul className="space-y-1.5">
                          {events.map((ev) => (
                            <li key={ev.event_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs">
                              <span className="font-medium text-slate-700">{eventTypeLabel(ev.event_type)}</span>
                              <span className="tabular-nums text-slate-400">
                                {formatClock(ev.start_s)}–{formatClock(ev.end_s)} · {ev.duration_s.toFixed(1)} s
                              </span>
                              <SeverityBadge severity={ev.severity_override ?? ev.severity} />
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="mb-1.5 text-xs font-semibold text-slate-700">Reviewer notes</p>
                        <ul className="space-y-1.5">
                          {selected.notes.map((n, i) => (
                            <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                              <strong>{n.author}</strong> · {formatDateTime(n.at)}
                              <p className="mt-0.5">{n.text}</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Recording reference: unavailable — object storage backend not implemented.
                      </p>
                    </>
                  );
                })()}
              </div>
            </Card>

            <Card className="border-violet-200">
              <CardHeader
                title={<span className="flex items-center gap-1.5 text-violet-800"><Sparkles className="h-4 w-4" /> AI advisory summary</span>}
                subtitle="AI-generated · advisory only"
              />
              <div className="px-5 py-4">
                <Banner tone="demo">
                  <strong>Summarization service unavailable.</strong> When implemented, the summary
                  reads only structured EventsFlags rows, and every statement is traceable to an
                  event row — it never constitutes a finding (SRS 3.1.5). Nothing is fabricated here.
                </Banner>
              </div>
            </Card>
          </div>
        ) : (
          <Card className="flex items-center justify-center">
            <p className="px-6 py-12 text-xs text-slate-400">Select a case to review.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
