"use client";

import Link from "next/link";
import { CalendarDays, Camera, Clock, GraduationCap, Mic, PlayCircle, ShieldCheck } from "lucide-react";
import { useRequireRole } from "@/lib/auth";
import { ExamService } from "@/lib/services";
import { institutionById } from "@/lib/fixtures";
import type { Exam } from "@/lib/types";
import { formatDate, formatTimeOfDay } from "@/lib/format";
import { Badge, Button, Card, CardHeader, EmptyState } from "@/components/ui";

const STATUS_BADGE: Record<Exam["status"], { tone: "neutral" | "brand" | "success" | "warning"; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  scheduled: { tone: "brand", label: "Scheduled" },
  in_progress: { tone: "warning", label: "In progress" },
  completed: { tone: "success", label: "Completed" },
  archived: { tone: "neutral", label: "Archived" },
};

export default function StudentDashboard() {
  const user = useRequireRole(["student"]);
  if (!user) return null;

  const all = ExamService.list().filter((e) => e.status !== "draft" && e.status !== "archived");
  const upcoming = all.filter((e) => e.status === "scheduled");
  const inProgress = all.filter((e) => e.status === "in_progress");
  const completed = all.filter((e) => e.status === "completed");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Welcome back, {user.full_name.split(" ")[0]}</h1>
          <p className="text-sm text-slate-500">
            {institutionById(user.institution_id)?.name} · Student {user.roster_id}
          </p>
        </div>
        <Badge tone={user.consent_status === "granted" ? "success" : "warning"}>
          <ShieldCheck className="h-3 w-3" />
          Monitoring consent: {user.consent_status === "granted" ? "Granted" : "Not granted"}
        </Badge>
      </div>

      {inProgress.length > 0 && (
        <Card>
          <CardHeader title="In progress" subtitle="Examinations with an active session" />
          <div className="divide-y divide-slate-100">
            {inProgress.map((exam) => (
              <ExamRow key={exam.exam_id} exam={exam} cta={
                <Link href={`/student/exam?exam=${exam.exam_id}`}>
                  <Button size="sm"><PlayCircle className="h-3.5 w-3.5" /> Continue exam</Button>
                </Link>
              } />
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Upcoming examinations" subtitle="Scheduled — you can start during the exam window" />
        {upcoming.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-10 w-10" />}
            title="No upcoming examinations"
            body="Scheduled exams assigned to your roster will appear here."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {upcoming.map((exam) => (
              <ExamRow key={exam.exam_id} exam={exam} cta={
                <Link href={`/student/check-in?exam=${exam.exam_id}`}>
                  <Button size="sm" variant="outline">Start check-in</Button>
                </Link>
              } />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Completed examinations" />
        {completed.length === 0 ? (
          <EmptyState
            icon={<GraduationCap className="h-10 w-10" />}
            title="Nothing completed yet"
            body="Completed sessions and their integrity results will appear here."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {completed.map((exam) => (
              <ExamRow key={exam.exam_id} exam={exam} cta={null} />
            ))}
          </div>
        )}
      </Card>

      <Card className="px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Monitoring requirements</h2>
        <ul className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
          <li className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-brand-600" /> Webcam with a clear view of your face
          </li>
          <li className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-brand-600" /> Working microphone (checked at check-in)
          </li>
          <li className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand-600" /> Uninterrupted session for the full exam duration
          </li>
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          All detections are advisory and reviewed by human proctors. The system never issues
          automated accusations. You can review or revoke monitoring consent in your profile settings.
        </p>
      </Card>
    </div>
  );
}

function ExamRow({ exam, cta }: { exam: Exam; cta: React.ReactNode }) {
  const badge = STATUS_BADGE[exam.status];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-slate-900">{exam.title}</p>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {institutionById(exam.institution_id)?.name} · {formatDate(exam.window_start)} ·{" "}
          {formatTimeOfDay(exam.window_start)}–{formatTimeOfDay(exam.window_end)} · {exam.duration_min} min
        </p>
        {exam.allowed_materials.length > 0 && (
          <p className="mt-0.5 text-[11px] text-slate-400">
            Allowed materials: {exam.allowed_materials.join(", ")}
          </p>
        )}
      </div>
      {cta}
    </div>
  );
}
