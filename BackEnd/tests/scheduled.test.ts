import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HOUR, json, startHarness } from "./helpers/harness";

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness({}, ["other"]);
});
afterAll(() => h.stop());

const inAWeek = () => Date.now() + 7 * 24 * HOUR;

describe("scheduled spaces", () => {
  test("a scheduled space is announced but closed until the host starts it", async () => {
    const when = inAWeek();
    const space = await h.newSpace({ title: "Founders AMA", scheduledFor: when, description: "  Bring questions.  " });
    expect(space.status).toBe("scheduled");
    expect(space.scheduledFor).toBe(when);
    expect(space.description).toBe("Bring questions.");
    expect(space.secret).toBe("letmein");

    // it takes no live slot, so a live space can exist alongside it
    expect((await h.api("/api/admin/spaces/current", { token: h.adminToken })).body.space).toBeNull();
    expect((await h.api("/health")).body.live).toBeNull();

    // the public page can show it, with who is hosting; the secret stays private
    const pub = await h.api(`/api/spaces/${space.id}`);
    expect(pub.body).toMatchObject({ status: "scheduled", title: "Founders AMA", scheduledFor: when, description: "Bring questions." });
    expect(pub.body.host).toEqual({ name: "admin", linkedinUrl: null });
    expect(pub.body.secret).toBeUndefined();

    // nobody can join (REST or socket) before it starts
    const early = await h.api(`/api/spaces/${space.id}/join`, json({ name: "Early", linkedinUrl: "linkedin.com/in/early", secret: "letmein" }));
    expect(early.status).toBe(409);
    expect(early.body.error).toBe("space_not_started");
    await expect(h.joinSpace(space.id, h.adminToken)).rejects.toThrow("space_not_started");

    // it shows in the admin list
    const list = (await h.api("/api/admin/spaces", { token: h.adminToken })).body.spaces;
    expect(list.find((s: any) => s.id === space.id).status).toBe("scheduled");

    // start it: same link and secret, now joinable, startedAt is when it went live
    const before = Date.now();
    const live = await h.api(`/api/admin/spaces/${space.id}/start`, { method: "POST", token: h.adminToken });
    expect(live.status).toBe(200);
    expect(live.body.status).toBe("live");
    expect(live.body.id).toBe(space.id);
    expect(live.body.startedAt).toBeGreaterThanOrEqual(before - 1000);
    const g = await h.guest(space.id, "On Time");
    expect(g.state.space.startedAt).toBe(live.body.startedAt);
    expect((await h.api("/health")).body.live).toBe(space.id);

    // starting twice is refused
    expect((await h.api(`/api/admin/spaces/${space.id}/start`, { method: "POST", token: h.adminToken })).body.error).toBe("space_not_scheduled");
    await h.endSpace(space.id);
  });

  test("many can be scheduled; only one can be live; reschedule, edit and cancel work", async () => {
    const a = await h.newSpace({ title: "A", scheduledFor: inAWeek() });
    const b = await h.newSpace({ title: "B", scheduledFor: inAWeek() + HOUR });
    const live = await h.newSpace({ title: "Live now" });

    // can't start a scheduled one while another is live
    const clash = await h.api(`/api/admin/spaces/${a.id}/start`, { method: "POST", token: h.adminToken });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe("space_already_live");
    await h.endSpace(live.id);

    // edit title, description and time
    const newTime = inAWeek() + 3 * HOUR;
    const edited = await h.api(`/api/admin/spaces/${a.id}`, { ...json({ title: "A (moved)", scheduledFor: newTime, description: null }, "PATCH"), token: h.adminToken });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ title: "A (moved)", scheduledFor: newTime, description: null, status: "scheduled" });

    // cancel B: it ends with reason "cancelled" and can't be started or edited
    expect((await h.api(`/api/admin/spaces/${b.id}/cancel`, { method: "POST", token: h.adminToken })).status).toBe(200);
    const cancelled = (await h.api(`/api/admin/spaces/${b.id}`, { token: h.adminToken })).body.space;
    expect(cancelled).toMatchObject({ status: "ended", endReason: "cancelled" });
    expect((await h.api(`/api/admin/spaces/${b.id}/start`, { method: "POST", token: h.adminToken })).body.error).toBe("space_not_scheduled");
    expect((await h.api(`/api/admin/spaces/${b.id}`, { ...json({ title: "x" }, "PATCH"), token: h.adminToken })).status).toBe(409);
    // a live space cannot be "cancelled" or "rescheduled"
    const l2 = await h.newSpace();
    expect((await h.api(`/api/admin/spaces/${l2.id}/cancel`, { method: "POST", token: h.adminToken })).status).toBe(409);
    expect((await h.api(`/api/admin/spaces/${l2.id}`, { ...json({ title: "x" }, "PATCH"), token: h.adminToken })).status).toBe(409);
    await h.endSpace(l2.id);
    await h.api(`/api/admin/spaces/${a.id}/cancel`, { method: "POST", token: h.adminToken });
  });

  test("the time must be sensible, and only the owner can manage a scheduled space", async () => {
    const mk = (scheduledFor: unknown) => h.api("/api/admin/spaces", { ...json({ title: "T", scheduledFor }), token: h.adminToken });
    expect((await mk(Date.now() - 2 * 86_400_000)).body.error).toBe("invalid_schedule"); // long past
    expect((await mk(Date.now() + 3 * 366 * 86_400_000)).body.error).toBe("invalid_schedule"); // years away
    expect((await mk(Date.now() - 60_000)).status).toBe(201); // a minute ago is fine: "starting now-ish"
    const s = await h.newSpace({ title: "Mine", scheduledFor: inAWeek() });

    const other = await h.login("other");
    expect((await h.api(`/api/admin/spaces/${s.id}/start`, { method: "POST", token: other })).status).toBe(403);
    expect((await h.api(`/api/admin/spaces/${s.id}/cancel`, { method: "POST", token: other })).status).toBe(403);
    expect((await h.api(`/api/admin/spaces/${s.id}`, { ...json({ title: "Hijack" }, "PATCH"), token: other })).status).toBe(403);
    expect((await h.api(`/api/admin/spaces/${s.id}/start`, { method: "POST" })).status).toBe(401);

    // the secret can be rotated while it waits
    const rotated = await h.api(`/api/admin/spaces/${s.id}/secret`, { ...json({ secret: "newsecret1" }), token: h.adminToken });
    expect(rotated.body.secret).toBe("newsecret1");
  });

  test("a restart leaves scheduled spaces alone (only live ones are closed)", async () => {
    const s = await h.newSpace({ title: "Survives", scheduledFor: inAWeek() });
    await h.server.manager.recoverFromRestart();
    expect((await h.api(`/api/spaces/${s.id}`)).body.status).toBe("scheduled");
  });
});
