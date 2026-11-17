import { fmtTime } from "@/lib/space";

/** Guests in the room over time. A plain SVG step chart using theme tokens. */
export function AttendanceChart({ series, peak }: { series: { t: number; n: number }[]; peak: number }) {
  const W = 600;
  const H = 140;
  const PAD = { l: 28, r: 8, t: 10, b: 22 };
  const t0 = series[0]?.t ?? 0;
  const t1 = series.at(-1)?.t ?? 1;
  const span = Math.max(1, t1 - t0);
  const top = Math.max(1, peak);
  const x = (t: number) => PAD.l + ((t - t0) / span) * (W - PAD.l - PAD.r);
  const y = (n: number) => PAD.t + (1 - n / top) * (H - PAD.t - PAD.b);

  // step path: hold each value until the next change
  let d = `M ${x(series[0]!.t)} ${y(series[0]!.n)}`;
  for (let i = 1; i < series.length; i++) d += ` H ${x(series[i]!.t)} V ${y(series[i]!.n)}`;
  const base = y(0);
  const area = `${d} V ${base} H ${x(series[0]!.t)} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`People in the room over time. The most at once was ${peak}.`} className="h-auto w-full" data-testid="attendance-chart">
      <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} className="stroke-border" />
      <line x1={PAD.l} x2={W - PAD.r} y1={y(top)} y2={y(top)} className="stroke-border" strokeDasharray="3 4" />
      <path d={area} className="fill-primary/10" />
      <path d={d} className="fill-none stroke-primary" strokeWidth={2} strokeLinejoin="round" />
      <text x={PAD.l - 6} y={y(top) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
        {peak}
      </text>
      <text x={PAD.l - 6} y={base + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
        0
      </text>
      <text x={PAD.l} y={H - 4} className="fill-muted-foreground text-[11px]">
        {fmtTime(t0)}
      </text>
      <text x={W - PAD.r} y={H - 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
        {fmtTime(t1)}
      </text>
    </svg>
  );
}
