import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { emit, json, startHarness, waitFor } from "./helpers/harness";

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness({}, ["other"]);
});
afterAll(() => h.stop());

const report = (spaceId: string, token: string | null, participantId: string, reason: string) =>
  h.api(`/api/spaces/${spaceId}/reports`, { ...json({ participantId, reason }), ...(token ? { token } : {}) });

describe("host profile", () => {
  test("a display name and LinkedIn replace the bare username for attendees", async () => {
    expect((await h.api("/api/admin/me", { token: h.adminToken })).body).toMatchObject({ username: "admin", displayName: null, linkedinUrl: null });

    const bad = await h.api("/api/admin/me", { ...json({ displayName: "Priya", linkedinUrl: "https://evil.com/in/priya" }, "PATCH"), token: h.adminToken });
    expect(bad.body.error).toBe("invalid_linkedin_url");

    const ok = await h.api("/api/admin/me", { ...json({ displayName: "  Priya Raman ", linkedinUrl: "linkedin.com/in/priya-raman/?x=1" }, "PATCH"), token: h.adminToken });
    expect(ok.body).toEqual({ id: expect.any(Number), username: "admin", displayName: "Priya Raman", linkedinUrl: "https://www.linkedin.com/in/priya-raman" });

    const space = await h.newSpace();
    const host = await h.joinSpace(space.id, h.adminToken);
    expect(host.state.you).toMatchObject({ name: "Priya Raman", linkedinUrl: "https://www.linkedin.com/in/priya-raman" });
    expect((await h.api(`/api/spaces/${space.id}`)).body.host).toEqual({ name: "Priya Raman", linkedinUrl: "https://www.linkedin.com/in/priya-raman" });

    // after the space, the host is on the attendee list with a profile people can open
    const ann = await h.guest(space.id, "Ann");
    await h.endSpace(space.id);
    const list = (await h.api(`/api/spaces/${space.id}/attendees`, { token: ann.token })).body.attendees;
    expect(list.find((a: any) => a.isHost)).toMatchObject({ name: "Priya Raman", linkedinUrl: "https://www.linkedin.com/in/priya-raman" });

    // clearing returns to the username
    const cleared = await h.api("/api/admin/me", { ...json({ displayName: "", linkedinUrl: null }, "PATCH"), token: h.adminToken });
    expect(cleared.body).toMatchObject({ displayName: null, linkedinUrl: null });
    expect((await h.api("/api/admin/me")).status).toBe(401);
  });
});

describe("reports and blocks", () => {
  test("attendees report someone; the admin reviews, dismisses or blocks; blocked people cannot rejoin anything", async () => {
    const space = await h.newSpace();
    const host = await h.joinSpace(space.id, h.adminToken);
    const ann = await h.guest(space.id, "Ann", "ann");
    const troll = await h.guest(space.id, "Troll", "troll");
    const nick = await h.guest(space.id, "Nick", "nick");

    // rules: need a reason, must be an attendee, can't report self or the host, once per person
    expect((await report(space.id, ann.token, troll.id, "x")).body.error).toBe("invalid_reason");
    expect((await report(space.id, null, troll.id, "Spamming links")).status).toBe(403);
    expect((await report(space.id, "nope", troll.id, "Spamming links")).status).toBe(403);
    expect((await report(space.id, ann.token, ann.id, "Spamming links")).body.error).toBe("invalid_report");
    expect((await report(space.id, ann.token, host.state.you.id, "Rude host")).body.error).toBe("invalid_report");
    expect((await report(space.id, ann.token, "00000000-0000-0000-0000-000000000000", "Spamming links")).status).toBe(404);

    expect((await report(space.id, ann.token, troll.id, "Spamming links in chat")).status).toBe(200);
    expect((await report(space.id, ann.token, troll.id, "Again")).body.error).toBe("already_reported");
    expect((await report(space.id, nick.token, troll.id, "Harassing me")).status).toBe(200);
    expect((await report(space.id, nick.token, ann.id, "Off topic")).status).toBe(200);

    // the admin sees the queue
    const queue = (await h.api("/api/admin/reports?status=open", { token: h.adminToken })).body.reports;
    expect(queue).toHaveLength(3);
    const first = queue.find((r: any) => r.reported.name === "Troll" && r.reporter.name === "Ann");
    expect(first).toMatchObject({ reason: "Spamming links in chat", spaceTitle: "Test space", status: "open" });
    expect((await h.api("/api/admin/reports")).status).toBe(401);

    // dismiss the Ann report
    const annReport = queue.find((r: any) => r.reported.name === "Ann");
    expect((await h.api(`/api/admin/reports/${annReport.id}/dismiss`, { method: "POST", token: h.adminToken })).status).toBe(200);
    expect((await h.api("/api/admin/reports?status=open", { token: h.adminToken })).body.reports).toHaveLength(2);
    expect((await h.api("/api/admin/reports?status=dismissed", { token: h.adminToken })).body.reports).toHaveLength(1);

    // block Troll from the report: removed from the live room at once, report marked blocked
    const kicked = waitFor(troll.socket, "kicked");
    const blocked = await h.api(`/api/admin/reports/${first.id}/block`, { ...json({ reason: "Spam" }), token: h.adminToken });
    expect(blocked.status).toBe(200);
    expect(blocked.body).toMatchObject({ name: "Troll", reason: "Spam", linkedinKey: "in/troll" });
    await kicked;
    expect((await h.api("/api/admin/reports?status=blocked", { token: h.adminToken })).body.reports.length).toBeGreaterThanOrEqual(1);

    // the block list, and the flag on the people list of that space
    const blocks = (await h.api("/api/admin/blocks", { token: h.adminToken })).body.blocks;
    expect(blocks.map((b: any) => b.name)).toEqual(["Troll"]);
    const detail = (await h.api(`/api/admin/spaces/${space.id}`, { token: h.adminToken })).body;
    expect(detail.participants.find((p: any) => p.name === "Troll").blocked).toBe(true);
    expect(detail.participants.find((p: any) => p.name === "Ann").blocked).toBe(false);
    await h.endSpace(space.id);

    // blocked across ALL spaces, even with the right secret and a different display name
    const next = await h.newSpace({ title: "Another night" });
    const again = await h.api(`/api/spaces/${next.id}/join`, json({ name: "Totally New Person", linkedinUrl: "https://uk.linkedin.com/in/TROLL/", secret: "letmein" }));
    expect(again.status).toBe(403);
    expect(again.body.error).toBe("blocked");
    // an innocent person is unaffected
    expect((await h.guest(next.id, "Fine Person", "fine")).state.you.role).toBe("listener");

    // unblock: allowed again
    expect((await h.api(`/api/admin/blocks/${blocks[0].id}`, { method: "DELETE", token: h.adminToken })).status).toBe(200);
    expect((await h.api(`/api/admin/blocks/${blocks[0].id}`, { method: "DELETE", token: h.adminToken })).status).toBe(404);
    expect((await h.guest(next.id, "Troll Reformed", "troll")).state.you.role).toBe("listener");
    await h.endSpace(next.id);
  });

  test("blocking by participant or by LinkedIn URL, never the host, and a blocked token stops working", async () => {
    const space = await h.newSpace();
    const host = await h.joinSpace(space.id, h.adminToken);
    const vic = await h.guest(space.id, "Vic", "vic");

    // the host cannot be blocked; bad payloads are refused
    expect((await h.api("/api/admin/blocks", { ...json({ participantId: host.state.you.id }), token: h.adminToken })).body.error).toBe("cannot_block");
    expect((await h.api("/api/admin/blocks", { ...json({}), token: h.adminToken })).body.error).toBe("invalid_payload");
    expect((await h.api("/api/admin/blocks", { ...json({ linkedinUrl: "https://evil.com/x" }), token: h.adminToken })).body.error).toBe("invalid_linkedin_url");
    expect((await h.api("/api/admin/blocks", { ...json({ participantId: "00000000-0000-0000-0000-000000000000" }), token: h.adminToken })).status).toBe(404);
    expect((await h.api("/api/admin/blocks", json({ participantId: vic.id }))).status).toBe(401);

    // block someone who is not here yet by URL, before they ever show up
    const pre = await h.api("/api/admin/blocks", { ...json({ linkedinUrl: "linkedin.com/in/known-bad", name: "Known Bad", reason: "Prior incident" }), token: h.adminToken });
    expect(pre.status).toBe(201);
    expect((await h.api(`/api/spaces/${space.id}/join`, json({ name: "x", linkedinUrl: "linkedin.com/in/known-bad", secret: "letmein" }))).body.error).toBe("blocked");

    // an already-issued guest token stops working for the socket once its owner is blocked (even after a restart of the room)
    await h.api("/api/admin/blocks", { ...json({ participantId: vic.id }), token: h.adminToken });
    await expect(h.joinSpace(space.id, vic.token)).rejects.toThrow(/banned|blocked|unauthorized/);

    // other admins' tools are not reachable without a session
    expect((await h.api("/api/admin/blocks")).status).toBe(401);
    expect((await emit(host.socket, "host:extend")).ok).toBe(true);
    await h.endSpace(space.id);
  });
});
