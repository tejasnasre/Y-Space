import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { emit, sleep, startHarness, waitFor } from "./helpers/harness";

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

describe("chat and reactions", () => {
  test("messages reach everyone, late joiners catch up, moderators can delete, bad input is refused", async () => {
    const space = await h.newSpace();
    const { socket: host } = await h.joinSpace(space.id, h.adminToken);
    const ann = await h.guest(space.id, "Ann");
    const ben = await h.guest(space.id, "Ben");

    const got = waitFor(ben.socket, "chat:message");
    const sent = await emit(ann.socket, "chat:send", { text: "  Hello   everyone \n " });
    expect(sent.ok).toBe(true);
    const msg = await got;
    expect(msg).toMatchObject({ participantId: ann.id, name: "Ann", role: "listener", text: "Hello everyone" });

    // someone who joins later gets the history in their snapshot
    const cat = await h.guest(space.id, "Cat");
    expect(cat.state.chat.map((m: any) => m.text)).toEqual(["Hello everyone"]);

    // empty, too long, wrong type: refused
    expect((await emit(ann.socket, "chat:send", { text: "   " })).error).toBe("invalid_payload");
    expect((await emit(ann.socket, "chat:send", { text: "x".repeat(281) })).error).toBe("invalid_payload");
    expect((await emit(ann.socket, "chat:send", { text: 42 })).error).toBe("invalid_payload");
    // a flood is slowed down
    expect((await emit(ann.socket, "chat:send", { text: "again" })).error).toBe("rate_limited");

    // a listener cannot delete; the host can, and everyone is told
    expect((await emit(ben.socket, "chat:delete", { id: msg.id })).error).toBe("forbidden");
    const deleted = waitFor(cat.socket, "chat:deleted");
    expect((await emit(host, "chat:delete", { id: msg.id })).ok).toBe(true);
    expect((await deleted).id).toBe(msg.id);
    const late = await h.guest(space.id, "Dee");
    expect(late.state.chat).toEqual([]);

    // a host's own messages carry the role so the UI can badge them
    const hostMsg = waitFor(ben.socket, "chat:message");
    await emit(host, "chat:send", { text: "Welcome!" });
    expect((await hostMsg).role).toBe("host");
    await h.endSpace(space.id);
  });

  test("history keeps only the latest 100 messages", async () => {
    const space = await h.newSpace();
    const { socket: host } = await h.joinSpace(space.id, h.adminToken);
    const room = h.server.manager.room!;
    const hostPeer = [...room.peers.values()][0]!;
    for (let i = 0; i < 105; i++) {
      hostPeer.lastChatAt = 0; // skip the per-message rate limit; it is tested above
      room.sendChat(hostPeer, `m${i}`);
    }
    const ann = await h.guest(space.id, "Ann");
    expect(ann.state.chat).toHaveLength(100);
    expect(ann.state.chat[0].text).toBe("m5");
    expect(ann.state.chat.at(-1).text).toBe("m104");
    host.close();
    await h.endSpace(space.id);
  });

  test("reactions: only the allowed set, broadcast to all, quietly rate-limited", async () => {
    const space = await h.newSpace();
    await h.joinSpace(space.id, h.adminToken);
    const ann = await h.guest(space.id, "Ann");
    const ben = await h.guest(space.id, "Ben");

    const seen = waitFor(ben.socket, "reaction");
    expect((await emit(ann.socket, "reaction:send", { emoji: "👏" })).ok).toBe(true);
    expect(await seen).toEqual({ participantId: ann.id, emoji: "👏" });

    expect((await emit(ann.socket, "reaction:send", { emoji: "💩" })).error).toBe("invalid_payload");
    expect((await emit(ann.socket, "reaction:send", { emoji: "<script>" })).error).toBe("invalid_payload");
    expect((await emit(ann.socket, "reaction:send", {})).error).toBe("invalid_payload");

    // a stuck key: the extra ones are dropped without an error and without a broadcast
    let count = 0;
    ben.socket.on("reaction", () => count++);
    await sleep(250);
    for (let i = 0; i < 5; i++) expect((await emit(ann.socket, "reaction:send", { emoji: "🔥" })).ok).toBe(true);
    await sleep(200);
    expect(count).toBe(1);
    await h.endSpace(space.id);
  });
});
