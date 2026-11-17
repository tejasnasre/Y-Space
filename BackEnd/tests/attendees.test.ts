import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { io as connect, type Socket } from "socket.io-client";
import { loadConfig } from "../src/config";
import { createServer } from "../src/server";
import { createTestDatabase } from "./helpers/testdb";

let server: Awaited<ReturnType<typeof createServer>>;
let base: string;
let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
let adminToken = "";
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

async function guest(spaceId: string, name: string, handle: string) {
  const res = await api(`/api/spaces/${spaceId}/join`, json({ name, linkedinUrl: `linkedin.com/in/${handle}`, secret: "letmein" }));
  expect(res.status).toBe(200);
  const { socket, state } = await joinSpace(spaceId, res.body.token);
  return { socket, token: res.body.token as string, id: state.you.id as string };
}

beforeAll(async () => {
  testDb = await createTestDatabase([{ username: "admin", password: PASSWORD }]);
  server = await createServer(
    loadConfig({
      PORT: "0",
      DATABASE_URL: testDb.url,
      RTC_PORT: String(50000 + Math.floor(Math.random() * 2000)),
      RTC_ANNOUNCED_IP: "127.0.0.1",
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

describe("who was here", () => {
  test("shared with attendees once the space ends, never before, never to outsiders, never including the removed", async () => {
    const space = (await api("/api/admin/spaces", { ...json({ title: "Networking night", secret: "letmein" }), token: adminToken })).body;
    const { socket: host } = await joinSpace(space.id, adminToken);
    const ada = await guest(space.id, "Ada Lovelace", "ada");
    const bob = await guest(space.id, "Bob", "bob");
    const mallory = await guest(space.id, "Mallory", "mallory");

    // Ada speaks, Mallory is removed
    expect((await emit(ada.socket, "speak:request")).ok).toBe(true);
    expect((await emit(host, "host:promote", { participantId: ada.id })).ok).toBe(true);
    const kicked = waitFor(mallory.socket, "kicked");
    expect((await emit(host, "host:kick", { participantId: mallory.id })).ok).toBe(true);
    await kicked;

    // still live: not shared yet, even to an attendee
    const early = await api(`/api/spaces/${space.id}/attendees`, { token: ada.token });
    expect(early.status).toBe(409);
    expect(early.body.error).toBe("space_not_ended");

    expect((await api(`/api/admin/spaces/${space.id}/end`, { method: "POST", token: adminToken })).status).toBe(200);

    // an attendee sees everyone who stayed, with LinkedIn, roles and times
    const res = await api(`/api/spaces/${space.id}/attendees`, { token: bob.token });
    expect(res.status).toBe(200);
    expect(res.body.space.title).toBe("Networking night");
    expect(res.body.you).toBe(bob.id);
    const names = res.body.attendees.map((a: any) => a.name);
    expect(names).toContain("Ada Lovelace");
    expect(names).toContain("Bob");
    expect(names).toContain("admin"); // the host
    expect(names).not.toContain("Mallory");
    const adaRow = res.body.attendees.find((a: any) => a.name === "Ada Lovelace");
    expect(adaRow.linkedinUrl).toBe("https://www.linkedin.com/in/ada");
    expect(adaRow.spoke).toBe(true);
    expect(adaRow.isHost).toBe(false);
    expect(typeof adaRow.joinedAt).toBe("number");
    expect(adaRow.leftAt).not.toBeNull(); // the space ended, so everyone has left
    expect(res.body.attendees.find((a: any) => a.name === "admin").isHost).toBe(true);
    expect(res.body.attendees.find((a: any) => a.name === "Bob").spoke).toBe(false);

    // outsiders get nothing
    expect((await api(`/api/spaces/${space.id}/attendees`)).status).toBe(403); // no token
    expect((await api(`/api/spaces/${space.id}/attendees`, { token: "not-a-real-token" })).status).toBe(403);
    expect((await api(`/api/spaces/${space.id}/attendees`, { token: mallory.token })).status).toBe(403); // removed
    expect((await api(`/api/spaces/${space.id}/attendees`, { token: adminToken })).status).toBe(403); // admins use the admin view
    expect((await api(`/api/spaces/nope/attendees`, { token: bob.token })).status).toBe(404);
  });

  test("a guest from another space cannot read this space's list", async () => {
    const a = (await api("/api/admin/spaces", { ...json({ title: "Space A", secret: "letmein" }), token: adminToken })).body;
    const guestA = await guest(a.id, "Alice", "alice");
    await api(`/api/admin/spaces/${a.id}/end`, { method: "POST", token: adminToken });

    const b = (await api("/api/admin/spaces", { ...json({ title: "Space B", secret: "letmein" }), token: adminToken })).body;
    const guestB = await guest(b.id, "Barry", "barry");
    await api(`/api/admin/spaces/${b.id}/end`, { method: "POST", token: adminToken });

    expect((await api(`/api/spaces/${a.id}/attendees`, { token: guestA.token })).status).toBe(200);
    expect((await api(`/api/spaces/${a.id}/attendees`, { token: guestB.token })).status).toBe(403);
    expect((await api(`/api/spaces/${b.id}/attendees`, { token: guestA.token })).status).toBe(403);
  });
});
