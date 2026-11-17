"use client";

import { HistoryIcon, InfoIcon, LogOutIcon, MicIcon, PhoneOffIcon, RefreshCwIcon, ShieldAlertIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { DashboardBodySkeleton } from "@/components/admin/dashboard-skeleton";
import { ProfileDialog } from "@/components/admin/profile-dialog";
import { StartSpaceCard } from "@/components/admin/start-space-card";
import { UpcomingSpaces } from "@/components/admin/upcoming-spaces";
import { Elapsed } from "@/components/elapsed";
import { TagList } from "@/components/tag-list";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { FieldGroup } from "@/components/ui/field";
import { ShareField } from "@/components/share-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, type AdminProfile, type AdminSpace, api, errorMessage } from "@/lib/api";
import { endReasonShort, formatSpan } from "@/lib/space";
import { cn } from "@/lib/utils";

const fmt = (at: number | null) =>
  at ? new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

export function AdminDashboard({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const router = useRouter();
  const [current, setCurrent] = useState<AdminSpace | null | undefined>(undefined);
  const [history, setHistory] = useState<AdminSpace[]>([]);
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [openReports, setOpenReports] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scheduled = history.filter((s) => s.status === "scheduled");
  const past = history.filter((s) => s.status !== "scheduled");
  const hostedMs = past.reduce((sum, s) => sum + (s.endedAt ? s.endedAt - s.startedAt : 0), 0); // finished spaces only
  const peopleTotal = past.reduce((sum, s) => sum + (s.participantCount ?? 0), 0);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [me, cur, list, reports] = await Promise.all([
        api.me(token),
        api.currentSpace(token),
        api.listSpaces(token),
        api.listReports(token, "open").catch(() => ({ reports: [] })), // a moderation hiccup should not block the dashboard
      ]);
      setProfile(me);
      setOpenReports(reports.reports.length);
      setCurrent(cur.space);
      setHistory(list.spaces);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return onSignOut();
      setError(errorMessage(e));
    }
  }, [token, onSignOut]);

  /** Nothing has loaded yet and the first attempt failed. Do not show "Start a space" as if we knew no space is live. */
  const failedFirstLoad = error !== null && current === undefined;

  function retry() {
    setError(null);
    void refresh();
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void refresh();
  }, [refresh]);

  async function end(space: AdminSpace) {
    setBusy(true);
    try {
      await api.endSpace(token, space.id);
      toast.success("Space ended");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function rotate(space: AdminSpace) {
    try {
      const res = await api.rotateSecret(token, space.id);
      toast.success("Secret rotated");
      setCurrent((c) => (c ? { ...c, secret: res.secret } : c));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function signOut() {
    await api.logout(token).catch(() => {});
    onSignOut();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-semibold tracking-tight">Dashboard</h2>
          <div className="text-sm text-muted-foreground">
            {profile ? (
              <>
                Signed in as <span className="font-medium text-foreground">{profile.displayName || profile.username}</span>
              </>
            ) : failedFirstLoad ? (
              "Couldn't load your account"
            ) : (
              <Skeleton className="h-4 w-32" />
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ProfileDialog token={token} profile={profile} onSaved={setProfile} />
          <Link href="/admin/moderation" className={buttonVariants({ variant: "outline" })} data-testid="open-moderation">
            <ShieldAlertIcon data-icon="inline-start" />
            Moderation
            {openReports > 0 && (
              <Badge variant="destructive" data-testid="open-reports-count">
                {openReports}
              </Badge>
            )}
          </Link>
          <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => void refresh()}>
            <RefreshCwIcon />
          </Button>
          <Button variant="outline" onClick={signOut} data-testid="sign-out">
            <LogOutIcon data-icon="inline-start" />
            Sign out
          </Button>
        </div>
      </div>

      {error && !failedFirstLoad && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {failedFirstLoad ? (
        <Empty className="border" data-testid="dashboard-error">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlertIcon />
            </EmptyMedia>
            <EmptyTitle>Couldn&apos;t load the dashboard</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={retry} data-testid="dashboard-retry">
              <RefreshCwIcon data-icon="inline-start" />
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      ) : current === undefined ? (
        <DashboardBodySkeleton />
      ) : current ? (
        <Card data-testid="live-space">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
              {current.title}
              <Badge variant="outline">
                <LiveDot />
                Live
              </Badge>
            </CardTitle>
            <TagList tags={current.tags} />
            <CardDescription>
              Started {fmt(current.startedAt)} · Running <Elapsed since={current.startedAt} className="tabular-nums" data-testid="live-elapsed" />
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-5 sm:grid-cols-2">
              <ShareField label="Join link" value={`${window.location.origin}/s/${current.id}`} testId="join-url" />
              <ShareField label="Secret" value={current.secret} testId="space-secret" mono />
            </FieldGroup>
            {current.autoEnd && autoEndNote(current.autoEnd) && (
              <p className="mt-5 flex items-start gap-2 text-sm text-muted-foreground" data-testid="auto-end-note">
                <InfoIcon className="mt-0.5 size-4 shrink-0" />
                {autoEndNote(current.autoEnd)}
              </p>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Link
              href={`/admin/space/${current.id}`}
              className={cn(buttonVariants({ size: "lg" }))}
              data-testid="enter-space"
            >
              <MicIcon data-icon="inline-start" />
              Enter as host
            </Link>
            <Button variant="outline" size="lg" onClick={() => void rotate(current)}>
              <RefreshCwIcon data-icon="inline-start" />
              Rotate secret
            </Button>
            <Button
              variant="destructive"
              size="lg"
              disabled={busy}
              onClick={() => setConfirmEnd(true)}
              data-testid="end-from-dashboard"
            >
              <PhoneOffIcon data-icon="inline-start" />
              End space
            </Button>
          </CardFooter>

          <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>End “{current.title}” for everyone?</AlertDialogTitle>
                <AlertDialogDescription>
                  All participants are disconnected. A new space can be created afterwards.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  data-testid="confirm-end-dashboard"
                  onClick={() => {
                    setConfirmEnd(false);
                    void end(current);
                  }}
                >
                  End space
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Card>
      ) : (
        <StartSpaceCard
          token={token}
          onCreated={(space) => {
            if (space.status === "live") setCurrent(space);
            void refresh();
          }}
        />
      )}

      {scheduled.length > 0 && current !== undefined && !failedFirstLoad && (
        <UpcomingSpaces token={token} spaces={scheduled} liveExists={!!current} onChanged={() => void refresh()} />
      )}

      {current !== undefined && !failedFirstLoad && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-semibold tracking-tight">History</CardTitle>
            <CardDescription>
            Newest first. Select a space to see who joined.
            {past.length > 0 && (
              <span className="mt-1 block tabular-nums" data-testid="history-totals">
                {past.length} {past.length === 1 ? "space" : "spaces"} · {formatSpan(hostedMs)} hosted · {peopleTotal} {peopleTotal === 1 ? "person" : "people"} joined
              </span>
            )}
          </CardDescription>
          </CardHeader>
          <CardContent>
            <div data-testid="history">
            {past.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <HistoryIcon />
                  </EmptyMedia>
                  <EmptyTitle>No spaces yet</EmptyTitle>
                  <EmptyDescription>Spaces you host will show up here once you start one.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Duration</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">People</TableHead>
                    <TableHead className="hidden md:table-cell">Started</TableHead>
                    <TableHead className="hidden md:table-cell">Ended</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {past.map((s) => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/admin/history/${s.id}`)}
                      data-testid={`history-row-${s.id}`}
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/admin/history/${s.id}`}
                          className="rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {s.title}
                        </Link>
                        <TagList tags={s.tags} className="mt-1 font-normal" />
                        <span className="block text-xs font-normal text-muted-foreground tabular-nums sm:hidden">
                          {s.participantCount ?? 0} people · {s.speakerCount ?? 0} spoke ·{" "}
                          {s.endedAt ? formatSpan(s.endedAt - s.startedAt) : <Elapsed since={s.startedAt} />}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.status === "live" ? "default" : "secondary"}>{s.status}</Badge>
                        {endReasonShort(s.endReason) && (
                          <span className="mt-1 block text-xs text-muted-foreground">{endReasonShort(s.endReason)}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden tabular-nums sm:table-cell">
                        {s.endedAt ? formatSpan(s.endedAt - s.startedAt) : <Elapsed since={s.startedAt} />}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {s.participantCount ?? 0} ({s.speakerCount ?? 0} spoke)
                      </TableCell>
                      <TableCell className="hidden tabular-nums md:table-cell">{fmt(s.startedAt)}</TableCell>
                      <TableCell className="hidden tabular-nums md:table-cell">{fmt(s.endedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** One sentence telling the host what happens if they forget to end the space. */
function autoEndNote({ maxMinutes, hostAbsentMinutes, emptyMinutes }: NonNullable<AdminSpace["autoEnd"]>): string | null {
  const parts = [
    hostAbsentMinutes > 0 && `you are away for ${formatSpan(hostAbsentMinutes * 60_000)}`,
    emptyMinutes > 0 && `nobody joins you for ${formatSpan(emptyMinutes * 60_000)}`,
    maxMinutes > 0 && `it has run for ${formatSpan(maxMinutes * 60_000)}`,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} or ${parts.at(-1)}` : parts[0]!;
  return `If you forget, this space ends on its own when ${list}.`;
}

