"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpDown, Eye, Filter, Search, ShieldCheck, Users } from "lucide-react";
import { useRequireRole } from "@/lib/auth";
import { examById, institutionById, sessions, userById } from "@/lib/fixtures";
import { apiConnected, LiveApi, useLiveData } from "@/lib/live-api";
import type { ExamSession } from "@/lib/types";
import { formatTimeOfDay } from "@/lib/format";
import { SEVERITY_META, SeverityBadge } from "@/components/severity";
import { BarChart, Sparkline } from "@/components/charts";
import { Badge, Banner, Button, Card, CardHeader, EmptyState, Input, Pagination, Select, StatCard, cn } from "@/components/ui";

const PAGE_SIZE = 8;

export default function ProctorDashboard() {
  const user = useRequireRole(["proctor"]);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [sortKey, setSortKey] = useState<"risk" | "flags" | "last_event">("risk");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(1);

  const live = apiConnected();
  const liveSessions = useLiveData(LiveApi.proctorSessions, live);

  const rows = useMemo(() => {
    if (live) {
      return (liveSessions.data ?? []).map((s) => ({
        s: {
          session_id: s.session_id,
          exam_id: s.exam_id,
          student_id: s.student_id,
          status: s.status,
          start_time: s.start_time,
          end_time: s.end_time,
          risk_score: s.risk_score,
          last_event_at: s.last_event_at,
          recording_available: false,
          monitoring_state: "active" as const,
        },
        student: { full_name: s.student_name, institution_id: s.institution_id } as ReturnType<typeof userById>,
        exam: { title: s.exam_title } as ReturnType<typeof examById>,
        flags: s.flag_count,
        highest: (s.highest_severity as string | null) ?? "low",
      }));
    }
    let r = sessions.map((s) => {
      const student = userById(s.student_id);
      const exam = examById(s.exam_id);
      const flags = 3 + (s.session_id.length % 4); // deterministic demo flag count
      return { s, student, exam, flags, highest: s.session_id.endsWith("1001") ? "critical" : "medium" };
    });
    if (query) {
      const q = query.toLowerCase();
      r = r.filter(
        (x) =>
          x.student?.full_name.toLowerCase().includes(q) ||
          x.exam?.title.toLowerCase().includes(q) ||
          x.s.session_id.toLowerCase().includes(q)
      );
    }
    if (severity !== "all") r = r.filter((x) => x.highest === severity);
    if (status !== "all") r = r.filter((x) => x.s.status === status);
    r.sort((a, b) => {
      const av = sortKey === "risk" ? (a.s.risk_score ?? -1) : sortKey === "flags" ? a.flags : +(a.s.last_event_at ?? "0");
      const bv = sortKey === "risk" ? (b.s.risk_score ?? -1) : sortKey === "flags" ? b.flags : +(b.s.last_event_at ?? "0");
      return (av - bv) * sortDir;
    });
    return r;
  }, [query, severity, status, sortKey, sortDir, live, liveSessions.data]);

  if (!user) return null;

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const sourceSessions = live
    ? (liveSessions.data ?? []).map((s) => ({
        status: s.status,
        flag_count: s.flag_count,
        highest_severity: s.highest_severity,
        risk_score: s.risk_score,
      }))
    : sessions.map((s) => ({
        status: s.status,
        flag_count: 3 + (s.session_id.length % 4),
        highest_severity: s.session_id.endsWith("1001") ? "critical" : "medium",
        risk_score: s.risk_score,
      }));
  const active = sourceSessions.filter((s) => s.status === "active").length;
  const needReview = sourceSessions.filter((s) => s.flag_count > 0).length;
  const severityCounts = (["low", "medium", "high", "critical"] as const).map((sev) => ({
    label: SEVERITY_META[sev].label,
    value: sourceSessions.filter((s) => s.highest_severity === sev).length,
    color: SEVERITY_META[sev].hex,
  }));

  const toggleSort = (k: "risk" | "flags" | "last_event") => {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(-1);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Proctor Monitoring</h1>
        <p className="text-sm text-slate-500">
          {user.full_name} · {institutionById(user.institution_id)?.name}
        </p>
      </div>

      {live ? (
        <Banner tone="success">
          <strong>Backend connected.</strong> Sessions, flags, and advisory risk scores below come
          from the live API — risk scores are advisory indicators only, never findings.
        </Banner>
      ) : (
        <Banner tone="demo">
          <strong>Demo fixtures.</strong> Session records and risk scores below are labeled
          development fixtures — the backend is not connected. The ML service status in the header
          reflects the real inference server.
        </Banner>
      )}

      {live && liveSessions.error && (
        <Banner tone="danger">
          <strong>Backend unavailable:</strong> {liveSessions.error}. Start the API or set{" "}
          <code>NEXT_PUBLIC_API_ENABLED=false</code>.
        </Banner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active sessions" value={active} sub={live ? "Live API" : "Demo fixture count"} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Requiring review" value={needReview} sub="Sessions with flagged events" icon={<Eye className="h-5 w-5" />} />
        <StatCard
          label="Highest severity now"
          value={<span className="flex items-center gap-2 text-base"><SeverityBadge severity={sourceSessions.some((s) => s.highest_severity === "critical") ? "critical" : sourceSessions.some((s) => s.highest_severity === "high") ? "high" : sourceSessions.some((s) => s.highest_severity === "medium") ? "medium" : "low"} /> {sourceSessions.filter((s) => s.highest_severity !== null).length}</span>}
          sub={live ? "Live API" : "Demo fixture"}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatCard label="ML service" value="Probe" sub="See header status — connects to webcam_demo.py" icon={<ShieldCheck className="h-5 w-5" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={live ? "Sessions by highest severity" : "Flags by severity (today)"}
            subtitle={live ? "Live API — real session data" : "Demo fixtures — labeled"}
          />
          <div className="px-5 py-4">
            <BarChart items={severityCounts} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Session activity" subtitle={live ? "Time-series endpoint not implemented" : "Flagged events per 10-min bucket (demo)"} />
          <div className="px-5 py-4">
            {live ? (
              <p className="py-6 text-center text-xs text-slate-400">
                Activity history requires the stream processor&apos;s time-series endpoint —
                shown honestly, not invented.
              </p>
            ) : (
              <>
                <Sparkline points={[0, 2, 1, 4, 2, 5, 3, 6, 4, 3, 5, 2]} />
                <p className="mt-2 text-[11px] text-slate-400">Based on demo fixtures.</p>
              </>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Session monitoring"
          subtitle={live ? `${rows.length} sessions (live API)` : `${rows.length} sessions (demo fixtures)`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Student, exam, session…"
                  className="w-52 pl-8"
                  aria-label="Search sessions"
                />
              </div>
              <Select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }} className="w-36" aria-label="Filter by highest severity">
                <option value="all">All severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-36" aria-label="Filter by session status">
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="scheduled">Scheduled</option>
              </Select>
              <Filter className="h-4 w-4 text-slate-400" />
            </div>
          }
        />
        {pageRows.length === 0 ? (
          <EmptyState icon={<Search className="h-10 w-10" />} title="No sessions match" body="Adjust the search or filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-semibold">Student</th>
                  <th className="px-3 py-2.5 font-semibold">Exam</th>
                  <th className="px-3 py-2.5 font-semibold">Institution</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">
                    <button onClick={() => toggleSort("risk")} className="inline-flex items-center gap-1 hover:text-slate-600">
                      Advisory risk <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-semibold">
                    <button onClick={() => toggleSort("flags")} className="inline-flex items-center gap-1 hover:text-slate-600">
                      Flags <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-semibold">Highest</th>
                  <th className="px-3 py-2.5 font-semibold">
                    <button onClick={() => toggleSort("last_event")} className="inline-flex items-center gap-1 hover:text-slate-600">
                      Last event <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-semibold">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pageRows.map(({ s, student, exam, flags, highest }) => (
                  <tr key={s.session_id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800">{student?.full_name ?? s.student_id}</p>
                      <p className="text-[10px] text-slate-400">{s.session_id}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{exam?.title ?? s.exam_id}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {institutionById(student?.institution_id ?? "")?.code ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      <SessionStatusBadge status={s.status} />
                    </td>
                    <td className="px-3 py-3">
                      {s.risk_score === null ? (
                        <span className="text-slate-400" title="Risk-scoring service not connected">—</span>
                      ) : (
                        <RiskPill score={s.risk_score} />
                      )}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-slate-700">{flags}</td>
                    <td className="px-3 py-3">
                      <SeverityBadge severity={highest as "medium" | "critical"} />
                    </td>
                    <td className="px-3 py-3 text-slate-500">
                      {s.last_event_at ? formatTimeOfDay(s.last_event_at) : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/proctor/sessions/${s.session_id}`}>
                        <Button size="sm" variant="secondary">Review</Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} onChange={setPage} />
      </Card>
    </div>
  );
}

function SessionStatusBadge({ status }: { status: ExamSession["status"] }) {
  const map = {
    active: { tone: "success" as const, label: "Active", dot: "bg-green-500" },
    completed: { tone: "neutral" as const, label: "Completed", dot: "bg-slate-400" },
    scheduled: { tone: "brand" as const, label: "Scheduled", dot: "bg-brand-500" },
  }[status];
  return (
    <Badge tone={map.tone}>
      <span className={cn("h-1.5 w-1.5 rounded-full", map.dot)} aria-hidden />
      {map.label}
    </Badge>
  );
}

function RiskPill({ score }: { score: number }) {
  const tone = score >= 60 ? "bg-red-50 text-red-800 border-red-200" : score >= 30 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-green-50 text-green-800 border-green-200";
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums", tone)} title="Advisory score — reviewed by a human proctor, never a finding">
      {score}
    </span>
  );
}
