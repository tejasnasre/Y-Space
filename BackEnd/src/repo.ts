import { and, asc, desc, eq, gt, isNotNull, isNull, lt, getTableColumns, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "./db";
import { adminSessions, admins, blockedProfiles, participants, reports, spaceEvents, spaces } from "./db/schema";

export interface AdminRow {
  id: number;
  username: string;
  passwordHash: string;
  displayName: string | null;
  linkedinUrl: string | null;
}

export interface AdminRef {
  id: number;
  username: string;
  /** public name shown to attendees; falls back to the username */
  displayName: string | null;
  linkedinUrl: string | null;
}

/** Timestamps are exposed as epoch milliseconds (stored as timestamptz). */
export interface SpaceRow {
  id: string;
  title: string;
  secret: string;
  hostAdminId: number;
  status: "scheduled" | "live" | "ended";
  createdAt: number;
  /** when it went live (falls back to createdAt for older rows); for a scheduled space, when it was created */
  startedAt: number;
  scheduledFor: number | null;
  description: string | null;
  /** the attendee list is published once the space ends (chosen before anyone joined) */
  publicList: boolean;
  /** opens by itself at `scheduledFor` */
  autoStart: boolean;
  /** the host opened a public list for guests to opt in to */
  listOptin: boolean;
  /** topic tags, lowercase, no "#" */
  tags: string[];
  /** kept off the public home page */
  unlisted: boolean;
  endedAt: number | null;
  endReason: string | null;
}

export interface ParticipantRow {
  id: string;
  spaceId: string;
  adminId: number | null;
  name: string;
  linkedinUrl: string | null;
  linkedinKey: string | null;
  joinedAt: number;
  leftAt: number | null;
  kickedAt: number | null;
  spoke: boolean;
  cohost: boolean;
  /** chose to appear on the public list */
  sharePublicly: boolean;
}

export interface BlockRow {
  id: number;
  linkedinKey: string;
  linkedinUrl: string;
  name: string;
  reason: string | null;
  createdAt: number;
}

export interface ReportRow {
  id: number;
  spaceId: string;
  spaceTitle: string;
  reason: string;
  status: string;
  createdAt: number;
  reporter: { id: string; name: string };
  reported: { id: string; name: string; linkedinUrl: string | null; linkedinKey: string | null };
}

export interface EventRow {
  id: number;
  participantId: string | null;
  type: string;
  data: unknown;
  at: number;
}

const ms = (d: Date | null): number | null => (d ? d.getTime() : null);

const toSpace = (r: typeof spaces.$inferSelect): SpaceRow => ({
  id: r.id,
  title: r.title,
  secret: r.secret,
  hostAdminId: r.hostAdminId,
  status: r.status,
  createdAt: r.createdAt.getTime(),
  startedAt: (r.startedAt ?? r.createdAt).getTime(),
  scheduledFor: ms(r.scheduledFor),
  description: r.description,
  publicList: r.publicList,
  autoStart: r.autoStart,
  listOptin: r.listOptin,
  tags: r.tags,
  unlisted: r.unlisted,
  endedAt: ms(r.endedAt),
  endReason: r.endReason,
});

const toParticipant = (r: typeof participants.$inferSelect): ParticipantRow => ({
  id: r.id,
  spaceId: r.spaceId,
  adminId: r.adminId,
  name: r.name,
  linkedinUrl: r.linkedinUrl,
  linkedinKey: r.linkedinKey,
  joinedAt: r.joinedAt.getTime(),
  leftAt: ms(r.leftAt),
  kickedAt: ms(r.kickedAt),
  spoke: r.spoke,
  cohost: r.cohost,
  sharePublicly: r.sharePublicly,
});

const toBlock = (r: typeof blockedProfiles.$inferSelect): BlockRow => ({
  id: r.id,
  linkedinKey: r.linkedinKey,
  linkedinUrl: r.linkedinUrl,
  name: r.name,
  reason: r.reason,
  createdAt: r.createdAt.getTime(),
});

const toReport = (r: {
  id: number;
  spaceId: string;
  spaceTitle: string;
  reason: string;
  status: string;
  createdAt: Date;
  reporterId: string;
  reporterName: string;
  reportedId: string;
  reportedName: string;
  reportedLinkedinUrl: string | null;
  reportedLinkedinKey: string | null;
}): ReportRow => ({
  id: r.id,
  spaceId: r.spaceId,
  spaceTitle: r.spaceTitle,
  reason: r.reason,
  status: r.status,
  createdAt: r.createdAt.getTime(),
  reporter: { id: r.reporterId, name: r.reporterName },
  reported: { id: r.reportedId, name: r.reportedName, linkedinUrl: r.reportedLinkedinUrl, linkedinKey: r.reportedLinkedinKey },
});

/** True for Postgres error 23505 (unique_violation), including when wrapped by Drizzle. */
export function isUniqueViolation(e: unknown): boolean {
  for (let err: any = e, i = 0; err && i < 5; err = err.cause, i++) {
    if (err.code === "23505" || err.errno === "23505") return true;
  }
  return false;
}

/** All SQL lives here (Drizzle + Postgres). Every parameter is bound, never interpolated. */
export class Repo {
  constructor(readonly db: Db) {}

  // ---------------------------------------------------------------- admins
  async createAdmin(username: string, passwordHash: string): Promise<void> {
    await this.db.insert(admins).values({ username, passwordHash });
  }

  async setAdminPassword(username: string, passwordHash: string): Promise<boolean> {
    const rows = await this.db
      .update(admins)
      .set({ passwordHash })
      .where(sql`lower(${admins.username}) = lower(${username})`)
      .returning({ id: admins.id });
    return rows.length > 0;
  }

  async findAdminByUsername(username: string): Promise<AdminRow | null> {
    const [r] = await this.db
      .select()
      .from(admins)
      .where(sql`lower(${admins.username}) = lower(${username})`);
    return r
      ? { id: r.id, username: r.username, passwordHash: r.passwordHash, displayName: r.displayName, linkedinUrl: r.linkedinUrl }
      : null;
  }

  async findAdminRef(id: number): Promise<AdminRef | null> {
    const [r] = await this.db.select().from(admins).where(eq(admins.id, id));
    return r ? { id: r.id, username: r.username, displayName: r.displayName, linkedinUrl: r.linkedinUrl } : null;
  }

  async updateAdminProfile(id: number, profile: { displayName: string | null; linkedinUrl: string | null }): Promise<AdminRef | null> {
    const [r] = await this.db.update(admins).set(profile).where(eq(admins.id, id)).returning();
    return r ? { id: r.id, username: r.username, displayName: r.displayName, linkedinUrl: r.linkedinUrl } : null;
  }

  // -------------------------------------------------------- admin sessions
  async createAdminSession(tokenHash: string, adminId: number, expiresAt: number): Promise<void> {
    await this.db.insert(adminSessions).values({ tokenHash, adminId, expiresAt: new Date(expiresAt) });
  }

  /** The admin for a valid, unexpired session token hash. */
  async findAdminBySession(tokenHash: string): Promise<AdminRef | null> {
    const [r] = await this.db
      .select({ id: admins.id, username: admins.username, displayName: admins.displayName, linkedinUrl: admins.linkedinUrl })
      .from(adminSessions)
      .innerJoin(admins, eq(admins.id, adminSessions.adminId))
      .where(and(eq(adminSessions.tokenHash, tokenHash), gt(adminSessions.expiresAt, new Date())));
    return r ?? null;
  }

  async deleteAdminSession(tokenHash: string): Promise<void> {
    await this.db.delete(adminSessions).where(eq(adminSessions.tokenHash, tokenHash));
  }

  async pruneAdminSessions(): Promise<void> {
    await this.db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));
  }

  // ---------------------------------------------------------------- spaces
  /** Throws a unique violation (see isUniqueViolation) if a live space already exists. */
  /** A live space starts now. A scheduled one (`scheduledFor`) stays closed until the host starts it. */
  async insertSpace(s: {
    id: string;
    title: string;
    secret: string;
    hostAdminId: number;
    scheduledFor?: number;
    description?: string | null;
    publicList?: boolean;
    autoStart?: boolean;
    tags?: string[];
    unlisted?: boolean;
  }): Promise<SpaceRow> {
    const scheduled = s.scheduledFor !== undefined;
    const [r] = await this.db
      .insert(spaces)
      .values({
        id: s.id,
        title: s.title,
        secret: s.secret,
        hostAdminId: s.hostAdminId,
        description: s.description ?? null,
        publicList: s.publicList ?? false,
        autoStart: scheduled && s.autoStart === true,
        tags: s.tags ?? [],
        unlisted: s.unlisted === true,
        status: scheduled ? "scheduled" : "live",
        // same statement as the created_at default, so a space that goes live on creation has startedAt === createdAt
        startedAt: scheduled ? null : sql`now()`,
        scheduledFor: scheduled ? new Date(s.scheduledFor!) : null,
      })
      .returning();
    return toSpace(r!);
  }

  /** scheduled -> live. Throws a unique violation if another space is already live. */
  async startScheduledSpace(id: string): Promise<SpaceRow | null> {
    const [r] = await this.db
      .update(spaces)
      .set({ status: "live", startedAt: new Date() })
      .where(and(eq(spaces.id, id), eq(spaces.status, "scheduled")))
      .returning();
    return r ? toSpace(r) : null;
  }

  async cancelScheduledSpace(id: string, reason: string): Promise<boolean> {
    const rows = await this.db
      .update(spaces)
      .set({ status: "ended", endedAt: new Date(), endReason: reason })
      .where(and(eq(spaces.id, id), eq(spaces.status, "scheduled")))
      .returning({ id: spaces.id });
    return rows.length > 0;
  }

  async updateScheduledSpace(
    id: string,
    patch: { title?: string; description?: string | null; scheduledFor?: number; publicList?: boolean; autoStart?: boolean; tags?: string[] },
  ): Promise<SpaceRow | null> {
    const set: Partial<typeof spaces.$inferInsert> = {};
    if (patch.tags !== undefined) set.tags = patch.tags;
    if (patch.autoStart !== undefined) set.autoStart = patch.autoStart;
    if (patch.publicList !== undefined) set.publicList = patch.publicList;
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.scheduledFor !== undefined) set.scheduledFor = new Date(patch.scheduledFor);
    if (Object.keys(set).length === 0) return this.getSpace(id).then((x) => (x?.status === "scheduled" ? x : null));
    const [r] = await this.db
      .update(spaces)
      .set(set)
      .where(and(eq(spaces.id, id), eq(spaces.status, "scheduled")))
      .returning();
    return r ? toSpace(r) : null;
  }

  async getSpace(id: string): Promise<SpaceRow | null> {
    const [r] = await this.db.select().from(spaces).where(eq(spaces.id, id));
    return r ? toSpace(r) : null;
  }

  /** `hostAdminId`: restrict to a space owned by that admin (so one host can't peek at another's live space). */
  async getLiveSpace(hostAdminId?: number): Promise<SpaceRow | null> {
    const [r] = await this.db
      .select()
      .from(spaces)
      .where(hostAdminId === undefined ? eq(spaces.status, "live") : and(eq(spaces.status, "live"), eq(spaces.hostAdminId, hostAdminId)));
    return r ? toSpace(r) : null;
  }

  /**
   * Scheduled spaces whose time has come and that opted in to opening by themselves. Uses the database clock.
   * A space that is further past its time than `graceMs` is left alone (the host can still start it by hand).
   */
  async listDueAutoStart(graceMs: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: spaces.id })
      .from(spaces)
      .where(
        and(
          eq(spaces.status, "scheduled"),
          eq(spaces.autoStart, true),
          sql`${spaces.scheduledFor} <= now()`,
          sql`${spaces.scheduledFor} > now() - (${Math.round(graceMs / 1000)} * interval '1 second')`,
        ),
      )
      .orderBy(asc(spaces.scheduledFor));
    return rows.map((r) => r.id);
  }

  async setSpaceListOptin(id: string, listOptin: boolean): Promise<void> {
    await this.db.update(spaces).set({ listOptin }).where(eq(spaces.id, id));
  }

  async setShareMe(participantId: string, share: boolean): Promise<void> {
    await this.db.update(participants).set({ sharePublicly: share }).where(eq(participants.id, participantId));
  }

  async setSpaceUnlisted(id: string, unlisted: boolean): Promise<void> {
    await this.db.update(spaces).set({ unlisted }).where(eq(spaces.id, id));
  }

  /**
   * Finished spaces for the public home page, newest first. Left out: spaces the host kept off the page,
   * cancelled ones, and ones that failed to start. `before` is the `endedAt` of the last item already shown.
   */
  async listPastSpaces(limit: number, before?: number): Promise<(SpaceRow & { people: number })[]> {
    const rows = await this.db
      .select({
        ...getTableColumns(spaces),
        people: sql<number>`(select count(*)::int from participants p where p.space_id = "spaces"."id" and p.admin_id is null and p.kicked_at is null)`,
      })
      .from(spaces)
      .where(
        and(
          eq(spaces.status, "ended"),
          eq(spaces.unlisted, false),
          sql`coalesce(${spaces.endReason}, '') not in ('cancelled', 'error')`,
          before === undefined ? undefined : lt(spaces.endedAt, new Date(before)),
        ),
      )
      .orderBy(desc(spaces.endedAt))
      .limit(limit);
    return rows.map(({ people, ...r }) => ({ ...toSpace(r), people }));
  }

  async setSpacePublicList(id: string, publicList: boolean): Promise<void> {
    await this.db.update(spaces).set({ publicList }).where(eq(spaces.id, id));
  }

  /** People in this space who have an unreviewed report against them. Kept off any public list until the admin decides. */
  async listOpenReportedIds(spaceId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ id: reports.reportedId })
      .from(reports)
      .where(and(eq(reports.spaceId, spaceId), eq(reports.status, "open")));
    return new Set(rows.map((r) => r.id));
  }

  async setSpaceSecret(id: string, secret: string): Promise<void> {
    await this.db.update(spaces).set({ secret }).where(eq(spaces.id, id));
  }

  async endSpace(id: string, reason: string): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(spaces)
        .set({ status: "ended", endedAt: now, endReason: reason })
        .where(and(eq(spaces.id, id), eq(spaces.status, "live")));
      // anyone still marked present is now gone
      await tx
        .update(participants)
        .set({ leftAt: now })
        .where(and(eq(participants.spaceId, id), isNull(participants.leftAt)));
    });
  }

  /** On boot: the in-memory room is gone, so any 'live' row is stale. */
  async endAllLive(reason: string): Promise<number> {
    const live = await this.db.select({ id: spaces.id }).from(spaces).where(eq(spaces.status, "live"));
    for (const s of live) {
      await this.endSpace(s.id, reason);
      await this.logEvent(s.id, null, "space_ended", { reason });
    }
    return live.length;
  }

  /** `hostAdminId`: only that admin's own spaces (never another host's, never their secrets). */
  async listSpaces(limit: number, before?: number, hostAdminId?: number) {
    const rows = await this.db
      .select({
        ...getTableColumns(spaces),
        participantCount: sql<number>`(select count(*)::int from participants p where p.space_id = "spaces"."id" and p.admin_id is null)`,
        speakerCount: sql<number>`(select count(*)::int from participants p where p.space_id = "spaces"."id" and p.spoke and p.admin_id is null)`,
      })
      .from(spaces)
      .where(
        and(
          before === undefined ? undefined : lt(spaces.createdAt, new Date(before)),
          hostAdminId === undefined ? undefined : eq(spaces.hostAdminId, hostAdminId),
        ),
      )
      .orderBy(desc(spaces.createdAt))
      .limit(limit);
    return rows.map(({ participantCount, speakerCount, ...r }) => ({
      ...toSpace(r),
      participantCount,
      speakerCount,
    }));
  }

  // ---------------------------------------------------------- participants
  async insertGuest(p: {
    id: string;
    spaceId: string;
    name: string;
    linkedinUrl: string;
    linkedinKey: string;
    tokenHash: string;
  }): Promise<void> {
    await this.db.insert(participants).values(p);
  }

  /** The host's participant row for a space; created on first connect, and kept in step with their profile. */
  async ensureHostParticipant(spaceId: string, adminId: number, name: string, linkedinUrl: string | null): Promise<ParticipantRow> {
    const find = () =>
      this.db
        .select()
        .from(participants)
        .where(and(eq(participants.spaceId, spaceId), eq(participants.adminId, adminId)));
    const [existing] = await find();
    if (existing) {
      if (existing.name === name && existing.linkedinUrl === linkedinUrl) return toParticipant(existing);
      const [updated] = await this.db
        .update(participants)
        .set({ name, linkedinUrl })
        .where(eq(participants.id, existing.id))
        .returning();
      return toParticipant(updated!);
    }
    const [created] = await this.db
      .insert(participants)
      .values({ spaceId, adminId, name, linkedinUrl, spoke: true })
      .returning();
    return toParticipant(created!);
  }

  async findParticipantByToken(tokenHash: string): Promise<ParticipantRow | null> {
    const [r] = await this.db.select().from(participants).where(eq(participants.tokenHash, tokenHash));
    return r ? toParticipant(r) : null;
  }

  async isLinkedinKicked(spaceId: string, linkedinKey: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: participants.id })
      .from(participants)
      .where(
        and(
          eq(participants.spaceId, spaceId),
          eq(participants.linkedinKey, linkedinKey),
          isNotNull(participants.kickedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async markPresent(id: string): Promise<void> {
    await this.db.update(participants).set({ leftAt: null }).where(eq(participants.id, id));
  }

  async markLeft(id: string): Promise<void> {
    await this.db
      .update(participants)
      .set({ leftAt: new Date() })
      .where(and(eq(participants.id, id), isNull(participants.leftAt)));
  }

  async setCohost(id: string, cohost: boolean): Promise<void> {
    await this.db.update(participants).set({ cohost }).where(eq(participants.id, id));
  }

  async getParticipant(id: string): Promise<ParticipantRow | null> {
    const [r] = await this.db.select().from(participants).where(eq(participants.id, id));
    return r ? toParticipant(r) : null;
  }

  async markSpoke(id: string): Promise<void> {
    await this.db.update(participants).set({ spoke: true }).where(eq(participants.id, id));
  }

  /** Kick = remember it, revoke the session token. */
  async markKicked(id: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(participants)
      .set({ kickedAt: now, leftAt: sql`coalesce(${participants.leftAt}, ${now})`, tokenHash: null })
      .where(eq(participants.id, id));
  }

  async listParticipants(spaceId: string): Promise<ParticipantRow[]> {
    const rows = await this.db
      .select()
      .from(participants)
      .where(eq(participants.spaceId, spaceId))
      .orderBy(asc(participants.joinedAt));
    return rows.map(toParticipant);
  }

  // ---------------------------------------------------------------- events
  async logEvent(spaceId: string, participantId: string | null, type: string, data?: unknown): Promise<void> {
    await this.db.insert(spaceEvents).values({ spaceId, participantId, type, data: data ?? null });
  }

  async listEvents(spaceId: string): Promise<EventRow[]> {
    const rows = await this.db
      .select()
      .from(spaceEvents)
      .where(eq(spaceEvents.spaceId, spaceId))
      .orderBy(asc(spaceEvents.id));
    return rows.map((r) => ({ id: r.id, participantId: r.participantId, type: r.type, data: r.data, at: r.at.getTime() }));
  }

  // ----------------------------------------------------------------- blocks
  async isBlocked(linkedinKey: string): Promise<boolean> {
    const rows = await this.db.select({ id: blockedProfiles.id }).from(blockedProfiles).where(eq(blockedProfiles.linkedinKey, linkedinKey)).limit(1);
    return rows.length > 0;
  }

  async blockProfile(b: { linkedinKey: string; linkedinUrl: string; name: string; reason: string | null; adminId: number }): Promise<BlockRow> {
    const [r] = await this.db
      .insert(blockedProfiles)
      .values({ linkedinKey: b.linkedinKey, linkedinUrl: b.linkedinUrl, name: b.name, reason: b.reason, blockedBy: b.adminId })
      .onConflictDoUpdate({ target: blockedProfiles.linkedinKey, set: { name: b.name, reason: b.reason } })
      .returning();
    return toBlock(r!);
  }

  async unblock(id: number): Promise<boolean> {
    const rows = await this.db.delete(blockedProfiles).where(eq(blockedProfiles.id, id)).returning({ id: blockedProfiles.id });
    return rows.length > 0;
  }

  async listBlocks(): Promise<BlockRow[]> {
    const rows = await this.db.select().from(blockedProfiles).orderBy(desc(blockedProfiles.createdAt));
    return rows.map(toBlock);
  }

  // ---------------------------------------------------------------- reports
  /** One report per reporter per person. Returns null if this reporter already reported them. */
  async createReport(r: { spaceId: string; reporterId: string; reportedId: string; reason: string }): Promise<number | null> {
    const rows = await this.db.insert(reports).values(r).onConflictDoNothing().returning({ id: reports.id });
    return rows[0]?.id ?? null;
  }

  async countReportsBy(spaceId: string, reporterId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(reports)
      .where(and(eq(reports.spaceId, spaceId), eq(reports.reporterId, reporterId)));
    return r?.n ?? 0;
  }

  /** `hostAdminId`: only reports filed in spaces that admin hosts (never another host's reports). */
  async listReports(status?: string, hostAdminId?: number): Promise<ReportRow[]> {
    const reporter = alias(participants, "reporter");
    const reported = alias(participants, "reported");
    const rows = await this.db
      .select({
        id: reports.id,
        spaceId: reports.spaceId,
        spaceTitle: spaces.title,
        reason: reports.reason,
        status: reports.status,
        createdAt: reports.createdAt,
        reporterId: reporter.id,
        reporterName: reporter.name,
        reportedId: reported.id,
        reportedName: reported.name,
        reportedLinkedinUrl: reported.linkedinUrl,
        reportedLinkedinKey: reported.linkedinKey,
      })
      .from(reports)
      .innerJoin(spaces, eq(spaces.id, reports.spaceId))
      .innerJoin(reporter, eq(reporter.id, reports.reporterId))
      .innerJoin(reported, eq(reported.id, reports.reportedId))
      .where(and(status ? eq(reports.status, status) : undefined, hostAdminId === undefined ? undefined : eq(spaces.hostAdminId, hostAdminId)))
      .orderBy(desc(reports.createdAt));
    return rows.map(toReport);
  }

  /** `hostAdminId`: only if that admin hosts the report's space (never another host's report). */
  async getReport(id: number, hostAdminId?: number): Promise<ReportRow | null> {
    return (await this.listReports(undefined, hostAdminId)).find((r) => r.id === id) ?? null;
  }

  async resolveReport(id: number, status: "dismissed" | "blocked"): Promise<void> {
    await this.db.update(reports).set({ status, resolvedAt: new Date() }).where(eq(reports.id, id));
  }
}

