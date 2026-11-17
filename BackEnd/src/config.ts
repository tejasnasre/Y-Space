import { networkInterfaces } from "node:os";

export interface Config {
  port: number;
  databaseUrl: string;
  publicWebUrl: string;
  /** `true` = allow any origin */
  corsOrigins: string[] | true;
  trustProxy: boolean;
  maxSpeakers: number;
  maxParticipants: number;
  adminSessionTtlMs: number;
  reconnectGraceMs: number;
  /** Safety net for spaces the host forgot about. Each limit is in ms; 0 turns that rule off. */
  autoEnd: {
    /** hard cap on how long any space may stay live */
    maxMs: number;
    /** the host is not connected (never entered, closed the tab, lost network) */
    hostAbsentMs: number;
    /** the host is connected but nobody else is */
    emptyMs: number;
    /** how long before an automatic end people are warned (and the host can extend) */
    warnMs: number;
    /** how much time "keep it going" adds */
    extendMs: number;
  };
  /** "auto": use pgmq when the extension is installed; "memory": always keep the raise-hand line in memory */
  speakQueue: "auto" | "memory";
  scheduler: {
    /** how often Postgres (pg_cron) pokes the API, in seconds */
    tickSeconds: number;
    /** a scheduled space that is this far past its time is left for the host to start by hand */
    autoStartGraceMs: number;
  };
  rtc: {
    listenIp: string;
    announcedIp: string;
    port: number;
  };
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is required (e.g. postgres://user:pass@localhost:5432/yspace)`);
  return v;
}

function int(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got "${raw}"`);
  return n;
}

/** First non-internal IPv4 address; fine for LAN testing, set RTC_ANNOUNCED_IP in production. */
function detectLanIp(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return "127.0.0.1";
}

export function loadConfig(env: Env = process.env): Config {
  const publicWebUrl = (env.PUBLIC_WEB_URL || "http://localhost:5173").replace(/\/+$/, "");

  let corsOrigins: Config["corsOrigins"];
  if (env.CORS_ORIGINS?.trim() === "*") corsOrigins = true;
  else if (env.CORS_ORIGINS?.trim()) {
    corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  } else corsOrigins = true; // open to all origins by default

  return {
    port: int(env, "PORT", 3000),
    databaseUrl: required(env, "DATABASE_URL"),
    publicWebUrl,
    corsOrigins,
    trustProxy: env.TRUST_PROXY === "true",
    maxSpeakers: int(env, "MAX_SPEAKERS", 5),
    maxParticipants: int(env, "MAX_PARTICIPANTS", 100),
    adminSessionTtlMs: int(env, "ADMIN_SESSION_TTL_HOURS", 72) * 3_600_000,
    reconnectGraceMs: int(env, "RECONNECT_GRACE_SECONDS", 15) * 1000,
    autoEnd: {
      maxMs: int(env, "MAX_SPACE_HOURS", 8) * 3_600_000,
      hostAbsentMs: int(env, "HOST_ABSENT_MINUTES", 15) * 60_000,
      emptyMs: int(env, "EMPTY_ROOM_MINUTES", 30) * 60_000,
      warnMs: int(env, "AUTO_END_WARN_MINUTES", 5) * 60_000,
      extendMs: int(env, "EXTEND_MINUTES", 60) * 60_000,
    },
    speakQueue: env.SPEAK_QUEUE === "memory" ? "memory" : "auto",
    scheduler: {
      tickSeconds: int(env, "SCHEDULER_TICK_SECONDS", 10),
      autoStartGraceMs: int(env, "AUTO_START_GRACE_MINUTES", 30) * 60_000,
    },
    rtc: {
      listenIp: env.RTC_LISTEN_IP || "0.0.0.0",
      announcedIp: env.RTC_ANNOUNCED_IP || detectLanIp(),
      port: int(env, "RTC_PORT", 44444),
    },
  };
}
