import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { emit, json, startHarness, waitFor } from "./helpers/harness";

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness({}, ["other"]);
});
afterAll(() => h.stop());

const pub = (id: string) => h.api(`/api/spaces/${id}/public-attendees`);
const optin = (id: string, enabled: boolean, token = h.adminToken) => h.api(`/api/admin/spaces/${id}/optin-list`, { ...json({ enabled }), token });
const shareMe = (id: string, token: string | null, share: unknown) => h.api(`/api/spaces/${id}/share-me`, { ...json({ share }), ...(token ? { token } : {}) });
const names = (res: any) => res.body.attendees.map((a: any) => a.name);

/** A private space (the default) that ran with three guests and has ended. */
async function endedPrivateSpace() {
  const space = await h.newSpace({ title: "Old night" }); // no publicList: guests were never told it could be public
  await h.joinSpace(space.id, h.adminToken);
  const ann = await h.guest(space.id, "Ann", "ann");
  const bob = await h.guest(space.id, "Bob", "bob");
  const cat = await h.guest(space.id, "Cat", "cat");
  await h.endSpace(space.id);
  return { space, ann, bob, cat };
}

describe("opt-in public list for a space that ended without one", () => {
  test("nothing is public until the host opens it, and then only guests who say yes appear", async () => {
    const { space, ann, bob, cat } = await endedPrivateSpace();
    expect((await pub(space.id)).status).toBe(403); // private
    expect((await h.api(`/api/spaces/${space.id}`)).body.listMode).toBe("off");

    // a guest cannot opt in before the host opens a list
    const early = await shareMe(space.id, ann.token, true);
    expect(early.status).toBe(409);
    expect(early.body.error).toBe("list_not_open");

    const opened = await optin(space.id, true);
    expect(opened.status).toBe(200);
    expect(opened.body.listMode).toBe("optin");
    expect((await h.api(`/api/spaces/${space.id}`)).body.listMode).toBe("optin");

    // opened but nobody has said yes: only the host is listed, so no guest is exposed by the host's click
    let res = await pub(space.id);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("optin");
    expect(names(res)).toEqual(["admin"]);

    // guests see the state and their own choice, and can change it
    const mine = (await h.api(`/api/spaces/${space.id}/attendees`, { token: ann.token })).body;
    expect(mine.space.listMode).toBe("optin");
    expect(mine.youShare).toBe(false);
    expect((await shareMe(space.id, ann.token, true)).body).toEqual({ ok: true, share: true });
    expect((await shareMe(space.id, cat.token, true)).status).toBe(200);
    res = await pub(space.id);
    expect(names(res).sort()).toEqual(["Ann", "Cat", "admin"]);
    expect(names(res)).not.toContain("Bob"); // never said yes
    expect((await h.api(`/api/spaces/${space.id}/attendees`, { token: ann.token })).body.youShare).toBe(true);
    expect((await h.api(`/api/spaces/${space.id}/attendees`, { token: bob.token })).body.youShare).toBe(false);

    // changing their mind removes them straight away
    expect((await shareMe(space.id, cat.token, false)).body.share).toBe(false);
    expect(names(await pub(space.id)).sort()).toEqual(["Ann", "admin"]);
  });

  test("opting in never overrides removals, blocks or open reports", async () => {
    const space = await h.newSpace({ title: "Messy night" });
    const host = await h.joinSpace(space.id, h.adminToken);
    const ann = await h.guest(space.id, "Ann", "ann");
    const kicked = await h.guest(space.id, "Kicked Kim", "kim");
    const blocked = await h.guest(space.id, "Blocked Bo", "bo");
    const flagged = await h.guest(space.id, "Flagged Flo", "flo");
    // everyone opts in later; the ones the host removed lose their token, so they cannot
    const k = waitFor(kicked.socket, "kicked");
    expect((await emit(host.socket, "host:kick", { participantId: kicked.id })).ok).toBe(true);
    await k;
    await h.api("/api/admin/blocks", { ...json({ participantId: blocked.id }), token: h.adminToken });
    await h.api(`/api/spaces/${space.id}/reports`, { ...json({ participantId: flagged.id, reason: "Spamming the chat" }), token: ann.token });
    await h.endSpace(space.id);
    expect((await optin(space.id, true)).status).toBe(200);

    expect((await shareMe(space.id, kicked.token, true)).status).toBe(403); // removed: token revoked
    for (const g of [ann, blocked, flagged]) await shareMe(space.id, g.token, true);
    expect(names(await pub(space.id)).sort()).toEqual(["Ann", "admin"]); // Bo is blocked, Flo has an open report
  });

  test("who may choose, and when the host may open or close it", async () => {
    const { space, ann } = await endedPrivateSpace();
    expect((await optin(space.id, true, await h.login("other"))).status).toBe(403); // not the owner
    expect((await h.api(`/api/admin/spaces/${space.id}/optin-list`, json({ enabled: true }))).status).toBe(401);
    expect((await optin(space.id, true)).status).toBe(200);

    expect((await shareMe(space.id, null, true)).status).toBe(403); // no token
    expect((await shareMe(space.id, "nope", true)).status).toBe(403);
    expect((await shareMe(space.id, h.adminToken, true)).status).toBe(403); // admins are listed by default and are not guests
    expect((await shareMe(space.id, ann.token, "yes")).status).toBe(422);
    expect((await shareMe("nope", ann.token, true)).status).toBe(404);
    // a guest of another space cannot opt in here
    const other = await h.newSpace();
    const stranger = await h.guest(other.id, "Stranger", "stranger");
    expect((await shareMe(space.id, stranger.token, true)).status).toBe(403);
    await h.endSpace(other.id);

    // stopping sharing hides the list again, whatever people chose
    await shareMe(space.id, ann.token, true);
    expect(names(await pub(space.id))).toContain("Ann");
    expect((await optin(space.id, false)).body.listMode).toBe("off");
    expect((await pub(space.id)).status).toBe(403);
    expect((await shareMe(space.id, ann.token, true)).status).toBe(409);
  });

  test("a space can only be opened for opt-in once it has ended, and not when everyone is already published", async () => {
    const live = await h.newSpace();
    const refused = await optin(live.id, true);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("cannot_open_list");
    await h.endSpace(live.id);

    const everyone = await h.newSpace({ publicList: true });
    await h.endSpace(everyone.id);
    expect((await optin(everyone.id, true)).body.error).toBe("cannot_open_list");
    expect((await pub(everyone.id)).body.mode).toBe("everyone");
  });

  test("the admin sees who chose to appear", async () => {
    const { space, ann, bob } = await endedPrivateSpace();
    await optin(space.id, true);
    await shareMe(space.id, ann.token, true);
    const detail = (await h.api(`/api/admin/spaces/${space.id}`, { token: h.adminToken })).body;
    expect(detail.space.listMode).toBe("optin");
    const flag = (n: string) => detail.participants.find((p: any) => p.name === n).sharePublicly;
    expect([flag("Ann"), flag("Bob"), flag("Cat")]).toEqual([true, false, false]);
    void bob;
  });
});
