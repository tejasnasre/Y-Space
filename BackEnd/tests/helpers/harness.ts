import { io as connect, type Socket } from "socket.io-client";
import { loadConfig } from "../../src/config";
import { createServer } from "../../src/server";
import { createTestDatabase } from "./testdb";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const PASSWORD = "correct-horse-battery";
export const json = (body: unknown, method = "POST") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const waitFor = (s: Socket, event: string, ms = 5000): Promise<any> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    s.once(event, (d) => {
      clearTimeout(t);
      resolve(d);
    });
  });
export const emit = (s: Socket, event: string, data?: unknown): Promise<any> => s.timeout(5000).emitWithAck(event, data);

/** Boots the real server on a throw-away database. One per test file. */
export async function startHarness(env: Record<string, string> = {}, extraAdmins: string[] = []) {
  const testDb = await createTestDatabase([{ username: "admin", password: PASSWORD }, ...extraAdmins.map((u) => ({ username: u, password: PASSWORD }))]);
  const server = await createServer(
    loadConfig({
      PORT: "0",
      DATABASE_URL: testDb.url,
      RTC_PORT: String(52000 + Math.floor(Math.random() * 3000)),
      RTC_ANNOUNCED_IP: "127.0.0.1",
      PUBLIC_WEB_URL: "https://space.example.com",
      RECONNECT_GRACE_SECONDS: "1",
      ...env,
    }),
  );
  const base = `http://localhost:${server.port}`;
  const sockets: Socket[] = [];

  async function api(path: string, init?: RequestInit & { token?: string }) {
    const res = await fetch(base + path, {
      ...init,
      headers: { ...(init?.headers as object), ...(init?.token ? { authorization: `Bearer ${init.token}` } : {}) },
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }

  const login = async (username = "admin") => (await api("/api/admin/login", json({ username, password: PASSWORD }))).body.token as string;
  const adminToken = await login();

  function joinSpace(spaceId: string, token: string): Promise<{ socket: Socket; state: any }> {
    return new Promise((resolve, reject) => {
      const socket = connect(base, { auth: { spaceId, token }, transports: ["websocket"], reconnection: false });
      sockets.push(socket);
      socket.once("space:state", (state) => resolve({ socket, state }));
      socket.once("connect_error", (err) => reject(err));
    });
  }

  /** Create a space as the admin (live now unless `scheduledFor` is given). */
  async function newSpace(body: Record<string, unknown> = {}, token = adminToken) {
    // tests share one server: close whatever a previous (possibly failed) test left live, so each test stands alone
    if (body.scheduledFor === undefined) {
      const cur = (await api("/api/admin/spaces/current", { token })).body?.space;
      if (cur) await api(`/api/admin/spaces/${cur.id}/end`, { method: "POST", token });
    }
    const res = await api("/api/admin/spaces", { ...json({ title: "Test space", secret: "letmein", ...body }), token });
    if (res.status !== 201) throw new Error(`create space failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  /** A guest joins: REST join, then the socket. */
  async function guest(spaceId: string, name: string, handle = name.toLowerCase().replace(/[^a-z0-9]/g, "")) {
    const res = await api(`/api/spaces/${spaceId}/join`, json({ name, linkedinUrl: `linkedin.com/in/${handle}`, secret: "letmein" }));
    if (res.status !== 200) throw new Error(`join failed: ${res.status} ${JSON.stringify(res.body)}`);
    const { socket, state } = await joinSpace(spaceId, res.body.token);
    return { socket, token: res.body.token as string, id: state.you.id as string, state };
  }

  const endSpace = (id: string) => api(`/api/admin/spaces/${id}/end`, { method: "POST", token: adminToken });

  return {
    server,
    base,
    api,
    login,
    adminToken,
    joinSpace,
    newSpace,
    guest,
    endSpace,
    async stop() {
      for (const s of sockets) s.close();
      await server.stop();
      await testDb.drop();
    },
  };
}
