import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HOUR, MIN, json, sleep, startHarness } from "./helpers/harness";

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

/** A scheduled space whose time is "now": allowed by the API (a few minutes of slack) and due straight away. */
const dueNow = (extra: Record<string, unknown> = {}) => h.newSpace({ title: "Due now", scheduledFor: Date.now() - 1000, autoStart: true, ...extra });
const status = async (id: string) => (await h.api(`/api/admin/spaces/${id}`, { token: h.adminToken })).body.space;
const liveId = async () => (await h.api("/health")).body.live;

describe("scheduler: opening scheduled spaces on time", () => {
  test("which clock is running is visible, and without pg_cron the in-process timer is used", async () => {
    const health = (await h.api("/health")).body;
    expect(health.scheduler).toBe("in-process"); // throw-away test databases have no pg_cron
    expect(h.server.scheduler.mode).toBe("in-process");
  });

  test("a due space with auto-start opens by itself, and the host-away timer starts then", async () => {
    const s = await dueNow();
    expect(s.status).toBe("scheduled");
    expect(s.autoStart).toBe(true);

    expect(await h.server.manager.openDue()).toEqual([s.id]);
    const after = await status(s.id);
    expect(after.status).toBe("live");
    expect(await liveId()).toBe(s.id);
    // guests can join now
    expect((await h.guest(s.id, "Early Bird")).state.you.role).toBe("listener");

    const events = (await h.api(`/api/admin/spaces/${s.id}`, { token: h.adminToken })).body.events;
    expect(events.find((e: any) => e.type === "space_started")?.data).toEqual({ auto: true });

    // nobody hosts it: the usual rule ends it after 15 minutes
    expect(await h.server.manager.sweep(after.startedAt + 14 * MIN)).toBeNull();
    expect(await h.server.manager.sweep(after.startedAt + 16 * MIN)).toBe("host_absent");
  });

  test("only spaces that opted in, are due, and are within the grace window are opened", async () => {
    const optedOut = await h.newSpace({ title: "No auto", scheduledFor: Date.now() - 1000, autoStart: false });
    const future = await h.newSpace({ title: "Later", scheduledFor: Date.now() + 2 * HOUR, autoStart: true });
    const stale = await dueNow({ title: "Missed it" });
    // pretend the API was down for 2 h: past the 30 min grace, so a human decides
    await h.server.sql`update spaces set scheduled_for = now() - interval '2 hours' where id = ${stale.id}`;

    expect(await h.server.manager.openDue()).toEqual([]);
    for (const id of [optedOut.id, future.id, stale.id]) expect((await status(id)).status).toBe("scheduled");

    // the grace window is measured from its time, so a space 10 min late still opens
    await h.server.sql`update spaces set scheduled_for = now() - interval '10 minutes' where id = ${stale.id}`;
    expect(await h.server.manager.openDue()).toEqual([stale.id]);
    await h.endSpace(stale.id);
    for (const id of [optedOut.id, future.id]) await h.api(`/api/admin/spaces/${id}/cancel`, { method: "POST", token: h.adminToken });
  });

  test("if another space is live, the due one waits and opens as soon as it is free", async () => {
    const live = await h.newSpace({ title: "Running" });
    const waiting = await dueNow({ title: "Waiting" });
    expect(await h.server.manager.openDue()).toEqual([]);
    expect(await liveId()).toBe(live.id);
    expect((await status(waiting.id)).status).toBe("scheduled");

    await h.endSpace(live.id);
    expect(await h.server.manager.openDue()).toEqual([waiting.id]);
    expect(await liveId()).toBe(waiting.id);
    await h.endSpace(waiting.id);
  });

  test("if the host opened it first, the scheduler leaves it alone; opening twice is harmless", async () => {
    const s = await dueNow();
    expect((await h.api(`/api/admin/spaces/${s.id}/start`, { method: "POST", token: h.adminToken })).status).toBe(200);
    expect(await h.server.manager.openDue()).toEqual([]);
    expect(await h.server.manager.openDue()).toEqual([]);
    expect(await liveId()).toBe(s.id);
    await h.endSpace(s.id);
  });

  test("a NOTIFY on the tick channel wakes the API (this is what the pg_cron job sends)", async () => {
    const s = await dueNow();
    expect(await liveId()).not.toBe(s.id);
    await h.server.sql`select pg_notify('yspace_tick', '')`;
    for (let i = 0; i < 30 && (await liveId()) !== s.id; i++) await sleep(100);
    expect(await liveId()).toBe(s.id);
    await h.endSpace(s.id);
  });

  test("auto-start can be set, changed and is ignored for spaces that start now", async () => {
    const now = await h.newSpace({ autoStart: true });
    expect(now.autoStart).toBe(false); // meaningless for a space that is already live
    await h.endSpace(now.id);

    const s = await h.newSpace({ scheduledFor: Date.now() + 3 * HOUR });
    expect(s.autoStart).toBe(false);
    const on = await h.api(`/api/admin/spaces/${s.id}`, { ...json({ autoStart: true }, "PATCH"), token: h.adminToken });
    expect(on.body.autoStart).toBe(true);
    const off = await h.api(`/api/admin/spaces/${s.id}`, { ...json({ autoStart: false }, "PATCH"), token: h.adminToken });
    expect(off.body.autoStart).toBe(false);
    // the public page can say whether it opens by itself
    await h.api(`/api/admin/spaces/${s.id}`, { ...json({ autoStart: true }, "PATCH"), token: h.adminToken });
    expect((await h.api(`/api/spaces/${s.id}`)).body.autoStart).toBe(true);
    await h.api(`/api/admin/spaces/${s.id}/cancel`, { method: "POST", token: h.adminToken });
  });
});
