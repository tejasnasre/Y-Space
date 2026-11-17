import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HOUR, MIN, emit, startHarness, waitFor } from "./helpers/harness";

/** Defaults: warn 5 min ahead, extend by 60 min, host absent 15 min, alone 30 min, cap 8 h. */
let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

describe("warning before an automatic end, and keeping it going", () => {
  test("a host sitting alone is warned 5 minutes ahead, and 'keep it going' restarts the clock", async () => {
    const space = await h.newSpace();
    const { socket: host } = await h.joinSpace(space.id, h.adminToken);
    const t0 = Date.now();

    expect(await h.server.manager.sweep(t0)).toBeNull(); // alone clock starts
    expect(await h.server.manager.sweep(t0 + 20 * MIN)).toBeNull(); // nothing yet: 10 min left
    const warned = waitFor(host, "space:expiring");
    expect(await h.server.manager.sweep(t0 + 26 * MIN)).toBeNull(); // 4 min left -> warn
    expect(await warned).toEqual({ reason: "empty", endsAt: t0 + 30 * MIN });

    // the warning is part of the snapshot for a host who reloads
    const reloaded = await h.joinSpace(space.id, h.adminToken);
    expect(reloaded.state.expiring).toEqual({ reason: "empty", endsAt: t0 + 30 * MIN });

    // keep it going: warning is withdrawn and the alone clock restarts
    const cleared = waitFor(reloaded.socket, "space:expiring"); // the reload replaced the first connection
    const res = await emit(reloaded.socket, "host:extend");
    expect(res).toMatchObject({ ok: true, extendedByMinutes: 60 });
    expect(await cleared).toBeNull();
    // the socket call restarts the clock at the real "now"; replay it at the test's clock to check the arithmetic
    await h.server.manager.extend(space.id, t0 + 26 * MIN);
    expect(await h.server.manager.sweep(t0 + 31 * MIN)).toBeNull(); // would have ended at +30 without the extension
    expect(await h.server.manager.sweep(t0 + 55 * MIN)).toBeNull();
    expect(await h.server.manager.sweep(t0 + 57 * MIN)).toBe("empty"); // a full new window (30 min) from the restart

  });

  test("the 'empty' warning goes to hosts only; a guest arriving cancels it", async () => {
    const space = await h.newSpace();
    const { socket: host } = await h.joinSpace(space.id, h.adminToken);
    const t0 = Date.now();
    await h.server.manager.sweep(t0);

    const warned = waitFor(host, "space:expiring");
    await h.server.manager.sweep(t0 + 27 * MIN);
    await warned;

    // a guest who joins now sees no warning: it is none of their business and it is about to clear
    const ann = await h.guest(space.id, "Ann");
    expect(ann.state.expiring).toBeNull();

    const cleared = waitFor(host, "space:expiring");
    await h.server.manager.sweep(t0 + 28 * MIN); // a guest is present: not alone any more
    expect(await cleared).toBeNull();
    await h.endSpace(space.id);
  });

  test("hard cap: everyone is warned, extending adds an hour, then it still ends", async () => {
    const space = await h.newSpace();
    const { socket: host } = await h.joinSpace(space.id, h.adminToken);
    const ann = await h.guest(space.id, "Ann");
    const start = space.startedAt;

    const seenByGuest = waitFor(ann.socket, "space:expiring");
    await h.server.manager.sweep(start + 8 * HOUR - 3 * MIN);
    expect(await seenByGuest).toEqual({ reason: "max_duration", endsAt: start + 8 * HOUR });

    expect((await emit(ann.socket, "host:extend")).error).toBe("forbidden"); // guests cannot
    expect((await emit(host, "host:extend")).ok).toBe(true);
    expect(await h.server.manager.sweep(start + 8 * HOUR + 10 * MIN)).toBeNull(); // +1 h granted
    expect(await h.server.manager.sweep(start + 9 * HOUR + MIN)).toBe("max_duration");
  });

  test("the owner can extend from the dashboard too, via REST", async () => {
    const space = await h.newSpace();
    expect((await h.api(`/api/admin/spaces/${space.id}/extend`, { method: "POST", token: h.adminToken })).body).toEqual({ extendedByMinutes: 60 });
    expect((await h.api(`/api/admin/spaces/${space.id}/extend`, { method: "POST" })).status).toBe(401);
    await h.endSpace(space.id);
    expect((await h.api(`/api/admin/spaces/${space.id}/extend`, { method: "POST", token: h.adminToken })).status).toBe(410);
  });
});
