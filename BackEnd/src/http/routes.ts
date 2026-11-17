import { Elysia, t } from "elysia";
import type { Config } from "../config";
import { AppError } from "../lib/errors";
import { FailureLimiter } from "../lib/rate-limit";
import { cleanName, parseLinkedin } from "../lib/validate";
import type { Repo } from "../repo";
import { AdminAuth, bearerToken } from "../services/admin-auth";
import type { SpaceManager } from "../services/space-manager";

interface Deps {
  config: Config;
  repo: Repo;
  auth: AdminAuth;
  manager: SpaceManager;
}

/**
 * The IP the rate limiters key on. With `trustProxy`, a single reverse proxy (nginx/caddy) sits in front and
 * appends the connection it actually saw as the LAST entry of X-Forwarded-For (e.g. nginx's
 * `$proxy_add_x_forwarded_for`); everything before that is whatever the client sent and is fully attacker-controlled.
 * Trusting the first entry instead (an earlier version of this function did) lets anyone bypass the login/join
 * brute-force limiters by sending a different fake `X-Forwarded-For: 1.2.3.4` on every request.
 */
function clientIp(request: Request, server: { requestIP(r: Request): { address: string } | null } | null, trustProxy: boolean) {
  if (trustProxy) {
    const fwd = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
    if (fwd) return fwd;
  }
  return server?.requestIP(request)?.address ?? "unknown";
}

/** Path ids for the moderation routes. Parsed by hand: Elysia's `t.Numeric()` path params throw a 500 on POST here. */
function intId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 2_147_483_647) throw new AppError("invalid_payload", 400, "invalid id");
  return n;
}

export function createHttpRoutes({ config, repo, auth, manager }: Deps) {
  const loginLimiter = new FailureLimiter(8, 15 * 60_000);
  const joinLimiter = new FailureLimiter(10, 10 * 60_000);

  // ---------------------------------------------------------------- public
  const publicRoutes = new Elysia({ prefix: "/api" })
    .get("/spaces/:id", ({ params }) => manager.publicView(params.id), {
      params: t.Object({ id: t.String({ maxLength: 40 }) }),
    })
    // who was in an ended space; needs the caller's own guest token (see SpaceManager.attendees)
    .get(
      "/spaces/:id/attendees",
      ({ params, headers }) => manager.attendees(params.id, bearerToken(headers.authorization)),
      { params: t.Object({ id: t.String({ maxLength: 40 }) }) },
    )
    // the public home page: what is live now, and past spaces (see SpaceManager.directory)
    .get(
      "/spaces",
      ({ query, set }) => {
        set.headers["cache-control"] = "public, max-age=5";
        return manager.directory(query.limit ?? 12, query.before);
      },
      { query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })), before: t.Optional(t.Numeric()) }) },
    )
    // the attendee list, for anyone, if the host published it (see SpaceManager.publicAttendees)
    .get("/spaces/:id/public-attendees", ({ params, set }) => {
      set.headers["cache-control"] = "public, max-age=30";
      return manager.publicAttendees(params.id);
    }, { params: t.Object({ id: t.String({ maxLength: 40 }) }) })
    // a guest chooses whether to appear on the opt-in public list (needs their own guest token)
    .post("/spaces/:id/share-me", ({ params, headers, body }) => manager.shareMe(params.id, bearerToken(headers.authorization), body.share), {
      params: t.Object({ id: t.String({ maxLength: 40 }) }),
      body: t.Object({ share: t.Boolean() }),
    })
    // an attendee flags someone to the admin (needs the caller's own guest token)
    .post(
      "/spaces/:id/reports",
      ({ params, headers, body }) => manager.report(params.id, bearerToken(headers.authorization), body),
      {
        params: t.Object({ id: t.String({ maxLength: 40 }) }),
        body: t.Object({ participantId: t.String({ maxLength: 60 }), reason: t.String({ maxLength: 600 }) }),
      },
    )
    .post(
      "/spaces/:id/join",
      async ({ params, body, request, server }) => {
        const ip = clientIp(request, server, config.trustProxy);
        if (joinLimiter.isBlocked(ip)) throw new AppError("rate_limited", 429, "too many wrong attempts, try later");
        try {
          return await manager.join(params.id, body);
        } catch (e) {
          if (e instanceof AppError && e.code === "invalid_secret") joinLimiter.fail(ip);
          throw e;
        }
      },
      {
        params: t.Object({ id: t.String({ maxLength: 40 }) }),
        body: t.Object({
          name: t.String({ maxLength: 200 }),
          linkedinUrl: t.String({ maxLength: 400 }),
          secret: t.String({ maxLength: 200 }),
        }),
      },
    );

  // ----------------------------------------------------------------- admin
  const adminLogin = new Elysia({ prefix: "/api/admin" }).post(
    "/login",
    async ({ body, request, server }) => {
      const ip = clientIp(request, server, config.trustProxy);
      if (loginLimiter.isBlocked(ip)) throw new AppError("rate_limited", 429, "too many failed logins, try later");
      try {
        const session = await auth.login(body.username, body.password);
        loginLimiter.reset(ip);
        return session;
      } catch (e) {
        if (e instanceof AppError && e.code === "invalid_credentials") loginLimiter.fail(ip);
        throw e;
      }
    },
    { body: t.Object({ username: t.String({ minLength: 1, maxLength: 64 }), password: t.String({ minLength: 1, maxLength: 256 }) }) },
  );

  const adminRoutes = new Elysia({ prefix: "/api/admin" })
    // every route registered below requires a valid admin session
    .resolve({ as: "scoped" }, async ({ headers }) => {
      const token = bearerToken(headers.authorization);
      const admin = await auth.authenticate(token);
      if (!admin || !token) throw new AppError("unauthorized", 401, "login required");
      return { admin, token };
    })
    .get("/me", ({ admin }) => ({ id: admin.id, username: admin.username, displayName: admin.displayName, linkedinUrl: admin.linkedinUrl }))
    // how the host appears to attendees: a display name and a LinkedIn profile (both optional, null clears)
    .patch(
      "/me",
      async ({ admin, body }) => {
        const displayName = body.displayName?.trim() ? cleanName(body.displayName) : null;
        const linkedinUrl = body.linkedinUrl?.trim() ? parseLinkedin(body.linkedinUrl).url : null;
        const next = await repo.updateAdminProfile(admin.id, { displayName, linkedinUrl });
        return { id: admin.id, username: admin.username, displayName: next?.displayName ?? null, linkedinUrl: next?.linkedinUrl ?? null };
      },
      { body: t.Object({ displayName: t.Union([t.String({ maxLength: 120 }), t.Null()]), linkedinUrl: t.Union([t.String({ maxLength: 300 }), t.Null()]) }) },
    )
    .post("/logout", async ({ token }) => {
      await auth.logout(token);
      return { ok: true };
    })
    .post(
      "/spaces",
      ({ admin, body, set }) => {
        set.status = 201;
        return manager.createSpace(admin.id, body);
      },
      {
        body: t.Object({
          title: t.String({ minLength: 1, maxLength: 120 }),
          secret: t.Optional(t.String({ maxLength: 200 })),
          /** epoch ms. Present = schedule it for later instead of starting now */
          scheduledFor: t.Optional(t.Number()),
          description: t.Optional(t.String({ maxLength: 1000 })),
          /** publish the attendee list once it ends; guests are told when they join */
          publicList: t.Optional(t.Boolean()),
          /** a scheduled space opens by itself at its time */
          autoStart: t.Optional(t.Boolean()),
          /** up to 5 topic tags; "#Tech" is saved as "tech" */
          tags: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: 20 })),
          /** keep it off the public home page */
          unlisted: t.Optional(t.Boolean()),
        }),
      },
    )
    // the live space (with secret + link), so the admin UI can restore itself after a refresh
    // (only if *this* admin is hosting it: someone else's live space is none of their business)
    .get("/spaces/current", async ({ admin }) => {
      const live = await repo.getLiveSpace(admin.id);
      return { space: live ? manager.toAdminView(live) : null };
    })
    .get(
      "/spaces",
      async ({ query, admin }) => ({
        spaces: (await repo.listSpaces(query.limit ?? 20, query.before, admin.id)).map((s) => ({
          ...manager.toAdminView(s),
          participantCount: s.participantCount,
          speakerCount: s.speakerCount,
        })),
      }),
      {
        query: t.Object({
          limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
          before: t.Optional(t.Numeric()),
        }),
      },
    )
    .get(
      "/spaces/:id",
      async ({ params, admin }) => {
        const space = await repo.getSpace(params.id);
        // a space that isn't theirs doesn't exist as far as they're concerned (no ownership leak either way)
        if (!space || space.hostAdminId !== admin.id) throw new AppError("space_not_found", 404);
        const blocked = new Set((await repo.listBlocks()).map((b) => b.linkedinKey));
        return {
          space: manager.toAdminView(space),
          participants: (await repo.listParticipants(space.id)).map((p) => ({
            id: p.id,
            name: p.name,
            linkedinUrl: p.linkedinUrl,
            isHost: p.adminId !== null,
            joinedAt: p.joinedAt,
            leftAt: p.leftAt,
            kickedAt: p.kickedAt,
            spoke: p.spoke,
            cohost: p.cohost,
            sharePublicly: p.sharePublicly,
            blocked: !!p.linkedinKey && blocked.has(p.linkedinKey),
          })),
          events: await repo.listEvents(space.id),
        };
      },
      { params: t.Object({ id: t.String({ maxLength: 40 }) }) },
    )
    .post(
      "/spaces/:id/end",
      async ({ params, admin }) => {
        await manager.assertHost(params.id, admin.id);
        await manager.endSpace(params.id, "ended_by_host");
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ maxLength: 40 }) }) },
    )
    .post(
      "/spaces/:id/secret",
      async ({ params, body, admin }) => {
        await manager.assertHost(params.id, admin.id);
        return manager.rotateSecret(params.id, body?.secret);
      },
      {
        params: t.Object({ id: t.String({ maxLength: 40 }) }),
        body: t.Optional(t.Object({ secret: t.Optional(t.String({ maxLength: 200 })) })),
      },
    )
    // ---- scheduled spaces
    .patch(
      "/spaces/:id",
      ({ params, body, admin }) => manager.updateScheduled(params.id, admin.id, body),
      {
        params: t.Object({ id: t.String({ maxLength: 40 }) }),
        body: t.Object({
          title: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
          description: t.Optional(t.Union([t.String({ maxLength: 1000 }), t.Null()])),
          scheduledFor: t.Optional(t.Number()),
          publicList: t.Optional(t.Boolean()),
          autoStart: t.Optional(t.Boolean()),
          tags: t.Optional(t.Array(t.String({ maxLength: 60 }), { maxItems: 20 })),
        }),
      },
    )
    // an ended, private space: let guests opt in to a public list ("enabled": false stops sharing)
    .post("/spaces/:id/optin-list", async ({ params, body, admin }) => (body.enabled ? manager.openOptInList(params.id, admin.id) : manager.setPublicList(params.id, admin.id, false)), {
      params: t.Object({ id: t.String({ maxLength: 40 }) }),
      body: t.Object({ enabled: t.Boolean() }),
    })
    // show a space on the public home page, or hide it (any time)
    .post("/spaces/:id/listing", ({ params, body, admin }) => manager.setListing(params.id, admin.id, body.listed), {
      params: t.Object({ id: t.String({ maxLength: 40 }) }),
      body: t.Object({ listed: t.Boolean() }),
    })
    // switch the public attendee list off (any time) or on (only before the space starts)
    .post("/spaces/:id/public-list", ({ params, body, admin }) => manager.setPublicList(params.id, admin.id, body.enabled), {
      params: t.Object({ id: t.String({ maxLength: 40 }) }),
      body: t.Object({ enabled: t.Boolean() }),
    })
    .post("/spaces/:id/start", ({ params, admin }) => manager.startScheduled(params.id, admin.id), {
      params: t.Object({ id: t.String({ maxLength: 40 }) }),
    })
    .post(
      "/spaces/:id/cancel",
      async ({ params, admin }) => {
        await manager.cancelScheduled(params.id, admin.id);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ maxLength: 40 }) }) },
    )
    // keep a live space going after the "about to end" warning
    .post(
      "/spaces/:id/extend",
      async ({ params, admin }) => {
        await manager.assertHost(params.id, admin.id);
        return manager.extend(params.id);
      },
      { params: t.Object({ id: t.String({ maxLength: 40 }) }) },
    )
    // ---- moderation: block profiles from every space, and review what attendees reported
    .get("/blocks", async () => ({ blocks: await repo.listBlocks() }))
    .post(
      "/blocks",
      async ({ body, admin, set }) => {
        set.status = 201;
        if (body.participantId) return manager.blockParticipant(admin.id, body.participantId, body.reason ?? null);
        if (body.linkedinUrl) return manager.blockLinkedin(admin.id, { linkedinUrl: body.linkedinUrl, name: body.name, reason: body.reason });
        throw new AppError("invalid_payload", 400, "send a participantId or a linkedinUrl");
      },
      {
        body: t.Object({
          participantId: t.Optional(t.String({ maxLength: 60 })),
          linkedinUrl: t.Optional(t.String({ maxLength: 300 })),
          name: t.Optional(t.String({ maxLength: 120 })),
          reason: t.Optional(t.String({ maxLength: 500 })),
        }),
      },
    )
    .delete(
      "/blocks/:id",
      async ({ params }) => {
        if (!(await repo.unblock(intId(params.id)))) throw new AppError("block_not_found", 404);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ maxLength: 12 }) }) },
    )
    .get("/reports", async ({ query, admin }) => ({ reports: await repo.listReports(query.status, admin.id) }), {
      query: t.Object({ status: t.Optional(t.Union([t.Literal("open"), t.Literal("dismissed"), t.Literal("blocked")])) }),
    })
    .post(
      "/reports/:id/dismiss",
      async ({ params, admin }) => {
        await manager.dismissReport(intId(params.id), admin.id);
        return { ok: true };
      },
      { params: t.Object({ id: t.String({ maxLength: 12 }) }) },
    )
    .post("/reports/:id/block", ({ params, body, admin }) => manager.blockFromReport(admin.id, intId(params.id), body?.reason ?? null), {
      params: t.Object({ id: t.String({ maxLength: 12 }) }),
      body: t.Optional(t.Object({ reason: t.Optional(t.String({ maxLength: 500 })) })),
    });

  return new Elysia().use(publicRoutes).use(adminLogin).use(adminRoutes);
}
