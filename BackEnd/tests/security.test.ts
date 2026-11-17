import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { io as connect, type Socket } from "socket.io-client";
import { loadConfig } from "../src/config";
import { adminSessions, admins, participants } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { sha256 } from "../src/lib/security";
import { createServer } from "../src/server";
import { createTestDatabase } from "./helpers/testdb";

/** Attacker's-eye tests. Every test here is a thing that must NOT work. */
let server: Awaited<ReturnType<typeof createServer>>;
let base = "";
let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
const sockets: Socket[] = [];
const PW = "correct-horse-battery";

const post = (p: string, body: unknown, token?: string, raw = false) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: raw ? (body as string) : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
const get = (p: string, token?: string) =>
  fetch(base + p, { headers: token ? { authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, text: await r.text() }));
const j = (t: string) => { try { return JSON.parse(t); } catch { return null; } };

const open = (spaceId: string, token: string): Promise<{ socket: Socket; state: any }> =>
  new Promise((resolve, reject) => {
    const socket = connect(base, { auth: { spaceId, token }, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    socket.once("space:state", (state) => resolve({ socket, state }));
    socket.once("connect_error", reject);
  });
const emit = (s: Socket, e: string, d?: unknown): Promise<any> => s.timeout(5000).emitWithAck(e, d);

let adminToken = "";
let space: any;
let guestToken = "";
let guest: { socket: Socket; state: any };

beforeAll(async () => {
  testDb = await createTestDatabase([{ username: "admin", password: PW }, { username: "other", password: PW }]);
  server = await createServer(
    loadConfig({ PORT: "0", DATABASE_URL: testDb.url, RTC_PORT: String(50700 + Math.floor(Math.random() * 1000)), RTC_ANNOUNCED_IP: "127.0.0.1" }),
  );
  base = `http://localhost:${server.port}`;

  adminToken = j((await post("/api/admin/login", { username: "admin", password: PW })).text).token;
  space = j((await post("/api/admin/spaces", { title: "Sec", secret: "s3cretvalue" }, adminToken)).text);
  const g = j((await post(`/api/spaces/${space.id}/join`, { name: "Eve", linkedinUrl: "linkedin.com/in/eve", secret: "s3cretvalue" })).text);
  guestToken = g.token;
  guest = await open(space.id, guestToken);
});

afterAll(async () => {
  for (const s of sockets) s.close();
  await server.stop();
  await testDb.drop();
});

describe("authentication & authorization", () => {
  test("admin API rejects missing, garbage, guest and expired tokens", async () => {
    for (const t of [undefined, "garbage", guestToken, "Bearer", ""]) {
      const r = await fetch(base + "/api/admin/me", { headers: t === undefined ? {} : { authorization: `Bearer ${t}` } });
      expect(r.status).toBe(401);
    }
    // expire the real session in the DB
    const db = server.repo.db;
    await db.update(adminSessions).set({ expiresAt: new Date(1) }).where(eq(adminSessions.tokenHash, sha256(adminToken)));
    expect((await fetch(base + "/api/admin/me", { headers: { authorization: `Bearer ${adminToken}` } })).status).toBe(401);
    // restore
    await db.update(adminSessions).set({ expiresAt: new Date(Date.now() + 3_600_000) }).where(eq(adminSessions.tokenHash, sha256(adminToken)));
    expect((await fetch(base + "/api/admin/me", { headers: { authorization: `Bearer ${adminToken}` } })).status).toBe(200);
  });

  test("logout really revokes the token", async () => {
    const t = j((await post("/api/admin/login", { username: "admin", password: PW })).text).token;
    expect((await post("/api/admin/logout", {}, t)).status).toBe(200);
    expect((await fetch(base + "/api/admin/me", { headers: { authorization: `Bearer ${t}` } })).status).toBe(401);
  });

  test("a different admin cannot end or re-key someone else's space, or host it", async () => {
    const other = j((await post("/api/admin/login", { username: "other", password: PW })).text).token;
    expect((await post(`/api/admin/spaces/${space.id}/end`, {}, other)).status).toBe(403);
    expect((await post(`/api/admin/spaces/${space.id}/secret`, {}, other)).status).toBe(403);
    await expect(open(space.id, other)).rejects.toThrow("unauthorized");
    expect((await server.repo.getSpace(space.id))?.status).toBe("live");
  });

  test("a different admin cannot read someone else's space, its secret, participants, or reports", async () => {
    const other = j((await post("/api/admin/login", { username: "other", password: PW })).text).token;

    // not in "current" (the admin's own live space) or the admin's own list
    expect(j((await get("/api/admin/spaces/current", other)).text).space).toBeNull();
    const listed = j((await get("/api/admin/spaces", other)).text).spaces as { id: string }[];
    expect(listed.some((s) => s.id === space.id)).toBe(false);

    // direct lookup: 404, not "forbidden" (no existence leak either), and no secret/participant/event dump
    expect((await get(`/api/admin/spaces/${space.id}`, other)).status).toBe(404);

    // a report filed in `space` is invisible to, and unresolvable by, the other admin
    const mallory = j((await post(`/api/spaces/${space.id}/join`, { name: "Mallory", linkedinUrl: "linkedin.com/in/mallory", secret: "s3cretvalue" })).text);
    const reportId = await server.repo.createReport({ spaceId: space.id, reporterId: guest.state.you.id, reportedId: mallory.participant.id, reason: "being weird" });
    const reports = j((await get("/api/admin/reports", other)).text).reports as { spaceId: string }[];
    expect(reports.every((r) => r.spaceId !== space.id)).toBe(true);
    expect((await post(`/api/admin/reports/${reportId}/dismiss`, {}, other)).status).toBe(404);
    expect((await post(`/api/admin/reports/${reportId}/block`, {}, other)).status).toBe(404);
    expect((await server.repo.getReport(reportId!))?.status).toBe("open"); // untouched
  });

  test("guest token can't host, and a token from another space is useless here", async () => {
    expect((await emit(guest.socket, "host:end")).error).toBe("forbidden");
    expect((await emit(guest.socket, "host:kick", { participantId: guest.state.you.id })).error).toBe("forbidden");
    expect((await server.repo.getSpace(space.id))?.status).toBe("live");
    await expect(open("nonexistent1", guestToken)).rejects.toThrow("space_not_found");
  });

  test("a listener can't produce or open a send transport", async () => {
    expect((await emit(guest.socket, "sfu:createTransport", { direction: "send" })).error).toBe("not_speaker");
    expect((await emit(guest.socket, "sfu:produce", { transportId: "x", rtpParameters: {} })).error).toBe("not_speaker");
  });
});

describe("input handling", () => {
  test("SQL injection strings are inert", async () => {
    const evil = "' OR 1=1; DROP TABLE spaces; --";
    expect((await post("/api/admin/login", { username: evil, password: evil })).status).toBe(401);
    expect((await post("/api/admin/login", { username: "admin' --", password: "x" })).status).toBe(401);
    const r = await post(`/api/spaces/${space.id}/join`, { name: evil, linkedinUrl: "linkedin.com/in/x", secret: evil });
    expect(r.status).toBe(403);
    expect((await fetch(`${base}/api/spaces/${encodeURIComponent(evil)}`)).status).toBe(404);
    expect(await server.repo.getSpace(space.id)).not.toBeNull(); // table still there
  });

  test("LinkedIn URL can't smuggle other hosts or schemes", async () => {
    const bad = [
      "javascript:alert(1)//linkedin.com/in/x",
      "https://linkedin.com.evil.com/in/x",
      "https://evil.com/linkedin.com/in/x",
      "https://linkedin.com@evil.com/in/x",
      "https://notlinkedin.com/in/x",
      "data:text/html,<script>alert(1)</script>",
      "https://linkedin.com/",
      "https://linkedin.com/feed",
      "ftp://linkedin.com/in/x",
    ];
    for (const linkedinUrl of bad) {
      const r = await post(`/api/spaces/${space.id}/join`, { name: "A", linkedinUrl, secret: "s3cretvalue" });
      expect({ linkedinUrl, status: r.status }).toEqual({ linkedinUrl, status: 400 });
    }
    // a good one is normalised: query/hash dropped, host canonical
    const ok = j((await post(`/api/spaces/${space.id}/join`, { name: "B", linkedinUrl: "http://in.linkedin.com/in/ok/?utm=1#frag", secret: "s3cretvalue" })).text);
    expect(ok.participant.linkedinUrl).toBe("https://www.linkedin.com/in/ok");
  });

  test("names are stripped of control chars and length-capped", async () => {
    const r = j((await post(`/api/spaces/${space.id}/join`, { name: "Ev\u0000il\u001b[31m\n\tName", linkedinUrl: "linkedin.com/in/n1", secret: "s3cretvalue" })).text);
    expect(r.participant.name).not.toMatch(/[\u0000-\u001f]/);
    expect((await post(`/api/spaces/${space.id}/join`, { name: "x".repeat(61), linkedinUrl: "linkedin.com/in/n2", secret: "s3cretvalue" })).status).toBe(400);
  });

  test("malformed JSON / wrong types give clean errors with no stack traces", async () => {
    for (const body of ['{"username":', "not json", "[]", "null", '{"username":123,"password":{}}']) {
      const r = await post("/api/admin/login", body, undefined, true);
      expect(r.status).toBeLessThan(500);
      expect(r.text).not.toMatch(/at .*\.ts|node_modules|\/Users\//);
    }
  });

  test("oversized request bodies are refused", async () => {
    const big = JSON.stringify({ username: "a", password: "x".repeat(5_000_000) });
    const r = await post("/api/admin/login", big, undefined, true).catch(() => ({ status: 0, text: "" }));
    expect([0, 413, 422]).toContain(r.status);
    expect(r.status).not.toBe(401); // must be refused before/without being processed as a login
  });

  test("hostile socket payloads never crash the server", async () => {
    const events = ["sfu:getRtpCapabilities", "sfu:createTransport", "sfu:connectTransport", "sfu:restartIce", "sfu:produce", "sfu:ready", "speak:request", "speak:cancel", "speak:leave", "mute:set", "host:promote", "host:demote", "host:deny", "host:mute", "host:kick", "host:end"];
    const payloads: unknown[] = [null, undefined, 0, "str", [], [[]], { __proto__: { x: 1 } }, { transportId: {} }, { participantId: ["a"] }, { direction: "send", rtpParameters: "no" }, { rtpCapabilities: { codecs: "x" } }, { muted: "yes" }, JSON.parse('{"__proto__":{"polluted":true}}')];
    for (const e of events) {
      for (const p of payloads) {
        const res = await emit(guest.socket, e, p).catch((err) => ({ ok: false, error: String(err) }));
        expect(res).toBeObject();
        expect(JSON.stringify(res)).not.toMatch(/\.ts|node_modules|\/Users\//);
      }
    }
    expect(({} as any).polluted).toBeUndefined();
    expect((await fetch(base + "/health")).status).toBe(200); // still alive
  });
});

describe("abuse resistance", () => {
  test("a socket flooding events gets throttled", async () => {
    const { socket } = await open(space.id, j((await post(`/api/spaces/${space.id}/join`, { name: "Flood", linkedinUrl: "linkedin.com/in/flood", secret: "s3cretvalue" })).text).token);
    const results = await Promise.all(Array.from({ length: 300 }, () => emit(socket, "speak:request").catch(() => ({ error: "timeout" }))));
    expect(results.some((r) => r.error === "rate_limited")).toBe(true);
  });

  test("wrong-secret brute force is locked out (and doesn't unlock with the right one)", async () => {
    let last = 0;
    for (let i = 0; i < 40; i++) {
      last = (await post(`/api/spaces/${space.id}/join`, { name: "bf", linkedinUrl: "linkedin.com/in/bf", secret: `guess${i}` })).status;
    }
    expect(last).toBe(429);
    expect((await post(`/api/spaces/${space.id}/join`, { name: "bf", linkedinUrl: "linkedin.com/in/bf", secret: "s3cretvalue" })).status).toBe(429);
  });

  test("login brute force is locked out", async () => {
    let last = 0;
    for (let i = 0; i < 20; i++) last = (await post("/api/admin/login", { username: "admin", password: `wrong-password-${i}` })).status;
    expect(last).toBe(429);
    expect((await post("/api/admin/login", { username: "admin", password: PW })).status).toBe(429);
  });
});

describe("rate limiting trusts the proxy's IP, not the client's", () => {
  let tpServer: Awaited<ReturnType<typeof createServer>>;
  let tpBase = "";
  let tpDb: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    tpDb = await createTestDatabase([{ username: "admin", password: PW }]);
    tpServer = await createServer(
      loadConfig({
        PORT: "0",
        DATABASE_URL: tpDb.url,
        RTC_PORT: String(51700 + Math.floor(Math.random() * 1000)),
        RTC_ANNOUNCED_IP: "127.0.0.1",
        TRUST_PROXY: "true", // as in production, behind nginx/caddy
      }),
    );
    tpBase = `http://localhost:${tpServer.port}`;
  });

  afterAll(async () => {
    await tpServer.stop();
    await tpDb.drop();
  });

  // The last hop is what a real reverse proxy appends (the connection it actually saw); everything
  // before it is attacker-supplied and must not be trusted for rate-limit bookkeeping.
  const loginAs = (xff: string) =>
    fetch(`${tpBase}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": xff },
      body: JSON.stringify({ username: "admin", password: "wrong" }),
    }).then((r) => r.status);

  test("spoofing earlier X-Forwarded-For hops cannot bypass the login lockout", async () => {
    let last = 0;
    for (let i = 0; i < 10; i++) last = await loginAs(`${i}.${i}.${i}.${i}, 203.0.113.9`); // a fresh fake leading IP every request
    expect(last).toBe(429); // the trusted (last) hop is what got counted, not the forged ones

    expect(await loginAs("99.99.99.99, 203.0.113.9")).toBe(429); // still the same real client: still locked out

    expect(await loginAs("anything, 203.0.113.10")).not.toBe(429); // a genuinely different real client is unaffected
  });
});

describe("secrets at rest", () => {
  test("session tokens are stored hashed, never raw", async () => {
    const db = server.repo.db;
    const sessions = (await db.select({ h: adminSessions.tokenHash }).from(adminSessions)).map((r) => r.h);
    const guests = (await db.select({ h: participants.tokenHash }).from(participants)).map((r) => r.h).filter(Boolean);
    expect(sessions).not.toContain(adminToken);
    expect(guests).not.toContain(guestToken);
    expect(guests).toContain(sha256(guestToken));
    const pw = (await db.select({ h: admins.passwordHash }).from(admins)).map((r) => r.h);
    for (const h of pw) expect(h).toStartWith("$argon2id$");
  });
});
