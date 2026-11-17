import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HOUR, emit, json, startHarness, waitFor } from "./helpers/harness";

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness({}, ["other"]);
});
afterAll(() => h.stop());

const pub = (id: string) => h.api(`/api/spaces/${id}/public-attendees`);
const report = (spaceId: string, token: string, participantId: string) =>
  h.api(`/api/spaces/${spaceId}/reports`, { ...json({ participantId, reason: "Spamming the chat" }), token });

describe("public attendee list", () => {
  test("private by default: nothing is public unless the host chose it", async () => {
    const space = await h.newSpace();
    expect(space.publicList).toBe(false);
    const ann = await h.guest(space.id, "Ann");
    await h.endSpace(space.id);
    const res = await pub(space.id);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_public");
    // the guests-only list still works for Ann
    expect((await h.api(`/api/spaces/${space.id}/attendees`, { token: ann.token })).body.space.publicList).toBe(false);
  });

  test("published list: names, roles and LinkedIn for anyone, once the space has ended, minus removed, blocked and reported people", async () => {
    const space = await h.newSpace({ title: "Open night", publicList: true });
    expect(space.publicList).toBe(true);
    // guests can see before joining that the list will be public
    expect((await h.api(`/api/spaces/${space.id}`)).body.publicList).toBe(true);

    const host = await h.joinSpace(space.id, h.adminToken);
    const ann = await h.guest(space.id, "Ann Public", "ann");
    const bob = await h.guest(space.id, "Bob Speaker", "bob");
    const kicked = await h.guest(space.id, "Kicked Kim", "kim");
    const blocked = await h.guest(space.id, "Blocked Bo", "bo");
    const flagged = await h.guest(space.id, "Flagged Flo", "flo");
    const cory = await h.guest(space.id, "Cory Cohost", "cory");

    expect((await emit(bob.socket, "speak:request")).ok).toBe(true);
    expect((await emit(host.socket, "host:promote", { participantId: bob.id })).ok).toBe(true);
    expect((await emit(host.socket, "host:makeCohost", { participantId: cory.id })).ok).toBe(true);
    const k = waitFor(kicked.socket, "kicked");
    expect((await emit(host.socket, "host:kick", { participantId: kicked.id })).ok).toBe(true);
    await k;
    await h.api("/api/admin/blocks", { ...json({ participantId: blocked.id }), token: h.adminToken });
    expect((await report(space.id, ann.token, flagged.id)).status).toBe(200); // unreviewed report

    // not yet: the space is live
    const early = await pub(space.id);
    expect(early.status).toBe(409);
    expect(early.body.error).toBe("space_not_ended");

    await h.endSpace(space.id);
    const res = await pub(space.id); // no token at all
    expect(res.status).toBe(200);
    expect(res.body.space).toMatchObject({ id: space.id, title: "Open night" });
    expect(res.body.space.host).toEqual({ name: "admin", linkedinUrl: null });
    const names = res.body.attendees.map((a: any) => a.name);
    expect(names).toEqual(expect.arrayContaining(["admin", "Ann Public", "Bob Speaker", "Cory Cohost"]));
    expect(names).not.toContain("Kicked Kim");
    expect(names).not.toContain("Blocked Bo");
    expect(names).not.toContain("Flagged Flo");
    const role = (n: string) => res.body.attendees.find((a: any) => a.name === n).role;
    expect([role("admin"), role("Cory Cohost"), role("Bob Speaker"), role("Ann Public")]).toEqual(["host", "cohost", "speaker", "listener"]);
    expect(res.body.attendees.find((a: any) => a.name === "Ann Public").linkedinUrl).toBe("https://www.linkedin.com/in/ann");

    // nothing else leaks: no tokens, secrets, times, LinkedIn keys
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/token|secret|joinedAt|leftAt|linkedinKey|kickedAt/i);

    // once the admin dismisses the report, Flo appears
    const queue = (await h.api("/api/admin/reports?status=open", { token: h.adminToken })).body.reports;
    expect((await h.api(`/api/admin/reports/${queue[0].id}/dismiss`, { method: "POST", token: h.adminToken })).status).toBe(200);
    expect((await pub(space.id)).body.attendees.map((a: any) => a.name)).toContain("Flagged Flo");
  });

  test("the host can switch it off any time, but not on after the space has started", async () => {
    const on = await h.newSpace({ publicList: true });
    const off = await h.api(`/api/admin/spaces/${on.id}/public-list`, { ...json({ enabled: false }), token: h.adminToken });
    expect(off.body.publicList).toBe(false);
    await h.endSpace(on.id);
    expect((await pub(on.id)).status).toBe(403); // withdrawn

    // a live or ended private space can't be made public: its guests were not told
    const live = await h.newSpace();
    const refused = await h.api(`/api/admin/spaces/${live.id}/public-list`, { ...json({ enabled: true }), token: h.adminToken });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("cannot_publish");
    await h.endSpace(live.id);
    expect((await h.api(`/api/admin/spaces/${live.id}/public-list`, { ...json({ enabled: true }), token: h.adminToken })).status).toBe(409);

    // but a scheduled one can be toggled, at creation and through edits
    const sched = await h.newSpace({ scheduledFor: Date.now() + 24 * HOUR });
    expect(sched.publicList).toBe(false);
    expect((await h.api(`/api/admin/spaces/${sched.id}/public-list`, { ...json({ enabled: true }), token: h.adminToken })).body.publicList).toBe(true);
    const edited = await h.api(`/api/admin/spaces/${sched.id}`, { ...json({ publicList: false }, "PATCH"), token: h.adminToken });
    expect(edited.body.publicList).toBe(false);
    await h.api(`/api/admin/spaces/${sched.id}/public-list`, { ...json({ enabled: true }), token: h.adminToken });
    // it stays on when the scheduled space goes live, and the join page already says so
    await h.api(`/api/admin/spaces/${sched.id}/start`, { method: "POST", token: h.adminToken });
    expect((await h.api(`/api/spaces/${sched.id}`)).body.publicList).toBe(true);
    await h.endSpace(sched.id);
    expect((await pub(sched.id)).status).toBe(200);
  });

  test("only the owner can change it, and unknown spaces are 404", async () => {
    const s = await h.newSpace({ scheduledFor: Date.now() + 24 * HOUR });
    const other = await h.login("other");
    expect((await h.api(`/api/admin/spaces/${s.id}/public-list`, { ...json({ enabled: true }), token: other })).status).toBe(403);
    expect((await h.api(`/api/admin/spaces/${s.id}/public-list`, json({ enabled: true }))).status).toBe(401);
    expect((await pub("nope")).status).toBe(404);
    expect((await h.api(`/api/admin/spaces/${s.id}/public-list`, { ...json({ enabled: "yes" }), token: h.adminToken })).status).toBe(422);
  });
});
