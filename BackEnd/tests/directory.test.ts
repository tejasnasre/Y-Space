import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HOUR, emit, json, sleep, startHarness } from "./helpers/harness";

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness({}, ["other"]);
});
afterAll(() => h.stop());

const dir = (qs = "") => h.api(`/api/spaces${qs}`); // public: no token
const titles = (res: any) => res.body.past.map((s: any) => s.title);

/** Run a space with `guests` guests and end it. */
async function ran(title: string, body: Record<string, unknown> = {}, guests = 0) {
  const s = await h.newSpace({ title, ...body });
  await h.joinSpace(s.id, h.adminToken);
  for (let i = 0; i < guests; i++) await h.guest(s.id, `${title} guest ${i}`, `g${i}-${s.id}`);
  await sleep(60);
  await h.endSpace(s.id);
  return s;
}

describe("public home page: what is live, and past spaces", () => {
  test("empty at first", async () => {
    const res = await dir();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ live: null, past: [], hasMore: false });
  });

  test("shows the live space with its size, and nothing private", async () => {
    await h.api("/api/admin/me", { ...json({ displayName: "Priya Raman", linkedinUrl: null }, "PATCH"), token: h.adminToken });
    const s = await h.newSpace({ title: "Live right now", tags: ["Tech", "#ai"] });
    const host = await h.joinSpace(s.id, h.adminToken);
    const ann = await h.guest(s.id, "Ann", "ann");
    await h.guest(s.id, "Bob", "bob");
    expect((await emit(ann.socket, "speak:request")).ok).toBe(true);
    expect((await emit(host.socket, "host:promote", { participantId: ann.id })).ok).toBe(true);

    const res = await dir(); // no token, no login
    expect(res.body.live).toMatchObject({ id: s.id, title: "Live right now", tags: ["tech", "ai"], host: "Priya Raman", speakerCount: 2, listenerCount: 1 });
    expect(typeof res.body.live.startedAt).toBe("number");
    // never a secret, a token, a link or anyone's name or LinkedIn
    expect(JSON.stringify(res.body)).not.toMatch(/secret|letmein|token|joinUrl|linkedin|Ann|Bob/i);
    await h.endSpace(s.id);
  });

  test("past spaces: newest first, with host, duration and size; what should not be there is not", async () => {
    const a = await ran("First night", { tags: ["design"] }, 2);
    await sleep(30);
    const b = await ran("Second night", {}, 3);
    await h.newSpace({ title: "Still scheduled", scheduledFor: Date.now() + 5 * HOUR }); // not started: not past
    const cancelled = await h.newSpace({ title: "Will be cancelled", scheduledFor: Date.now() + 5 * HOUR });
    await h.api(`/api/admin/spaces/${cancelled.id}/cancel`, { method: "POST", token: h.adminToken });
    const hidden = await ran("Hidden night", { unlisted: true }, 1);

    const res = await dir();
    expect(res.body.live).toBeNull();
    expect(titles(res)).toEqual(["Second night", "First night", "Live right now"]); // newest first (the earlier test's space has ended and is now past); hidden, cancelled and scheduled are absent
    const second = res.body.past[0];
    expect(second).toMatchObject({ id: b.id, host: "Priya Raman", people: 3, listMode: "off" });
    expect(second.endedAt).toBeGreaterThanOrEqual(second.startedAt);
    expect(res.body.past[1]).toMatchObject({ id: a.id, tags: ["design"], people: 2 });
    expect(res.body.past[2]).toMatchObject({ title: "Live right now", people: 2 });
    expect(JSON.stringify(res.body)).not.toMatch(/Hidden night|Still scheduled|Will be cancelled|secret|token/i);
    void hidden;
  });

  test("the host can hide and show any space, at any time; only the owner can", async () => {
    const s = await ran("Toggle me", {}, 0);
    expect(titles(await dir())).toContain("Toggle me");

    const off = await h.api(`/api/admin/spaces/${s.id}/listing`, { ...json({ listed: false }), token: h.adminToken });
    expect(off.body.unlisted).toBe(true);
    expect(titles(await dir())).not.toContain("Toggle me");
    // its own link still works for anyone who has it: hiding only removes it from the list
    expect((await h.api(`/api/spaces/${s.id}`)).status).toBe(200);

    expect((await h.api(`/api/admin/spaces/${s.id}/listing`, { ...json({ listed: true }), token: await h.login("other") })).status).toBe(403);
    expect((await h.api(`/api/admin/spaces/${s.id}/listing`, json({ listed: true }))).status).toBe(401);
    expect((await h.api(`/api/admin/spaces/${s.id}/listing`, { ...json({ listed: "yes" }), token: h.adminToken })).status).toBe(422);
    const on = await h.api(`/api/admin/spaces/${s.id}/listing`, { ...json({ listed: true }), token: h.adminToken });
    expect(on.body.unlisted).toBe(false);
    expect(titles(await dir())).toContain("Toggle me");

    // a live space can be hidden too
    const live = await h.newSpace({ title: "Quiet live" });
    await h.api(`/api/admin/spaces/${live.id}/listing`, { ...json({ listed: false }), token: h.adminToken });
    expect((await dir()).body.live).toBeNull();
    await h.endSpace(live.id);
  });

  test("a space that lists its attendees says so; people who were removed are not counted", async () => {
    const s = await h.newSpace({ title: "With a list", publicList: true });
    const host = await h.joinSpace(s.id, h.adminToken);
    await h.guest(s.id, "Stays", "stays");
    const gone = await h.guest(s.id, "Removed", "removed");
    expect((await emit(host.socket, "host:kick", { participantId: gone.id })).ok).toBe(true);
    await h.endSpace(s.id);
    const item = (await dir()).body.past.find((x: any) => x.id === s.id);
    expect(item).toMatchObject({ listMode: "everyone", people: 1 });
  });

  test("pages through with `before`, and says when there is more", async () => {
    for (let i = 0; i < 4; i++) {
      await ran(`Page ${i}`);
      await sleep(25);
    }
    const first = await dir("?limit=2");
    expect(first.body.past).toHaveLength(2);
    expect(first.body.hasMore).toBe(true);
    const next = await dir(`?limit=2&before=${first.body.past.at(-1).endedAt}`);
    expect(next.body.past[0].title).not.toBe(first.body.past[0].title);
    expect(next.body.past.map((s: any) => s.id)).not.toContain(first.body.past[0].id);
    // walk to the end: no repeats, and it finishes
    const seen = new Set<string>();
    let cursor: number | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await dir(`?limit=3${cursor ? `&before=${cursor}` : ""}`);
      for (const s of page.body.past) {
        expect(seen.has(s.id)).toBe(false);
        seen.add(s.id);
      }
      if (!page.body.hasMore) break;
      cursor = page.body.past.at(-1).endedAt;
    }
    expect(seen.size).toBeGreaterThanOrEqual(8);
    expect((await dir("?limit=0")).status).toBe(422);
    expect((await dir("?limit=51")).status).toBe(422);
  });

  test("the response is cacheable for a few seconds", async () => {
    const res = await fetch(`${h.base}/api/spaces`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=5");
  });
});
