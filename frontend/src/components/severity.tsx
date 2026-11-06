import type { Severity } from "@/lib/types";
import { Badge } from "./ui";

// Severity always shows a text label alongside color — color alone never
// carries meaning.
export const SEVERITY_META: Record<
  Severity,
  { label: string; rank: number; badge: string; hex: string }
> = {
  low: { label: "Low", rank: 1, badge: "bg-green-50 text-green-800 border-green-200", hex: "#16a34a" },
  medium: { label: "Medium", rank: 2, badge: "bg-amber-50 text-amber-800 border-amber-200", hex: "#d97706" },
  high: { label: "High", rank: 3, badge: "bg-orange-50 text-orange-800 border-orange-200", hex: "#ea580c" },
  critical: { label: "Critical", rank: 4, badge: "bg-red-50 text-red-800 border-red-200", hex: "#dc2626" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const meta = SEVERITY_META[severity];
  return (
    <Badge className={meta.badge}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.hex }} aria-hidden />
      {meta.label}
    </Badge>
  );
}

export function eventTypeLabel(eventType: string): string {
  return eventType
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function detectorLabel(detector: string): string {
  return detector === "yolo11n" ? "YOLO11n (visual)" : "MediaPipe (pose)";
}

export function reviewStatusLabel(status?: string): string {
  switch (status) {
    case "acknowledged":
      return "Acknowledged";
    case "dismissed":
      return "Dismissed";
    case "escalated":
      return "Escalated";
    default:
      return "Pending review";
  }
}
