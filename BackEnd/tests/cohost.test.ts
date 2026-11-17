import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { emit, sleep, startHarness, waitFor } from "./helpers/harness";

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

describe("co-hosts", () => {
  test("host appoints a co-host who can moderate, but not touch the host or other co-hosts", async () => {
    const space = await h.newSpace();
    const { socket: host, state } = await h.joinSpace(space.id, h.adminToken);
    const hostId = state.you.id;
    const cory = await h.guest(space.id, "Cory");
    const dana = await h.guest(space.id, "Dana");
    const eve = await h.guest(space.id, "Eve");

    // a listener cannot appoint anyone
    expect((await emit(cory.socket, "host:makeCohost", { participantId: dana.id })).error).toBe("forbidden");

    // host appoints Cory: everyone sees the new role, Cory is told
    const told = waitFor(cory.socket, "you:role");
    const updated = waitFor(eve.socket, "participant:updated");
    expect((await emit(host, "host:makeCohost", { participantId: cory.id })).ok).toBe(true);
    expect((await told).role).toBe("cohost");
    expect((await updated).role).toBe("cohost");

    // Cory now receives host-only events and can approve a hand
    const seen = waitFor(cory.socket, "speak:requested");
    expect((await emit(eve.socket, "speak:request")).ok).toBe(true);
    expect((await seen).id).toBe(eve.id);
    const eveRole = waitFor(eve.socket, "you:role");
    expect((await emit(cory.socket, "host:promote", { participantId: eve.id })).ok).toBe(true);
    expect((await eveRole).role).toBe("speaker");

    // ...and can remove a normal listener...
    const kicked = waitFor(dana.socket, "kicked");
    expect((await emit(cory.socket, "host:kick", { participantId: dana.id })).ok).toBe(true);
    await kicked;

    // ...but not the host, and not end the space or appoint/extend
    expect((await emit(cory.socket, "host:kick", { participantId: hostId })).error).toBe("cannot_kick_host");
    expect((await emit(cory.socket, "host:demote", { participantId: hostId })).error).toBe("cannot_demote_host");
    expect((await emit(cory.socket, "host:mute", { participantId: hostId })).error).toBe("forbidden");
    expect((await emit(cory.socket, "host:end")).error).toBe("forbidden");
    expect((await emit(cory.socket, "host:extend")).error).toBe("forbidden");
    expect((await emit(cory.socket, "host:makeCohost", { participantId: eve.id })).error).toBe("forbidden");

    // a second co-host cannot be removed by a co-host, only by the host
    expect((await emit(host, "host:makeCohost", { participantId: eve.id })).ok).toBe(true);
    expect((await emit(cory.socket, "host:kick", { participantId: eve.id })).error).toBe("forbidden");
    expect((await emit(cory.socket, "host:demote", { participantId: eve.id })).error).toBe("forbidden");
    expect((await emit(host, "host:demote", { participantId: eve.id })).error).toBe("target_is_cohost");

    // the host takes the role away again
    const back = waitFor(eve.socket, "you:role");
    expect((await emit(host, "host:removeCohost", { participantId: eve.id })).ok).toBe(true);
    expect((await back).role).toBe("speaker");
    expect((await emit(eve.socket, "host:kick", { participantId: cory.id })).error).toBe("forbidden");

    // co-hosts cannot "step down" off the stage by accident
    expect((await emit(cory.socket, "speak:leave")).error).toBe("cohost_cannot_leave_stage");
    await h.endSpace(space.id);
  });

  test("the stage limit still applies when appointing a co-host", async () => {
    const space = await h.newSpace();
    const { socket: host } = await h.joinSpace(space.id, h.adminToken);
    const guests = [];
    for (let i = 0; i < 6; i++) guests.push(await h.guest(space.id, `G${i}`));
    for (let i = 0; i < 4; i++) expect((await emit(host, "host:promote", { participantId: guests[i]!.id })).ok).toBe(true);
    // host + 4 speakers = 5: a listener cannot be lifted on stage as a co-host
    expect((await emit(host, "host:makeCohost", { participantId: guests[4]!.id })).error).toBe("speaker_limit");
    // but an existing speaker can become one without needing a new seat
    expect((await emit(host, "host:makeCohost", { participantId: guests[0]!.id })).ok).toBe(true);
    await h.endSpace(space.id);
  });

  test("if the host leaves, the co-host becomes host automatically; when the host returns, they hand it back", async () => {
    const space = await h.newSpace();
    const hostConn = await h.joinSpace(space.id, h.adminToken);
    const hostId = hostConn.state.you.id;
    const cory = await h.guest(space.id, "Cory");
    const fay = await h.guest(space.id, "Fay");
    expect((await emit(hostConn.socket, "host:makeCohost", { participantId: cory.id })).ok).toBe(true);

    // host's connection drops; after the reconnect grace (1 s in tests) the co-host takes over
    const promoted = waitFor(cory.socket, "you:role", 6000);
    const announced = waitFor(fay.socket, "space:host_changed", 6000);
    hostConn.socket.close();
    expect((await promoted).role).toBe("host");
    expect(await announced).toMatchObject({ participantId: cory.id, name: "Cory", reason: "left" });

    // the new host can do host things: end powers, extend, appoint, moderate
    expect((await emit(cory.socket, "host:makeCohost", { participantId: fay.id })).ok).toBe(true);
    expect((await emit(cory.socket, "host:extend")).ok).toBe(true);

    // the watchdog sees someone hosting: not "host_absent"
    expect(await h.server.manager.sweep(Date.now() + 20 * MIN_)).toBeNull();

    // the real host comes back and gets the role back; Cory returns to co-host
    const demoted = waitFor(cory.socket, "you:role");
    const returned = await h.joinSpace(space.id, h.adminToken);
    expect(returned.state.you.role).toBe("host");
    expect((await demoted).role).toBe("cohost");
    const roles = Object.fromEntries(returned.state.participants.map((p: any) => [p.name, p.role]));
    expect(roles.Cory).toBe("cohost");
    expect(returned.state.you.id).toBe(hostId);
    // Cory can no longer end the space
    expect((await emit(cory.socket, "host:end")).error).toBe("forbidden");
    await h.endSpace(space.id);
  });

  test("with no co-host nobody takes over, and a co-host keeps the role across a reconnect", async () => {
    const space = await h.newSpace();
    const hostConn = await h.joinSpace(space.id, h.adminToken);
    const gus = await h.guest(space.id, "Gus");
    hostConn.socket.close();
    await sleep(1500);
    expect(h.server.manager.room?.peers.get(gus.id)?.role).toBe("listener"); // nobody was appointed, so nobody inherits
    const back = await h.joinSpace(space.id, h.adminToken);

    // appoint, then let Gus's connection drop past the grace period and reconnect with the same token
    expect((await emit(back.socket, "host:makeCohost", { participantId: gus.id })).ok).toBe(true);
    const gone = waitFor(back.socket, "participant:left", 6000);
    gus.socket.close();
    await gone;
    const again = await h.joinSpace(space.id, gus.token);
    expect(again.state.you.role).toBe("cohost");
    await h.endSpace(space.id);
  });
});

const MIN_ = 60_000;
