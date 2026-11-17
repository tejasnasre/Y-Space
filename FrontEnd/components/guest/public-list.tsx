"use client";

import { ExternalLinkIcon, GlobeIcon, LockIcon, RefreshCwIcon, SearchIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ShareField } from "@/components/share-field";
import { TagList } from "@/components/tag-list";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, type PublicAttendee, type PublicAttendees, api, errorMessage } from "@/lib/api";
import { fmtDateTime, initials } from "@/lib/space";

const ORDER = { host: 0, cohost: 1, speaker: 2, listener: 3 } as const;
const LABEL = { host: "host", cohost: "co-host", speaker: "spoke", listener: "" } as const;

/** The attendee list the host chose to publish. Anyone with the link can see it. */
export function PublicList({ spaceId }: { spaceId: string }) {
  const [data, setData] = useState<PublicAttendees | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .publicAttendees(spaceId)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError({ code: e instanceof ApiError ? e.code : "error", message: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [spaceId, attempt]);

  const people = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.attendees.filter((a) => !q || a.name.toLowerCase().includes(q)).sort((a, b) => ORDER[a.role] - ORDER[b.role]);
  }, [data, query]);

  if (error) {
    const notPublic = error.code === "not_public";
    const notEnded = error.code === "space_not_ended";
    const missing = error.code === "space_not_found";
    return (
      <div className="flex flex-1 items-center justify-center py-6">
        <Empty className="max-w-md flex-none border" data-testid="public-list-error">
          <EmptyHeader>
            <EmptyMedia variant="icon">{notPublic ? <LockIcon /> : <TriangleAlertIcon />}</EmptyMedia>
            <EmptyTitle>{notPublic ? "This list isn't public" : notEnded ? "Not published yet" : missing ? "Space not found" : "Couldn't load this list"}</EmptyTitle>
            <EmptyDescription>
              {notPublic ? "The host didn't publish who was there." : notEnded ? "The list appears here once the space has ended." : missing ? "Check the link and try again." : error.message}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {notPublic || missing ? (
              <Link href="/" className={buttonVariants({ variant: "outline" })}>
                Back to home
              </Link>
            ) : (
              <Button
                onClick={() => {
                  setError(null);
                  setAttempt((n) => n + 1);
                }}
              >
                <RefreshCwIcon data-icon="inline-start" />
                {notEnded ? "Check again" : "Try again"}
              </Button>
            )}
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-xl" role="status" aria-busy="true" aria-label="Loading list">
        <Card>
          <CardHeader>
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="mt-1 h-4 w-1/2" />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4" data-testid="public-list">
      <Card>
        <CardHeader>
          <div>
            <Badge variant="outline">
              <GlobeIcon data-icon="inline-start" />
              Public list
            </Badge>
          </div>
          <CardTitle className="text-2xl font-semibold tracking-tight text-balance" data-testid="public-list-title">
            Who was at {data.space.title}
          </CardTitle>
          <TagList tags={data.space.tags} />
          <CardDescription>
            {data.mode === "optin"
              ? `${data.attendees.length} ${data.attendees.length === 1 ? "person" : "people"} chose to be listed`
              : `${data.attendees.length} ${data.attendees.length === 1 ? "person" : "people"}`}{" "}
            · ended {fmtDateTime(data.space.endedAt)}. Say hello on LinkedIn.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {data.attendees.length > 8 && (
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" aria-label="Search attendees" />
            </InputGroup>
          )}
          <ul className="flex flex-col gap-1" role="list" data-testid="public-people">
            {people.map((a) => (
              <PersonRow key={a.id} a={a} />
            ))}
          </ul>
          {people.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No one matches &ldquo;{query}&rdquo;.</p>}
        </CardContent>
      </Card>
      <ShareField label="Link to this list" value={typeof window === "undefined" ? "" : window.location.href} testId="public-list-link" />
      <p className="text-sm text-muted-foreground">
        {data.mode === "optin"
          ? "This list only includes the host and the guests who chose to appear. It shows names and LinkedIn profiles only."
          : "The host published this list. It shows names and LinkedIn profiles only."}
      </p>
    </div>
  );
}

function PersonRow({ a }: { a: PublicAttendee }) {
  return (
    <li>
      <Item variant="outline" size="xs" className="flex-nowrap">
        <ItemMedia>
          <Avatar>
            <AvatarFallback>{initials(a.name)}</AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="max-w-full">
            <span className="min-w-0 truncate">{a.name}</span>
            {LABEL[a.role] && <Badge variant={a.role === "host" ? "default" : "secondary"}>{LABEL[a.role]}</Badge>}
          </ItemTitle>
        </ItemContent>
        {a.linkedinUrl && (
          <ItemActions className="shrink-0">
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={a.linkedinUrl} target="_blank" rel="noopener noreferrer" aria-label={`${a.name} on LinkedIn`} />}>
              LinkedIn
              <ExternalLinkIcon data-icon="inline-end" />
            </Button>
          </ItemActions>
        )}
      </Item>
    </li>
  );
}
