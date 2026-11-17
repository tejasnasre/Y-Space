import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { io as connect, type Socket } from "socket.io-client";
import { loadConfig } from "../src/config";
import { createServer } from "../src/server";
import { createTestDatabase } from "./helpers/testdb";

let server: Awaited<ReturnType<typeof createServer>>;
let base: string;
let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
const sockets: Socket[] = [];

const PASSWORD = "correct-horse-battery";
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function api(path: string, init?: RequestInit & { token?: string }) {
  const res = await fetch(base + path, {
    ...init,
    headers: { ...(init?.headers as object), ...(init?.token ? { authorization: `Bearer ${init.token}` } : {}) },
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

/** Connect and wait for the first `space:state` snapshot. */
function joinSpace(spaceId: string, token: string): Promise<{ socket: Socket; state: any }> {
  return new Promise((resolve, reject) => {
    const socket = connect(base, { auth: { spaceId, token }, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    socket.once("space:state", (state) => resolve({ socket, state }));
    socket.once("connect_error", (err) => reject(err));
  });
}

const emit = (s: Socket, event: string, data?: unknown): Promise<any> => s.timeout(5000).emitWithAck(event, data);
const waitFor = (s: Socket, event: string): Promise<any> => new Promise((r) => s.once(event, r));

beforeAll(async () => {
  testDb = await createTestDatabase([{ username: "admin", password: PASSWORD }]);

  server = await createServer(
    loadConfig({
      PORT: "0",
      DATABASE_URL: testDb.url,
      RTC_PORT: String(46000 + Math.floor(Math.random() * 2000)),
      RTC_ANNOUNCED_IP: "127.0.0.1",
      PUBLIC_WEB_URL: "https://space.example.com",
      RECONNECT_GRACE_SECONDS: "1",
    }),
  );
  base = `http://localhost:${server.port}`;
});

afterAll(async () => {
  for (const s of sockets) s.close();
  await server.stop();
  await testDb.drop();
});

describe("space flow", () => {
  let adminToken = "";
  let space: any;
  let host: Socket;
  let hostId = "";

  test("admin endpoints require login; bad credentials rejected", async () => {
    expect((await api("/api/admin/me")).status).toBe(401);
    expect((await api("/api/admin/spaces", json({ title: "x" }))).status).toBe(401);
    expect((await api("/api/admin/login", json({ username: "admin", password: "nope-nope-nope" }))).status).toBe(401);
    expect((await api("/api/admin/login", json({ username: "ghost", password: PASSWORD }))).status).toBe(401);

    const ok = await api("/api/admin/login", json({ username: "admin", password: PASSWORD }));
    expect(ok.status).toBe(200);
    adminToken = ok.body.token;
    expect((await api("/api/admin/me", { token: adminToken })).body.username).toBe("admin");
  });

  test("admin creates a space; a second live space is refused", async () => {
    const res = await api("/api/admin/spaces", { ...json({ title: "Demo", secret: "letmein" }), token: adminToken });
    expect(res.status).toBe(201);
    space = res.body;
    expect(space.secret).toBe("letmein");
    expect(space.joinUrl).toBe(`https://space.example.com/s/${space.id}`);

    const dup = await api("/api/admin/spaces", { ...json({ title: "Second" }), token: adminToken });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("space_already_live");

    const pub = await api(`/api/spaces/${space.id}`);
    expect(pub.status).toBe(200);
    expect(pub.body.secret).toBeUndefined();
  });

  test("guests need name + valid LinkedIn + correct secret", async () => {
    const good = { name: "Ada", linkedinUrl: "linkedin.com/in/ada", secret: "letmein" };
    expect((await api(`/api/spaces/${space.id}/join`, json({ ...good, secret: "wrong" }))).body.error).toBe("invalid_secret");
    expect((await api(`/api/spaces/${space.id}/join`, json({ ...good, linkedinUrl: "https://evil.com/in/ada" }))).body.error).toBe("invalid_linkedin_url");
    expect((await api(`/api/spaces/${space.id}/join`, json({ ...good, name: "   " }))).body.error).toBe("invalid_name");
    expect((await api(`/api/spaces/nope/join`, json(good))).status).toBe(404);

    const ok = await api(`/api/spaces/${space.id}/join`, json(good));
    expect(ok.status).toBe(200);
    expect(ok.body.participant.linkedinUrl).toBe("https://www.linkedin.com/in/ada");
  });

  test("sockets reject missing/invalid auth", async () => {
    await expect(joinSpace(space.id, "garbage")).rejects.toThrow("unauthorized");
    await expect(joinSpace("nope", "garbage")).rejects.toThrow("space_not_found");
  });

  test("host joins as a speaker, guests join as listeners", async () => {
    const h = await joinSpace(space.id, adminToken);
    host = h.socket;
    hostId = h.state.you.id;
    expect(h.state.you.role).toBe("host");
    expect(h.state.maxSpeakers).toBe(5);

    const { body } = await api(`/api/spaces/${space.id}/join`, json({ name: "Bob", linkedinUrl: "https://linkedin.com/in/bob", secret: "letmein" }));
    const joined = waitFor(host, "participant:joined");
    const g = await joinSpace(space.id, body.token);
    expect(g.state.you.role).toBe("listener");
    expect((await joined).name).toBe("Bob");
  });

  test("request → approve → 5 speaker cap → demote frees a seat", async () => {
    const guests: { socket: Socket; id: string; token: string }[] = [];
    for (let i = 0; i < 6; i++) {
      const { body } = await api(`/api/spaces/${space.id}/join`, json({ name: `G${i}`, linkedinUrl: `linkedin.com/in/g${i}`, secret: "letmein" }));
      const { socket, state } = await joinSpace(space.id, body.token);
      guests.push({ socket, id: state.you.id, token: body.token });
    }

    // a listener can't open a send transport or speak
    expect((await emit(guests[0]!.socket, "sfu:createTransport", { direction: "send" })).error).toBe("not_speaker");
    // …and can't use host powers
    expect((await emit(guests[0]!.socket, "host:promote", { participantId: guests[1]!.id })).error).toBe("forbidden");

    // listener raises a hand, host sees it
    const requested = waitFor(host, "speak:requested");
    expect((await emit(guests[0]!.socket, "speak:request")).ok).toBe(true);
    expect((await requested).id).toBe(guests[0]!.id);

    // host + 4 guests = 5 speakers; the 5th guest is refused
    for (let i = 0; i < 4; i++) {
      const role = waitFor(guests[i]!.socket, "you:role");
      expect((await emit(host, "host:promote", { participantId: guests[i]!.id })).ok).toBe(true);
      expect((await role).role).toBe("speaker");
    }
    expect((await emit(host, "host:promote", { participantId: guests[4]!.id })).error).toBe("speaker_limit");

    // a speaker may open a send transport; real mediasoup answers with ICE + DTLS
    const t = await emit(guests[0]!.socket, "sfu:createTransport", { direction: "send" });
    expect(t.ok).toBe(true);
    expect(t.iceCandidates.length).toBeGreaterThan(0);
    expect(t.dtlsParameters.fingerprints.length).toBeGreaterThan(0);
    const caps = await emit(guests[0]!.socket, "sfu:getRtpCapabilities");
    expect(caps.rtpCapabilities.codecs[0].mimeType).toBe("audio/opus");

    // demote frees a seat
    expect((await emit(host, "host:demote", { participantId: guests[0]!.id })).ok).toBe(true);
    expect((await emit(host, "host:promote", { participantId: guests[4]!.id })).ok).toBe(true);

    // host can't be demoted or kicked
    expect((await emit(host, "host:demote", { participantId: hostId })).error).toBe("cannot_demote_host");
    expect((await emit(host, "host:kick", { participantId: hostId })).error).toBe("cannot_kick_host");

    // kick: socket is dropped and the token no longer works
    const kicked = waitFor(guests[5]!.socket, "kicked");
    expect((await emit(host, "host:kick", { participantId: guests[5]!.id })).ok).toBe(true);
    await kicked;
    await expect(joinSpace(space.id, guests[5]!.token)).rejects.toThrow("unauthorized");
    const again = await api(`/api/spaces/${space.id}/join`, json({ name: "G5", linkedinUrl: "linkedin.com/in/g5", secret: "letmein" }));
    expect(again.body.error).toBe("banned");
  });

  test("ending the space notifies everyone and frees the slot; history is kept", async () => {
    const ended = waitFor(host, "space:ended");
    expect((await api(`/api/admin/spaces/${space.id}/end`, { method: "POST", token: adminToken })).status).toBe(200);
    expect((await ended).reason).toBe("ended_by_host");

    expect((await api(`/api/spaces/${space.id}/join`, json({ name: "Late", linkedinUrl: "linkedin.com/in/late", secret: "letmein" }))).status).toBe(410);

    const list = await api("/api/admin/spaces", { token: adminToken });
    expect(list.body.spaces[0].status).toBe("ended");
    expect(list.body.spaces[0].speakerCount).toBeGreaterThanOrEqual(5);

    const detail = await api(`/api/admin/spaces/${space.id}`, { token: adminToken });
    expect(detail.body.participants.length).toBeGreaterThanOrEqual(8);
    expect(detail.body.events.map((e: any) => e.type)).toContain("promoted");
    expect(detail.body.events.map((e: any) => e.type)).toContain("kicked");

    // a new space can start now
    const next = await api("/api/admin/spaces", { ...json({ title: "Round 2" }), token: adminToken });
    expect(next.status).toBe(201);
    expect(next.body.secret).toHaveLength(8); // generated
    expect((await api("/api/admin/spaces/current", { token: adminToken })).body.space.id).toBe(next.body.id);
  });
});
