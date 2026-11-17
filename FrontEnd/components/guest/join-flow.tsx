"use client";

import { CircleSlashIcon, GlobeIcon, HeadphonesIcon, MicIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AttendeesCard } from "@/components/guest/attendees-card";
import { JoinSkeleton } from "@/components/guest/join-skeleton";
import { TagList } from "@/components/tag-list";
import { ScheduledCard } from "@/components/guest/scheduled-card";
import { LiveDot } from "@/components/live-dot";
import { SpaceRoom } from "@/components/room/space-room";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { guestKey, useStored } from "@/hooks/use-stored";
import { ApiError, type PublicSpace, api, errorMessage } from "@/lib/api";

export function JoinFlow({ spaceId }: { spaceId: string }) {
  const [token, setToken, ready] = useStored(guestKey(spaceId));
  const router = useRouter();
  const [space, setSpace] = useState<PublicSpace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [closedWhy, setClosedWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .publicSpace(spaceId)
      .then((s) => !cancelled && setSpace(s))
      .catch((e) => !cancelled && setLoadError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [spaceId, attempt]);

  // a scheduled space opens when the host starts it: keep checking, so the join form appears by itself
  const status = space?.status;
  useEffect(() => {
    if (status !== "scheduled") return;
    const id = setInterval(() => {
      api.publicSpace(spaceId).then(setSpace).catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  }, [status, spaceId]);

  // until storage has been read we cannot tell a returning guest from a new one
  if (!ready) return <JoinSkeleton />;

  if (token) {
    return (
      <SpaceRoom
        spaceId={spaceId}
        token={token}
        // Keep the token when the space ends or we are removed, so the "ended" / "removed" screen stays up
        // (and a refresh explains itself). Leaving clears it. A token the server rejects is useless: drop it
        // and show the join form again.
        onClosed={(why, detail) => {
          setClosedWhy(why);
          if (detail === "unauthorized") setToken(null);
        }}
        // Leaving a live space clears the token. After it has ended we keep it: it is what lets this person
        // come back to the link later and still see who was there.
        onLeave={() => {
          if (closedWhy !== "ended") setToken(null);
          router.push("/");
        }}
        endedExtra={<AttendeesCard spaceId={spaceId} token={token} />}
      />
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center py-6">
        <Empty className="max-w-md flex-none border" data-testid="load-error">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlertIcon />
            </EmptyMedia>
            <EmptyTitle>Couldn&apos;t open this space</EmptyTitle>
            <EmptyDescription>{loadError}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              onClick={() => {
                setLoadError(null);
                setAttempt((n) => n + 1);
              }}
            >
              <RefreshCwIcon data-icon="inline-start" />
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }
  if (!space) return <JoinSkeleton />;

  if (space.status === "scheduled") return <ScheduledCard space={space} />;

  if (space.status !== "live") {
    return (
      <div className="flex flex-1 items-center justify-center py-6">
        <Empty className="max-w-md flex-none border" data-testid="space-ended">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleSlashIcon />
            </EmptyMedia>
            <EmptyTitle>{space.title}</EmptyTitle>
            <EmptyDescription>This space has ended.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {space.listMode !== "off" && (
              <Link href={`/s/${space.id}/people`} className={buttonVariants()} data-testid="see-public-list">
                See who was there
              </Link>
            )}
            <Link href="/" className={buttonVariants({ variant: "outline" })}>
              Back to home
            </Link>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api.join(spaceId, {
        name: String(form.get("name")).trim(),
        linkedinUrl: String(form.get("linkedin")).trim(),
        secret: String(form.get("secret")),
      });
      setToken(res.token);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === "space_ended") setSpace({ ...space!, status: "ended" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center py-6">
      <Card className="w-full max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-(--card-spacing)">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge variant="outline">
                <LiveDot />
                Live
              </Badge>
              <span className="flex items-center gap-3 text-sm text-muted-foreground tabular-nums">
                <span className="flex items-center gap-1">
                  <MicIcon className="size-3.5" />
                  {space.speakerCount} speaking
                </span>
                <span className="flex items-center gap-1">
                  <HeadphonesIcon className="size-3.5" />
                  {space.listenerCount} listening
                </span>
              </span>
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight text-balance" data-testid="join-title">
              {space.title}
            </CardTitle>
            <TagList tags={space.tags} />
            <CardDescription>
              You&apos;ll join as a listener. Ask to speak once you&apos;re in.
              {space.host && (
                <span className="mt-1 block" data-testid="join-host">
                  Hosted by <span className="font-medium text-foreground">{space.host.name}</span>
                  {space.host.linkedinUrl && (
                    <>
                      {" · "}
                      <a href={space.host.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
                        LinkedIn
                      </a>
                    </>
                  )}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {space.publicList && (
                <Alert data-testid="public-list-notice">
                  <GlobeIcon />
                  <AlertTitle>The attendee list will be public</AlertTitle>
                  <AlertDescription>After this space ends, the host will publish who was here, with names and LinkedIn profiles, for anyone to see.</AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive" data-testid="join-error">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Field>
                <FieldLabel htmlFor="name">Your name</FieldLabel>
                <Input id="name" name="name" required maxLength={200} autoComplete="name" />
              </Field>
              <Field>
                <FieldLabel htmlFor="linkedin">LinkedIn profile URL</FieldLabel>
                <Input
                  id="linkedin"
                  name="linkedin"
                  type="url"
                  required
                  placeholder="https://www.linkedin.com/in/you"
                  autoComplete="url"
                />
                <FieldDescription>
                  {space.publicList
                    ? "Shown to the host, the others in the space, and on the public attendee list after it ends."
                    : "Shown to the host and the others in the space, and in the attendee list shared when it ends."}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="secret">Space secret</FieldLabel>
                <Input id="secret" name="secret" required autoComplete="off" />
                <FieldDescription>The host shared this with the link.</FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button type="submit" size="lg" className="w-full" disabled={busy} data-testid="join-submit">
              {busy && <Spinner data-icon="inline-start" />}
              Join as listener
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
