import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { io as connect, type Socket } from "socket.io-client";
import { loadConfig } from "../src/config";
import { createServer } from "../src/server";
import { createTestDatabase } from "./helpers/testdb";

/**
 * Forgotten-space safety net. `manager.sweep(now)` takes a synthetic clock, so nothing here waits minutes.
 * Defaults under test: host absent 15 min, host alone 30 min, hard cap 8 h.
 */

let server: Awaited<ReturnType<typeof createServer>>;
let base: string;
let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let adminToken = "";
const sockets: Socket[] = [];

const MIN = 60_000;
const HOUR = 60 * MIN;
const PASSWORD = "correct-horse-battery";
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function api(path: string, init?: RequestInit & { token?: string }) {
  const res = await fetch(base + path, {
    ...init,
    headers: { ...(init?.headers as object), ...(init?.token ? { authorization: `Bearer ${init.token}` } : {}) },
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

function joinSpace(spaceId: string, token: string): Promise<{ socket: Socket; state: any }> {
  return new Promise((resolve, reject) => {
    const socket = connect(base, { auth: { spaceId, token }, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    socket.once("space:state", (state) => resolve({ socket, state }));
    socket.once("connect_error", (err) => reject(err));
  });
}

const waitFor = (s: Socket, event: string): Promise<any> => new Promise((r) => s.once(event, r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newSpace() {
  const res = await api("/api/admin/spaces", { ...json({ title: "Forgotten AMA", secret: "letmein" }), token: adminToken });
  expect(res.status).toBe(201);
  return res.body as { id: string; createdAt: number; autoEnd: { maxMinutes: number; hostAbsentMinutes: number; emptyMinutes: number } };
}

async function guestJoin(spaceId: string, n = 1) {
  const res = await api(`/api/spaces/${spaceId}/join`, json({ name: `Guest ${n}`, linkedinUrl: `linkedin.com/in/guest${n}`, secret: "letmein" }));
  expect(res.status).toBe(200);
  return joinSpace(spaceId, res.body.token);
}

const stored = (id: string) => server.repo.getSpace(id);
const endIfLive = async (id: string) => {
  await api(`/api/admin/spaces/${id}/end`, { method: "POST", token: adminToken });
};

beforeAll(async () => {
  testDb = await createTestDatabase([{ username: "admin", password: PASSWORD }]);
  server = await createServer(
    loadConfig({
      PORT: "0",
      DATABASE_URL: testDb.url,
      RTC_PORT: String(48000 + Math.floor(Math.random() * 2000)),
      RTC_ANNOUNCED_IP: "127.0.0.1",
      RECONNECT_GRACE_SECONDS: "1",
    }),
  );
  base = `http://localhost:${server.port}`;
  adminToken = (await api("/api/admin/login", json({ username: "admin", password: PASSWORD }))).body.token;
});

afterAll(async () => {
  for (const s of sockets) s.close();
  await server.stop();
  await testDb.drop();
});

describe("forgotten spaces end on their own", () => {
  test("the admin view and the room snapshot say when the space started and what the limits are", async () => {
    const space = await newSpace();
    expect(space.autoEnd).toEqual({ maxMinutes: 480, hostAbsentMinutes: 15, emptyMinutes: 30 });
    const { state } = await joinSpace(space.id, adminToken);
    expect(state.space.startedAt).toBe(space.createdAt);
    await endIfLive(space.id);
  });

  test("created but never entered: still live at 14 min, ended at 16 min as host_absent", async () => {
    const space = await newSpace();
    expect(await server.manager.sweep(space.createdAt + 14 * MIN)).toBeNull();
    expect((await stored(space.id))?.status).toBe("live");

    expect(await server.manager.sweep(space.createdAt + 16 * MIN)).toBe("host_absent");
    const row = await stored(space.id);
    expect(row?.status).toBe("ended");
    expect(row?.endReason).toBe("host_absent");
    expect(row?.endedAt).not.toBeNull();
    expect(server.manager.room).toBeNull();
    expect((await api(`/api/spaces/${space.id}`)).body.status).toBe("ended");
  });

  test("host sitting alone: fine at 29 min, ended at 31 min as empty, and the host is told why", async () => {
    const space = await newSpace();
    const { socket: host } = await joinSpace(space.id, adminToken);
    const t0 = Date.now();
    const ended = waitFor(host, "space:ended");

    expect(await server.manager.sweep(t0)).toBeNull(); // starts the "alone" clock
    expect(await server.manager.sweep(t0 + 29 * MIN)).toBeNull();
    expect(await server.manager.sweep(t0 + 31 * MIN)).toBe("empty");

    expect(await ended).toEqual({ reason: "empty" });
    expect((await stored(space.id))?.endReason).toBe("empty");
  });

  test("a guest keeps the room alive while the host is there", async () => {
    const space = await newSpace();
    await joinSpace(space.id, adminToken);
    await guestJoin(space.id);
    const t0 = Date.now();
    expect(await server.manager.sweep(t0)).toBeNull();
    expect(await server.manager.sweep(t0 + 3 * HOUR)).toBeNull();
    expect((await stored(space.id))?.status).toBe("live");
    await endIfLive(space.id);
  });

  test("host walks away: guests are not enough, it ends as host_absent and guests are told", async () => {
    const space = await newSpace();
    const { socket: host } = await joinSpace(space.id, adminToken);
    const { socket: guest } = await guestJoin(space.id);
    const t0 = Date.now();
    expect(await server.manager.sweep(t0)).toBeNull();

    const ended = waitFor(guest, "space:ended");
    host.close();
    await sleep(1400); // past the 1 s reconnect grace, so the host peer is gone entirely
    const t1 = Date.now();
    expect(await server.manager.sweep(t1)).toBeNull(); // the absence clock starts here
    expect(await server.manager.sweep(t1 + 14 * MIN)).toBeNull();
    expect(await server.manager.sweep(t1 + 16 * MIN)).toBe("host_absent");
    expect(await ended).toEqual({ reason: "host_absent" });
  });

  test("a host who comes back resets the clock", async () => {
    const space = await newSpace();
    const { socket: host } = await joinSpace(space.id, adminToken);
    await guestJoin(space.id);
    host.close();
    await sleep(300);
    const t0 = Date.now();
    expect(await server.manager.sweep(t0)).toBeNull(); // absent since t0
    await joinSpace(space.id, adminToken); // back within the window
    expect(await server.manager.sweep(t0 + 10 * MIN)).toBeNull(); // present again, clock cleared
    expect(await server.manager.sweep(t0 + 20 * MIN)).toBeNull(); // would have ended if the clock had kept running
    await endIfLive(space.id);
  });

  test("hard cap ends even a busy room", async () => {
    const space = await newSpace();
    await joinSpace(space.id, adminToken);
    await guestJoin(space.id);
    expect(await server.manager.sweep(space.createdAt + 8 * HOUR - MIN)).toBeNull();
    expect(await server.manager.sweep(space.createdAt + 8 * HOUR + MIN)).toBe("max_duration");
    expect((await stored(space.id))?.endReason).toBe("max_duration");
  });

  test("a rule set to 0 is off", async () => {
    const space = await newSpace();
    const limits = (server.manager as any).config.autoEnd;
    const before = limits.hostAbsentMs;
    limits.hostAbsentMs = 0;
    try {
      expect(await server.manager.sweep(space.createdAt + 5 * HOUR)).toBeNull();
      expect((await stored(space.id))?.status).toBe("live");
    } finally {
      limits.hostAbsentMs = before;
    }
    await endIfLive(space.id);
  });

  test("sweeping with no live space does nothing, and ending by hand first is not an error", async () => {
    expect(await server.manager.sweep()).toBeNull();
    const space = await newSpace();
    await endIfLive(space.id);
    expect(await server.manager.sweep(space.createdAt + 20 * HOUR)).toBeNull();
  });
});
