import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Socket } from "socket.io-client";
import { emit, sleep, startHarness, waitFor } from "./helpers/harness";

/** The same behaviour on both implementations: pgmq (Postgres) and the in-memory fallback. */
describe.each([
  ["pgmq", {}],
  ["memory", { SPEAK_QUEUE: "memory" }],
] as const)("raise-hand line (%s)", (kind, env) => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  beforeAll(async () => {
    h = await startHarness({ ...env });
  });
  afterAll(() => h.stop());

  const isPgmq = () => h.server.speakQueue.kind === "pgmq";
  const queued = async (spaceId: string) => (await h.server.sql`select count(*)::int as n from pgmq.q_speak_requests where message->>'spaceId' = ${spaceId}`)[0].n as number;
  const archived = async (spaceId: string) => (await h.server.sql`select count(*)::int as n from pgmq.a_speak_requests where message->>'spaceId' = ${spaceId}`)[0].n as number;

  /** Records every `speak:queue` message a socket receives. */
  const watchQueue = (s: Socket) => {
    const seen: string[][] = [];
    s.on("speak:queue", (d: { queue: { id: string }[] }) => seen.push(d.queue.map((q) => q.id)));
    return seen;
  };
  const watchPosition = (s: Socket) => {
    const seen: ({ position: number; total: number } | null)[] = [];
    s.on("speak:position", (p) => seen.push(p));
    return seen;
  };

  test("which queue is running", async () => {
    expect((await h.api("/health")).body.queue).toBe(isPgmq() ? "pgmq" : "memory");
    if (kind === "memory") expect(h.server.speakQueue.kind).toBe("memory");
    else if (!isPgmq()) console.warn("pgmq is not installed on this database: the pgmq variant ran on the in-memory fallback");
  });

  test("first come, first served: the order hands went up survives a refresh, whatever order people joined in", async () => {
    const space = await h.newSpace();
    const host = await h.joinSpace(space.id, h.adminToken);
    const ann = await h.guest(space.id, "Ann"); // joined 1st
    const bob = await h.guest(space.id, "Bob"); // joined 2nd
    const cat = await h.guest(space.id, "Cat"); // joined 3rd
    const hostSeen = watchQueue(host.socket);
    const catPos = watchPosition(cat.socket);

    // hands go up in a different order: Cat, Ann, Bob
    expect((await emit(cat.socket, "speak:request")).position).toBe(1);
    expect((await emit(ann.socket, "speak:request")).position).toBe(2);
    expect((await emit(bob.socket, "speak:request")).position).toBe(3);
    await sleep(100);
    expect(hostSeen.at(-1)).toEqual([cat.id, ann.id, bob.id]);

    // the host refreshes (a new connection gets a fresh snapshot): used to come back in JOIN order [Ann, Bob, Cat]
    const refreshed = await h.joinSpace(space.id, h.adminToken);
    expect(refreshed.state.requests).toEqual([cat.id, ann.id, bob.id]);
    expect(refreshed.state.queue.map((q: any) => q.id)).toEqual([cat.id, ann.id, bob.id]);
    expect(refreshed.state.queue.every((q: any) => typeof q.at === "number")).toBe(true);
    // and a guest who reconnects learns where they stand
    const annAgain = await h.joinSpace(space.id, ann.token);
    expect(annAgain.state.position).toEqual({ position: 2, total: 3 });
    expect(catPos.at(-1)).toEqual({ position: 1, total: 3 });

    // a listener never sees other people's requests
    expect(annAgain.state.requests).toEqual([]);
    expect(annAgain.state.queue).toEqual([]);
    await h.endSpace(space.id);
  });

  test("everyone behind someone who leaves the line moves up; pressing twice adds nobody", async () => {
    const space = await h.newSpace();
    await h.joinSpace(space.id, h.adminToken);
    const ann = await h.guest(space.id, "Ann");
    const bob = await h.guest(space.id, "Bob");
    const cat = await h.guest(space.id, "Cat");
    const bobPos = watchPosition(bob.socket);
    const catPos = watchPosition(cat.socket);

    // Ann presses twice at once
    const [a1, a2] = await Promise.all([emit(ann.socket, "speak:request"), emit(ann.socket, "speak:request")]);
    expect(a1.ok && a2.ok).toBe(true);
    await emit(bob.socket, "speak:request");
    await emit(cat.socket, "speak:request");
    await sleep(100);
    expect(bobPos.at(-1)).toEqual({ position: 2, total: 3 });
    expect(catPos.at(-1)).toEqual({ position: 3, total: 3 });
    if (isPgmq()) expect(await queued(space.id)).toBe(3); // Ann is in once, not twice

    // Ann lowers her hand: Bob is next, Cat second
    expect((await emit(ann.socket, "speak:cancel")).ok).toBe(true);
    await sleep(100);
    expect(bobPos.at(-1)).toEqual({ position: 1, total: 2 });
    expect(catPos.at(-1)).toEqual({ position: 2, total: 2 });
    if (isPgmq()) {
      expect(await queued(space.id)).toBe(2);
      expect(await archived(space.id)).toBe(0); // withdrawn, not "handled": deleted, no record
    }

    // Bob drops off the call without lowering his hand: gone after the 1 s grace, Cat is next
    bob.socket.close();
    await sleep(1500);
    expect(catPos.at(-1)).toEqual({ position: 1, total: 1 });
    await h.endSpace(space.id);
  });

  test("raising and lowering a hand straight away leaves nobody in line", async () => {
    const space = await h.newSpace();
    const host = await h.joinSpace(space.id, h.adminToken);
    const ann = await h.guest(space.id, "Ann");
    const seen = watchQueue(host.socket);
    // both messages go out before the queue has answered the first one
    await Promise.all([emit(ann.socket, "speak:request"), emit(ann.socket, "speak:cancel")]);
    await sleep(300);
    expect(seen.at(-1) ?? []).toEqual([]);
    if (isPgmq()) expect(await queued(space.id)).toBe(0);
    expect((await h.joinSpace(space.id, h.adminToken)).state.requests).toEqual([]);
    // and she can still raise it again afterwards
    expect((await emit(ann.socket, "speak:request")).position).toBe(1);
    await h.endSpace(space.id);
  });

  test("'approve next' takes whoever has waited longest; hosts and co-hosts only; a full stage keeps them waiting", async () => {
    const space = await h.newSpace();
    const host = await h.joinSpace(space.id, h.adminToken);
    const ann = await h.guest(space.id, "Ann");
    const bob = await h.guest(space.id, "Bob");
    const cat = await h.guest(space.id, "Cat");
    expect((await emit(host.socket, "host:approveNext")).error).toBe("no_requests"); // nobody waiting

    await emit(bob.socket, "speak:request");
    await emit(ann.socket, "speak:request");
    await emit(cat.socket, "speak:request");
    expect((await emit(cat.socket, "host:approveNext")).error).toBe("forbidden"); // a listener cannot

    const role = waitFor(bob.socket, "you:role");
    const res = await emit(host.socket, "host:approveNext");
    expect(res).toMatchObject({ ok: true, participantId: bob.id, name: "Bob" });
    expect((await role).role).toBe("speaker");
    const annPos = watchPosition(ann.socket);
    await sleep(100);
    if (isPgmq()) {
      expect(await archived(space.id)).toBe(1); // handled: kept with timestamps
      expect(await queued(space.id)).toBe(2);
    }

    // a co-host can approve too
    expect((await emit(host.socket, "host:makeCohost", { participantId: cat.id })).ok).toBe(true); // Cat leaves the line by becoming one
    const next = await emit(host.socket, "host:approveNext");
    expect(next.participantId).toBe(ann.id);

    // fill the stage, then try to approve someone: refused, and they keep their place
    const guests = [];
    for (let i = 0; i < 3; i++) guests.push(await h.guest(space.id, `Extra${i}`));
    await emit(guests[0]!.socket, "speak:request");
    const full = await emit(host.socket, "host:approveNext"); // host + Bob + Ann + Cat (co-host) = 4, one seat left
    expect(full.ok).toBe(true);
    await emit(guests[1]!.socket, "speak:request");
    const refused = await emit(host.socket, "host:approveNext");
    expect(refused.error).toBe("speaker_limit");
    expect((await h.joinSpace(space.id, h.adminToken)).state.requests).toEqual([guests[1]!.id]);
    void annPos;
    await h.endSpace(space.id);
  });

  test("when a seat frees up, the hosts are told who is next", async () => {
    const space = await h.newSpace();
    const host = await h.joinSpace(space.id, h.adminToken);
    const people = [];
    for (let i = 0; i < 6; i++) people.push(await h.guest(space.id, `P${i}`));
    for (let i = 0; i < 4; i++) expect((await emit(host.socket, "host:promote", { participantId: people[i]!.id })).ok).toBe(true); // host + 4 = full
    await emit(people[4]!.socket, "speak:request");
    await emit(people[5]!.socket, "speak:request");

    // nobody is told while the stage is full and nothing changes
    const offers: any[] = [];
    host.socket.on("speak:seat_free", (d) => offers.push(d));

    // a speaker steps down: the host hears that P4 (waiting longest) is next
    const offer = waitFor(host.socket, "speak:seat_free");
    expect((await emit(people[0]!.socket, "speak:leave")).ok).toBe(true);
    expect((await offer).next).toEqual({ id: people[4]!.id, name: "P4" });
    // the host moves a speaker to the audience: same
    const again = waitFor(host.socket, "speak:seat_free");
    expect((await emit(host.socket, "host:demote", { participantId: people[1]!.id })).ok).toBe(true);
    expect((await again).next.id).toBe(people[4]!.id);
    expect(offers.length).toBe(2);

    // with nobody waiting, a free seat is just a free seat
    await emit(people[4]!.socket, "speak:cancel");
    await emit(people[5]!.socket, "speak:cancel");
    offers.length = 0;
    await emit(people[2]!.socket, "speak:leave");
    await sleep(200);
    expect(offers).toEqual([]);
    await h.endSpace(space.id);
  });

  test("ending the space empties the line", async () => {
    const space = await h.newSpace();
    await h.joinSpace(space.id, h.adminToken);
    const ann = await h.guest(space.id, "Ann");
    await emit(ann.socket, "speak:request");
    if (isPgmq()) expect(await queued(space.id)).toBe(1);
    await h.endSpace(space.id);
    await sleep(200);
    if (isPgmq()) expect(await queued(space.id)).toBe(0);
  });
});
