import type { Server as IoServer, Socket } from "socket.io";
import { AppError } from "../lib/errors";
import type { Peer, Notifier, Room } from "../room/room";
import type { AdminAuth } from "../services/admin-auth";
import type { SpaceManager } from "../services/space-manager";

const ACK_TIMEOUT_MS = 5000;

const spaceRoom = (spaceId: string) => `space:${spaceId}`;
const hostRoom = (spaceId: string) => `host:${spaceId}`;
const peerRoom = (peerId: string) => `peer:${peerId}`;

/** socket.io implementation of the Room's Notifier. */
export function createSocketNotifier(io: IoServer, spaceId: string): Notifier {
  return {
    all: (event, data) => void io.to(spaceRoom(spaceId)).emit(event, data),
    host: (event, data) => void io.to(hostRoom(spaceId)).emit(event, data),
    peer: (peerId, event, data) => void io.to(peerRoom(peerId)).emit(event, data),
    ack: (socketId, event, data) => {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) return Promise.reject(new Error("socket gone"));
      return socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, data);
    },
    disconnectSocket: (socketId) => void io.sockets.sockets.get(socketId)?.disconnect(true),
    closeAll: () => void io.in(spaceRoom(spaceId)).disconnectSockets(true),
    setModerator: (peerId, on) => void (on ? io.in(peerRoom(peerId)).socketsJoin(hostRoom(spaceId)) : io.in(peerRoom(peerId)).socketsLeave(hostRoom(spaceId))),
  };
}

type Ack = (res: unknown) => void;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !v) throw new AppError("invalid_payload", 400, `${field} must be a string`);
  return v;
};

export function registerSocketHandlers(io: IoServer, manager: SpaceManager, auth: AdminAuth): void {
  // ---------------------------------------------------------- handshake auth
  io.use(async (socket, next) => {
    try {
      const identity = await manager.authenticateSocket(obj(socket.handshake.auth), (t) => auth.authenticate(t));
      manager.room!.assertCanConnect(identity.id);
      socket.data.identity = identity;
      next();
    } catch (e) {
      const err = new Error(e instanceof AppError ? e.code : "unauthorized");
      (err as Error & { data?: unknown }).data = { code: err.message };
      next(err);
    }
  });

  io.on("connection", (socket) => {
    const room = manager.room;
    const identity = socket.data.identity;
    if (!room || room.closed || !identity) return void socket.disconnect(true);

    let peer: Peer;
    try {
      peer = room.connectPeer(identity, socket.id);
    } catch (e) {
      socket.emit("space:error", { code: e instanceof AppError ? e.code : "internal_error" });
      return void socket.disconnect(true);
    }

    socket.join([spaceRoom(room.spaceId), peerRoom(peer.id)]);
    if (peer.canModerate) socket.join(hostRoom(room.spaceId));
    socket.emit("space:state", room.snapshot(peer));
    socket.on("disconnect", () => room.disconnectPeer(peer, socket.id));

    bindHandlers(socket, room, peer, manager);
  });
}

const EVENT_WINDOW_MS = 10_000;
const EVENT_LIMIT = 60; // per socket per window; real clients send a handful

function bindHandlers(socket: Socket, room: Room, peer: Peer, manager: SpaceManager): void {
  let windowStart = Date.now();
  let count = 0;
  const throttled = (): boolean => {
    const now = Date.now();
    if (now - windowStart > EVENT_WINDOW_MS) {
      windowStart = now;
      count = 0;
    }
    return ++count > EVENT_LIMIT;
  };

  /** Register `event` so that thrown AppErrors become `{ ok:false, error }` acks. */
  const on = (event: string, fn: (data: Record<string, unknown>) => unknown | Promise<unknown>) => {
    socket.on(event, async (payload: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === "function" ? ack : () => {};
      if (room.closed) return reply({ ok: false, error: "space_ended" });
      if (throttled()) return reply({ ok: false, error: "rate_limited" });
      try {
        const result = await fn(obj(payload));
        reply({ ok: true, ...obj(result) });
      } catch (e) {
        if (e instanceof AppError) return reply({ ok: false, error: e.code });
        // mediasoup throws TypeError on malformed rtp/dtls params
        if (e instanceof TypeError) return reply({ ok: false, error: "invalid_payload" });
        console.error(`[socket] ${event} failed`, e);
        reply({ ok: false, error: "internal_error" });
      }
    });
  };

  // ------------------------------------------------------------------- SFU
  on("sfu:getRtpCapabilities", () => ({ rtpCapabilities: room.rtpCapabilities }));

  on("sfu:createTransport", async (d) => {
    if (d.direction !== "send" && d.direction !== "recv") throw new AppError("invalid_payload");
    return room.createTransport(peer, d.direction);
  });

  on("sfu:connectTransport", async (d) => {
    await room.connectTransport(peer, str(d.transportId, "transportId"), d.dtlsParameters as never);
  });

  on("sfu:restartIce", async (d) => ({ iceParameters: await room.restartIce(peer, str(d.transportId, "transportId")) }));

  on("sfu:produce", (d) => room.produce(peer, str(d.transportId, "transportId"), d.rtpParameters as never));

  // client finished creating its recv transport -> we start pushing consumers (`sfu:newConsumer`)
  on("sfu:ready", async (d) => {
    await room.setReady(peer, d.rtpCapabilities as never);
  });

  // ------------------------------------------------------------ speak flow
  // acks with the caller's place in line: { position, total }
  on("speak:request", async () => ({ ...(await room.requestSpeak(peer)) }));
  on("speak:cancel", () => room.cancelRequest(peer));
  on("speak:leave", () => room.leaveStage(peer));
  on("mute:set", (d) => {
    if (typeof d.muted !== "boolean") throw new AppError("invalid_payload");
    room.setMuted(peer, d.muted);
  });

  // ------------------------------------------------------------- host only
  on("host:promote", (d) => room.promote(peer, str(d.participantId, "participantId")));
  on("host:approveNext", () => room.approveNext(peer));
  on("host:demote", (d) => room.demote(peer, str(d.participantId, "participantId")));
  on("host:deny", (d) => room.denySpeak(peer, str(d.participantId, "participantId")));
  on("host:mute", (d) => room.hostMute(peer, str(d.participantId, "participantId")));
  on("host:kick", (d) => room.kick(peer, str(d.participantId, "participantId")));
  on("host:makeCohost", (d) => room.makeCohost(peer, str(d.participantId, "participantId")));
  on("host:removeCohost", (d) => room.removeCohost(peer, str(d.participantId, "participantId")));
  on("host:end", async () => {
    if (peer.role !== "host") throw new AppError("forbidden", 403);
    await manager.endSpace(room.spaceId, "ended_by_host");
  });
  // "keep it going" after the warning that the space is about to end by itself
  on("host:extend", async () => {
    if (peer.role !== "host") throw new AppError("forbidden", 403);
    return manager.extend(room.spaceId);
  });

  // ------------------------------------------------------- chat + reactions
  on("chat:send", (d) => ({ message: room.sendChat(peer, d.text) }));
  on("chat:delete", (d) => room.deleteChat(peer, d.id));
  on("reaction:send", (d) => room.react(peer, d.emoji));
}
