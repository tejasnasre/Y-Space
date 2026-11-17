"use client";

import { CalendarPlusIcon, DownloadIcon, ExternalLinkIcon } from "lucide-react";
import { TagList } from "@/components/tag-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useNow } from "@/hooks/use-now";
import type { PublicSpace } from "@/lib/api";
import { calendarLinks, downloadText, fmtDateTime, untilText } from "@/lib/space";

/** The page a guest sees before a scheduled space has started: when, who, and a way to remember it. */
export function ScheduledCard({ space }: { space: PublicSpace }) {
  const now = useNow(30_000);
  const start = space.scheduledFor;
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/s/${space.id}`;
  const cal = start ? calendarLinks({ title: space.title, start, description: space.description, url }) : null;

  return (
    <div className="flex flex-1 items-center justify-center py-6">
      <Card className="w-full max-w-md" data-testid="scheduled">
        <CardHeader>
          <div>
            <Badge variant="outline">Scheduled</Badge>
          </div>
          <CardTitle className="text-2xl font-semibold tracking-tight text-balance" data-testid="scheduled-title">
            {space.title}
          </CardTitle>
          <TagList tags={space.tags} />
          <CardDescription className="flex flex-col gap-1">
            <span className="text-base font-medium text-foreground" data-testid="scheduled-when">
              {fmtDateTime(start)}
            </span>
            <span data-testid="scheduled-countdown">{now > 0 && start ? `Starts ${untilText(start - now)}` : " "}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {space.description && <p className="text-sm whitespace-pre-wrap">{space.description}</p>}
          {space.host && (
            <p className="text-sm text-muted-foreground">
              Hosted by <span className="font-medium text-foreground">{space.host.name}</span>
              {space.host.linkedinUrl && (
                <>
                  {" "}
                  <a
                    href={space.host.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary underline-offset-4 hover:underline"
                  >
                    LinkedIn
                    <ExternalLinkIcon className="size-3" />
                  </a>
                </>
              )}
            </p>
          )}
          {space.publicList && (
            <p className="text-sm" data-testid="public-list-notice">
              After it ends, the host will publish the attendee list, with names and LinkedIn profiles, for anyone to see.
            </p>
          )}
          <p className="text-sm text-muted-foreground" data-testid="scheduled-hint">
            {space.autoStart ? "It opens by itself at this time. " : "It opens when the host starts it. "}
            Keep this page open and it will let you in. You&apos;ll need the secret they shared with you.
          </p>
        </CardContent>
        {cal && (
          <CardFooter className="flex flex-wrap gap-2">
            <Button variant="outline" nativeButton={false} render={<a href={cal.google} target="_blank" rel="noopener noreferrer" />} data-testid="google-calendar">
              <CalendarPlusIcon data-icon="inline-start" />
              Google Calendar
            </Button>
            <Button variant="outline" onClick={() => downloadText("space.ics", cal.ics, "text/calendar;charset=utf-8")} data-testid="download-ics">
              <DownloadIcon data-icon="inline-start" />
              Other calendars
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
