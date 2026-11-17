"use client";

import { ArrowLeftIcon, BanIcon, ExternalLinkIcon, FlagIcon, LockIcon, RefreshCwIcon, ShieldAlertIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ADMIN_TOKEN_KEY, useStored } from "@/hooks/use-stored";
import { ApiError, type Block, type Report, api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/space";

function ModerationSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading moderation" className="flex flex-col gap-6">
      <Skeleton className="h-8 w-28 rounded-lg" />
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-8 w-60 rounded-lg" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** What people reported, and who is blocked from every space. */
export function ModerationView() {
  const [token, setToken, ready] = useStored(ADMIN_TOKEN_KEY);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [blocking, setBlocking] = useState<Report | null>(null);
  const [unblocking, setUnblocking] = useState<Block | null>(null);
  /** unblocked during this visit, so a mistake is one click to undo */
  const [recentlyUnblocked, setRecentlyUnblocked] = useState<Block[]>([]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    Promise.all([api.listReports(token), api.listBlocks(token)])
      .then(([r, b]) => {
        if (cancelled) return;
        setReports(r.reports);
        setBlocks(b.blocks);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) return setToken(null);
        setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt, setToken]);

  if (!ready) return <ModerationSkeleton />;

  if (!token) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockIcon />
          </EmptyMedia>
          <EmptyTitle>Sign in required</EmptyTitle>
          <EmptyDescription>Sign in as admin to review reports.</EmptyDescription>
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
      <Empty className="border" data-testid="moderation-error">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>Couldn&apos;t load moderation</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            onClick={() => {
              setError(null);
              reload();
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (!reports || !blocks) return <ModerationSkeleton />;

  const open = reports.filter((r) => r.status === "open");
  const resolved = reports.filter((r) => r.status !== "open");
  const blockedKeys = new Set(blocks.map((b) => b.linkedinKey));
  const undoable = recentlyUnblocked.filter((b) => !blockedKeys.has(b.linkedinKey));

  /** Put an unblocked profile straight back on the list, with the same name and reason. */
  function reblock(b: Block) {
    api
      .blockLinkedin(token!, { linkedinUrl: b.linkedinUrl, name: b.name, reason: b.reason ?? undefined })
      .then(() => {
        toast.success(`${b.name} is blocked again`);
        setRecentlyUnblocked((l) => l.filter((x) => x.linkedinKey !== b.linkedinKey));
      })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(reload);
  }

  return (
    <div className="flex flex-col gap-6" data-testid="moderation">
      <Link href="/admin" className={buttonVariants({ variant: "ghost", size: "sm" }) + " w-fit"}>
        <ArrowLeftIcon data-icon="inline-start" />
        Dashboard
      </Link>
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-semibold tracking-tight">Moderation</h2>
        <p className="text-sm text-muted-foreground">What attendees reported, and who can&apos;t join any space.</p>
      </div>

      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports" data-testid="tab-reports">
            Reports{open.length > 0 ? ` (${open.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="blocked" data-testid="tab-blocked">
            Blocked ({blocks.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="flex flex-col gap-6 pt-2">
          {open.length === 0 ? (
            <Empty className="border" data-testid="no-reports">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FlagIcon />
                </EmptyMedia>
                <EmptyTitle>No open reports</EmptyTitle>
                <EmptyDescription>When an attendee reports someone from the after-event list, it shows up here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-2" role="list" data-testid="open-reports">
              {open.map((r) => (
                <li key={r.id} data-testid={`report-${r.id}`}>
                  <ReportItem report={r} alreadyBlocked={!!r.reported.linkedinKey && blockedKeys.has(r.reported.linkedinKey)}>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`dismiss-${r.id}`}
                      onClick={() =>
                        api
                          .dismissReport(token, r.id)
                          .then(() => toast.success("Report dismissed"))
                          .catch((e) => toast.error(errorMessage(e)))
                          .finally(reload)
                      }
                    >
                      Dismiss
                    </Button>
                    {r.reported.linkedinKey && !blockedKeys.has(r.reported.linkedinKey) && (
                      <Button size="sm" variant="destructive" onClick={() => setBlocking(r)} data-testid={`block-report-${r.id}`}>
                        <BanIcon data-icon="inline-start" />
                        Block
                      </Button>
                    )}
                  </ReportItem>
                </li>
              ))}
            </ul>
          )}

          {resolved.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-muted-foreground">Resolved</h3>
              <ul className="flex flex-col gap-2" role="list" data-testid="resolved-reports">
                {resolved.map((r) => (
                  <li key={r.id}>
                    <ReportItem report={r} alreadyBlocked={false} status={r.status} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </TabsContent>

        <TabsContent value="blocked" className="flex flex-col gap-6 pt-2">
          <BlockForm token={token} onBlocked={reload} />
          {undoable.length > 0 && (
            <section className="flex flex-col gap-2" data-testid="recently-unblocked">
              <h3 className="text-sm font-medium text-muted-foreground">Recently unblocked</h3>
              <ul className="flex flex-col gap-2" role="list">
                {undoable.map((b) => (
                  <li key={b.id}>
                    <Item variant="outline" size="xs" className="flex-nowrap">
                      <ItemContent className="min-w-0">
                        <ItemTitle className="max-w-full">
                          <span className="truncate">{b.name}</span>
                          <a href={b.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-xs font-normal text-primary underline-offset-4 hover:underline" aria-label={`${b.name} on LinkedIn`}>
                            LinkedIn
                            <ExternalLinkIcon className="size-3" />
                          </a>
                        </ItemTitle>
                      </ItemContent>
                      <ItemActions className="shrink-0">
                        <Button size="sm" variant="destructive" onClick={() => reblock(b)} data-testid={`reblock-${b.id}`}>
                          <BanIcon data-icon="inline-start" />
                          Block again
                        </Button>
                      </ItemActions>
                    </Item>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {blocks.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ShieldAlertIcon />
                </EmptyMedia>
                <EmptyTitle>Nobody is blocked</EmptyTitle>
                <EmptyDescription>Blocked profiles can&apos;t join any space, whatever name they use.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Card>
              <CardContent>
                <Table data-testid="blocks">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>LinkedIn</TableHead>
                      <TableHead className="hidden md:table-cell">Reason</TableHead>
                      <TableHead className="hidden md:table-cell">Blocked</TableHead>
                      <TableHead className="w-24">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {blocks.map((b) => (
                      <TableRow key={b.id} data-testid={`block-row-${b.id}`}>
                        <TableCell className="max-w-48 truncate font-medium">{b.name}</TableCell>
                        <TableCell>
                          <a href={b.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                            Profile
                            <ExternalLinkIcon className="size-3" />
                          </a>
                        </TableCell>
                        <TableCell className="hidden max-w-64 truncate md:table-cell">{b.reason ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="hidden tabular-nums md:table-cell">{fmtDateTime(b.createdAt)}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => setUnblocking(b)} data-testid={`unblock-${b.id}`}>
                            Unblock
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {blocking && <BlockReportDialog key={blocking.id} token={token} report={blocking} onClose={() => setBlocking(null)} onDone={reload} />}

      <AlertDialog open={!!unblocking} onOpenChange={(o) => !o && setUnblocking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unblock {unblocking?.name}?</AlertDialogTitle>
            <AlertDialogDescription>They will be able to join spaces again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep blocked</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-unblock"
              onClick={() => {
                const b = unblocking!;
                setUnblocking(null);
                api
                  .unblock(token, b.id)
                  .then(() => {
                    setRecentlyUnblocked((l) => [b, ...l.filter((x) => x.linkedinKey !== b.linkedinKey)]);
                    toast(`${b.name} is unblocked`, { duration: 10_000, action: { label: "Block again", onClick: () => reblock(b) } });
                  })
                  .catch((e) => toast.error(errorMessage(e)))
                  .finally(reload);
              }}
            >
              Unblock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ReportItem({ report: r, alreadyBlocked, status, children }: { report: Report; alreadyBlocked: boolean; status?: Report["status"]; children?: React.ReactNode }) {
  return (
    <Item variant="outline" className="flex-nowrap items-start">
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full flex-wrap">
          <span className="truncate">{r.reported.name}</span>
          {r.reported.linkedinUrl && (
            <a href={r.reported.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-xs font-normal text-primary underline-offset-4 hover:underline" aria-label={`${r.reported.name} on LinkedIn`}>
              LinkedIn
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
          {alreadyBlocked && <Badge variant="destructive">Already blocked</Badge>}
          {status && <Badge variant={status === "blocked" ? "destructive" : "secondary"}>{status === "blocked" ? "Blocked" : "Dismissed"}</Badge>}
        </ItemTitle>
        <p className="text-sm whitespace-pre-wrap">{r.reason}</p>
        <ItemDescription>
          Reported by {r.reporter.name} in{" "}
          <Link href={`/admin/history/${r.spaceId}`} className="underline-offset-4 hover:underline">
            {r.spaceTitle}
          </Link>{" "}
          · {fmtDateTime(r.createdAt)}
        </ItemDescription>
      </ItemContent>
      {children && <ItemActions className="shrink-0">{children}</ItemActions>}
    </Item>
  );
}

function BlockReportDialog({ token, report, onClose, onDone }: { token: string; report: Report; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState(report.reason);
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Block {report.reported.name}?</AlertDialogTitle>
          <AlertDialogDescription>This LinkedIn profile can&apos;t join any space again, whatever name they use. If they are in a live space now, they are removed.</AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} aria-label="Reason (only you see it)" />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            data-testid="confirm-block-report"
            onClick={() => {
              setBusy(true);
              api
                .blockFromReport(token, report.id, reason.trim() || undefined)
                .then(() => toast.success(`${report.reported.name} is blocked`))
                .catch((e) => toast.error(errorMessage(e)))
                .finally(() => {
                  onDone();
                  onClose();
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

/** Block someone who hasn't been in a space yet (for example a known problem from elsewhere). */
function BlockForm({ token, onBlocked }: { token: string; onBlocked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await api.blockLinkedin(token, {
        linkedinUrl: String(data.get("url")).trim(),
        name: String(data.get("name") ?? "").trim() || undefined,
        reason: String(data.get("reason") ?? "").trim() || undefined,
      });
      toast.success("Profile blocked");
      form.reset();
      onBlocked();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-(--card-spacing)">
        <CardHeader>
          <CardTitle className="text-base font-semibold">Block a profile</CardTitle>
          <CardDescription>For someone who hasn&apos;t been in a space yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor="block-url">LinkedIn profile URL</FieldLabel>
                <Input id="block-url" name="url" type="text" inputMode="url" required placeholder="https://www.linkedin.com/in/someone" aria-invalid={!!error} data-testid="block-url" />
                {error && <p className="text-sm text-destructive">{error}</p>}
              </Field>
              <Field>
                <FieldLabel htmlFor="block-name">Name (optional)</FieldLabel>
                <Input id="block-name" name="name" maxLength={120} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="block-reason">Reason (optional, only you see it)</FieldLabel>
              <Input id="block-reason" name="reason" maxLength={500} />
            </Field>
          </FieldGroup>
        </CardContent>
        <div className="px-(--card-spacing) pb-(--card-spacing)">
          <Button type="submit" variant="destructive" disabled={busy} data-testid="block-submit">
            {busy ? <Spinner data-icon="inline-start" /> : <BanIcon data-icon="inline-start" />}
            Block profile
          </Button>
        </div>
      </form>
    </Card>
  );
}
