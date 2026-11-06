"use client";

import type { EventFlag } from "@/lib/types";
import { formatClock } from "@/lib/format";
import { eventTypeLabel, SeverityBadge } from "@/components/severity";
import { cn } from "@/components/ui";

export function EventFeed({
  events,
  emptyText = "No flagged events yet",
  className,
}: {
  events: EventFlag[];
  emptyText?: string;
  className?: string;
}) {
  return (
    <div className={cn("thin-scroll max-h-72 space-y-1.5 overflow-y-auto", className)}>
      {events.length === 0 && (
        <p className="py-4 text-center text-xs text-slate-400">{emptyText}</p>
      )}
      {events.map((ev) => (
        <div
          key={ev.event_id}
          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-slate-800">{eventTypeLabel(ev.event_type)}</span>
            <SeverityBadge severity={ev.severity} />
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>
              {formatClock(ev.start_s)}–{formatClock(ev.end_s)} · {ev.duration_s.toFixed(1)} s
            </span>
            <span>{ev.detector === "yolo11n" ? "YOLO" : "Pose"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
