// Tiny dependency-free SVG charts — enough for the reports and dashboard
// modules without pulling in a charting library.

export function BarChart({
  items,
  height = 160,
}: {
  items: { label: string; value: number; color: string }[];
  height?: number;
}) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-xs text-slate-400">No data in range</p>;
  }
  const max = Math.max(...items.map((i) => i.value), 1);
  const barW = 36;
  const width = Math.max(items.length * (barW + 24), 200);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={`Bar chart: ${items.map((i) => `${i.label} ${i.value}`).join(", ")}`}
    >
      {items.map((item, i) => {
        const x = 12 + i * (barW + 24);
        const h = (item.value / max) * (height - 48);
        const y = height - 28 - h;
        return (
          <g key={item.label}>
            <rect x={x} y={y} width={barW} height={h} rx={4} fill={item.color} opacity={0.85} />
            <text
              x={x + barW / 2}
              y={y - 6}
              textAnchor="middle"
              className="fill-slate-600"
              fontSize={11}
              fontWeight={600}
            >
              {item.value}
            </text>
            <text x={x + barW / 2} y={height - 10} textAnchor="middle" className="fill-slate-500" fontSize={10}>
              {item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Sparkline({
  points,
  color = "#2563eb",
  height = 44,
}: {
  points: number[];
  color?: string;
  height?: number;
}) {
  if (points.length < 2) {
    return <p className="py-4 text-center text-xs text-slate-400">No activity yet</p>;
  }
  const width = 240;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => [
    i * step,
    height - 6 - ((p - min) / span) * (height - 12),
  ]);
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Session activity over time"
    >
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}
