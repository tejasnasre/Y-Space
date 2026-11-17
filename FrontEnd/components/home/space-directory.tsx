"use client";

import { HeadphonesIcon, MicIcon, RadioIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Elapsed } from "@/components/elapsed";
import { LiveDot } from "@/components/live-dot";
import { TagList } from "@/components/tag-list";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { type DirectoryLive, type DirectoryPast, api, errorMessage } from "@/lib/api";
import { formatSpan } from "@/lib/space";

const PAGE = 12;
const REFRESH_MS = 15_000;

const day = (ms: number) => new Date(ms).toLocaleDateString([], { dateStyle: "medium" });

/** The public home page's list: what is live right now, and what has run before. */
export function SpaceDirectory() {
  const [live, setLive] = useState<DirectoryLive | null>(null);
  const [past, setPast] = useState<DirectoryPast[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.directory(PAGE);
      setLive(d.live);
      // keep pages the visitor already opened; only add what is new at the top
      setPast((cur) => {
        if (cur.length === 0) return d.past;
        const have = new Set(cur.map((s) => s.id));
        return [...d.past.filter((s) => !have.has(s.id)), ...cur];
      });
      setHasMore((h) => (loaded ? h : d.hasMore));
      setLoaded(true);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [loaded]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
    const id = setInterval(() => void load(), REFRESH_MS); // a space can start or end while someone is looking
    return () => clearInterval(id);
  }, [load]);

  async function more() {
    setLoadingMore(true);
    try {
      const d = await api.directory(PAGE, past.at(-1)?.endedAt);
      setPast((cur) => [...cur, ...d.past.filter((s) => !cur.some((c) => c.id === s.id))]);
      setHasMore(d.hasMore);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  if (!loaded && !error) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label="Loading spaces">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-7 w-40" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!loaded && error) {
    return (
      <Empty className="border" data-testid="directory-error">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlertIcon />
          </EmptyMedia>
          <EmptyTitle>Couldn&apos;t load spaces</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => void load()}>
            <RefreshCwIcon data-icon="inline-start" />
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-10" data-testid="directory">
      <section className="flex flex-col gap-4" aria-labelledby="live-now">
        <h2 id="live-now" className="text-2xl font-semibold tracking-tight">
          Live now
        </h2>
        {live ? (
          <Card data-testid="directory-live">
            <CardHeader>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LiveDot />
                <span>
                  Live for <Elapsed since={live.startedAt} className="tabular-nums" />
                </span>
              </div>
              <CardTitle className="text-xl font-semibold tracking-tight text-balance">{live.title}</CardTitle>
              <TagList tags={live.tags} />
              <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
                {live.host && <span>Hosted by {live.host}</span>}
                <span className="flex items-center gap-1">
                  <MicIcon className="size-3.5" />
                  {live.speakerCount} speaking
                </span>
                <span className="flex items-center gap-1">
                  <HeadphonesIcon className="size-3.5" />
                  {live.listenerCount} listening
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">You&apos;ll need the secret the host shared to get in.</CardContent>
            <CardFooter>
              <Link href={`/s/${live.id}`} className={buttonVariants({ size: "lg" })} data-testid="directory-join">
                Join this space
              </Link>
            </CardFooter>
          </Card>
        ) : (
          <Empty className="border" data-testid="directory-none-live">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RadioIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing is live right now</EmptyTitle>
              <EmptyDescription>Spaces that have run before are below.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="past-spaces">
        <h2 id="past-spaces" className="text-2xl font-semibold tracking-tight">
          Past spaces
        </h2>
        {past.length === 0 ? (
          <Empty className="border" data-testid="directory-no-past">
            <EmptyHeader>
              <EmptyTitle>No past spaces yet</EmptyTitle>
              <EmptyDescription>Spaces show up here once they have ended.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2" role="list" data-testid="directory-past">
            {past.map((s) => (
              <li key={s.id} data-testid={`past-${s.id}`}>
                <Item variant="outline" className="flex-nowrap">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full">
                      <span className="truncate">{s.title}</span>
                    </ItemTitle>
                    <TagList tags={s.tags} />
                    <ItemDescription className="tabular-nums">
                      {s.host && <>Hosted by {s.host} · </>}
                      {day(s.endedAt)} · {formatSpan(s.endedAt - s.startedAt)} · {s.people} {s.people === 1 ? "person" : "people"}
                    </ItemDescription>
                  </ItemContent>
                  {s.listMode !== "off" && (
                    <ItemActions className="shrink-0">
                      <Link href={`/s/${s.id}/people`} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid={`past-people-${s.id}`}>
                        Who was there
                      </Link>
                    </ItemActions>
                  )}
                </Item>
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <div>
            <Button variant="outline" onClick={() => void more()} disabled={loadingMore} data-testid="directory-more">
              {loadingMore && <Spinner data-icon="inline-start" />}
              Show more
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
