import type { Config } from "../config";
import { AppError } from "../lib/errors";
import { generateSecret, newSpaceId, randomToken, safeEqual, sha256 } from "../lib/security";
import { cleanName, cleanSecret, cleanTags, parseLinkedin } from "../lib/validate";
import { Room, type Identity, type Notifier } from "../room/room";
import { isUniqueViolation, type AdminRef, type ParticipantRow, type Repo, type SpaceRow } from "../repo";
import type { Media } from "../sfu/media";
import type { SpeakQueue } from "./speak-queue";

/** How a space's attendee list is shared: not at all, everyone who stayed (decided in advance), or only guests who opt in. */
export type ListMode = "off" | "everyone" | "optin";
const listMode = (s: { publicList: boolean; listOptin: boolean }): ListMode => (s.publicList ? "everyone" : s.listOptin ? "optin" : "off");

/**
 * Owns the lifecycle of the (single) live space: create, join, end.
 * The DB's partial unique index is the source of truth for "only one live space".
 */
export class SpaceManager {
  room: Room | null = null;
  /** What the watchdog has observed about the live room. Only the transitions matter, not every tick. */
  private watch: { hostAbsentSince: number | null; aloneSince: number | null; extraMs: number } = {
    hostAbsentSince: null,
    aloneSince: null,
    extraMs: 0,
  };

  constructor(
    private readonly repo: Repo,
    private readonly media: Media,
    private readonly config: Config,
    private readonly makeNotifier: (spaceId: string) => Notifier,
    private readonly speakQueue: SpeakQueue,
  ) {}

  /** Call once on boot: a restart loses the in-memory room, so stale live rows must be closed. */
  async recoverFromRestart(): Promise<void> {
    await this.speakQueue.clearAll().catch((e) => console.error("[queue] could not clear the raise-hand queue", e)); // nobody from a past run is waiting any more
    const n = await this.repo.endAllLive("server_restart");
    if (n) console.log(`[spaces] closed ${n} stale live space(s) from a previous run`);
  }

  /** Starts a space now, or (with `scheduledFor`) books one for later that stays closed until the host starts it. */
  async createSpace(
    hostAdminId: number,
    input: { title: string; secret?: string; scheduledFor?: number; description?: string; publicList?: boolean; autoStart?: boolean; tags?: string[]; unlisted?: boolean },
  ) {
    const secret = input.secret ? cleanSecret(input.secret) : generateSecret();
    const tags = cleanTags(input.tags);
    const id = newSpaceId();
    const description = input.description?.trim() ? input.description.trim().slice(0, 1000) : null;

    if (input.scheduledFor !== undefined) {
      const when = this.checkSchedule(input.scheduledFor);
      const space = await this.repo.insertSpace({
        id,
        title: input.title.trim(),
        secret,
        hostAdminId,
        scheduledFor: when,
        description,
        publicList: input.publicList === true,
        autoStart: input.autoStart === true,
        tags,
        unlisted: input.unlisted === true,
      });
      await this.repo.logEvent(space.id, null, "space_scheduled", { scheduledFor: when });
      return this.toAdminView(space);
    }

    let space: SpaceRow;
    try {
      space = await this.repo.insertSpace({ id, title: input.title.trim(), secret, hostAdminId, description, publicList: input.publicList === true, tags, unlisted: input.unlisted === true });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new AppError("space_already_live", 409, "a space is already live, end it first");
      }
      throw e;
    }
    await this.openRoom(space);
    await this.repo.logEvent(space.id, null, "space_created");
    return this.toAdminView(space);
  }

  /** A scheduled time must be a real, sensible moment: not long past, not years away. */
  private checkSchedule(when: number): number {
    const now = Date.now();
    if (!Number.isFinite(when) || when < now - 5 * 60_000 || when > now + 366 * 86_400_000) {
      throw new AppError("invalid_schedule", 400, "pick a time between now and a year from now");
    }
    return Math.round(when);
  }

  /** Creates the in-memory room for a space that is now live. */
  private async openRoom(space: SpaceRow): Promise<void> {
    try {
      const { router, levelObserver } = await this.media.createRouter();
      this.room = new Room(
        space.id,
        space.title,
        router,
        levelObserver,
        this.media,
        this.makeNotifier(space.id),
        this.repo,
        this.config,
        space.startedAt,
        this.speakQueue,
        space.tags,
      );
      // nobody has connected yet, so the host counts as absent from the moment the space is live
      this.watch = { hostAbsentSince: space.startedAt, aloneSince: null, extraMs: 0 };
    } catch (e) {
      await this.repo.endSpace(space.id, "error");
      throw e;
    }
  }

  /** The host opens a scheduled space. Same link and secret as announced. */
  async startScheduled(spaceId: string, adminId: number) {
    const space = await this.assertHost(spaceId, adminId);
    if (space.status !== "scheduled") throw new AppError("space_not_scheduled", 409, "this space is not waiting to start");
    let live: SpaceRow | null;
    try {
      live = await this.repo.startScheduledSpace(space.id);
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("space_already_live", 409, "a space is already live, end it first");
      throw e;
    }
    if (!live) throw new AppError("space_not_scheduled", 409, "this space is not waiting to start");
    await this.openRoom(live);
    await this.repo.logEvent(live.id, null, "space_started");
    return this.toAdminView(live);
  }

  /**
   * Scheduler path: open scheduled spaces whose time has come. Nobody presses a button, so the host-away timer
   * starts now: the host has `HOST_ABSENT_MINUTES` to show up. If another space is live this one stays scheduled
   * and is retried on the next tick, until the grace window passes. Safe to call as often as you like.
   */
  async openDue(): Promise<string[]> {
    const opened: string[] = [];
    for (const id of await this.repo.listDueAutoStart(this.config.scheduler.autoStartGraceMs)) {
      try {
        const live = await this.repo.startScheduledSpace(id);
        if (!live) continue; // the host started it first
        await this.openRoom(live);
        await this.repo.logEvent(live.id, null, "space_started", { auto: true });
        console.log(`[scheduler] opened "${live.title}" (${live.id}) at its scheduled time`);
        opened.push(live.id);
      } catch (e) {
        if (isUniqueViolation(e)) continue; // another space is live: try again next tick
        console.error(`[scheduler] could not open ${id}`, e);
      }
    }
    return opened;
  }

  async cancelScheduled(spaceId: string, adminId: number): Promise<void> {
    const space = await this.assertHost(spaceId, adminId);
    if (space.status !== "scheduled") throw new AppError("space_not_scheduled", 409, "only a space that has not started can be cancelled");
    if (!(await this.repo.cancelScheduledSpace(space.id, "cancelled"))) throw new AppError("space_not_scheduled", 409);
    await this.repo.logEvent(space.id, null, "space_cancelled");
  }

  async updateScheduled(
    spaceId: string,
    adminId: number,
    patch: { title?: string; description?: string | null; scheduledFor?: number; publicList?: boolean; autoStart?: boolean; tags?: string[] },
  ) {
    await this.assertHost(spaceId, adminId);
    const next = await this.repo.updateScheduledSpace(spaceId, {
      title: patch.title?.trim() || undefined,
      description: patch.description === undefined ? undefined : patch.description?.trim() ? patch.description.trim().slice(0, 1000) : null,
      scheduledFor: patch.scheduledFor === undefined ? undefined : this.checkSchedule(patch.scheduledFor),
      publicList: patch.publicList,
      autoStart: patch.autoStart,
      tags: patch.tags === undefined ? undefined : cleanTags(patch.tags),
    });
    if (!next) throw new AppError("space_not_scheduled", 409, "only a space that has not started can be edited");
    return this.toAdminView(next);
  }

  /**
   * Safety net for forgotten spaces. Ends the live space when:
   *  - it has been live longer than `autoEnd.maxMs` (plus any extensions)  -> "max_duration"
   *  - nobody is hosting for `autoEnd.hostAbsentMs`                         -> "host_absent"
   *  - the host is connected but alone for `autoEnd.emptyMs`                -> "empty"
   * A limit of 0 disables that rule. Within `autoEnd.warnMs` of the nearest one, the room is warned
   * (`space:expiring`) so the host can press "keep it going". Returns the reason if it ended the space.
   * `now` is injectable so tests do not have to wait.
   */
  async sweep(now = Date.now()): Promise<string | null> {
    const room = this.room;
    if (!room || room.closed) return null;
    const { maxMs, hostAbsentMs, emptyMs, warnMs } = this.config.autoEnd;
    const w = this.watch;

    if (room.hostConnected) w.hostAbsentSince = null;
    else w.hostAbsentSince ??= now;
    if (room.hostConnected && room.connectedGuests === 0) w.aloneSince ??= now;
    else w.aloneSince = null;

    // everything that could end the space, and when. `audience`: who needs to hear about it.
    const due: { reason: string; endsAt: number; audience: "all" | "moderators" }[] = [];
    if (maxMs > 0) due.push({ reason: "max_duration", endsAt: room.startedAt + maxMs + w.extraMs, audience: "all" });
    if (hostAbsentMs > 0 && w.hostAbsentSince !== null) due.push({ reason: "host_absent", endsAt: w.hostAbsentSince + hostAbsentMs, audience: "all" });
    if (emptyMs > 0 && w.aloneSince !== null) due.push({ reason: "empty", endsAt: w.aloneSince + emptyMs, audience: "moderators" });
    const next = due.sort((a, b) => a.endsAt - b.endsAt)[0];

    if (!next) {
      room.setExpiring(null);
      return null;
    }
    if (next.endsAt > now) {
      room.setExpiring(warnMs > 0 && next.endsAt - now <= warnMs ? next : null);
      return null;
    }

    try {
      await this.endSpace(room.spaceId, next.reason);
    } catch (e) {
      if (e instanceof AppError && e.code === "space_ended") return null; // the host ended it first
      throw e;
    }
    console.log(`[spaces] auto-ended ${room.spaceId}: ${next.reason}`);
    return next.reason;
  }

  /** "Keep it going": the host buys more time. Restarts the alone/absent clocks and lifts the hard cap. */
  async extend(spaceId: string, now = Date.now()): Promise<{ extendedByMinutes: number }> {
    const room = this.room;
    if (!room || room.closed || room.spaceId !== spaceId) throw new AppError("space_ended", 410);
    const { extendMs } = this.config.autoEnd;
    const w = this.watch;
    w.extraMs += extendMs;
    if (w.aloneSince !== null) w.aloneSince = now;
    if (w.hostAbsentSince !== null) w.hostAbsentSince = now;
    room.setExpiring(null);
    await this.repo.logEvent(spaceId, null, "space_extended", { minutes: Math.round(extendMs / 60_000) });
    return { extendedByMinutes: Math.round(extendMs / 60_000) };
  }

  /** Only the admin who created a space may end or re-key it. */
  async assertHost(spaceId: string, adminId: number): Promise<SpaceRow> {
    const space = await this.repo.getSpace(spaceId);
    if (!space) throw new AppError("space_not_found", 404);
    if (space.hostAdminId !== adminId) throw new AppError("forbidden", 403, "you are not the host of this space");
    return space;
  }

  async endSpace(spaceId: string, reason = "ended_by_host"): Promise<void> {
    const space = await this.repo.getSpace(spaceId);
    if (!space) throw new AppError("space_not_found", 404);
    if (space.status !== "live") throw new AppError("space_ended", 409, "space already ended");

    const room = this.room?.spaceId === space.id ? this.room : null;
    if (room) {
      this.room = null; // no new joins from here on
      room.close(reason);
      await room.flush(); // let queued presence writes land before we close the books
    }
    await this.repo.logEvent(space.id, null, "space_ended", { reason });
    await this.repo.endSpace(space.id, reason);
  }

  async rotateSecret(spaceId: string, secret?: string) {
    const space = await this.repo.getSpace(spaceId);
    if (!space) throw new AppError("space_not_found", 404);
    if (space.status === "ended") throw new AppError("space_ended", 409);
    const next = secret ? cleanSecret(secret) : generateSecret();
    await this.repo.setSpaceSecret(space.id, next);
    return this.toAdminView({ ...space, secret: next });
  }

  /** Guest enters name + LinkedIn + secret and gets a session token for the socket. */
  async join(spaceId: string, input: { name: unknown; linkedinUrl: unknown; secret: unknown }) {
    const space = await this.repo.getSpace(spaceId);
    if (!space) throw new AppError("space_not_found", 404);
    if (space.status === "scheduled") throw new AppError("space_not_started", 409, "this space has not started yet");
    if (space.status !== "live" || this.room?.spaceId !== space.id) {
      throw new AppError("space_ended", 410, "this space has ended");
    }

    const secret = typeof input.secret === "string" ? input.secret.trim() : "";
    if (!safeEqual(secret, space.secret)) throw new AppError("invalid_secret", 403, "wrong secret");

    const name = cleanName(input.name);
    const linkedin = parseLinkedin(input.linkedinUrl);
    if (await this.repo.isBlocked(linkedin.key)) throw new AppError("blocked", 403, "you can't join spaces hosted here");
    if (await this.repo.isLinkedinKicked(space.id, linkedin.key)) {
      throw new AppError("banned", 403, "you were removed from this space");
    }
    this.room.assertCanConnect("new");

    const id = crypto.randomUUID();
    const token = randomToken();
    await this.repo.insertGuest({
      id,
      spaceId: space.id,
      name,
      linkedinUrl: linkedin.url,
      linkedinKey: linkedin.key,
      tokenHash: sha256(token),
    });
    return { token, participant: { id, name, linkedinUrl: linkedin.url } };
  }

  // ------------------------------------------------------- socket handshake
  /** Resolve a socket's `auth` into an Identity, or throw. */
  async authenticateSocket(
    auth: { token?: unknown; spaceId?: unknown },
    adminLookup: (token: string) => Promise<AdminRef | null>,
  ): Promise<Identity> {
    const token = typeof auth.token === "string" ? auth.token : "";
    const spaceId = typeof auth.spaceId === "string" ? auth.spaceId : "";
    if (!token || !spaceId) throw new AppError("unauthorized", 401);

    const space = await this.repo.getSpace(spaceId);
    if (!space) throw new AppError("space_not_found", 404);
    if (space.status === "scheduled") throw new AppError("space_not_started", 409);
    if (space.status !== "live" || !this.room || this.room.spaceId !== space.id) {
      throw new AppError("space_ended", 410);
    }

    // guest?
    const guest = await this.repo.findParticipantByToken(sha256(token));
    if (guest) {
      if (guest.spaceId !== space.id) throw new AppError("unauthorized", 401);
      if (guest.kickedAt) throw new AppError("banned", 403);
      if (guest.linkedinKey && (await this.repo.isBlocked(guest.linkedinKey))) throw new AppError("blocked", 403);
      return this.guestIdentity(guest);
    }

    // host?
    const admin = await adminLookup(token);
    if (admin && admin.id === space.hostAdminId) {
      const row = await this.repo.ensureHostParticipant(space.id, admin.id, admin.displayName || admin.username, admin.linkedinUrl);
      return { id: row.id, name: row.name, linkedinUrl: row.linkedinUrl, isHost: true };
    }
    throw new AppError("unauthorized", 401);
  }

  private guestIdentity(p: ParticipantRow): Identity {
    return { id: p.id, name: p.name, linkedinUrl: p.linkedinUrl, isHost: false, cohost: p.cohost };
  }

  /**
   * The "who was here" list, shared once a space has ended so the people in it can connect.
   * Only someone who actually joined this space may read it (their own guest token), never the public,
   * and people the host removed are left out (and lose their token, so they cannot ask).
   */
  async attendees(spaceId: string, token: string | null) {
    const space = await this.repo.getSpace(spaceId);
    if (!space) throw new AppError("space_not_found", 404);
    if (space.status !== "ended") {
      throw new AppError("space_not_ended", 409, "the attendee list is shared once the space has ended");
    }
    const me = token ? await this.repo.findParticipantByToken(sha256(token)) : null;
    if (!me || me.spaceId !== space.id || me.kickedAt) {
      throw new AppError("forbidden", 403, "only people who were in this space can see who attended");
    }
    const rows = (await this.repo.listParticipants(space.id)).filter((p) => !p.kickedAt);
    return {
      space: { id: space.id, title: space.title, tags: space.tags, createdAt: space.startedAt, endedAt: space.endedAt, publicList: space.publicList, listMode: listMode(space) },
      you: me.id,
      /** whether you chose to appear on the opt-in public list */
      youShare: me.sharePublicly,
      attendees: rows.map((p) => ({
        id: p.id,
        name: p.name,
        linkedinUrl: p.linkedinUrl,
        isHost: p.adminId !== null,
        spoke: p.spoke,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
      })),
    };
  }

  /**
   * The attendee list for anyone, if the host chose to publish it (before the space, so guests were told when
   * they joined). Names, roles and LinkedIn only. Left out: people who were removed, blocked profiles, and
   * anyone with an unreviewed report against them.
   */
  async publicAttendees(spaceId: string) {
    const space = await this.repo.getSpace(spaceId);
    if (!space) throw new AppError("space_not_found", 404);
    const mode = listMode(space);
    if (mode === "off") throw new AppError("not_public", 403, "the host did not publish this list");
    if (space.status !== "ended") throw new AppError("space_not_ended", 409, "the list is published once the space has ended");

    const [rows, blocks, reported] = await Promise.all([
      this.repo.listParticipants(space.id),
      this.repo.listBlocks(),
      this.repo.listOpenReportedIds(space.id),
    ]);
    const blockedKeys = new Set(blocks.map((b) => b.linkedinKey));
    const host = await this.repo.findAdminRef(space.hostAdminId);
    return {
      mode,
      space: { id: space.id, title: space.title, tags: space.tags, startedAt: space.startedAt, endedAt: space.endedAt, host: host ? { name: host.displayName || host.username, linkedinUrl: host.linkedinUrl } : null },
      attendees: rows
        // "optin": the host plus only the guests who chose to appear. "everyone": the guests were told in advance.
        .filter((p) => mode === "everyone" || p.adminId !== null || p.sharePublicly)
        .filter((p) => !p.kickedAt && !reported.has(p.id) && !(p.linkedinKey && blockedKeys.has(p.linkedinKey)))
        .map((p) => ({
          id: p.id,
          name: p.name,
          linkedinUrl: p.linkedinUrl,
          role: p.adminId !== null ? "host" : p.cohost ? "cohost" : p.spoke ? "speaker" : "listener",
        })),
    };
  }

  /**
   * Switch the public list on or off. Off is always allowed. On only before the space starts: guests are told
   * the list will be public when they join, so it cannot be switched on after people have joined.
   */
  async setPublicList(spaceId: string, adminId: number, enabled: boolean) {
    const space = await this.assertHost(spaceId, adminId);
    if (enabled && space.status !== "scheduled") {
      throw new AppError("cannot_publish", 409, "guests are told before they join, so this can only be switched on before the space starts");
    }
    await this.repo.setSpacePublicList(space.id, enabled);
    if (!enabled) await this.repo.setSpaceListOptin(space.id, false); // "stop sharing" ends every kind of public list
    await this.repo.logEvent(space.id, null, enabled ? "public_list_on" : "public_list_off");
    return this.toAdminView({ ...space, publicList: enabled, listOptin: enabled ? space.listOptin : false });
  }

  /**
   * For a space that already ended without a public list: open one that each guest chooses whether to appear on.
   * The guests were not told it would be public, so nobody is listed unless they say so themselves.
   */
  async openOptInList(spaceId: string, adminId: number) {
    const space = await this.assertHost(spaceId, adminId);
    if (space.status !== "ended") throw new AppError("cannot_open_list", 409, "a list can be opened once the space has ended");
    if (space.publicList) throw new AppError("cannot_open_list", 409, "this space already publishes everyone who stayed");
    await this.repo.setSpaceListOptin(space.id, true);
    await this.repo.logEvent(space.id, null, "list_optin_on");
    return this.toAdminView({ ...space, listOptin: true });
  }

  /** A guest chooses whether to appear on the opt-in public list. Their own join token only. */
  async shareMe(spaceId: string, token: string | null, share: unknown) {
    if (typeof share !== "boolean") throw new AppError("invalid_payload", 400, "share must be true or false");
    const space = await this.repo.getSpace(spaceId);
    if (!space) throw new AppError("space_not_found", 404);
    if (!space.listOptin) throw new AppError("list_not_open", 409, "the host has not opened a public list for this space");
    const me = token ? await this.repo.findParticipantByToken(sha256(token)) : null;
    if (!me || me.spaceId !== space.id || me.kickedAt || me.adminId !== null) {
      throw new AppError("forbidden", 403, "only guests who were in this space can choose this");
    }
    await this.repo.setShareMe(me.id, share);
    return { ok: true, share };
  }

  /**
   * What the public home page shows: the space that is live right now, and past ones. Titles, topics, host name and
   * size only: never a secret, never who joined. A host can keep any space off it (`unlisted`).
   */
  async directory(limit: number, before?: number) {
    const hostName = new Map<number, string>();
    const nameOf = async (adminId: number) => {
      if (!hostName.has(adminId)) {
        const a = await this.repo.findAdminRef(adminId);
        hostName.set(adminId, a ? a.displayName || a.username : "");
      }
      return hostName.get(adminId)!;
    };

    const room = this.room;
    const liveRow = room ? await this.repo.getSpace(room.spaceId) : null;
    const live =
      room && liveRow && liveRow.status === "live" && !liveRow.unlisted
        ? {
            id: liveRow.id,
            title: liveRow.title,
            tags: liveRow.tags,
            host: await nameOf(liveRow.hostAdminId),
            startedAt: liveRow.startedAt,
            speakerCount: room.speakerCount,
            listenerCount: room.listenerCount,
          }
        : null;

    const rows = await this.repo.listPastSpaces(limit + 1, before); // one extra tells us whether there is more
    const past = await Promise.all(
      rows.slice(0, limit).map(async (s) => ({
        id: s.id,
        title: s.title,
        tags: s.tags,
        host: await nameOf(s.hostAdminId),
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        people: s.people,
        /** whether a "who was there" page exists for it */
        listMode: listMode(s),
      })),
    );
    return { live, past, hasMore: rows.length > limit };
  }

  /** Show or hide a space on the public home page. Any time, any status. */
  async setListing(spaceId: string, adminId: number, listed: boolean) {
    const space = await this.assertHost(spaceId, adminId);
    await this.repo.setSpaceUnlisted(space.id, !listed);
    return this.toAdminView({ ...space, unlisted: !listed });
  }

  // ------------------------------------------------------------- moderation
  /** An attendee flags someone to the admin. Needs the reporter's own join token for that space. */
  async report(spaceId: string, token: string | null, input: { participantId: unknown; reason: unknown }) {
    const space = await this.repo.getSpace(spaceId);
    if (!space) throw new AppError("space_not_found", 404);
    const me = token ? await this.repo.findParticipantByToken(sha256(token)) : null;
    if (!me || me.spaceId !== space.id || me.kickedAt) throw new AppError("forbidden", 403, "only people in this space can report someone");

    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length < 3 || reason.length > 500) throw new AppError("invalid_reason", 400, "say what happened in a few words (3 to 500 characters)");
    const target = typeof input.participantId === "string" ? await this.repo.getParticipant(input.participantId) : null;
    if (!target || target.spaceId !== space.id) throw new AppError("participant_not_found", 404);
    if (target.id === me.id) throw new AppError("invalid_report", 400, "you can't report yourself");
    if (target.adminId !== null) throw new AppError("invalid_report", 400, "report the host to the people running this site, not here");
    if ((await this.repo.countReportsBy(space.id, me.id)) >= 10) throw new AppError("rate_limited", 429, "you have sent a lot of reports for this space");

    if ((await this.repo.createReport({ spaceId: space.id, reporterId: me.id, reportedId: target.id, reason })) === null) {
      throw new AppError("already_reported", 409, "you already reported this person");
    }
    return { ok: true };
  }

  /** Block a profile from every space. Anyone using it who is in the live room is removed at once. */
  async blockParticipant(adminId: number, participantId: string, reason: string | null) {
    const p = await this.repo.getParticipant(participantId);
    if (!p) throw new AppError("participant_not_found", 404);
    if (p.adminId !== null || !p.linkedinKey || !p.linkedinUrl) throw new AppError("cannot_block", 400, "only guests can be blocked");
    const block = await this.repo.blockProfile({
      linkedinKey: p.linkedinKey,
      linkedinUrl: p.linkedinUrl,
      name: p.name,
      reason: reason?.trim() || null,
      adminId,
    });
    await this.evictIfPresent(p.linkedinKey);
    return block;
  }

  async blockLinkedin(adminId: number, input: { linkedinUrl: string; name?: string; reason?: string | null }) {
    const linkedin = parseLinkedin(input.linkedinUrl);
    const block = await this.repo.blockProfile({
      linkedinKey: linkedin.key,
      linkedinUrl: linkedin.url,
      name: input.name?.trim() || linkedin.url,
      reason: input.reason?.trim() || null,
      adminId,
    });
    await this.evictIfPresent(linkedin.key);
    return block;
  }

  /** `adminId` must host the space the report was filed in, or it doesn't exist as far as they're concerned. */
  async blockFromReport(adminId: number, reportId: number, reason: string | null) {
    const report = await this.repo.getReport(reportId, adminId);
    if (!report) throw new AppError("report_not_found", 404);
    if (!report.reported.linkedinKey || !report.reported.linkedinUrl) throw new AppError("cannot_block", 400);
    const block = await this.blockParticipant(adminId, report.reported.id, reason ?? report.reason);
    await this.repo.resolveReport(reportId, "blocked");
    return block;
  }

  async dismissReport(reportId: number, adminId: number): Promise<void> {
    if (!(await this.repo.getReport(reportId, adminId))) throw new AppError("report_not_found", 404);
    await this.repo.resolveReport(reportId, "dismissed");
  }

  /** Remove anyone currently in the live room whose profile matches `linkedinKey`. */
  private async evictIfPresent(linkedinKey: string): Promise<void> {
    const room = this.room;
    if (!room || room.closed) return;
    const rows = await this.repo.listParticipants(room.spaceId);
    for (const row of rows) {
      if (row.linkedinKey !== linkedinKey) continue;
      const peer = room.peers.get(row.id);
      if (peer) await room.evict(peer);
    }
  }

  // ----------------------------------------------------------------- views
  /** What the public link page may see: no secret. */
  async publicView(spaceId: string) {
    const space = await this.repo.getSpace(spaceId);
    if (!space) throw new AppError("space_not_found", 404);
    const host = await this.repo.findAdminRef(space.hostAdminId);
    return {
      id: space.id,
      title: space.title,
      status: space.status,
      createdAt: space.createdAt,
      startedAt: space.startedAt,
      scheduledFor: space.scheduledFor,
      description: space.description,
      publicList: space.publicList,
      listMode: listMode(space),
      autoStart: space.autoStart,
      tags: space.tags,
      host: host ? { name: host.displayName || host.username, linkedinUrl: host.linkedinUrl } : null,
      endedAt: space.endedAt,
      speakerCount: this.room?.spaceId === space.id ? this.room.speakerCount : 0,
      listenerCount: this.room?.spaceId === space.id ? this.room.listenerCount : 0,
    };
  }

  toAdminView(space: SpaceRow) {
    return {
      id: space.id,
      title: space.title,
      secret: space.secret,
      status: space.status,
      createdAt: space.createdAt,
      startedAt: space.startedAt,
      scheduledFor: space.scheduledFor,
      description: space.description,
      publicList: space.publicList,
      listMode: listMode(space),
      autoStart: space.autoStart,
      tags: space.tags,
      unlisted: space.unlisted,
      endedAt: space.endedAt,
      endReason: space.endReason,
      joinUrl: `${this.config.publicWebUrl}/s/${space.id}`,
      /** the host's safety net, in minutes (0 = off), so the UI can tell them what will happen if they forget */
      autoEnd: {
        maxMinutes: Math.round(this.config.autoEnd.maxMs / 60_000),
        hostAbsentMinutes: Math.round(this.config.autoEnd.hostAbsentMs / 60_000),
        emptyMinutes: Math.round(this.config.autoEnd.emptyMs / 60_000),
      },
    };
  }

  private async requireLive(spaceId: string): Promise<SpaceRow> {
    const space = await this.repo.getSpace(spaceId);
    if (!space) throw new AppError("space_not_found", 404);
    if (space.status !== "live") throw new AppError("space_ended", 409);
    return space;
  }
}
