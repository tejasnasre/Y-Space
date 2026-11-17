import type { types as ms } from "mediasoup";
import { AppError } from "../lib/errors";
import type { Repo } from "../repo";
import { MemorySpeakQueue, type QueueEntry, type SpeakQueue } from "../services/speak-queue";
import type { Media } from "../sfu/media";

/** `host` runs the room (the admin, or a co-host standing in); `cohost` moderates and speaks. */
export type Role = "host" | "cohost" | "speaker" | "listener";
export type Direction = "send" | "recv";

export interface Identity {
  id: string;
  name: string;
  linkedinUrl: string | null;
  /** the admin who owns this space */
  isHost: boolean;
  /** was made a co-host earlier; keeps the role across a reconnect */
  cohost?: boolean;
}

export interface ChatMessage {
  id: number;
  participantId: string;
  name: string;
  role: Role;
  text: string;
  at: number;
}

/** Heads-up that the space will end on its own unless someone acts. */
export interface Expiring {
  reason: string;
  endsAt: number;
}

export const REACTIONS = ["👏", "❤️", "🔥", "😂", "🎉", "👍"] as const;
const CHAT_MAX_LENGTH = 280;
const CHAT_KEEP = 100;

export interface PublicParticipant {
  id: string;
  name: string;
  linkedinUrl: string | null;
  role: Role;
  muted: boolean;
  joinedAt: number;
}

/** How the Room talks to clients. Implemented on top of socket.io, faked in unit tests. */
export interface Notifier {
  all(event: string, data?: unknown): void;
  host(event: string, data?: unknown): void;
  peer(peerId: string, event: string, data?: unknown): void;
  /** Emit to one socket and wait for the client's ack. Rejects on timeout/disconnect. */
  ack(socketId: string, event: string, data?: unknown): Promise<unknown>;
  disconnectSocket(socketId: string): void;
  /** Put a peer's sockets in (or take them out of) the moderators-only channel. */
  setModerator(peerId: string, on: boolean): void;
  /** Disconnect everyone in the room. */
  closeAll(): void;
}

export class Peer {
  role: Role;
  muted = false;
  handRaised = false;
  socketId?: string;
  rtpCapabilities?: ms.RtpCapabilities;
  sendTransport?: ms.WebRtcTransport;
  recvTransport?: ms.WebRtcTransport;
  producer?: ms.Producer;
  producePending = false;
  readonly consumers = new Map<string, ms.Consumer>();
  readonly pendingConsume = new Set<string>();
  graceTimer?: ReturnType<typeof setTimeout>;
  lastReactionAt = 0;
  lastChatAt = 0;
  /** this person's place in the raise-hand line, while their hand is up */
  request?: QueueEntry;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly linkedinUrl: string | null,
    /** the admin who owns the space. Never changes, unlike `role`, which a co-host can inherit. */
    readonly isHost: boolean,
    readonly joinedAt: number,
    cohost = false,
  ) {
    this.role = isHost ? "host" : cohost ? "cohost" : "listener";
  }

  get canSpeak(): boolean {
    return this.role !== "listener";
  }

  get canModerate(): boolean {
    return this.role === "host" || this.role === "cohost";
  }

  toPublic(): PublicParticipant {
    return {
      id: this.id,
      name: this.name,
      linkedinUrl: this.linkedinUrl,
      role: this.role,
      muted: this.muted,
      joinedAt: this.joinedAt,
    };
  }
}

export interface RoomOptions {
  maxSpeakers: number;
  maxParticipants: number;
  reconnectGraceMs: number;
}

/**
 * The one live space: who is in it, who may speak, and their mediasoup resources.
 * Everything here is synchronous state + mediasoup calls; socket.io lives behind `Notifier`.
 */
export class Room {
  readonly peers = new Map<string, Peer>();
  private readonly producers = new Map<string, Peer>(); // producerId -> owner
  closed = false;
  private readonly kicked = new Set<string>();
  /** DB writes run in order, off the real-time path. Failures are logged, never thrown into the room. */
  private writes: Promise<unknown> = Promise.resolve();
  private chatLog: ChatMessage[] = [];
  private chatSeq = 0;
  /** set by the watchdog while an automatic end is coming */
  expiring: (Expiring & { audience: "all" | "moderators" }) | null = null;

  constructor(
    readonly spaceId: string,
    readonly title: string,
    private readonly router: ms.Router,
    private readonly levelObserver: ms.AudioLevelObserver,
    private readonly media: Media,
    private readonly notify: Notifier,
    private readonly repo: Repo,
    private readonly opts: RoomOptions,
    /** when the space was created (ms). Lets clients show how long it has been running. */
    readonly startedAt: number = Date.now(),
    /** where the raise-hand line lives (pgmq, or memory) */
    private readonly queue: SpeakQueue = new MemorySpeakQueue(),
    /** topic tags, shown under the title */
    private readonly tags: string[] = [],
  ) {
    levelObserver.on("volumes", (volumes) => {
      notify.all(
        "speaker:volumes",
        volumes.map((v) => ({ participantId: v.producer.appData.peerId as string, volume: v.volume })),
      );
    });
    levelObserver.on("silence", () => notify.all("speaker:volumes", []));
  }

  private persist(fn: () => Promise<unknown>): Promise<void> {
    const next = this.writes.then(fn).then(
      () => {},
      (err) => console.error("[room] db write failed", err),
    );
    this.writes = next;
    return next;
  }

  /** Resolves once every queued DB write has finished. */
  flush(): Promise<unknown> {
    return this.writes;
  }

  // -------------------------------------------------------------- presence
  get speakerCount(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.canSpeak) n++;
    return n;
  }

  get listenerCount(): number {
    return this.peers.size - this.speakerCount;
  }

  /** Is someone running the room connected right now? A co-host who took over counts. */
  get hostConnected(): boolean {
    for (const p of this.peers.values()) if (p.role === "host" && p.socketId) return true;
    return false;
  }

  /** Everyone with a live socket except whoever is hosting. */
  get connectedGuests(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.role !== "host" && p.socketId) n++;
    return n;
  }

  assertCanConnect(id: string): void {
    if (this.closed) throw new AppError("space_ended", 410);
    if (this.kicked.has(id)) throw new AppError("banned", 403);
    if (!this.peers.has(id) && this.peers.size >= this.opts.maxParticipants) {
      throw new AppError("room_full", 403);
    }
  }

  /** Called when a socket authenticates. Reconnects within the grace window keep their role. */
  connectPeer(identity: Identity, socketId: string): Peer {
    this.assertCanConnect(identity.id);

    let peer = this.peers.get(identity.id);
    if (peer) {
      clearTimeout(peer.graceTimer);
      // second tab / stale socket: the newest connection wins
      if (peer.socketId && peer.socketId !== socketId) this.notify.disconnectSocket(peer.socketId);
      this.closeMedia(peer);
      peer.socketId = socketId;
      this.persist(() => this.repo.markPresent(identity.id));
      return peer;
    }

    peer = new Peer(identity.id, identity.name, identity.linkedinUrl, identity.isHost, Date.now(), identity.cohost);
    peer.socketId = socketId;
    this.peers.set(peer.id, peer);
    if (peer.isHost) this.reclaimHost(peer);
    this.persist(() => this.repo.markPresent(peer.id));
    this.persist(() => this.repo.logEvent(this.spaceId, peer.id, "joined"));
    this.broadcastExcept(peer.id, "participant:joined", peer.toPublic());
    return peer;
  }

  /** Socket dropped. Media is gone immediately, but the seat is held for a short grace period. */
  disconnectPeer(peer: Peer, socketId: string): void {
    if (this.closed || peer.socketId !== socketId) return; // already replaced by a newer socket
    peer.socketId = undefined;
    this.closeMedia(peer);
    clearTimeout(peer.graceTimer);
    peer.graceTimer = setTimeout(() => this.removePeer(peer), this.opts.reconnectGraceMs);
  }

  private removePeer(peer: Peer): void {
    if (!this.peers.delete(peer.id)) return;
    clearTimeout(peer.graceTimer);
    this.closeMedia(peer);
    this.persist(() => this.repo.markLeft(peer.id));
    this.persist(() => this.repo.logEvent(this.spaceId, peer.id, "left"));
    if (peer.handRaised) this.notify.host("speak:requestCancelled", { participantId: peer.id });
    this.leaveLine(peer, "delete");
    this.notify.all("participant:left", { participantId: peer.id });
    if (peer.canSpeak) this.offerSeat(); // a seat just opened
    // nobody left in charge: a co-host steps up (the real host gets it back if they return)
    if (!this.closed && !this.hasActingHost()) this.transferHost();
  }

  private hasActingHost(): boolean {
    for (const p of this.peers.values()) if (p.role === "host") return true;
    return false;
  }

  /** The host is gone. The longest-serving co-host (connected ones first) becomes host. */
  private transferHost(): void {
    const next = [...this.peers.values()]
      .filter((p) => p.role === "cohost")
      .sort((a, b) => Number(!!b.socketId) - Number(!!a.socketId) || a.joinedAt - b.joinedAt)[0];
    if (!next) return;
    next.role = "host";
    this.persist(() => this.repo.logEvent(this.spaceId, next.id, "host_transferred"));
    this.notify.peer(next.id, "you:role", { role: "host" });
    this.notify.all("participant:updated", next.toPublic());
    this.notify.all("space:host_changed", { participantId: next.id, name: next.name, reason: "left" });
  }

  /** The real host is back: whoever was standing in goes back to being a co-host. */
  private reclaimHost(owner: Peer): void {
    for (const p of this.peers.values()) {
      if (p === owner || p.role !== "host") continue;
      p.role = "cohost";
      this.persist(() => this.repo.logEvent(this.spaceId, p.id, "host_returned"));
      this.notify.peer(p.id, "you:role", { role: "cohost" });
      this.notify.all("participant:updated", p.toPublic());
    }
    this.notify.all("space:host_changed", { participantId: owner.id, name: owner.name, reason: "returned" });
  }

  snapshot(peer: Peer) {
    return {
      space: { id: this.spaceId, title: this.title, tags: this.tags, startedAt: this.startedAt },
      you: peer.toPublic(),
      maxSpeakers: this.opts.maxSpeakers,
      participants: [...this.peers.values()].map((p) => p.toPublic()),
      // in the order hands went up, whatever order people joined in
      requests: peer.canModerate ? this.line.map((p) => p.id) : [],
      queue: peer.canModerate ? this.line.map((p) => ({ id: p.id, at: p.request!.at })) : [],
      position: this.positionOf(peer),
      chat: this.chatLog,
      expiring: this.expiring && (this.expiring.audience === "all" || peer.canModerate) ? { reason: this.expiring.reason, endsAt: this.expiring.endsAt } : null,
    };
  }

  // ----------------------------------------------------------- speak flow
  /**
   * People with a hand up, first come first served. The order is the queue's message id, which only grows, so it
   * does not depend on who joined first or on which device saw the request first.
   */
  private get line(): Peer[] {
    return [...this.peers.values()].filter((p) => p.request).sort((a, b) => a.request!.msgId - b.request!.msgId);
  }

  /** Where this person stands in line (1 = next), or null if their hand is down. */
  positionOf(peer: Peer): { position: number; total: number } | null {
    const line = this.line;
    const i = line.indexOf(peer);
    return i === -1 ? null : { position: i + 1, total: line.length };
  }

  /** Tell the hosts the whole line, and everyone in it where they stand. Called after every change. */
  private publishQueue(): void {
    const line = this.line;
    this.notify.host("speak:queue", { queue: line.map((p) => ({ id: p.id, at: p.request!.at })) });
    line.forEach((p, i) => this.notify.peer(p.id, "speak:position", { position: i + 1, total: line.length }));
  }

  /**
   * Take someone off the line. `archive`: they were dealt with (kept as a record with timestamps).
   * `delete`: they withdrew, left or were removed. The database write happens in the background.
   */
  private leaveLine(peer: Peer, how: "archive" | "delete"): void {
    peer.handRaised = false;
    const entry = peer.request;
    if (!entry) return;
    peer.request = undefined;
    void this.queue.resolve(entry.msgId, how).catch((err) => console.error("[queue] resolve failed", err));
    if (how === "archive") this.notify.peer(peer.id, "speak:position", null);
    this.publishQueue();
  }

  /** A seat just opened and somebody is waiting: tell the hosts who is next. */
  private offerSeat(): void {
    if (this.closed) return;
    const next = this.line[0];
    if (next && this.speakerCount < this.opts.maxSpeakers) this.notify.host("speak:seat_free", { next: { id: next.id, name: next.name } });
  }

  async requestSpeak(peer: Peer): Promise<{ position: number; total: number } | null> {
    this.assertLive(peer);
    if (peer.role !== "listener") throw new AppError("already_speaker");
    if (peer.handRaised) return this.positionOf(peer); // already waiting (or being added): pressing twice does nothing
    peer.handRaised = true; // claim it now, so a double press cannot join the line twice

    let entry: QueueEntry;
    try {
      entry = await this.queue.add(this.spaceId, peer.id);
    } catch (err) {
      peer.handRaised = false;
      console.error("[queue] could not add to the raise-hand line", err);
      throw new AppError("queue_unavailable", 503);
    }
    // they may have lowered their hand, left, or been promoted while we waited for the queue
    if (!peer.handRaised || this.closed || this.peers.get(peer.id) !== peer) {
      void this.queue.resolve(entry.msgId, "delete").catch((e) => console.error("[queue] resolve failed", e));
      return null;
    }
    peer.request = entry;
    this.persist(() => this.repo.logEvent(this.spaceId, peer.id, "speak_requested"));
    this.notify.host("speak:requested", { ...peer.toPublic(), requestedAt: entry.at });
    this.publishQueue();
    return this.positionOf(peer);
  }

  cancelRequest(peer: Peer): void {
    if (!peer.handRaised) return;
    this.leaveLine(peer, "delete");
    this.persist(() => this.repo.logEvent(this.spaceId, peer.id, "speak_cancelled"));
    this.notify.host("speak:requestCancelled", { participantId: peer.id });
  }

  promote(host: Peer, targetId: string): void {
    this.assertModerator(host);
    const target = this.getPeer(targetId);
    if (target.role !== "listener") throw new AppError("already_speaker");
    if (this.speakerCount >= this.opts.maxSpeakers) throw new AppError("speaker_limit", 409);

    target.role = "speaker";
    this.leaveLine(target, "archive");
    this.persist(() => this.repo.markSpoke(target.id));
    this.persist(() => this.repo.logEvent(this.spaceId, target.id, "promoted"));
    this.notify.host("speak:requestCancelled", { participantId: target.id });
    this.notify.peer(target.id, "you:role", { role: target.role });
    this.notify.all("participant:updated", target.toPublic());
  }

  demote(actor: Peer, targetId: string): void {
    this.assertModerator(actor);
    const target = this.getPeer(targetId);
    if (target.isHost || target.role === "host") throw new AppError("cannot_demote_host");
    this.assertCanActOn(actor, target);
    if (target.role === "cohost") throw new AppError("target_is_cohost"); // use host:removeCohost
    this.stepDown(target, "demoted");
  }

  /** A speaker voluntarily returns to the audience. The host and co-hosts can't. */
  leaveStage(peer: Peer): void {
    if (peer.isHost || peer.role === "host") throw new AppError("cannot_demote_host");
    if (peer.role === "cohost") throw new AppError("cohost_cannot_leave_stage");
    this.stepDown(peer, "stepped_down");
  }

  // -------------------------------------------------------------- co-hosts
  /** Only the person running the room can appoint a co-host. Listeners are lifted straight onto the stage. */
  makeCohost(host: Peer, targetId: string): void {
    this.assertHost(host);
    const target = this.getPeer(targetId);
    if (target.role === "host") throw new AppError("already_host");
    if (target.role === "cohost") return;
    if (!target.canSpeak && this.speakerCount >= this.opts.maxSpeakers) throw new AppError("speaker_limit", 409);

    target.role = "cohost";
    this.leaveLine(target, "archive");
    this.persist(() => this.repo.markSpoke(target.id));
    this.persist(() => this.repo.setCohost(target.id, true));
    this.persist(() => this.repo.logEvent(this.spaceId, target.id, "cohost_added"));
    this.notify.setModerator(target.id, true);
    this.notify.host("speak:requestCancelled", { participantId: target.id });
    this.notify.peer(target.id, "you:role", { role: target.role });
    this.notify.all("participant:updated", target.toPublic());
  }

  removeCohost(host: Peer, targetId: string): void {
    this.assertHost(host);
    const target = this.getPeer(targetId);
    if (target.role !== "cohost") throw new AppError("not_cohost");
    target.role = "speaker";
    this.persist(() => this.repo.setCohost(target.id, false));
    this.persist(() => this.repo.logEvent(this.spaceId, target.id, "cohost_removed"));
    this.notify.setModerator(target.id, false);
    this.notify.peer(target.id, "you:role", { role: target.role });
    this.notify.all("participant:updated", target.toPublic());
  }

  private stepDown(target: Peer, reason: string): void {
    if (target.role !== "speaker") throw new AppError("not_speaker");
    target.role = "listener";
    target.muted = false;
    // closing the send transport closes the producer -> every consumer gets `producerclose`
    target.sendTransport?.close();
    target.sendTransport = undefined;
    this.persist(() => this.repo.logEvent(this.spaceId, target.id, reason));
    this.notify.peer(target.id, "you:role", { role: target.role });
    this.notify.all("participant:updated", target.toPublic());
    this.offerSeat();
  }

  /** Approve whoever has waited longest. */
  approveNext(host: Peer): { participantId: string; name: string } {
    this.assertModerator(host);
    const next = this.line[0];
    if (!next) throw new AppError("no_requests", 409);
    this.promote(host, next.id); // same rules as approving by hand, including "stage is full"
    return { participantId: next.id, name: next.name };
  }

  denySpeak(host: Peer, targetId: string): void {
    this.assertModerator(host);
    const target = this.getPeer(targetId);
    if (!target.handRaised) return;
    this.leaveLine(target, "archive");
    this.persist(() => this.repo.logEvent(this.spaceId, target.id, "speak_denied"));
    this.notify.host("speak:requestCancelled", { participantId: target.id });
    this.notify.peer(target.id, "speak:denied");
  }

  setMuted(peer: Peer, muted: boolean, by: "self" | "host" = "self"): void {
    if (!peer.canSpeak) throw new AppError("not_speaker");
    peer.muted = muted;
    if (peer.producer) void (muted ? peer.producer.pause() : peer.producer.resume()).catch(() => {});
    if (by === "host") this.notify.peer(peer.id, "you:muted", { muted, by });
    this.notify.all("participant:updated", peer.toPublic());
  }

  /** The host may silence a speaker but can't force a mic back on. */
  hostMute(actor: Peer, targetId: string): void {
    this.assertModerator(actor);
    const target = this.getPeer(targetId);
    if (target !== actor) this.assertCanActOn(actor, target);
    this.setMuted(target, true, "host");
  }

  async kick(actor: Peer, targetId: string): Promise<void> {
    this.assertModerator(actor);
    const target = this.getPeer(targetId);
    if (target.isHost || target.role === "host") throw new AppError("cannot_kick_host");
    this.assertCanActOn(actor, target);
    await this.evict(target);
  }

  /** Remove someone and ban their profile from this space, with no actor (a moderator's kick, or an admin's block). */
  async evict(target: Peer): Promise<void> {
    const socketId = target.socketId;
    this.kicked.add(target.id); // takes effect immediately, before the DB write lands
    this.persist(() => this.repo.markKicked(target.id));
    this.persist(() => this.repo.logEvent(this.spaceId, target.id, "kicked"));
    this.notify.peer(target.id, "kicked");
    this.removePeer(target);
    if (socketId) this.notify.disconnectSocket(socketId);
    await this.flush(); // the ban is durable before we acknowledge it
  }

  // ------------------------------------------------------ chat + reactions
  /** A short message to the whole room. Kept in memory (last 100) so people who join late or reconnect can catch up. */
  sendChat(peer: Peer, text: unknown): ChatMessage {
    this.assertLive(peer);
    const clean = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
    if (!clean || clean.length > CHAT_MAX_LENGTH) throw new AppError("invalid_payload");
    const now = Date.now();
    if (now - peer.lastChatAt < 600) throw new AppError("rate_limited");
    peer.lastChatAt = now;
    const msg: ChatMessage = { id: ++this.chatSeq, participantId: peer.id, name: peer.name, role: peer.role, text: clean, at: now };
    this.chatLog.push(msg);
    if (this.chatLog.length > CHAT_KEEP) this.chatLog.shift();
    this.notify.all("chat:message", msg);
    return msg;
  }

  deleteChat(actor: Peer, id: unknown): void {
    this.assertModerator(actor);
    const i = this.chatLog.findIndex((m) => m.id === id);
    if (i === -1) return;
    this.chatLog.splice(i, 1);
    this.notify.all("chat:deleted", { id });
  }

  react(peer: Peer, emoji: unknown): void {
    this.assertLive(peer);
    if (typeof emoji !== "string" || !(REACTIONS as readonly string[]).includes(emoji)) throw new AppError("invalid_payload");
    const now = Date.now();
    if (now - peer.lastReactionAt < 200) return; // quietly drop a stuck key, not an error
    peer.lastReactionAt = now;
    this.notify.all("reaction", { participantId: peer.id, emoji });
  }

  // -------------------------------------------------------- expiry warning
  /** Tell people the space is about to end by itself (or that it no longer is). */
  setExpiring(next: (Expiring & { audience: "all" | "moderators" }) | null): void {
    const a = this.expiring;
    if (a?.reason === next?.reason && a?.endsAt === next?.endsAt && a?.audience === next?.audience) return;
    this.expiring = next;
    if (a) this.notify.all("space:expiring", null);
    if (next) {
      const payload = { reason: next.reason, endsAt: next.endsAt };
      if (next.audience === "all") this.notify.all("space:expiring", payload);
      else this.notify.host("space:expiring", payload);
    }
  }

  // ------------------------------------------------------------------- SFU
  get rtpCapabilities(): ms.RtpCapabilities {
    return this.router.rtpCapabilities;
  }

  async createTransport(peer: Peer, direction: Direction) {
    this.assertLive(peer);
    if (direction === "send" && !peer.canSpeak) throw new AppError("not_speaker");
    if ((direction === "send" ? peer.sendTransport : peer.recvTransport)) {
      throw new AppError("transport_exists");
    }

    const transport = await this.media.createTransport(this.router);
    // the world may have changed while we awaited
    const stale =
      this.closed ||
      this.peers.get(peer.id) !== peer ||
      !peer.socketId ||
      (direction === "send" && !peer.canSpeak) ||
      (direction === "send" ? peer.sendTransport : peer.recvTransport);
    if (stale) {
      transport.close();
      throw new AppError("transport_exists");
    }

    if (direction === "send") peer.sendTransport = transport;
    else peer.recvTransport = transport;
    transport.observer.on("close", () => {
      if (peer.sendTransport === transport) peer.sendTransport = undefined;
      if (peer.recvTransport === transport) peer.recvTransport = undefined;
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  private transportOf(peer: Peer, transportId: string): ms.WebRtcTransport {
    for (const t of [peer.sendTransport, peer.recvTransport]) if (t && t.id === transportId) return t;
    throw new AppError("unknown_transport");
  }

  async connectTransport(peer: Peer, transportId: string, dtlsParameters: ms.DtlsParameters): Promise<void> {
    this.assertLive(peer);
    await this.transportOf(peer, transportId).connect({ dtlsParameters });
  }

  async restartIce(peer: Peer, transportId: string): Promise<ms.IceParameters> {
    this.assertLive(peer);
    return this.transportOf(peer, transportId).restartIce();
  }

  async produce(peer: Peer, transportId: string, rtpParameters: ms.RtpParameters) {
    this.assertLive(peer);
    if (!peer.canSpeak) throw new AppError("not_speaker");
    const transport = peer.sendTransport;
    if (!transport || transport.id !== transportId) throw new AppError("unknown_transport");
    if (peer.producer || peer.producePending) throw new AppError("already_producing");

    peer.producePending = true;
    let producer: ms.Producer;
    try {
      producer = await transport.produce({
        kind: "audio",
        rtpParameters,
        paused: peer.muted,
        appData: { peerId: peer.id },
      });
    } finally {
      peer.producePending = false;
    }

    // demoted / disconnected while negotiating?
    if (this.closed || !peer.canSpeak || peer.sendTransport !== transport) {
      producer.close();
      throw new AppError("not_speaker");
    }

    peer.producer = producer;
    this.producers.set(producer.id, peer);
    producer.observer.on("close", () => {
      this.producers.delete(producer.id);
      if (peer.producer === producer) peer.producer = undefined;
    });
    void this.levelObserver.addProducer({ producerId: producer.id }).catch(() => {});

    for (const other of this.peers.values()) {
      if (other !== peer) void this.consumeFor(other, producer, peer);
    }
    return { producerId: producer.id };
  }

  /**
   * The client says "my recv transport is ready, here is what I can decode".
   * We then push a consumer for every active speaker, and for any future one. Safe to call again.
   */
  async setReady(peer: Peer, rtpCapabilities: ms.RtpCapabilities): Promise<void> {
    this.assertLive(peer);
    if (!peer.recvTransport) throw new AppError("no_recv_transport");
    peer.rtpCapabilities = rtpCapabilities;
    await Promise.all(
      [...this.producers.entries()]
        .filter(([, owner]) => owner !== peer)
        .map(([id, owner]) => {
          const producer = owner.producer;
          return producer && producer.id === id ? this.consumeFor(peer, producer, owner) : undefined;
        }),
    );
  }

  private async consumeFor(target: Peer, producer: ms.Producer, owner: Peer): Promise<void> {
    const transport = target.recvTransport;
    const socketId = target.socketId;
    if (!transport || !target.rtpCapabilities || !socketId) return;
    if (target.pendingConsume.has(producer.id)) return;
    for (const c of target.consumers.values()) if (c.producerId === producer.id) return;
    if (!this.router.canConsume({ producerId: producer.id, rtpCapabilities: target.rtpCapabilities })) return;

    target.pendingConsume.add(producer.id);
    let consumer: ms.Consumer | undefined;
    try {
      consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: target.rtpCapabilities,
        paused: true, // resume only after the client confirms it built its side
      });
      const c = consumer;
      target.consumers.set(c.id, c);
      c.on("transportclose", () => target.consumers.delete(c.id));
      c.on("producerclose", () => {
        target.consumers.delete(c.id);
        this.notify.peer(target.id, "sfu:consumerClosed", { consumerId: c.id, producerId: producer.id });
      });

      await this.notify.ack(socketId, "sfu:newConsumer", {
        consumerId: c.id,
        producerId: producer.id,
        participantId: owner.id,
        kind: c.kind,
        rtpParameters: c.rtpParameters,
      });
      await c.resume();
    } catch {
      // client timed out / disconnected / consumer closed meanwhile: drop it, the client can re-sync with `sfu:ready`
      if (consumer && !consumer.closed) consumer.close();
      if (consumer) target.consumers.delete(consumer.id);
    } finally {
      target.pendingConsume.delete(producer.id);
    }
  }

  /** Release a peer's mediasoup objects. */
  private closeMedia(peer: Peer): void {
    peer.sendTransport?.close();
    peer.recvTransport?.close();
    peer.sendTransport = undefined;
    peer.recvTransport = undefined;
    peer.producer = undefined;
    peer.rtpCapabilities = undefined;
    peer.consumers.clear();
    peer.pendingConsume.clear();
  }

  // ------------------------------------------------------------- lifecycle
  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.notify.all("space:ended", { reason });
    for (const peer of this.peers.values()) {
      clearTimeout(peer.graceTimer);
      this.closeMedia(peer);
    }
    this.peers.clear();
    this.producers.clear();
    void this.queue.clear(this.spaceId).catch((err) => console.error("[queue] clear failed", err));
    this.router.close();
    this.notify.closeAll();
  }

  // --------------------------------------------------------------- helpers
  /** Whoever is running the room right now (the host, or a co-host standing in). */
  private assertHost(peer: Peer): void {
    if (peer.role !== "host") throw new AppError("forbidden", 403);
  }

  /** Host or co-host. */
  private assertModerator(peer: Peer): void {
    if (!peer.canModerate) throw new AppError("forbidden", 403);
  }

  /** A co-host can moderate the audience and stage, but not the host or other co-hosts. Only the host can handle co-hosts. */
  private assertCanActOn(actor: Peer, target: Peer): void {
    if (target === actor) return;
    if (target.role === "host") throw new AppError("forbidden", 403);
    if (target.role === "cohost" && actor.role !== "host") throw new AppError("forbidden", 403);
  }

  private assertLive(peer: Peer): void {
    if (this.closed || this.peers.get(peer.id) !== peer) throw new AppError("space_ended", 410);
  }

  private getPeer(id: unknown): Peer {
    const peer = typeof id === "string" ? this.peers.get(id) : undefined;
    if (!peer) throw new AppError("participant_not_found", 404);
    return peer;
  }

  private broadcastExcept(peerId: string, event: string, data: unknown): void {
    for (const p of this.peers.values()) {
      if (p.id !== peerId) this.notify.peer(p.id, event, data);
    }
  }
}
