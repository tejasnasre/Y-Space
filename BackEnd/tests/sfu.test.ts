import { afterAll, beforeAll, expect, test } from "bun:test";
import { io as connect, type Socket } from "socket.io-client";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db";
import { Repo } from "../src/repo";
import { createServer } from "../src/server";
import { createTestDatabase } from "./helpers/testdb";

/**
 * Real audio needs a browser, so here a server-side PlainTransport stands in for a speaker's mic.
 * Everything *after* the producer exists (consumer creation, the client ack, resume, close
 * propagation) goes through the real code path.
 */
let server: Awaited<ReturnType<typeof createServer>>;
let base: string;
let testDb: Awaited<ReturnType<typeof createTestDatabase>>;
const sockets: Socket[] = [];

const post = (p: string, body: unknown, token?: string) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: (await r.json()) as any }));

const open = (spaceId: string, token: string): Promise<{ socket: Socket; state: any }> =>
  new Promise((resolve, reject) => {
    const socket = connect(base, { auth: { spaceId, token }, transports: ["websocket"], reconnection: false });
    sockets.push(socket);
    socket.once("space:state", (state) => resolve({ socket, state }));
    socket.once("connect_error", reject);
  });
const emit = (s: Socket, e: string, d?: unknown): Promise<any> => s.timeout(5000).emitWithAck(e, d);
const next = (s: Socket, e: string): Promise<any> => new Promise((r) => s.once(e, r));

beforeAll(async () => {
  testDb = await createTestDatabase([{ username: "admin", password: "correct-horse-battery" }]);
  server = await createServer(
    loadConfig({ PORT: "0", DATABASE_URL: testDb.url, RTC_PORT: String(48000 + Math.floor(Math.random() * 1500)), RTC_ANNOUNCED_IP: "127.0.0.1", RECONNECT_GRACE_SECONDS: "1" }),
  );
  base = `http://localhost:${server.port}`;
});

afterAll(async () => {
  for (const s of sockets) s.close();
  await server.stop();
  await testDb.drop();
});

test("listeners receive consumers for active speakers, and are told when they stop", async () => {
  const { token } = (await post("/api/admin/login", { username: "admin", password: "correct-horse-battery" })).body;
  const space = (await post("/api/admin/spaces", { title: "SFU", secret: "sfusecret" }, token)).body;
  const hostConn = await open(space.id, token);

  const guest = async (n: string) => {
    const j = (await post(`/api/spaces/${space.id}/join`, { name: n, linkedinUrl: `linkedin.com/in/${n}`, secret: "sfusecret" })).body;
    return open(space.id, j.token);
  };
  const speaker = await guest("speaker");
  const listener = await guest("listener");
  await emit(hostConn.socket, "host:promote", { participantId: speaker.state.you.id });

  // stand-in for the speaker's microphone, registered the way Room.produce would
  const room = server.manager.room as any;
  const plain = await room.router.createPlainTransport({ listenInfo: { protocol: "udp", ip: "127.0.0.1" }, rtcpMux: true, comedia: true });
  const producer = await plain.produce({
    kind: "audio",
    rtpParameters: { codecs: [{ mimeType: "audio/opus", payloadType: 111, clockRate: 48000, channels: 2 }], encodings: [{ ssrc: 11111111 }] },
    appData: { peerId: speaker.state.you.id },
  });
  const owner = room.peers.get(speaker.state.you.id);
  owner.producer = producer;
  room.producers.set(producer.id, owner);

  // listener: recv transport -> ready -> server pushes a consumer, we ack, server resumes it
  const rtp = (await emit(listener.socket, "sfu:getRtpCapabilities")).rtpCapabilities;
  expect((await emit(listener.socket, "sfu:createTransport", { direction: "recv" })).ok).toBe(true);
  const pushed = new Promise<any>((resolve) =>
    listener.socket.once("sfu:newConsumer", (payload, ack) => {
      ack({ ok: true });
      resolve(payload);
    }),
  );
  expect((await emit(listener.socket, "sfu:ready", { rtpCapabilities: rtp })).ok).toBe(true);
  const consumerMsg = await pushed;
  expect(consumerMsg.producerId).toBe(producer.id);
  expect(consumerMsg.participantId).toBe(speaker.state.you.id);
  expect(consumerMsg.kind).toBe("audio");
  expect(consumerMsg.rtpParameters.codecs[0].mimeType).toBe("audio/opus");

  // consumer was resumed after our ack
  const consumer = [...room.peers.get(listener.state.you.id).consumers.values()][0];
  await Bun.sleep(100);
  expect(consumer.paused).toBe(false);

  // calling ready again must not create a duplicate
  expect((await emit(listener.socket, "sfu:ready", { rtpCapabilities: rtp })).ok).toBe(true);
  expect(room.peers.get(listener.state.you.id).consumers.size).toBe(1);

  // speaker's stream ends -> listener is told to drop the consumer
  const closed = next(listener.socket, "sfu:consumerClosed");
  producer.close();
  expect((await closed).consumerId).toBe(consumerMsg.consumerId);

  // muting a speaker is broadcast; a listener can't mute
  const upd = next(listener.socket, "participant:updated");
  expect((await emit(speaker.socket, "mute:set", { muted: true })).ok).toBe(true);
  expect((await upd).muted).toBe(true);
  expect((await emit(listener.socket, "mute:set", { muted: true })).error).toBe("not_speaker");

  // a dropped socket keeps its seat during the grace period, then is removed
  const left = next(hostConn.socket, "participant:left");
  speaker.socket.close();
  expect(room.peers.has(speaker.state.you.id)).toBe(true);
  expect((await left).participantId).toBe(speaker.state.you.id);
  expect(room.peers.has(speaker.state.you.id)).toBe(false);
});

test("a crash leaves a stale live row; the next boot closes it so a new space can start", async () => {
  await server.stop(); // graceful stop ends the space itself…

  // …so simulate a crash by leaving a 'live' row behind
  const { db, client } = createDb(testDb.url);
  const repo = new Repo(db);
  const adminId = (await repo.findAdminByUsername("admin"))!.id;
  await repo.insertSpace({ id: "stale000aa", title: "Crashed", secret: "x1x1x1", hostAdminId: adminId });
  await client.close();

  server = await createServer(
    loadConfig({ PORT: "0", DATABASE_URL: testDb.url, RTC_PORT: String(49600 + Math.floor(Math.random() * 1000)), RTC_ANNOUNCED_IP: "127.0.0.1" }),
  );
  base = `http://localhost:${server.port}`;

  expect(await server.repo.getLiveSpace()).toBeNull();
  expect((await server.repo.getSpace("stale000aa"))?.endReason).toBe("server_restart");
  const { token } = (await post("/api/admin/login", { username: "admin", password: "correct-horse-battery" })).body;
  expect((await post("/api/admin/spaces", { title: "After crash" }, token)).status).toBe(201);
});
