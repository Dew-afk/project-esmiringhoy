"use client";

// Reporting center (SRS 3.1.10). Visualizations use deterministic fixtures,
// labeled as such. Exports require the backend (presigned/PDF/CSV generation)
// and are honestly disabled.

import { useState } from "react";
import { Download, FileBarChart, FileText, Scale, ShieldCheck, Users } from "lucide-react";
import { useRequireRole } from "@/lib/auth";
import { ReportService } from "@/lib/services";
import { examById, exams } from "@/lib/fixtures";
import { SEVERITY_META } from "@/components/severity";
import { EVENT_CATALOG } from "@/lib/events";
import { eventTypeLabel } from "@/components/severity";
import { BarChart } from "@/components/charts";
import { Banner, Button, Card, CardHeader, Field, Input, Select, useToast } from "@/components/ui";

const REPORT_TYPES = [
  { id: "integrity", title: "Session integrity report", desc: "Flagged events, final advisory risk score, and AI summary for one session (PDF/CSV).", icon: <FileText className="h-4 w-4" /> },
  { id: "cohort", title: "Class / cohort analytics", desc: "Flag rates and risk-score distribution across an exam roster.", icon: <Users className="h-4 w-4" /> },
  { id: "appeals", title: "Appeals package export", desc: "Recording reference, event log, AI summary, and reviewer notes bundled for formal appeals.", icon: <Scale className="h-4 w-4" /> },
  { id: "audit", title: "Audit / compliance report", desc: "Access logs and retention actions for FERPA/GDPR compliance review.", icon: <ShieldCheck className="h-4 w-4" /> },
] as const;

export default function ReportsPage() {
  const user = useRequireRole(["admin"]);
  const toast = useToast();
  const [examId, setExamId] = useState("all");
  const [from, setFrom] = useState("2026-10-01");
  const [to, setTo] = useState("2026-10-31");

  if (!user) return null;

  const exportReport = (type: string) => {
    const res = ReportService.generate(type);
    if (!res.ok) toast.push("warning", res.reason);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Reports &amp; analytics</h1>
        <p className="text-sm text-slate-500">Integrity reports, cohort analytics, appeals packages, audit trails</p>
      </div>

      <Banner tone="demo">
        <strong>Demo fixtures.</strong> Charts use labeled fixture data. Report generation and
        PDF/CSV export require the backend reporting service — export buttons show their real
        unavailable state and nothing is downloaded.
      </Banner>

      <Card className="px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Examination">
            <Select value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="all">All examinations</option>
              {exams.map((e) => (
                <option key={e.exam_id} value={e.exam_id}>{e.title}</option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <p className="text-xs text-slate-400">
              {examId === "all" ? "All" : examById(examId)?.title} · {from} → {to}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Flag distribution" subtitle="By severity (demo fixtures)" />
          <div className="px-5 py-4">
            <BarChart
              items={(["low", "medium", "high", "critical"] as const).map((s) => ({
                label: SEVERITY_META[s].label,
                value: { low: 4, medium: 7, high: 2, critical: 1 }[s],
                color: SEVERITY_META[s].hex,
              }))}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Advisory risk-score distribution" subtitle="Demo fixtures — live scoring requires the stream processor" />
          <div className="px-5 py-4">
            <BarChart
              items={[
                { label: "0–29", value: 5, color: "#16a34a" },
                { label: "30–59", value: 3, color: "#d97706" },
                { label: "60–89", value: 1, color: "#ea580c" },
                { label: "90+", value: 0, color: "#dc2626" },
              ]}
            />
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Event-type breakdown" subtitle="Per detection source (demo fixtures)" />
          <div className="px-5 py-4">
            <BarChart
              items={Object.entries(EVENT_CATALOG).map(([type, meta]) => ({
                label: eventTypeLabel(type),
                value: meta.status === "live" ? { gaze_deviation: 5, head_pose_deviation: 3, unauthorized_object: 2, second_person: 1 }[type as "gaze_deviation" | "head_pose_deviation" | "unauthorized_object" | "second_person"] ?? 1 : 0,
                color: meta.status === "live" ? SEVERITY_META[meta.severity].hex : "#cbd5e1",
              }))}
            />
            <p className="mt-2 text-[11px] text-slate-400">
              Gray bars: detector not yet implemented (audio, browser, network) — shown honestly,
              not as data.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {REPORT_TYPES.map((r) => (
          <Card key={r.id} className="flex items-start justify-between gap-3 px-5 py-4">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <FileBarChart className="h-4 w-4 text-brand-600" /> {r.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{r.desc}</p>
            </div>
            <Button size="sm" disabled title="Requires the backend reporting service" onClick={() => exportReport(r.id)}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
