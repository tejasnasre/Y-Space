import type { SpaceEvent, SpaceParticipant } from "@/lib/api";

export interface SpaceStats {
  /** most guests in the room at once */
  peak: number;
  /** when that happened */
  peakAt: number | null;
  /** average time a guest stayed */
  avgStayMs: number | null;
  /** share of guests (0 to 1) still there when the space ended. null while live or with no guests */
  stayedShare: number | null;
  handRaises: number;
  /** step series for a chart: guests in the room from `t` on */
  series: { t: number; n: number }[];
}

/**
 * Engagement numbers from who joined and left. Guests only (the host is always there). A guest counts as
 * present from `joinedAt` until `leftAt`, or until `end` if they never left. People who were removed count
 * until the moment they were.
 */
export function spaceStats(participants: SpaceParticipant[], events: SpaceEvent[], start: number, end: number, ended: boolean): SpaceStats {
  const guests = participants.filter((p) => !p.isHost);

  const points: { t: number; d: number }[] = [];
  for (const g of guests) {
    points.push({ t: g.joinedAt, d: 1 });
    points.push({ t: g.leftAt ?? end, d: -1 });
  }
  // at the same instant, count leaving before joining so a hand-off is not a spike
  points.sort((a, b) => a.t - b.t || a.d - b.d);

  let n = 0;
  let peak = 0;
  let peakAt: number | null = null;
  const series: { t: number; n: number }[] = [{ t: start, n: 0 }];
  for (const p of points) {
    n += p.d;
    series.push({ t: Math.max(start, p.t), n });
    if (n > peak) {
      peak = n;
      peakAt = p.t;
    }
  }
  series.push({ t: end, n: series.at(-1)!.n });

  // anyone still present at the end has leftAt === endedAt, so their time counts too
  const allStays = guests.map((g) => (g.leftAt ?? end) - g.joinedAt);
  const avgStayMs = allStays.length ? allStays.reduce((a, b) => a + b, 0) / allStays.length : null;

  const stillThere = guests.filter((g) => !g.kickedAt && g.leftAt !== null && g.leftAt >= end - 2000).length;
  const stayedShare = ended && guests.length ? stillThere / guests.length : null;

  return {
    peak,
    peakAt,
    avgStayMs,
    stayedShare,
    handRaises: events.filter((e) => e.type === "speak_requested").length,
    series,
  };
}
