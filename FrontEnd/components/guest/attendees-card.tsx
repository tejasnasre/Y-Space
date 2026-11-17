"use client";

import { ExternalLinkIcon, FlagIcon, RefreshCwIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ShareField } from "@/components/share-field";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { type Attendee, type Attendees, api, errorMessage } from "@/lib/api";
import { initials } from "@/lib/space";

/** Host first, then people who spoke, then everyone else in the order they joined. */
const rank = (a: Attendee) => (a.isHost ? 0 : a.spoke ? 1 : 2);

/**
 * "Who was here": shown to people who were in a space once it has ended, so they can find each other.
 * The server only answers with the caller's own join token, so outsiders never see it.
 */
export function AttendeesCard({ spaceId, token }: { spaceId: string; token: string }) {
  const [data, setData] = useState<Attendees | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [reporting, setReporting] = useState<Attendee | null>(null);
  const [share, setShare] = useState<boolean | null>(null); // my own choice; null until the list has loaded
  const [sharing, setSharing] = useState(false);
  const [reported, setReported] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api
      .spaceAttendees(spaceId, token)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setShare(d.youShare);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [spaceId, token, attempt]);

  const people = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.attendees
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || a.joinedAt - b.joinedAt);
  }, [data, query]);

  if (error) {
    return (
      <Empty className="border" data-testid="attendees-error">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>Couldn&apos;t load who was here</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (!data) {
    return (
      <Card role="status" aria-busy="true" aria-label="Loading attendees">
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-1 h-4 w-3/4" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="attendees">
      <CardHeader>
        <CardTitle className="text-xl font-semibold tracking-tight">Who was here</CardTitle>
        <CardDescription>
          {data.attendees.length} {data.attendees.length === 1 ? "person" : "people"} joined &ldquo;{data.space.title}&rdquo;. Say hello on
          LinkedIn.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data.space.listMode === "optin" && (
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3" data-testid="optin-choice">
            <div className="flex flex-col gap-1">
              <label htmlFor="share-me" className="text-sm font-medium">
                Show me on the public list
              </label>
              <p className="text-sm text-muted-foreground">
                The host opened a public list of this space. It only includes people who choose to be on it. If you do, anyone with the link can see your name and LinkedIn profile. You can change this any time.
              </p>
            </div>
            <Switch
              id="share-me"
              checked={!!share}
              disabled={share === null || sharing}
              data-testid="share-me-switch"
              onCheckedChange={(next) => {
                const before = share;
                setShare(next);
                setSharing(true);
                api
                  .shareMe(spaceId, token, next)
                  .then(() => toast.success(next ? "You're on the public list" : "You're off the public list"))
                  .catch((e) => {
                    setShare(before);
                    toast.error(errorMessage(e));
                  })
                  .finally(() => setSharing(false));
              }}
            />
          </div>
        )}
        {data.space.listMode !== "off" && (
          <div className="flex flex-col gap-1" data-testid="public-link">
            <ShareField label="Public link to this list" value={`${window.location.origin}/s/${spaceId}/people`} testId="public-link-input" />
            <p className="text-sm text-muted-foreground">
              {data.space.listMode === "optin" ? "Only people who chose to appear are on it." : "The host published this list. Anyone with this link can see it."}
            </p>
          </div>
        )}
        {data.attendees.length > 8 && (
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name"
              aria-label="Search attendees"
              type="search"
            />
          </InputGroup>
        )}
        <ul className="flex flex-col gap-1" role="list" data-testid="attendee-list">
          {people.map((a) => (
            <li key={a.id}>
              <Item variant="outline" size="xs" className="flex-nowrap">
                <ItemMedia>
                  <Avatar>
                    <AvatarFallback>{initials(a.name)}</AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="max-w-full">
                    <span className="min-w-0 truncate">{a.name}</span>
                    {a.id === data.you && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                    {a.isHost && <Badge>host</Badge>}
                    {!a.isHost && a.spoke && <Badge variant="secondary">spoke</Badge>}
                  </ItemTitle>
                </ItemContent>
                <ItemActions className="shrink-0">
                  {a.id !== data.you && !a.isHost && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={reported.has(a.id) ? `You reported ${a.name}` : `Report ${a.name}`}
                      title={reported.has(a.id) ? "Reported" : "Report"}
                      disabled={reported.has(a.id)}
                      onClick={() => setReporting(a)}
                      data-testid={`report-${a.id}`}
                    >
                      <FlagIcon />
                    </Button>
                  )}
                  {a.linkedinUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<a href={a.linkedinUrl} target="_blank" rel="noopener noreferrer" aria-label={`${a.name} on LinkedIn`} />}
                    >
                      LinkedIn
                      <ExternalLinkIcon data-icon="inline-end" />
                    </Button>
                  )}
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
        {people.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No one matches &ldquo;{query}&rdquo;.</p>}
      </CardContent>
      {reporting && (
        <ReportDialog
          key={reporting.id}
          spaceId={spaceId}
          token={token}
          person={reporting}
          onClose={() => setReporting(null)}
          onReported={(id) => setReported((s) => new Set(s).add(id))}
        />
      )}
    </Card>
  );
}

/** Tell the admin about someone. They review it and may block that profile from future spaces. */
function ReportDialog({
  spaceId,
  token,
  person,
  onClose,
  onReported,
}: {
  spaceId: string;
  token: string;
  person: Attendee;
  onClose: () => void;
  onReported: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      await api.reportPerson(spaceId, token, { participantId: person.id, reason });
      onReported(person.id);
      toast.success("Thanks. The admin will take a look.");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Report {person.name}</DialogTitle>
            <DialogDescription>Only the admin sees this. They decide what happens next. {person.name} isn&apos;t told who reported them.</DialogDescription>
          </DialogHeader>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="report-reason">What happened?</FieldLabel>
            <Textarea id="report-reason" name="reason" required minLength={3} maxLength={500} rows={4} aria-invalid={!!error} placeholder="For example: sent me spam, harassed other people, pretended to be someone else" autoFocus data-testid="report-reason" />
            <FieldDescription className={error ? "text-destructive" : undefined}>{error ?? "A few words is enough."}</FieldDescription>
          </Field>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" variant="destructive" disabled={busy} data-testid="send-report">
              {busy && <Spinner data-icon="inline-start" />}
              Send report
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
