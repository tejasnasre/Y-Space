"use client";

import { ArrowLeftIcon, BanIcon, CalendarClockIcon, GlobeIcon, DownloadIcon, ExternalLinkIcon, LockIcon, RefreshCwIcon, SearchIcon, TriangleAlertIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AttendanceChart } from "@/components/admin/attendance-chart";
import { Elapsed } from "@/components/elapsed";
import { TagList } from "@/components/tag-list";
import { ShareField } from "@/components/share-field";
import { LiveDot } from "@/components/live-dot";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNow } from "@/hooks/use-now";
import { ADMIN_TOKEN_KEY, useStored } from "@/hooks/use-stored";
import { ApiError, type AdminSpace, type SpaceDetail, type SpaceParticipant, api, errorMessage } from "@/lib/api";
import { describeEvent, downloadText, endReasonShort, fmtDateTime, fmtTime, formatSpan, toCsv } from "@/lib/space";
import { spaceStats } from "@/lib/stats";
import { toast } from "sonner";

const roleOf = (p: SpaceParticipant) => (p.isHost ? "Host" : p.cohost ? "Co-host" : p.spoke ? "Speaker" : "Listener");

export function DetailSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading space" className="flex flex-col gap-6">
      <Skeleton className="h-8 w-28 rounded-lg" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24 rounded-4xl" />
        <Skeleton className="h-9 w-2/3 max-w-md" />
      </div>
      <Card>
        <CardContent className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </CardContent>
      </Card>
      <Skeleton className="h-8 w-56 rounded-lg" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

/** One finished (or live) space: who joined, their LinkedIn, when, and a timeline. */
export function SpaceDetailView({ spaceId }: { spaceId: string }) {
  const [token, setToken, ready] = useStored(ADMIN_TOKEN_KEY);
  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [blocking, setBlocking] = useState<SpaceParticipant | null>(null);
  const now = useNow(30_000);

  const load = useCallback(() => {
    if (!token) return () => {};
    let cancelled = false;
    api
      .spaceDetail(token, spaceId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) return setToken(null);
        setError({ message: errorMessage(e), notFound: e instanceof ApiError && e.status === 404 });
      });
    return () => {
      cancelled = true;
    };
  }, [token, spaceId, setToken]);

  useEffect(() => load(), [load, attempt]);

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (detail?.participants ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [detail, query]);

  const stats = useMemo(() => {
    if (!detail || detail.space.status === "scheduled") return null;
    const end = detail.space.endedAt ?? (now || detail.space.startedAt);
    return spaceStats(detail.participants, detail.events, detail.space.startedAt, end, detail.space.status === "ended");
  }, [detail, now]);

  if (!ready) return <DetailSkeleton />;

  if (!token) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockIcon />
          </EmptyMedia>
          <EmptyTitle>Sign in required</EmptyTitle>
          <EmptyDescription>Sign in as admin to see who joined this space.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href="/admin" className={buttonVariants()}>
            Go to sign in
          </Link>
        </EmptyContent>
      </Empty>
    );
  }

  if (error) {
    return (
      <Empty className="border" data-testid="detail-error">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>{error.notFound ? "Space not found" : "Couldn't load this space"}</EmptyTitle>
          <EmptyDescription>{error.notFound ? "It may have been removed, or the link is wrong." : error.message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            <Link href="/admin" className={buttonVariants({ variant: "outline" })}>
              Back to dashboard
            </Link>
            {!error.notFound && (
              <Button
                onClick={() => {
                  setError(null);
                  setAttempt((n) => n + 1);
                }}
              >
                <RefreshCwIcon data-icon="inline-start" />
                Try again
              </Button>
            )}
          </div>
        </EmptyContent>
      </Empty>
    );
  }

  if (!detail) return <DetailSkeleton />;

  const { space, participants, events } = detail;
  const live = space.status === "live";
  const scheduled = space.status === "scheduled";
  const guests = participants.filter((p) => !p.isHost);
  const spoke = guests.filter((p) => p.spoke).length;
  const removed = guests.filter((p) => p.kickedAt).length;
  const names = new Map(participants.map((p) => [p.id, p.name]));

  function exportCsv() {
    const rows = [
      ["Name", "LinkedIn", "Role", "Joined", "Left", "Removed"],
      ...participants.map((p) => [
        p.name,
        p.linkedinUrl ?? "",
        roleOf(p),
        new Date(p.joinedAt).toISOString(),
        p.leftAt ? new Date(p.leftAt).toISOString() : "",
        p.kickedAt ? "yes" : "",
      ]),
    ];
    const slug = space.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "space";
    downloadText(`${slug}-attendees.csv`, toCsv(rows));
  }

  return (
    <div className="flex flex-col gap-6" data-testid="space-detail">
      <Link href="/admin" className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit"}>
        <ArrowLeftIcon data-icon="inline-start" />
        Dashboard
      </Link>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {scheduled ? (
            <Badge variant="outline">Scheduled</Badge>
          ) : live ? (
            <Badge variant="outline">
              <LiveDot />
              Live now
            </Badge>
          ) : (
            <Badge variant="secondary">ended</Badge>
          )}
          {endReasonShort(space.endReason) && <Badge variant="outline">{endReasonShort(space.endReason)}</Badge>}
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-balance" data-testid="detail-title">
          {space.title}
        </h2>
        <TagList tags={space.tags} />
      </div>

      {scheduled ? (
        <Card>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <CalendarClockIcon className="size-4" />
              Scheduled for {fmtDateTime(space.scheduledFor)}
            </p>
            {space.description && <p className="whitespace-pre-wrap text-muted-foreground">{space.description}</p>}
            <p className="text-muted-foreground">Nobody has joined yet. Open it from the dashboard when it&apos;s time.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <Stat label="Duration">
                {space.endedAt ? formatSpan(space.endedAt - space.startedAt) : <Elapsed since={space.startedAt} className="tabular-nums" />}
              </Stat>
              <Stat label="People joined">{guests.length}</Stat>
              <Stat label="Spoke">{spoke}</Stat>
              <Stat label="Removed">{removed}</Stat>
              <Stat label="Started">{fmtDateTime(space.startedAt)}</Stat>
              <Stat label="Ended">{fmtDateTime(space.endedAt)}</Stat>
            </dl>
          </CardContent>
        </Card>
      )}

      {stats && guests.length > 0 && (
        <Card data-testid="engagement">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Engagement</CardTitle>
            <CardDescription>How people used the space, from when they joined and left.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <Stat label="Most at once">
                <span data-testid="stat-peak">{stats.peak}</span>
                {stats.peakAt && <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">at {fmtTime(stats.peakAt)}</span>}
              </Stat>
              <Stat label="Average stay">
                <span data-testid="stat-avg">{stats.avgStayMs === null ? "—" : formatSpan(stats.avgStayMs)}</span>
              </Stat>
              <Stat label="Stayed to the end">
                <span data-testid="stat-stayed">{stats.stayedShare === null ? "—" : `${Math.round(stats.stayedShare * 100)}%`}</span>
              </Stat>
              <Stat label="Hands raised">
                <span data-testid="stat-hands">{stats.handRaises}</span>
              </Stat>
            </dl>
            <div>
              <h3 className="mb-2 text-sm font-medium">People in the room</h3>
              <AttendanceChart series={stats.series} peak={stats.peak} />
            </div>
          </CardContent>
        </Card>
      )}

      <ListingRow token={token} space={space} onChanged={() => setAttempt((n) => n + 1)} />

      {!scheduled && (space.status === "ended" || space.listMode !== "off") && (
        <SharingCard token={token} space={space} guests={guests} onChanged={() => setAttempt((n) => n + 1)} />
      )}

      {live && (
        <p className="text-sm text-muted-foreground">
          This space is still live.{" "}
          <Link href={`/admin/space/${space.id}`} className="text-primary underline-offset-4 hover:underline">
            Go to the room
          </Link>{" "}
          or refresh to see new people.
        </p>
      )}

      <Tabs defaultValue="people">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="people" data-testid="tab-people">
              People ({participants.length})
            </TabsTrigger>
            <TabsTrigger value="timeline" data-testid="tab-timeline">
              Timeline
            </TabsTrigger>
          </TabsList>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => setAttempt((n) => n + 1)}>
              <RefreshCwIcon />
            </Button>
            <Button variant="outline" onClick={exportCsv} data-testid="export-csv" disabled={participants.length === 0}>
              <DownloadIcon data-icon="inline-start" />
              Download CSV
            </Button>
          </div>
        </div>

        <TabsContent value="people" className="flex flex-col gap-3 pt-2">
          {participants.length > 8 && (
            <InputGroup className="max-w-sm">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name"
                aria-label="Search people"
              />
            </InputGroup>
          )}
          {participants.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersIcon />
                </EmptyMedia>
                <EmptyTitle>Nobody joined</EmptyTitle>
                <EmptyDescription>No one entered this space.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Card>
              <CardContent>
                <Table data-testid="people">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>LinkedIn</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="hidden md:table-cell">Joined</TableHead>
                      <TableHead className="hidden md:table-cell">Time in space</TableHead>
                      <TableHead className="w-10">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {people.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="max-w-48 truncate font-medium">{p.name}</TableCell>
                        <TableCell>
                          {p.linkedinUrl ? (
                            <a
                              href={p.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                            >
                              Profile
                              <ExternalLinkIcon className="size-3" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant={p.isHost ? "default" : p.spoke ? "secondary" : "outline"}>{roleOf(p)}</Badge>
                            {p.kickedAt && <Badge variant="destructive">Removed</Badge>}
                            {p.blocked && <Badge variant="destructive">Blocked</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="hidden tabular-nums md:table-cell">{fmtTime(p.joinedAt)}</TableCell>
                        <TableCell className="hidden tabular-nums md:table-cell">
                          {p.leftAt ? formatSpan(p.leftAt - p.joinedAt) : "In the space"}
                        </TableCell>
                        <TableCell>
                          {!p.isHost && !p.blocked && p.linkedinUrl && (
                            <Button variant="ghost" size="icon-sm" aria-label={`Block ${p.name} from all spaces`} title="Block from all spaces" onClick={() => setBlocking(p)} data-testid={`block-${p.id}`}>
                              <BanIcon />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {people.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No one matches &ldquo;{query}&rdquo;.</p>}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="timeline" className="pt-2">
          <Card>
            <CardContent>
              <ol className="flex flex-col gap-1" data-testid="timeline">
                {events.map((e) => (
                  <li key={e.id}>
                    <Item size="xs">
                      <time className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={new Date(e.at).toISOString()}>
                        {fmtTime(e.at)}
                      </time>
                      <ItemContent>
                        <ItemTitle className="font-normal">{describeEvent(e.type, e.participantId ? (names.get(e.participantId) ?? null) : null, e.data)}</ItemTitle>
                      </ItemContent>
                    </Item>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {blocking && (
        <BlockDialog
          key={blocking.id}
          token={token}
          person={blocking}
          onClose={() => setBlocking(null)}
          onBlocked={() => setAttempt((n) => n + 1)}
        />
      )}
    </div>
  );
}

/** Whether this space appears on the public home page. */
function ListingRow({ token, space, onChanged }: { token: string; space: AdminSpace; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardContent>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="detail-listed">Show on the home page</FieldLabel>
            <FieldDescription>
              {space.unlisted ? "Hidden. People with its link can still open it." : "Anyone can see the title, topics, host and how big it was. Never the secret or who joined."}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="detail-listed"
            checked={!space.unlisted}
            disabled={busy}
            data-testid="detail-listed"
            onCheckedChange={(next) => {
              setBusy(true);
              api
                .setListing(token, space.id, next)
                .then(() => toast.success(next ? "Shown on the home page" : "Hidden from the home page"))
                .catch((e) => toast.error(errorMessage(e)))
                .finally(() => {
                  setBusy(false);
                  onChanged();
                });
            }}
          />
        </Field>
      </CardContent>
    </Card>
  );
}

/**
 * The "share who was here" section of a space, in whichever state it is in:
 *  - everyone: the host chose, before the space, to publish everyone who stayed
 *  - optin: guests choose for themselves whether to appear
 *  - off (ended): private. Offers the consent-respecting way to share it.
 */
function SharingCard({ token, space, guests, onChanged }: { token: string; space: AdminSpace; guests: SpaceParticipant[]; onChanged: () => void }) {
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const ended = space.status === "ended";
  const mode = space.listMode;
  const joined = guests.filter((g) => !g.kickedAt).length;
  const chose = guests.filter((g) => g.sharePublicly && !g.kickedAt).length;

  function run(promise: Promise<unknown>, success: string) {
    setBusy(true);
    promise
      .then(() => toast.success(success))
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => {
        setBusy(false);
        setConfirmStop(false);
        onChanged();
      });
  }

  if (mode === "off") {
    return (
      <Card data-testid="sharing-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <GlobeIcon className="size-4" />
            Share who was here
          </CardTitle>
          <CardDescription>This list is private.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            The people in this space joined expecting the list to stay with the people who were there, so it can&apos;t just be published. You can open a public list that <strong>each guest chooses to appear on</strong>. Nobody is listed unless they say yes.
          </p>
          <p className="text-muted-foreground">
            Guests see a switch on their &ldquo;space ended&rdquo; page, in the browser they joined from. {joined === 0 ? "Nobody but you joined this one, so the list would only show you." : `${joined} ${joined === 1 ? "guest" : "guests"} can choose.`}
          </p>
          <div>
            <Button disabled={busy} onClick={() => run(api.openOptInList(token, space.id, true), "Public list opened")} data-testid="open-optin">
              {busy ? <Spinner data-icon="inline-start" /> : <GlobeIcon data-icon="inline-start" />}
              Let attendees opt in
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="public-list-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <GlobeIcon className="size-4" />
          {mode === "optin" ? "Public list (guests opt in)" : "Public attendee list"}
        </CardTitle>
        <CardDescription>
          {mode === "optin" ? (
            <>
              <span data-testid="optin-count">
                {chose} of {joined} {joined === 1 ? "guest" : "guests"} chose to appear.
              </span>{" "}
              Anyone with the link sees you and those guests. Removed, blocked and reported people never appear.
            </>
          ) : ended ? (
            "Anyone with this link can see who was here: names and LinkedIn profiles, without people you removed, blocked or have an unreviewed report against."
          ) : (
            "Published once the space ends. Guests were told when they joined."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ShareField label="Link" value={`${window.location.origin}/s/${space.id}/people`} testId="admin-public-link" />
        <div className="flex flex-wrap gap-2">
          {ended && (
            <Link href={`/s/${space.id}/people`} target="_blank" className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="open-public-list">
              <ExternalLinkIcon data-icon="inline-start" />
              Open page
            </Link>
          )}
          <Button variant="outline" size="sm" onClick={() => setConfirmStop(true)} data-testid="stop-sharing">
            Stop sharing
          </Button>
        </div>
      </CardContent>
      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop sharing this list?</AlertDialogTitle>
            <AlertDialogDescription>
              The public link stops working.{mode === "optin" ? " Guests' choices are kept, and you can open the list again later." : " It can't be switched on for everyone again once the space has started, because guests are told before they join."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep sharing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} data-testid="confirm-stop-sharing" onClick={() => run(api.setPublicList(token, space.id, false), "List is private again")}>
              Stop sharing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Block a profile from every future space. Whoever is in a live space with it is removed at once. */
function BlockDialog({ token, person, onClose, onBlocked }: { token: string; person: SpaceParticipant; onClose: () => void; onBlocked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Block {person.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This LinkedIn profile can&apos;t join any space again, whatever name they use. You can unblock it later from Moderation.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional, only you see it)" rows={2} maxLength={500} aria-label="Reason" />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            data-testid="confirm-block"
            onClick={() => {
              setBusy(true);
              api
                .blockParticipant(token, person.id, reason.trim() || undefined)
                .then(() => {
                  toast.success(`${person.name} is blocked`);
                  onBlocked();
                  onClose();
                })
                .catch((e) => {
                  toast.error(errorMessage(e));
                  setBusy(false);
                });
            }}
          >
            {busy && <Spinner data-icon="inline-start" />}
            Block
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-base font-medium">{children}</dd>
    </div>
  );
}
