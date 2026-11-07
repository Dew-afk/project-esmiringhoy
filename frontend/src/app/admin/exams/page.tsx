"use client";

// Examination management (SRS 3.1.7). Demo-memory mutations are clearly
// labeled; a real backend enforces the lifecycle state machine and the
// policy.yaml source of truth (this UI never touches policy.yaml).

import { useMemo, useState } from "react";
import { CalendarDays, Plus, ShieldCheck } from "lucide-react";
import { useRequireRole } from "@/lib/auth";
import { ExamService } from "@/lib/services";
import { institutionById, policyTemplates } from "@/lib/fixtures";
import { apiConnected, LiveApi, useLiveData } from "@/lib/live-api";
import type { ApiExam } from "@/lib/api";
import type { Exam, ExamStatus } from "@/lib/types";
import { formatDate, formatTimeOfDay } from "@/lib/format";
import { EVENT_CATALOG } from "@/lib/events";
import { eventTypeLabel, SeverityBadge } from "@/components/severity";
import { Badge, Banner, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";

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
    status: a.status as ExamStatus,
    roster_ids: [],
    accommodations: [],
  };
}

const STATUS_BADGE: Record<ExamStatus, { tone: "neutral" | "brand" | "warning" | "success"; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  scheduled: { tone: "brand", label: "Scheduled" },
  in_progress: { tone: "warning", label: "In Progress" },
  completed: { tone: "success", label: "Completed" },
  archived: { tone: "neutral", label: "Archived" },
};

const LIFECYCLE: Record<ExamStatus, ExamStatus[]> = {
  draft: ["scheduled", "archived"],
  scheduled: ["in_progress", "completed", "archived"],
  in_progress: ["completed"],
  completed: ["archived"],
  archived: [],
};

const EMPTY_FORM = {
  title: "",
  course_code: "",
  institution_id: "inst_westbridge",
  window_start: "",
  window_end: "",
  duration_min: 60,
  allowed_materials: "",
  policy_template_id: "pol_standard",
};

export default function ExamManagement() {
  const user = useRequireRole(["admin"]);
  const toast = useToast();
  const live = apiConnected();
  const liveExams = useLiveData(LiveApi.listExams, live);
  const livePolicies = useLiveData(LiveApi.policies, live);
  const [fixtureExams, setFixtureExams] = useState<Exam[]>(() => ExamService.list());
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const exams = live ? (liveExams.data ?? []).map(apiExamToExam) : fixtureExams;

  const set = (k: string, v: string | number) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const create = () => {
    const errs: Record<string, string> = {};
    if (form.title.trim().length < 3) errs.title = "Title is required.";
    if (!form.window_start || !form.window_end) errs.window_start = "Schedule the exam window.";
    if (form.window_end <= form.window_start) errs.window_end = "End must be after start.";
    if (form.duration_min <= 0) errs.duration_min = "Duration must be positive.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const body = {
      title: form.title.trim(),
      course_code: form.course_code.trim() || "NEW",
      institution_id: form.institution_id,
      window_start: new Date(form.window_start).toISOString(),
      window_end: new Date(form.window_end).toISOString(),
      duration_min: Number(form.duration_min),
      allowed_materials: form.allowed_materials.split(",").map((m) => m.trim()).filter(Boolean),
      policy_template_id: form.policy_template_id,
    };

    if (live) {
      LiveApi.createExam(body)
        .then(() => {
          toast.push("success", "Exam created — persisted by the backend.");
          liveExams.reload();
        })
        .catch((e) => toast.push("danger", e instanceof Error ? e.message : "Create failed"));
      setCreating(false);
      setForm(EMPTY_FORM);
      return;
    }

    const exam: Exam = { ...body, exam_id: `exm_demo_${Date.now()}`, status: "draft", roster_ids: [], accommodations: [] };
    ExamService.create(exam);
    setFixtureExams(ExamService.list());
    setCreating(false);
    setForm(EMPTY_FORM);
    toast.push("warning", "Demo memory only — the exam was added to this page's state, not persisted.");
  };

  const transition = (exam: Exam, next: ExamStatus) => {
    if (live) {
      LiveApi.transitionExam(exam.exam_id, next)
        .then(() => {
          toast.push("success", `Status → ${next} (server-enforced lifecycle).`);
          liveExams.reload();
        })
        .catch((e) => toast.push("danger", e instanceof Error ? e.message : "Transition refused"));
      return;
    }
    ExamService.transition(exam.exam_id, next);
    setFixtureExams(ExamService.list());
    toast.push("warning", `Demo memory only — status set to "${next}" locally; a real backend enforces the lifecycle and permissions.`);
  };

  const grouped = useMemo(() => {
    const g: Record<string, Exam[]> = {};
    for (const e of exams) (g[e.status] ??= []).push(e);
    return g;
  }, [exams]);

  if (!user) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Examination management</h1>
          <p className="text-sm text-slate-500">Create, configure, schedule, and advance exams through the lifecycle</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Create exam</Button>
      </div>

      {live ? (
        <Banner tone="success">
          <strong>Backend connected.</strong> The server enforces the Draft → Scheduled → In
          Progress → Completed → Archived state machine, roster rules, and audit logging.
        </Banner>
      ) : (
        <Banner tone="demo">
          <strong>Demo mode.</strong> Lifecycle changes below are local memory only — the real
          backend enforces the Draft → Scheduled → In Progress → Completed → Archived state
          machine, roster assignments, and audit logging.
        </Banner>
      )}

      {(Object.keys(grouped) as ExamStatus[]).map((status) =>
        grouped[status].map((exam) => (
          <Card key={exam.exam_id}>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">{exam.title}</p>
                  <Badge tone={STATUS_BADGE[exam.status].tone}>{STATUS_BADGE[exam.status].label}</Badge>
                  {exam.policy_template_id && (
                    <Badge tone="brand">
                      <ShieldCheck className="h-3 w-3" />
                      {policyTemplates.find((p) => p.policy_template_id === exam.policy_template_id)?.name ?? exam.policy_template_id}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {exam.course_code} · {institutionById(exam.institution_id)?.name} ·{" "}
                  {formatDate(exam.window_start)} {formatTimeOfDay(exam.window_start)}–
                  {formatTimeOfDay(exam.window_end)} · {exam.duration_min} min ·{" "}
                  {exam.roster_ids.length} student(s) assigned
                </p>
                {exam.allowed_materials.length > 0 && (
                  <p className="mt-0.5 text-[11px] text-slate-400">Allowed: {exam.allowed_materials.join(", ")}</p>
                )}
                {exam.accommodations.length > 0 && (
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Accommodations: {exam.accommodations.map((a) => a.detail).join("; ")}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {LIFECYCLE[exam.status].map((next) => (
                  <Button key={next} size="sm" variant="secondary" onClick={() => transition(exam, next)}>
                    Move to {STATUS_BADGE[next].label}
                  </Button>
                ))}
              </div>
            </div>
          </Card>
        ))
      )}

      {exams.length === 0 && (
        <EmptyState icon={<CalendarDays className="h-10 w-10" />} title="No examinations yet" body="Create one to get started." />
      )}

      <Card>
        <CardHeader title="Proctoring policy templates" subtitle="Read-only — machine learning/policy.yaml (pose_v2) is the source of truth; management requires a backend" />
        <div className="grid gap-3 px-5 py-4 md:grid-cols-3">
          {(live
            ? (livePolicies.data ?? []).map((p) => ({
                policy_template_id: p.policy_template_id,
                name: p.name,
                description: p.description,
                severity_map: p.severity_map as Record<string, never>,
              }))
            : policyTemplates
          ).map((p) => (
            <div key={p.policy_template_id} className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-800">{p.name}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{p.description}</p>
              <ul className="mt-2 space-y-1">
                {Object.entries(p.severity_map).map(([type, sev]) => (
                  <li key={type} className="flex items-center justify-between text-[11px] text-slate-600">
                    <span>{eventTypeLabel(type)}{EVENT_CATALOG[type as keyof typeof EVENT_CATALOG].status !== "live" && " (not implemented yet)"}</span>
                    <SeverityBadge severity={sev as "low" | "medium" | "high" | "critical"} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={creating}
        title="Create examination"
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={create}>Create draft</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title" required error={errors.title}>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. MATH 101 — Final Examination" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Course code">
              <Input value={form.course_code} onChange={(e) => set("course_code", e.target.value)} placeholder="MATH 101" />
            </Field>
            <Field label="Institution">
              <Select value={form.institution_id} onChange={(e) => set("institution_id", e.target.value)}>
                <option value="inst_westbridge">Westbridge State University</option>
                <option value="inst_northfield">Northfield Polytechnic College</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Window start" required error={errors.window_start}>
              <Input type="datetime-local" value={form.window_start} onChange={(e) => set("window_start", e.target.value)} />
            </Field>
            <Field label="Window end" required error={errors.window_end}>
              <Input type="datetime-local" value={form.window_end} onChange={(e) => set("window_end", e.target.value)} />
            </Field>
          </div>
          <Field label="Duration (minutes)" required error={errors.duration_min}>
            <Input type="number" min={1} value={form.duration_min} onChange={(e) => set("duration_min", Number(e.target.value))} />
          </Field>
          <Field label="Allowed materials" hint="Comma-separated list">
            <Textarea value={form.allowed_materials} onChange={(e) => set("allowed_materials", e.target.value)} placeholder="Scientific calculator, Formula sheet" />
          </Field>
          <Field label="Proctoring policy template">
            <Select value={form.policy_template_id} onChange={(e) => set("policy_template_id", e.target.value)}>
              {(live ? livePolicies.data ?? [] : policyTemplates).map((p) => (
                <option key={p.policy_template_id} value={p.policy_template_id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
