"use client";

import { Device } from "mediasoup-client";
import type { Consumer, Producer, Transport } from "mediasoup-client/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { io, type Socket } from "socket.io-client";
import { API_URL, errorMessage } from "@/lib/api";

export type Role = "host" | "cohost" | "speaker" | "listener";

/** Host and co-host can moderate (approve hands, mute, remove people). */
export const canModerate = (role: Role | undefined) => role === "host" || role === "cohost";

export interface ChatMessage {
  id: number;
  participantId: string;
  name: string;
  role: Role;
  text: string;
  at: number;
}

export interface Reaction {
  id: number;
  participantId: string;
  emoji: string;
}

/** One person waiting to speak, and when their hand went up (ms). The list is in line order, first at the top. */
export interface QueueItem {
  id: string;
  at: number;
}

/** Where you stand in the raise-hand line. `position` 1 means you are next. */
export interface LinePosition {
  position: number;
  total: number;
}

/** The space is about to end by itself unless the host acts. */
export interface Expiring {
  reason: string;
  endsAt: number;
}

export interface Participant {
  id: string;
  name: string;
  linkedinUrl: string | null;
  role: Role;
  muted: boolean;
  joinedAt?: string;
}

export type RoomStatus = "connecting" | "connected" | "reconnecting" | "ended" | "kicked" | "error";

/** A human-readable moment in the room ("Ana joined", "Jon raised a hand"). */
export interface ActivityEntry {
  id: number;
  at: number;
  kind: "join" | "leave" | "hand" | "stage" | "info";
  text: string;
}

export interface LogEntry {
  at: number;
  kind: "in" | "out" | "info" | "error";
  text: string;
}

type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

interface Options {
  spaceId: string;
  token: string;
  /** called when the space ends or this user is removed, so the page can clean up its stored token */
  onClosed?: (why: "ended" | "kicked" | "error", detail: string | null) => void;
}

export function useSpaceRoom({ spaceId, token, onClosed }: Options) {
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [you, setYou] = useState<Participant | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [requests, setRequests] = useState<string[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [position, setPosition] = useState<LinePosition | null>(null);
  const [seatFree, setSeatFree] = useState<{ id: string; name: string } | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const positionRef = useRef<number | null>(null);
  const [maxSpeakers, setMaxSpeakers] = useState(5);
  const [speaking, setSpeaking] = useState<string[]>([]);
  const [micError, setMicError] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [expiring, setExpiring] = useState<Expiring | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const sendTransport = useRef<Transport | null>(null);
  const recvTransport = useRef<Transport | null>(null);
  const producerRef = useRef<Producer | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const consumers = useRef(new Map<string, { consumer: Consumer; audio: HTMLAudioElement }>());
  const youRef = useRef<Participant | null>(null);
  /** id -> person, so "left" and "hand lowered" events can name who they were about */
  const peopleRef = useRef(new Map<string, Participant>());
  const removingRef = useRef(new Set<string>());
  const activitySeq = useRef(0);
  const announcedRef = useRef(false);
  const reactionSeq = useRef(0);
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });

  const addLog = useCallback((kind: LogEntry["kind"], text: string) => {
    setLog((l) => [...l.slice(-199), { at: Date.now(), kind, text }]);
  }, []);

  const addActivity = useCallback((kind: ActivityEntry["kind"], text: string) => {
    const entry = { id: ++activitySeq.current, at: Date.now(), kind, text };
    setActivity((l) => [entry, ...l].slice(0, 100));
  }, []);

  /** socket.io request with ack, rejecting on `{ok:false}` */
  const call = useCallback(
    <T extends object = object>(event: string, payload: object = {}) =>
      new Promise<T>((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket?.connected) return reject(new Error("not_connected"));
        socket.timeout(8000).emit(event, payload, (err: Error | null, res: Ack<T>) => {
          if (err) return reject(new Error("timeout"));
          if (!res.ok) {
            addLog("error", `${event} → ${res.error}`);
            return reject(new Error(res.error));
          }
          addLog("out", event);
          resolve(res);
        });
      }),
    [addLog],
  );

  // ------------------------------------------------------------ media helpers
  const closeConsumers = useCallback(() => {
    for (const { consumer, audio } of consumers.current.values()) {
      consumer.close();
      audio.srcObject = null;
      audio.remove();
    }
    consumers.current.clear();
  }, []);

  const stopSending = useCallback(() => {
    producerRef.current?.close();
    producerRef.current = null;
    sendTransport.current?.close();
    sendTransport.current = null;
    micStream.current?.getTracks().forEach((t) => t.stop());
    micStream.current = null;
  }, []);

  const teardownMedia = useCallback(() => {
    stopSending();
    recvTransport.current?.close();
    recvTransport.current = null;
    closeConsumers();
    deviceRef.current = null;
  }, [closeConsumers, stopSending]);

  const startSending = useCallback(async () => {
    const device = deviceRef.current;
    if (!device || sendTransport.current) return;
    setMicError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone needs HTTPS or localhost.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStream.current = stream;

      const params = await call<{ id: string; iceParameters: never; iceCandidates: never; dtlsParameters: never }>(
        "sfu:createTransport",
        { direction: "send" },
      );
      const transport = device.createSendTransport(params);
      sendTransport.current = transport;
      transport.on("connect", ({ dtlsParameters }, ok, fail) => {
        call("sfu:connectTransport", { transportId: transport.id, dtlsParameters }).then(() => ok(), fail);
      });
      transport.on("produce", ({ rtpParameters }, ok, fail) => {
        call<{ producerId: string }>("sfu:produce", { transportId: transport.id, rtpParameters }).then(
          (r) => ok({ id: r.producerId }),
          fail,
        );
      });
      transport.on("connectionstatechange", (s) => addLog("info", `send transport: ${s}`));

      const track = stream.getAudioTracks()[0]!;
      producerRef.current = await transport.produce({ track, codecOptions: { opusDtx: true } });
      addLog("info", "microphone is live");
    } catch (e) {
      stopSending();
      const msg = e instanceof Error ? e.message : String(e);
      setMicError(
        msg.includes("Permission") || msg.includes("NotAllowed")
          ? "Microphone permission was denied. Allow it in the browser and press Retry."
          : errorMessage(e),
      );
      addLog("error", `mic: ${msg}`);
    }
  }, [addLog, call, stopSending]);

  const setupMedia = useCallback(async () => {
    teardownMedia();
    try {
      const { rtpCapabilities } = await call<{ rtpCapabilities: never }>("sfu:getRtpCapabilities");
      const device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities });
      deviceRef.current = device;

      const params = await call<{ id: string; iceParameters: never; iceCandidates: never; dtlsParameters: never }>(
        "sfu:createTransport",
        { direction: "recv" },
      );
      const transport = device.createRecvTransport(params);
      recvTransport.current = transport;
      transport.on("connect", ({ dtlsParameters }, ok, fail) => {
        call("sfu:connectTransport", { transportId: transport.id, dtlsParameters }).then(() => ok(), fail);
      });
      transport.on("connectionstatechange", (s) => addLog("info", `recv transport: ${s}`));

      await call("sfu:ready", { rtpCapabilities: device.rtpCapabilities });
      const me = youRef.current;
      if (me && me.role !== "listener") await startSending();
    } catch (e) {
      addLog("error", `media setup failed: ${e instanceof Error ? e.message : e}`);
    }
  }, [addLog, call, startSending, teardownMedia]);

  // ------------------------------------------------------------------ socket
  useEffect(() => {
    const socket = io(API_URL, {
      auth: { spaceId, token },
      transports: ["websocket"],
      reconnectionDelayMax: 3000,
    });
    socketRef.current = socket;
    const consumerMap = consumers.current;

    const finish = (status: RoomStatus, detail: string | null, why: "ended" | "kicked" | "error") => {
      setStatus(status);
      setStatusDetail(detail);
      teardownMedia();
      socket.disconnect();
      onClosedRef.current?.(why, detail);
    };

    socket.on("connect", () => addLog("info", "socket connected"));
    socket.on("connect_error", (err) => {
      const code = err.message;
      addLog("error", `connect_error: ${code}`);
      // auth-type failures are final; anything else (network) lets socket.io keep retrying
      if (["unauthorized", "space_not_found", "space_ended", "banned", "room_full"].includes(code)) {
        finish(code === "space_ended" ? "ended" : "error", code, code === "space_ended" ? "ended" : "error");
      } else {
        setStatus("reconnecting");
        setStatusDetail(errorMessage(code));
      }
    });
    socket.on("disconnect", (reason) => {
      addLog("info", `socket disconnected: ${reason}`);
      if (reason === "io server disconnect" || reason === "io client disconnect") return;
      setStatus("reconnecting");
      teardownMedia();
    });

    socket.on(
      "space:state",
      (s: {
        space: { id: string; title: string; startedAt?: number; tags?: string[] };
        you: Participant;
        maxSpeakers: number;
        participants: Participant[];
        requests: string[];
        queue?: QueueItem[];
        position?: LinePosition | null;
        chat?: ChatMessage[];
        expiring?: Expiring | null;
      }) => {
        addLog("in", `space:state (${s.participants.length} participants)`);
        setStatus("connected");
        setStatusDetail(null);
        setTitle(s.space.title);
        if (s.space.startedAt) setStartedAt(s.space.startedAt);
        setTags(s.space.tags ?? []);
        peopleRef.current = new Map(s.participants.map((x) => [x.id, x]));
        setChat(s.chat ?? []);
        setExpiring(s.expiring ?? null);
        addActivity("info", announcedRef.current ? "Reconnected" : "You joined the space");
        announcedRef.current = true;
        youRef.current = s.you;
        setYou(s.you);
        setMaxSpeakers(s.maxSpeakers);
        setParticipants(s.participants);
        setRequests(s.requests);
        setQueue(s.queue ?? []);
        positionRef.current = s.position?.position ?? null;
        setPosition(s.position ?? null);
        setHandRaised(!!s.position);
        setSeatFree(null);
        void setupMedia();
      },
    );
    socket.on("space:error", (e: { code: string }) => finish("error", e.code, "error"));
    socket.on("participant:joined", (p: Participant) => {
      addLog("in", `participant:joined ${p.name}`);
      if (!peopleRef.current.has(p.id)) addActivity("join", `${p.name} joined`);
      peopleRef.current.set(p.id, p);
      setParticipants((l) => (l.some((x) => x.id === p.id) ? l : [...l, p]));
    });
    socket.on("participant:updated", (p: Participant) => {
      addLog("in", `participant:updated ${p.name} (${p.role}${p.muted ? ", muted" : ""})`);
      const before = peopleRef.current.get(p.id);
      const who = youRef.current?.id === p.id ? "You" : p.name;
      if (before && before.role !== "cohost" && p.role === "cohost") {
        addActivity("stage", who === "You" ? "You are now a co-host" : `${who} is now a co-host`);
      } else if (before && before.role === "cohost" && p.role === "speaker") {
        addActivity("stage", who === "You" ? "You are no longer a co-host" : `${who} is no longer a co-host`);
      } else if (before && before.role === "listener" && p.role !== "listener") {
        addActivity("stage", who === "You" ? "You joined the stage" : `${who} joined the stage`);
      } else if (before && before.role !== "listener" && p.role === "listener") {
        addActivity("stage", who === "You" ? "You moved to listeners" : `${who} moved to listeners`);
      }
      peopleRef.current.set(p.id, p);
      setParticipants((l) => l.map((x) => (x.id === p.id ? p : x)));
      if (youRef.current?.id === p.id) {
        youRef.current = p;
        setYou(p);
      }
    });
    socket.on("participant:left", (d: { participantId?: string; id?: string }) => {
      const id = d.participantId ?? d.id;
      addLog("in", `participant:left ${id}`);
      if (id) {
        const person = peopleRef.current.get(id);
        if (person) addActivity("leave", removingRef.current.has(id) ? `${person.name} was removed` : `${person.name} left`);
        peopleRef.current.delete(id);
        removingRef.current.delete(id);
      }
      setParticipants((l) => l.filter((x) => x.id !== id));
      setRequests((r) => r.filter((x) => x !== id));
    });
    socket.on("speak:requested", (p: Participant) => {
      addLog("in", `speak:requested ${p.name}`);
      addActivity("hand", `${p.name} raised a hand`);
    });
    socket.on("speak:requestCancelled", (d: { participantId: string }) => {
      const person = peopleRef.current.get(d.participantId);
      if (person) addActivity("hand", `${person.name} lowered their hand`);
    });
    // The server sends the whole line, in order, after every change. It is the single source of truth for who
    // is waiting and in what order (rebuilding it from individual events is how the order used to drift).
    socket.on("speak:queue", (d: { queue: QueueItem[] }) => {
      setQueue(d.queue);
      setRequests(d.queue.map((q) => q.id));
      setSeatFree(null);
    });
    socket.on("speak:position", (p: LinePosition | null) => {
      setPosition(p);
      setHandRaised(!!p);
      if (p?.position === 1 && positionRef.current !== 1) toast("You're next in line");
      positionRef.current = p?.position ?? null;
    });
    socket.on("speak:seat_free", (d: { next: { id: string; name: string } }) => setSeatFree(d.next));
    socket.on("speak:denied", () => {
      addLog("in", "speak:denied");
      addActivity("hand", "The host declined your request to speak");
      setHandRaised(false);
    });
    socket.on("you:role", (d: { role: Role }) => {
      addLog("in", `you:role ${d.role}`);
      const prevRole = youRef.current?.role;
      if (d.role === "host" && prevRole !== "host") toast.success("You are now the host");
      else if (d.role === "cohost" && prevRole === "listener") toast.success("You are now a co-host");
      else if (d.role === "cohost" && prevRole === "host") toast("The host is back. You are a co-host again.");
      else if (d.role === "speaker" && prevRole === "cohost") toast("You are no longer a co-host");
      const me = youRef.current;
      if (me) {
        const next = { ...me, role: d.role };
        youRef.current = next;
        setYou(next);
      }
      setHandRaised(false);
      if (d.role === "listener") stopSending();
      else void startSending();
    });
    socket.on("you:muted", (d: { muted: boolean; by: string }) => addLog("in", `you:muted ${d.muted} by ${d.by}`));
    socket.on("speaker:volumes", (v: { participantId: string; volume: number }[]) => {
      setSpeaking(v.map((x) => x.participantId));
    });
    socket.on("space:host_changed", (d: { name: string; reason: "left" | "returned" }) => {
      addActivity("info", d.reason === "left" ? `${d.name} is now hosting because the host left` : `${d.name} is back as host`);
    });
    socket.on("space:expiring", (d: Expiring | null) => setExpiring(d));
    socket.on("chat:message", (m: ChatMessage) => setChat((l) => [...l.filter((x) => x.id !== m.id), m].slice(-100)));
    socket.on("chat:deleted", (d: { id: number }) => setChat((l) => l.filter((x) => x.id !== d.id)));
    socket.on("reaction", (r: { participantId: string; emoji: string }) => {
      const id = ++reactionSeq.current;
      setReactions((l) => [...l.slice(-14), { id, ...r }]);
      setTimeout(() => setReactions((l) => l.filter((x) => x.id !== id)), 2800);
    });
    socket.on("kicked", () => finish("kicked", "You were removed from this space.", "kicked"));
    socket.on("space:ended", (d: { reason: string }) => finish("ended", d.reason, "ended"));

    socket.on(
      "sfu:newConsumer",
      async (
        d: { consumerId: string; producerId: string; participantId: string; kind: "audio"; rtpParameters: never },
        ack: (r: object) => void,
      ) => {
        try {
          const transport = recvTransport.current;
          if (!transport) throw new Error("no recv transport");
          const consumer = await transport.consume({
            id: d.consumerId,
            producerId: d.producerId,
            kind: d.kind,
            rtpParameters: d.rtpParameters,
          });
          const audio = new Audio();
          audio.autoplay = true;
          audio.srcObject = new MediaStream([consumer.track]);
          audio.style.display = "none";
          document.body.appendChild(audio);
          audio.play().catch(() => setAudioBlocked(true));
          consumerMap.set(consumer.id, { consumer, audio });
          addLog("in", `sfu:newConsumer from ${d.participantId}`);
          ack({ ok: true });
        } catch (e) {
          addLog("error", `consume failed: ${e instanceof Error ? e.message : e}`);
          ack({ ok: false });
        }
      },
    );
    socket.on("sfu:consumerClosed", (d: { consumerId: string }) => {
      const entry = consumerMap.get(d.consumerId);
      if (!entry) return;
      entry.consumer.close();
      entry.audio.srcObject = null;
      entry.audio.remove();
      consumerMap.delete(d.consumerId);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      teardownMedia();
    };
  }, [spaceId, token, addLog, addActivity, setupMedia, startSending, stopSending, teardownMedia]);

  // ----------------------------------------------------------------- actions
  const run = useCallback(
    async (event: string, payload: object = {}) => {
      try {
        return await call(event, payload);
      } catch (e) {
        throw new Error(errorMessage(e instanceof Error ? e.message : e));
      }
    },
    [call],
  );

  return {
    status,
    statusDetail,
    title,
    startedAt,
    tags,
    queue,
    position,
    seatFree,
    you,
    participants,
    requests,
    maxSpeakers,
    speaking,
    micError,
    audioBlocked,
    handRaised,
    log,
    activity,
    chat,
    reactions,
    expiring,
    retryMic: startSending,
    enableAudio: () => {
      for (const { audio } of consumers.current.values()) void audio.play();
      setAudioBlocked(false);
    },
    requestSpeak: async () => {
      const res = (await run("speak:request")) as { position?: number; total?: number };
      setHandRaised(true);
      return res;
    },
    approveNext: () => run("host:approveNext") as Promise<{ ok: true; participantId: string; name: string }>,
    cancelRequest: async () => {
      await run("speak:cancel");
      setHandRaised(false);
    },
    leaveStage: async () => {
      await run("speak:leave");
    },
    setMuted: (muted: boolean) => run("mute:set", { muted }),
    promote: (participantId: string) => run("host:promote", { participantId }),
    demote: (participantId: string) => run("host:demote", { participantId }),
    deny: (participantId: string) => run("host:deny", { participantId }),
    hostMute: (participantId: string) => run("host:mute", { participantId }),
    makeCohost: (participantId: string) => run("host:makeCohost", { participantId }),
    removeCohost: (participantId: string) => run("host:removeCohost", { participantId }),
    extend: () => run("host:extend") as Promise<{ ok: true; extendedByMinutes: number }>,
    sendChat: (text: string) => run("chat:send", { text }),
    deleteChat: (id: number) => run("chat:delete", { id }),
    react: (emoji: string) => run("reaction:send", { emoji }),
    kick: async (participantId: string) => {
      removingRef.current.add(participantId);
      try {
        return await run("host:kick", { participantId });
      } catch (e) {
        removingRef.current.delete(participantId);
        throw e;
      }
    },
    endSpace: () => run("host:end"),
  };
}
