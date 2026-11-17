"use client";

import {
  ActivityIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  ExternalLinkIcon,
  HandIcon,
  HeadphonesIcon,
  InfoIcon,
  LogOutIcon,
  MicIcon,
  MicOffIcon,
  MoreHorizontalIcon,
  PhoneOffIcon,
  UserMinusIcon,
  ListChecksIcon,
  UserPlusIcon,
  UserXIcon,
  WifiOffIcon,
  Volume2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Elapsed } from "@/components/elapsed";
import { LiveDot } from "@/components/live-dot";
import { ChatPanel } from "@/components/room/chat-panel";
import { ExpiryBanner } from "@/components/room/expiry-banner";
import { ReactionLayer, ReactionPicker } from "@/components/room/reactions";
import { RoomSkeleton } from "@/components/room/room-skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Participant, type Role, type RoomStatus, canModerate, useSpaceRoom } from "@/hooks/use-space-room";
import { errorMessage } from "@/lib/api";
import { endReasonText, formatSpan, initials } from "@/lib/space";
import { useNow } from "@/hooks/use-now";
import { TagList } from "@/components/tag-list";
import { cn } from "@/lib/utils";

const ACTIVITY_ICON = {
  join: UserPlusIcon,
  leave: LogOutIcon,
  hand: HandIcon,
  stage: MicIcon,
  info: InfoIcon,
} as const;

const ROLE_BADGE: Record<Role, "default" | "secondary" | "outline"> = {
  host: "default",
  cohost: "secondary",
  speaker: "secondary",
  listener: "outline",
};

const roleLabel = (role: Role) => (role === "cohost" ? "co-host" : role);

const STATUS_LABEL: Record<RoomStatus, string> = {
  connecting: "Connecting…",
  connected: "Live",
  reconnecting: "Reconnecting…",
  ended: "Ended",
  kicked: "Removed",
  error: "Error",
};

interface Props {
  spaceId: string;
  token: string;
  onClosed?: (why: "ended" | "kicked" | "error", detail: string | null) => void;
  onLeave: () => void;
  /** Extra action shown in the room header (the host's Invite button). */
  headerAction?: React.ReactNode;
  /** Shown under the "this space has ended" screen (the attendee list, or a link to the summary). */
  endedExtra?: React.ReactNode;
}

/** What to tell someone the server refused, by the error code it sent. */
function errorCopy(code: string | null): { title: string; body: string; icon: typeof XIcon } {
  switch (code) {
    case "unauthorized":
      return { title: "You're signed out", body: "Your session expired. Sign in again to continue.", icon: UserXIcon };
    case "space_not_found":
      return { title: "Space not found", body: "Check the link and try again.", icon: XIcon };
    case "room_full":
      return { title: "This space is full", body: "Try again in a moment, someone may leave.", icon: UserXIcon };
    case "banned":
      return { title: "You can't join this space", body: "You were removed from this space.", icon: UserXIcon };
    default:
      return { title: "Couldn't join", body: code ? errorMessage(code) : "Something went wrong.", icon: XIcon };
  }
}

type Room = ReturnType<typeof useSpaceRoom>;
type Act = (fn: () => Promise<unknown>, success?: string) => () => Promise<void>;

export function SpaceRoom({ spaceId, token, onClosed, onLeave, headerAction, endedExtra }: Props) {
  const room = useSpaceRoom({ spaceId, token, onClosed });
  return <RoomView room={room} onLeave={onLeave} headerAction={headerAction} endedExtra={endedExtra} />;
}

/** Presentation of a room. Takes the room state as a prop so it can be rendered without a live connection. */
export function RoomView({
  room,
  onLeave,
  headerAction,
  endedExtra,
}: {
  room: Room;
  onLeave: () => void;
  headerAction?: React.ReactNode;
  endedExtra?: React.ReactNode;
}) {
  const { you, participants, requests, speaking } = room;
  /** running the room right now (the host, or a co-host who took over) */
  const isHost = you?.role === "host";
  /** host or co-host */
  const moderator = canModerate(you?.role);
  const canSpeak = !!you && you.role !== "listener";

  const act: Act = (fn, success) => async () => {
    try {
      await fn();
      if (success) toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  };

  const speakers = participants.filter((p) => p.role !== "listener");
  const listeners = participants.filter((p) => p.role === "listener");
  const requesters = requests.map((id) => participants.find((p) => p.id === id)).filter((p): p is Participant => !!p);
  const openSeats = Math.max(0, room.maxSpeakers - speakers.length);

  if (room.status === "ended" || room.status === "kicked" || room.status === "error") {
    const copy = {
      ended: {
        title: "This space has ended",
        body: endReasonText(room.statusDetail) ?? "Thanks for joining.",
        icon: PhoneOffIcon,
      },
      kicked: {
        title: "You were removed",
        body: room.statusDetail ?? "The host removed you from this space.",
        icon: UserXIcon,
      },
      error: errorCopy(room.statusDetail),
    }[room.status];
    const Icon = copy.icon;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6">
        <Empty className="max-w-md flex-none border" data-testid="room-closed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon />
            </EmptyMedia>
            <EmptyTitle>{copy.title}</EmptyTitle>
            <EmptyDescription>{copy.body}</EmptyDescription>
          </EmptyHeader>
          <Button onClick={onLeave}>Back</Button>
        </Empty>
        {room.status === "ended" && endedExtra && <div className="w-full max-w-xl">{endedExtra}</div>}
      </div>
    );
  }

  // Before the first snapshot arrives there is no room to show yet. A skeleton beats a half-empty room.
  if (!room.you && (room.status === "connecting" || room.status === "reconnecting")) {
    return <ConnectingState status={room.status} onLeave={onLeave} />;
  }

  return (
    <div className="flex w-full flex-col gap-6 pb-28">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={room.status === "connected" ? "outline" : "secondary"} data-testid="room-status">
            {room.status === "connected" ? <LiveDot /> : <Spinner data-icon="inline-start" />}
            {STATUS_LABEL[room.status]}
          </Badge>
          {you && (
            <Badge variant={ROLE_BADGE[you.role]} data-testid="my-role">
              You: {roleLabel(you.role)}
            </Badge>
          )}
          {headerAction && <div className="ml-auto">{headerAction}</div>}
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-balance" data-testid="room-title">
          {room.title || "Space"}
        </h2>
        <TagList tags={room.tags} />
        <p className="text-sm text-muted-foreground tabular-nums">
          {speakers.length}/{room.maxSpeakers} on stage · {listeners.length} listening
          {room.startedAt && room.status === "connected" && (
            <>
              {" "}
              · Live for <Elapsed since={room.startedAt} data-testid="room-elapsed" />
            </>
          )}
        </p>
      </header>

      {room.status === "reconnecting" && (
        <Alert>
          <Spinner />
          <AlertTitle>Connection lost</AlertTitle>
          <AlertDescription>Trying to reconnect. Your seat is held for a few seconds.</AlertDescription>
        </Alert>
      )}
      {room.audioBlocked && (
        <Alert>
          <Volume2Icon />
          <AlertTitle>Audio is blocked by the browser</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            Click to start hearing the speakers.
            <Button size="sm" onClick={room.enableAudio}>
              Enable audio
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {room.micError && (
        <Alert variant="destructive">
          <MicOffIcon />
          <AlertTitle>Microphone problem</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {room.micError}
            <Button size="sm" variant="outline" onClick={() => void room.retryMic()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {room.expiring && <ExpiryBanner expiring={room.expiring} canExtend={isHost} onExtend={room.extend} />}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3" aria-labelledby="stage-heading">
            <h3 id="stage-heading" className="text-lg font-semibold tracking-tight">
              On stage
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <ul className="contents" role="list" data-testid="speakers">
                {speakers.map((p) => (
                  <li key={p.id} data-testid={`participant-${p.id}`} className="flex min-w-0">
                    <PersonTile
                      p={p}
                      me={p.id === you?.id}
                      talking={speaking.includes(p.id) && !p.muted}
                      actions={moderator && p.id !== you?.id && p.role !== "host" && (p.role !== "cohost" || isHost) ? <HostActions p={p} room={room} act={act} isHost={isHost} /> : null}
                    />
                  </li>
                ))}
              </ul>
              {Array.from({ length: openSeats }, (_, i) => (
                <Item key={`seat-${i}`} variant="outline" className="border-dashed text-muted-foreground" aria-hidden>
                  <ItemMedia>
                    <Avatar size="lg">
                      <AvatarFallback className="bg-transparent">
                        <MicIcon className="size-4" />
                      </AvatarFallback>
                    </Avatar>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>Open seat</ItemTitle>
                  </ItemContent>
                </Item>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="listeners-heading">
            <h3 id="listeners-heading" className="flex items-baseline gap-2 text-lg font-semibold tracking-tight">
              Listeners
              <span className="text-sm font-normal text-muted-foreground tabular-nums">{listeners.length}</span>
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2" role="list" data-testid="listeners">
              {listeners.map((p) => (
                <li key={p.id} data-testid={`participant-${p.id}`} className="flex min-w-0">
                  <PersonTile
                    p={p}
                    me={p.id === you?.id}
                    talking={false}
                    compact
                    actions={moderator && p.id !== you?.id ? <HostActions p={p} room={room} act={act} isHost={isHost} /> : null}
                  />
                </li>
              ))}
            </ul>
            {listeners.length === 0 && (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HeadphonesIcon />
                  </EmptyMedia>
                  <EmptyTitle>Nobody is listening yet</EmptyTitle>
                  <EmptyDescription>People who join with the space link show up here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </section>
        </div>

        <SidePanel room={room} moderator={moderator} requesters={requesters} act={act} />
      </div>

      <ReactionLayer reactions={room.reactions} />
      <ControlDock room={room} act={act} isHost={isHost} canSpeak={canSpeak} onLeave={onLeave} />
    </div>
  );
}


/** Requests (moderators), chat and activity, in one panel. */
function SidePanel({ room, moderator, requesters, act }: { room: Room; moderator: boolean; requesters: Participant[]; act: Act }) {
  const now = useNow(30_000);
  const stageFull = room.participants.filter((p) => p.role !== "listener").length >= room.maxSpeakers;
  const [tab, setTab] = useState<string>(moderator ? "requests" : "chat");
  // chat messages newer than the last one seen on the Chat tab count as unread
  const [seenId, setSeenId] = useState(() => room.chat.at(-1)?.id ?? 0);
  const unread = tab === "chat" ? 0 : room.chat.filter((m) => m.id > seenId && m.participantId !== room.you?.id).length;
  const markSeen = () => setSeenId(room.chat.at(-1)?.id ?? 0);

  return (
    <Card>
      <CardContent>
        <Tabs
          value={tab}
          onValueChange={(v) => {
            markSeen(); // leaving or entering Chat: everything up to now has been seen
            setTab(v as string);
          }}
        >
          <TabsList className="w-full">
            {moderator && (
              <TabsTrigger value="requests" data-testid="tab-requests">
                Requests{requesters.length > 0 ? ` (${requesters.length})` : ""}
              </TabsTrigger>
            )}
            <TabsTrigger value="chat" data-testid="tab-chat">
              Chat{unread > 0 ? ` (${unread})` : ""}
            </TabsTrigger>
            <TabsTrigger value="log" data-testid="tab-activity">
              Activity
            </TabsTrigger>
          </TabsList>
          {moderator && (
      <TabsContent value="requests">
        {requesters.length > 0 && (
          <div className="mb-2 flex flex-col gap-2">
            {room.seatFree && (
              <Alert data-testid="seat-free">
                <UserPlusIcon />
                <AlertTitle>A seat is free</AlertTitle>
                <AlertDescription>{room.seatFree.name} has waited longest.</AlertDescription>
              </Alert>
            )}
            {stageFull && !room.seatFree && (
              <p className="text-sm text-muted-foreground" data-testid="stage-full">
                The stage is full. Move someone to the audience to make room.
              </p>
            )}
            <Button size="sm" onClick={act(room.approveNext)} data-testid="approve-next">
              <ListChecksIcon data-icon="inline-start" />
              Approve next: {requesters[0]!.name}
            </Button>
          </div>
        )}
        <ol className="flex flex-col gap-1" data-testid="requests">
          {requesters.map((p, i) => {
            const at = room.queue.find((q) => q.id === p.id)?.at;
            return (
              <li key={p.id} data-testid={`request-${i + 1}`}>
                <Item size="xs">
                  <span className="w-5 shrink-0 text-sm font-medium text-muted-foreground tabular-nums" aria-label={`Number ${i + 1} in line`}>
                    {i + 1}
                  </span>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full">
                      <span className="truncate">{p.name}</span>
                    </ItemTitle>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                      {i === 0 && <Badge variant="secondary">next</Badge>}
                      {at && now > 0 && (now - at < 60_000 ? "just now" : `waiting ${formatSpan(now - at)}`)}
                    </span>
                  </ItemContent>
                  <ItemActions>
                    <Button size="sm" onClick={act(() => room.promote(p.id))} data-testid={`approve-${p.id}`}>
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" onClick={act(() => room.deny(p.id))}>
                      Deny
                    </Button>
                  </ItemActions>
                </Item>
              </li>
            );
          })}
        </ol>
        {requesters.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HandIcon />
              </EmptyMedia>
              <EmptyTitle>No raised hands</EmptyTitle>
              <EmptyDescription>Requests to speak appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </TabsContent>
          )}
          <TabsContent value="chat">
            <ChatPanel
              messages={room.chat}
              meId={room.you?.id}
              moderator={moderator}
              disabled={room.status !== "connected"}
              onSend={room.sendChat}
              onDelete={room.deleteChat}
            />
          </TabsContent>
      <TabsContent value="log">
        {room.activity.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ActivityIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing yet</EmptyTitle>
              <EmptyDescription>Joins, raised hands and stage changes show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ScrollArea className="h-72">
            <ol className="flex flex-col gap-1 pr-3" data-testid="event-log">
              {room.activity.map((a) => {
                const Icon = ACTIVITY_ICON[a.kind];
                return (
                  <li key={a.id}>
                    <Item size="xs">
                      <ItemMedia variant="icon">
                        <Icon />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="font-normal">{a.text}</ItemTitle>
                      </ItemContent>
                      <time className="text-xs text-muted-foreground tabular-nums" dateTime={new Date(a.at).toISOString()}>
                        {new Date(a.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </time>
                    </Item>
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        )}
      </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/** Skeleton while connecting. If it drags on, or the server is unreachable, say so and offer a way out. */
function ConnectingState({ status, onLeave }: { status: RoomStatus; onLeave: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);

  const unreachable = status === "reconnecting";
  return (
    <div className="flex w-full flex-col gap-6" data-testid="room-connecting">
      {(unreachable || slow) && (
        <Alert>
          {unreachable ? <WifiOffIcon /> : <Spinner />}
          <AlertTitle>{unreachable ? "Can't reach the server" : "Taking longer than usual"}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {unreachable ? "We'll keep trying. Check your connection if this continues." : "Still connecting. Check your connection."}
            <Button size="sm" variant="outline" onClick={onLeave}>
              Back
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <RoomSkeleton />
    </div>
  );
}

/** The signed-in person's own controls, pinned to the bottom of the screen so they are always one tap away. */
function ControlDock({
  room,
  act,
  isHost,
  canSpeak,
  onLeave,
}: {
  room: Room;
  act: Act;
  isHost: boolean;
  canSpeak: boolean;
  onLeave: () => void;
}) {
  const { you } = room;
  const [endOpen, setEndOpen] = useState(false);

  return (
    <div
      role="toolbar"
      aria-label="Your controls"
      className="fixed inset-x-4 bottom-4 mx-auto flex max-w-xl items-center gap-2 rounded-xl bg-card p-2 ring-1 ring-foreground/10"
    >
      {canSpeak ? (
        <>
          <Button
            size="lg"
            className="flex-1"
            variant={you?.muted ? "default" : "outline"}
            onClick={act(() => room.setMuted(!you?.muted))}
            data-testid="mute-toggle"
          >
            {you?.muted ? <MicOffIcon data-icon="inline-start" /> : <MicIcon data-icon="inline-start" />}
            {you?.muted ? "Unmute" : "Mute"}
          </Button>
          {you?.role === "speaker" && (
            <Button size="lg" variant="outline" onClick={act(room.leaveStage)} data-testid="leave-stage">
              <UserMinusIcon data-icon="inline-start" />
              Step down
            </Button>
          )}
        </>
      ) : room.handRaised ? (
        <Button size="lg" className="flex-1" variant="outline" onClick={act(room.cancelRequest)} data-testid="lower-hand">
          <XIcon data-icon="inline-start" />
          Lower hand{room.position ? ` · #${room.position.position} in line` : ""}
        </Button>
      ) : (
        <Button size="lg" className="flex-1" onClick={act(room.requestSpeak)} data-testid="raise-hand">
          <HandIcon data-icon="inline-start" />
          Ask to speak
        </Button>
      )}

      <ReactionPicker onReact={room.react} disabled={room.status !== "connected"} />

      {isHost ? (
        <AlertDialog open={endOpen} onOpenChange={setEndOpen}>
          <AlertDialogTrigger render={<Button size="lg" variant="destructive" data-testid="end-space" />}>
            <PhoneOffIcon data-icon="inline-start" />
            End space
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>End this space for everyone?</AlertDialogTitle>
              <AlertDialogDescription>
                All participants are disconnected. A new space can be created afterwards.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                data-testid="confirm-end"
                onClick={() => {
                  setEndOpen(false);
                  void act(room.endSpace)();
                }}
              >
                End space
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button size="lg" variant="ghost" onClick={onLeave} data-testid="leave-space">
          <LogOutIcon data-icon="inline-start" />
          Leave
        </Button>
      )}
    </div>
  );
}

function PersonTile({
  p,
  me,
  talking,
  compact,
  actions,
}: {
  p: Participant;
  me: boolean;
  talking: boolean;
  compact?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <Item variant="outline" size={compact ? "xs" : "default"} className={cn("flex-nowrap", talking && "border-primary")}>
      <ItemMedia>
        <Avatar
          size={compact ? "default" : "lg"}
          className={talking ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : undefined}
        >
          <AvatarFallback>{initials(p.name)}</AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full">
          <span className="min-w-0 truncate">{p.name}</span>
          {me && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
          {p.muted && p.role !== "listener" && (
            <MicOffIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Muted" />
          )}
          {talking && <span className="sr-only">Speaking</span>}
        </ItemTitle>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {!compact && <Badge variant={ROLE_BADGE[p.role]}>{roleLabel(p.role)}</Badge>}
          {p.linkedinUrl && (
            <a
              href={p.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 rounded-sm text-xs text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              LinkedIn
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
      </ItemContent>
      {actions && <ItemActions className="shrink-0">{actions}</ItemActions>}
    </Item>
  );
}

/** Host-only actions for one person, tucked in a menu so the roster stays calm. */
/** `isHost`: I am running the room (only the host appoints co-hosts); a co-host can do the rest. */
function HostActions({ p, room, act, isHost }: { p: Participant; room: Room; act: Act; isHost: boolean }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Actions for ${p.name}`} />}>
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuGroup>
            {p.role === "listener" ? (
              <DropdownMenuItem onClick={act(() => room.promote(p.id))}>
                <UserPlusIcon />
                Invite to speak
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem disabled={p.muted} onClick={act(() => room.hostMute(p.id))}>
                  <MicOffIcon />
                  Mute
                </DropdownMenuItem>
                {p.role === "speaker" && (
                  <DropdownMenuItem onClick={act(() => room.demote(p.id))}>
                    <UserMinusIcon />
                    Move to listeners
                  </DropdownMenuItem>
                )}
              </>
            )}
            {isHost && p.role !== "cohost" && (
              <DropdownMenuItem onClick={act(() => room.makeCohost(p.id), `${p.name} is now a co-host`)} data-testid={`make-cohost-${p.id}`}>
                <ShieldCheckIcon />
                Make co-host
              </DropdownMenuItem>
            )}
            {isHost && p.role === "cohost" && (
              <DropdownMenuItem onClick={act(() => room.removeCohost(p.id), `${p.name} is no longer a co-host`)} data-testid={`remove-cohost-${p.id}`}>
                <ShieldOffIcon />
                Remove co-host
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
              <UserXIcon />
              Remove and ban
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {p.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They are removed and their LinkedIn profile is banned from rejoining this space.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                void act(() => room.kick(p.id), "Removed")();
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
