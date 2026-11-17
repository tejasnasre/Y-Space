export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface AdminSession {
  token: string;
  expiresAt: string;
  admin: { id: string; username: string };
}

export interface AdminProfile {
  id: number;
  username: string;
  /** how the host appears to attendees; falls back to the username */
  displayName: string | null;
  linkedinUrl: string | null;
}

/** How a space's attendee list is shared: not at all, everyone who stayed (chosen before the space), or only guests who opt in. */
export type ListMode = "off" | "everyone" | "optin";

export interface AdminSpace {
  id: string;
  title: string;
  secret: string;
  status: "scheduled" | "live" | "ended";
  /** ms since epoch */
  createdAt: number;
  /** when it went live (equals createdAt for a space started on creation) */
  startedAt: number;
  /** when the host plans to open a scheduled space */
  scheduledFor: number | null;
  description: string | null;
  /** the attendee list is published for anyone once the space ends */
  publicList: boolean;
  listMode: ListMode;
  /** a scheduled space opens by itself at its time */
  autoStart: boolean;
  /** topic tags, lowercase, shown as #tag */
  tags: string[];
  /** kept off the public home page */
  unlisted: boolean;
  endedAt: number | null;
  endReason: string | null;
  joinUrl: string;
  participantCount?: number;
  speakerCount?: number;
  /** the server's forgotten-space limits, in minutes (0 = off). Only on admin views of a space. */
  autoEnd?: { maxMinutes: number; hostAbsentMinutes: number; emptyMinutes: number };
}

export interface PublicSpace {
  id: string;
  title: string;
  status: "scheduled" | "live" | "ended";
  /** ms since epoch */
  createdAt: number;
  startedAt: number;
  scheduledFor: number | null;
  description: string | null;
  /** guests are told, before they join, that the attendee list will be published */
  publicList: boolean;
  listMode: ListMode;
  /** a scheduled space opens by itself at its time */
  autoStart: boolean;
  tags: string[];
  host: { name: string; linkedinUrl: string | null } | null;
  endedAt: number | null;
  speakerCount: number;
  listenerCount: number;
}

export interface SpaceParticipant {
  id: string;
  name: string;
  linkedinUrl: string | null;
  isHost: boolean;
  joinedAt: number;
  leftAt: number | null;
  kickedAt: number | null;
  spoke: boolean;
  cohost: boolean;
  /** this guest chose to appear on the opt-in public list */
  sharePublicly: boolean;
  /** this profile is on the admin's block list */
  blocked: boolean;
}

export interface SpaceEvent {
  id: number;
  participantId: string | null;
  type: string;
  data: unknown;
  at: number;
}

export interface SpaceDetail {
  space: AdminSpace;
  participants: SpaceParticipant[];
  events: SpaceEvent[];
}

/** One person on the "who was here" list shared with attendees after a space ends. */
export interface Attendee {
  id: string;
  name: string;
  linkedinUrl: string | null;
  isHost: boolean;
  spoke: boolean;
  joinedAt: number;
  leftAt: number | null;
}

export interface Attendees {
  space: { id: string; title: string; createdAt: number; endedAt: number | null; publicList: boolean; listMode: ListMode };
  /** the caller's own participant id */
  you: string;
  /** whether you chose to appear on the opt-in public list */
  youShare: boolean;
  attendees: Attendee[];
}

export interface JoinResult {
  token: string;
  participant: { id: string; name: string };
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        "ngrok-skip-browser-warning": "1",
        ...(rest.body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError("network_error", 0, `Cannot reach the API at ${API_URL}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? "unknown_error", res.status, data.message);
  return data as T;
}

const json = (body: unknown) => JSON.stringify(body);

export interface Block {
  id: number;
  linkedinKey: string;
  linkedinUrl: string;
  name: string;
  reason: string | null;
  createdAt: number;
}

export interface Report {
  id: number;
  spaceId: string;
  spaceTitle: string;
  reason: string;
  status: "open" | "dismissed" | "blocked";
  createdAt: number;
  reporter: { id: string; name: string };
  reported: { id: string; name: string; linkedinUrl: string | null; linkedinKey: string | null };
}

/** One person on the public list: no times, no tokens. */
export interface PublicAttendee {
  id: string;
  name: string;
  linkedinUrl: string | null;
  role: "host" | "cohost" | "speaker" | "listener";
}

export interface PublicAttendees {
  mode: Exclude<ListMode, "off">;
  space: { id: string; title: string; tags: string[]; startedAt: number; endedAt: number | null; host: { name: string; linkedinUrl: string | null } | null };
  attendees: PublicAttendee[];
}

/** The space that is live right now, as the public home page shows it. */
export interface DirectoryLive {
  id: string;
  title: string;
  tags: string[];
  host: string;
  startedAt: number;
  speakerCount: number;
  listenerCount: number;
}

/** A finished space on the public home page. Title, topics, host and size only. */
export interface DirectoryPast {
  id: string;
  title: string;
  tags: string[];
  host: string;
  startedAt: number;
  endedAt: number;
  /** guests who joined (not counting the host or anyone removed) */
  people: number;
  /** a "who was there" page exists when this is not "off" */
  listMode: ListMode;
}

export interface Directory {
  live: DirectoryLive | null;
  past: DirectoryPast[];
  hasMore: boolean;
}

export interface SpaceInput {
  /** keep it off the public home page */
  unlisted?: boolean;
  title: string;
  /** publish the attendee list once it ends; guests are told when they join */
  publicList?: boolean;
  /** open a scheduled space by itself at its time */
  autoStart?: boolean;
  /** up to 5 topic tags */
  tags?: string[];
  secret?: string;
  description?: string;
  /** epoch ms: book it for later instead of starting now */
  scheduledFor?: number;
}

export const api = {
  health: () => request<{ ok: boolean; live: string | null }>("/health"),
  login: (username: string, password: string) =>
    request<AdminSession>("/api/admin/login", { method: "POST", body: json({ username, password }) }),
  logout: (token: string) => request<{ ok: true }>("/api/admin/logout", { method: "POST", token }),
  me: (token: string) => request<AdminProfile>("/api/admin/me", { token }),
  updateProfile: (token: string, body: { displayName: string | null; linkedinUrl: string | null }) =>
    request<AdminProfile>("/api/admin/me", { method: "PATCH", token, body: json(body) }),
  currentSpace: (token: string) => request<{ space: AdminSpace | null }>("/api/admin/spaces/current", { token }),
  listSpaces: (token: string) => request<{ spaces: AdminSpace[] }>("/api/admin/spaces?limit=20", { token }),
  createSpace: (token: string, body: SpaceInput) =>
    request<AdminSpace>("/api/admin/spaces", { method: "POST", token, body: json(body) }),
  updateSpace: (token: string, id: string, body: { title?: string; description?: string | null; scheduledFor?: number; publicList?: boolean; autoStart?: boolean; tags?: string[] }) =>
    request<AdminSpace>(`/api/admin/spaces/${id}`, { method: "PATCH", token, body: json(body) }),
  /** An ended, private space: let guests opt in to a public list. `false` stops sharing. */
  openOptInList: (token: string, id: string, enabled: boolean) =>
    request<AdminSpace>(`/api/admin/spaces/${id}/optin-list`, { method: "POST", token, body: json({ enabled }) }),
  /** A guest chooses whether to appear on the opt-in public list. */
  shareMe: (spaceId: string, token: string, share: boolean) =>
    request<{ ok: true; share: boolean }>(`/api/spaces/${spaceId}/share-me`, { method: "POST", token, body: json({ share }) }),
  /** Show a space on the public home page, or hide it. */
  setListing: (token: string, id: string, listed: boolean) =>
    request<AdminSpace>(`/api/admin/spaces/${id}/listing`, { method: "POST", token, body: json({ listed }) }),
  /** What is live now and past spaces, for the public home page. No sign-in needed. */
  directory: (limit = 12, before?: number) =>
    request<Directory>(`/api/spaces?limit=${limit}${before ? `&before=${before}` : ""}`),
  setPublicList: (token: string, id: string, enabled: boolean) =>
    request<AdminSpace>(`/api/admin/spaces/${id}/public-list`, { method: "POST", token, body: json({ enabled }) }),
  startSpace: (token: string, id: string) => request<AdminSpace>(`/api/admin/spaces/${id}/start`, { method: "POST", token }),
  cancelSpace: (token: string, id: string) => request<{ ok: true }>(`/api/admin/spaces/${id}/cancel`, { method: "POST", token }),
  extendSpace: (token: string, id: string) =>
    request<{ extendedByMinutes: number }>(`/api/admin/spaces/${id}/extend`, { method: "POST", token }),
  endSpace: (token: string, id: string) =>
    request<{ ok: true }>(`/api/admin/spaces/${id}/end`, { method: "POST", token }),
  rotateSecret: (token: string, id: string, secret?: string) =>
    request<AdminSpace | { secret: string }>(`/api/admin/spaces/${id}/secret`, {
      method: "POST",
      token,
      body: json(secret ? { secret } : {}),
    }),
  spaceDetail: (token: string, id: string) => request<SpaceDetail>(`/api/admin/spaces/${id}`, { token }),
  listBlocks: (token: string) => request<{ blocks: Block[] }>("/api/admin/blocks", { token }),
  blockParticipant: (token: string, participantId: string, reason?: string) =>
    request<Block>("/api/admin/blocks", { method: "POST", token, body: json({ participantId, reason }) }),
  blockLinkedin: (token: string, body: { linkedinUrl: string; name?: string; reason?: string }) =>
    request<Block>("/api/admin/blocks", { method: "POST", token, body: json(body) }),
  unblock: (token: string, id: number) => request<{ ok: true }>(`/api/admin/blocks/${id}`, { method: "DELETE", token }),
  listReports: (token: string, status?: Report["status"]) =>
    request<{ reports: Report[] }>(`/api/admin/reports${status ? `?status=${status}` : ""}`, { token }),
  dismissReport: (token: string, id: number) => request<{ ok: true }>(`/api/admin/reports/${id}/dismiss`, { method: "POST", token }),
  blockFromReport: (token: string, id: number, reason?: string) =>
    request<Block>(`/api/admin/reports/${id}/block`, { method: "POST", token, body: json(reason ? { reason } : {}) }),
  /** An attendee flags someone to the admin. Needs the caller's own guest token. */
  reportPerson: (spaceId: string, token: string, body: { participantId: string; reason: string }) =>
    request<{ ok: true }>(`/api/spaces/${spaceId}/reports`, { method: "POST", token, body: json(body) }),
  publicSpace: (id: string) => request<PublicSpace>(`/api/spaces/${id}`),
  /** The attendee list of an ended space whose host published it. No sign-in needed. */
  publicAttendees: (id: string) => request<PublicAttendees>(`/api/spaces/${id}/public-attendees`),
  /** Who was in an ended space. Needs the caller's own guest token for that space. */
  spaceAttendees: (id: string, token: string) => request<Attendees>(`/api/spaces/${id}/attendees`, { token }),
  join: (id: string, body: { name: string; linkedinUrl: string; secret: string }) =>
    request<JoinResult>(`/api/spaces/${id}/join`, { method: "POST", body: json(body) }),
};

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Wrong username or password.",
  invalid_secret: "That space secret is wrong.",
  invalid_linkedin_url: "Enter a valid LinkedIn profile URL.",
  invalid_name: "Enter a valid name.",
  banned: "You have been removed from this space.",
  space_ended: "This space has ended.",
  space_not_found: "Space not found.",
  space_already_live: "A space is already live. End it before creating a new one.",
  room_full: "The space is full.",
  rate_limited: "Too many attempts. Try again later.",
  unauthorized: "Your session expired. Log in again.",
  speaker_limit: "The stage is full (max speakers reached).",
  forbidden: "Only the host can do that.",
  space_not_started: "This space hasn't started yet.",
  blocked: "You can't join spaces hosted here.",
  invalid_schedule: "Pick a time between now and a year from now.",
  space_not_scheduled: "That space isn't waiting to start.",
  already_reported: "You already reported this person.",
  invalid_reason: "Say what happened in a few words.",
  invalid_report: "That person can't be reported.",
  cannot_block: "Only guests can be blocked.",
  not_public: "The host didn't publish this list.",
  invalid_tags: "Topics can use letters, numbers and dashes, up to 5.",
  list_not_open: "The host hasn't opened a public list for this space.",
  cannot_open_list: "A list can be opened once the space has ended, and only if everyone isn't already published.",
  space_not_ended: "This list is published once the space has ended.",
  cannot_publish: "This can only be switched on before the space starts, because guests are told before they join.",
};

export function errorMessage(e: unknown): string {
  // our own wording first (sentence case, written for the person); the server's text is the fallback
  if (e instanceof ApiError) return MESSAGES[e.code] ?? (e.message !== e.code ? e.message : e.code);
  if (typeof e === "string") return MESSAGES[e] ?? e;
  return e instanceof Error ? e.message : "Something went wrong.";
}
