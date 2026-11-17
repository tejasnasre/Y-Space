import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** `scheduled` = created ahead of time, not open for joining until the host starts it. */
export const spaceStatus = pgEnum("space_status", ["scheduled", "live", "ended"]);

export const admins = pgTable(
  "admins",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    username: text().notNull(),
    passwordHash: text("password_hash").notNull(),
    /** public name shown to attendees instead of the login username */
    displayName: text("display_name"),
    linkedinUrl: text("linkedin_url"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    // usernames are case-insensitive
    uniqueIndex("admins_username_lower").on(sql`lower(${t.username})`),
  ],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    adminId: integer("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("admin_sessions_expires").on(t.expiresAt)],
);

export const spaces = pgTable(
  "spaces",
  {
    id: text().primaryKey(),
    title: text().notNull(),
    secret: text().notNull(),
    hostAdminId: integer("host_admin_id")
      .notNull()
      .references(() => admins.id),
    status: spaceStatus().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    /** when it went live. NULL for rows from before this column existed (treated as created_at) and for scheduled spaces */
    startedAt: ts("started_at"),
    /** when the host plans to start a scheduled space */
    scheduledFor: ts("scheduled_for"),
    description: text(),
    /** the host chose, before anyone joined, to publish the attendee list once the space ends. Guests are told when they join. */
    publicList: boolean("public_list").notNull().default(false),
    /** a scheduled space opens by itself at `scheduledFor` (the host still has to show up: see HOST_ABSENT_MINUTES) */
    autoStart: boolean("auto_start").notNull().default(false),
    /** an ended space whose host opened a public list that each guest chooses to appear on (see participants.sharePublicly) */
    listOptin: boolean("list_optin").notNull().default(false),
    /** up to 5 topic tags, stored lowercase without the "#" (the UI shows #tech) */
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** the host asked to keep this space off the public home page (title, topics, host, size) */
    unlisted: boolean("unlisted").notNull().default(false),
    endedAt: ts("ended_at"),
    endReason: text("end_reason"),
  },
  (t) => [
    // Hard guarantee: at most ONE live space at any time.
    uniqueIndex("spaces_one_live")
      .on(t.status)
      .where(sql`${t.status} = 'live'`),
    index("spaces_created").on(t.createdAt),
  ],
);

export const participants = pgTable(
  "participants",
  {
    id: uuid().primaryKey().defaultRandom(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    /** set only for the host */
    adminId: integer("admin_id").references(() => admins.id),
    name: text().notNull(),
    linkedinUrl: text("linkedin_url"),
    linkedinKey: text("linkedin_key"),
    /** sha256 of the session token. NULL for the host (uses an admin session) and for kicked guests. */
    tokenHash: text("token_hash").unique(),
    joinedAt: ts("joined_at").notNull().defaultNow(),
    leftAt: ts("left_at"),
    kickedAt: ts("kicked_at"),
    /** was ever on stage */
    spoke: boolean().notNull().default(false),
    /** currently a co-host: keeps moderation powers across a reconnect */
    cohost: boolean().notNull().default(false),
    /** this guest chose to appear on the space's public list */
    sharePublicly: boolean("share_publicly").notNull().default(false),
  },
  (t) => [
    index("participants_space").on(t.spaceId),
    index("participants_space_linkedin").on(t.spaceId, t.linkedinKey),
  ],
);

export const spaceEvents = pgTable(
  "space_events",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id"),
    type: text().notNull(),
    data: jsonb(),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("space_events_space").on(t.spaceId, t.id)],
);

/** Profiles the admin has blocked from every space. Matched by the normalised LinkedIn key. */
export const blockedProfiles = pgTable("blocked_profiles", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  linkedinKey: text("linkedin_key").notNull().unique(),
  linkedinUrl: text("linkedin_url").notNull(),
  name: text().notNull(),
  reason: text(),
  blockedBy: integer("blocked_by")
    .notNull()
    .references(() => admins.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** An attendee flagging someone to the admin. */
export const reports = pgTable(
  "reports",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    reportedId: uuid("reported_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    reason: text().notNull(),
    /** open | dismissed | blocked */
    status: text().notNull().default("open"),
    createdAt: ts("created_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [index("reports_status").on(t.status, t.createdAt), uniqueIndex("reports_once").on(t.reporterId, t.reportedId)],
);
