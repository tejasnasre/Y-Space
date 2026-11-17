import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { HOUR, json, startHarness } from "./helpers/harness";
import { cleanTags } from "../src/lib/validate";

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

const create = (body: Record<string, unknown>) => h.api("/api/admin/spaces", { ...json({ title: "Tagged", secret: "letmein", ...body }), token: h.adminToken });
const endLive = async () => {
  const cur = (await h.api("/api/admin/spaces/current", { token: h.adminToken })).body.space;
  if (cur) await h.endSpace(cur.id);
};

describe("tag cleaning", () => {
  test("'#Tech', ' tech ' and 'TECH' are one tag; spaces become dashes; no '#' is stored", () => {
    expect(cleanTags(["#Tech", " tech ", "TECH", "##ux"])).toEqual(["tech", "ux"]);
    expect(cleanTags(["Machine Learning", "  open   source "])).toEqual(["machine-learning", "open-source"]);
    expect(cleanTags(["-x-", "a--b"])).toEqual(["x", "a-b"]);
    expect(cleanTags(["#", "", "   "])).toEqual([]); // empty boxes are ignored, not errors
    expect(cleanTags(undefined)).toEqual([]);
    expect(cleanTags(["Café", "日本語", "ai2"])).toEqual(["café", "日本語", "ai2"]); // letters of any language
  });

  test("refuses, with a reason, instead of silently cutting", () => {
    const err = (v: unknown) => {
      try {
        cleanTags(v);
      } catch (e: any) {
        return `${e.code}: ${e.message}`;
      }
      return "no error";
    };
    expect(err(["a", "b", "c", "d", "e", "f"])).toBe("invalid_tags: add at most 5 tags");
    expect(err(["a", "A", "#a", "b", "c", "d", "e"])).toBe("no error"); // repeats do not count twice: 5 distinct
    expect(err(["x".repeat(25)])).toBe("invalid_tags: a tag can be at most 24 characters");
    expect(err(["x".repeat(24)])).toBe("no error");
    expect(err(["rock&roll"])).toBe("invalid_tags: tags can use letters, numbers and dashes");
    expect(err(["<script>"])).toBe("invalid_tags: tags can use letters, numbers and dashes");
    expect(err(["a_b"])).toBe("invalid_tags: tags can use letters, numbers and dashes");
    expect(err("tech")).toBe("invalid_tags: tags must be a list of words");
    expect(err([1])).toBe("invalid_tags: tags must be words");
  });
});

describe("tags on spaces", () => {
  test("saved cleaned, and shown everywhere a space is shown", async () => {
    await endLive();
    const res = await create({ tags: ["#Tech", "Design", "tech", "Open Source"] });
    expect(res.status).toBe(201);
    expect(res.body.tags).toEqual(["tech", "design", "open-source"]);
    const id = res.body.id;

    expect((await h.api(`/api/spaces/${id}`)).body.tags).toEqual(["tech", "design", "open-source"]); // public join page
    expect((await h.api("/api/admin/spaces/current", { token: h.adminToken })).body.space.tags).toEqual(["tech", "design", "open-source"]);
    const listed = (await h.api("/api/admin/spaces", { token: h.adminToken })).body.spaces.find((s: any) => s.id === id);
    expect(listed.tags).toEqual(["tech", "design", "open-source"]);
    // inside the room
    const host = await h.joinSpace(id, h.adminToken);
    expect(host.state.space.tags).toEqual(["tech", "design", "open-source"]);
    // and on the lists shared after it ends
    const ann = await h.guest(id, "Ann");
    await h.endSpace(id);
    expect((await h.api(`/api/spaces/${id}/attendees`, { token: ann.token })).body.space.tags).toEqual(["tech", "design", "open-source"]);
    await h.api(`/api/admin/spaces/${id}/optin-list`, { ...json({ enabled: true }), token: h.adminToken });
    expect((await h.api(`/api/spaces/${id}/public-attendees`)).body.space.tags).toEqual(["tech", "design", "open-source"]);
  });

  test("none is fine; too many or bad ones are refused and nothing is created", async () => {
    await endLive();
    const none = await create({});
    expect(none.body.tags).toEqual([]);
    await h.endSpace(none.body.id);

    const six = await create({ tags: ["a", "b", "c", "d", "e", "f"] });
    expect(six.status).toBe(400);
    expect(six.body.error).toBe("invalid_tags");
    const bad = await create({ tags: ["no/slashes"] });
    expect(bad.body.error).toBe("invalid_tags");
    expect((await h.api("/api/admin/spaces/current", { token: h.adminToken })).body.space).toBeNull(); // the failed attempts created nothing
    expect((await create({ tags: ["x".repeat(61)] })).status).toBe(422); // beyond what the endpoint even accepts
  });

  test("a scheduled space's tags can be edited; a live one's cannot", async () => {
    await endLive();
    const s = await create({ scheduledFor: Date.now() + 24 * HOUR, tags: ["ai"] });
    expect(s.body.tags).toEqual(["ai"]);
    const edited = await h.api(`/api/admin/spaces/${s.body.id}`, { ...json({ tags: ["#Startups", "ai", "Product Design"] }, "PATCH"), token: h.adminToken });
    expect(edited.body.tags).toEqual(["startups", "ai", "product-design"]);
    expect((await h.api(`/api/admin/spaces/${s.body.id}`, { ...json({ tags: [] }, "PATCH"), token: h.adminToken })).body.tags).toEqual([]);
    expect((await h.api(`/api/admin/spaces/${s.body.id}`, { ...json({ tags: ["1", "2", "3", "4", "5", "6"] }, "PATCH"), token: h.adminToken })).body.error).toBe("invalid_tags");
    // they carry over when it goes live
    await h.api(`/api/admin/spaces/${s.body.id}`, { ...json({ tags: ["tech"] }, "PATCH"), token: h.adminToken });
    const live = await h.api(`/api/admin/spaces/${s.body.id}/start`, { method: "POST", token: h.adminToken });
    expect(live.body.tags).toEqual(["tech"]);
    expect((await h.api(`/api/admin/spaces/${s.body.id}`, { ...json({ tags: ["x"] }, "PATCH"), token: h.adminToken })).status).toBe(409);
    await h.endSpace(s.body.id);
  });
});
