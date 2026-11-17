/** "27:14" under an hour, "1:05:09" after. For a running clock. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** "Under a minute", "27 min", "2 h 5 min". For a finished space. */
export function formatSpan(ms: number): string {
  const mins = Math.round(Math.max(0, ms) / 60_000);
  if (mins < 1) return "Under a minute";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const END_REASONS: Record<string, string> = {
  host_absent: "The host was away for too long, so the space ended automatically.",
  empty: "Nobody joined the host for a while, so the space ended automatically.",
  max_duration: "The space reached its maximum length and ended automatically.",
  cancelled: "The host cancelled this space.",
  server_restart: "The server restarted, so the space ended.",
  server_shutdown: "The server shut down, so the space ended.",
};

/** Plain-language reason a space ended, or null when the host simply ended it. */
export function endReasonText(reason: string | null | undefined): string | null {
  return reason ? (END_REASONS[reason] ?? null) : null;
}

/** Short form for tables. */
export function endReasonShort(reason: string | null | undefined): string | null {
  if (!reason || !END_REASONS[reason]) return null;
  return { host_absent: "Host was away", empty: "Nobody joined", max_duration: "Hit the time limit", cancelled: "Cancelled", server_restart: "Server restarted", server_shutdown: "Server shut down" }[reason] ?? null;
}

/** "AL" for "Ada Lovelace". */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const fmtDateTime = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

/** One line of the timeline, in plain language. */
export function describeEvent(type: string, name: string | null, data: unknown): string {
  const who = name ?? "Someone";
  switch (type) {
    case "space_created":
    case "space_started":
      return "Space started";
    case "space_scheduled":
      return "Space scheduled";
    case "space_cancelled":
      return "Space cancelled";
    case "space_extended":
      return "The host kept the space going";
    case "cohost_added":
      return `${who} became a co-host`;
    case "cohost_removed":
      return `${who} stopped being a co-host`;
    case "host_transferred":
      return `${who} took over as host`;
    case "host_returned":
      return `${who} handed hosting back`;
    case "space_ended": {
      const reason = (data as { reason?: string } | null)?.reason;
      return endReasonText(reason) ?? "Space ended";
    }
    case "joined":
      return `${who} joined`;
    case "left":
      return `${who} left`;
    case "speak_requested":
      return `${who} raised a hand`;
    case "speak_cancelled":
      return `${who} lowered their hand`;
    case "speak_denied":
      return `The host declined ${who}'s request to speak`;
    case "promoted":
      return `${who} joined the stage`;
    case "demoted":
      return `${who} was moved to listeners`;
    case "stepped_down":
      return `${who} stepped down from the stage`;
    case "kicked":
      return `${who} was removed`;
    default:
      return `${who}: ${type.replaceAll("_", " ")}`;
  }
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/** CSV text for a list of rows (first row = header). */
export const toCsv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n");

/** Save text as a file in the browser. */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Why a running space is about to end by itself, said to the person who can stop it. */
export function expiryText(reason: string, canExtend: boolean): string {
  switch (reason) {
    case "empty":
      return "Nobody has joined you for a while.";
    case "host_absent":
      return canExtend ? "Nobody is hosting." : "The host has stepped away.";
    case "max_duration":
      return "This space has reached its maximum length.";
    default:
      return "This space is about to end.";
  }
}

/** A calendar entry for a scheduled space: a Google Calendar link and an .ics file body. */
export function calendarLinks(opts: { title: string; start: number; description?: string | null; url: string; durationMs?: number }) {
  const end = opts.start + (opts.durationMs ?? 60 * 60_000);
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const details = [opts.description, `Join: ${opts.url}`].filter(Boolean).join("\n\n");
  const google = new URL("https://calendar.google.com/calendar/render");
  google.searchParams.set("action", "TEMPLATE");
  google.searchParams.set("text", opts.title);
  google.searchParams.set("dates", `${stamp(opts.start)}/${stamp(end)}`);
  google.searchParams.set("details", details);
  google.searchParams.set("location", opts.url);
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Y-Space//EN",
    "BEGIN:VEVENT",
    `UID:${stamp(opts.start)}-${encodeURIComponent(opts.title).slice(0, 20)}@y-space`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(opts.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(opts.title)}`,
    `DESCRIPTION:${esc(details)}`,
    `URL:${opts.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return { google: google.toString(), ics };
}

/** "in 3 days", "in 2 h 5 min", "starting now". */
export function untilText(ms: number): string {
  if (ms <= 0) return "starting now";
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
  const days = Math.floor(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}
