"use client";

import { LockIcon, Share2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { InviteDialog } from "@/components/admin/invite-dialog";
import { RoomSkeleton } from "@/components/room/room-skeleton";
import { SpaceRoom } from "@/components/room/space-room";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ADMIN_TOKEN_KEY, useStored } from "@/hooks/use-stored";
import { api } from "@/lib/api";

export function HostRoom({ spaceId }: { spaceId: string }) {
  const [token, setToken, ready] = useStored(ADMIN_TOKEN_KEY);
  const router = useRouter();
  const back = () => router.push("/admin");

  // until storage has been read we cannot know if the admin is signed in, so don't claim they are not
  if (!ready) return <RoomSkeleton />;

  if (!token) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LockIcon />
          </EmptyMedia>
          <EmptyTitle>Sign in required</EmptyTitle>
          <EmptyDescription>Your session has ended or you are signed out. Sign in as admin to host this space.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={back}>Go to sign in</Button>
        </EmptyContent>
      </Empty>
    );
  }
  return (
    <SpaceRoom
      spaceId={spaceId}
      token={token}
      // an expired admin session is final: clear it so the screen above explains what to do
      onClosed={(_why, detail) => {
        if (detail === "unauthorized") setToken(null);
      }}
      onLeave={back}
      headerAction={<InviteDialog spaceId={spaceId} token={token} />}
      endedExtra={<HostEndedActions spaceId={spaceId} token={token} />}
    />
  );
}

/** After the space ends: your summary, and the public link if you chose to publish the list. */
function HostEndedActions({ spaceId, token }: { spaceId: string; token: string }) {
  const [publicList, setPublicList] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .spaceDetail(token, spaceId)
      .then((d) => !cancelled && setPublicList(d.space.listMode !== "off"))
      .catch(() => {}); // the summary link works either way
    return () => {
      cancelled = true;
    };
  }, [spaceId, token]);

  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Link href={`/admin/history/${spaceId}`} className={buttonVariants({ variant: "outline", size: "lg" })} data-testid="view-summary">
        View who joined
      </Link>
      {publicList && (
        <Button
          size="lg"
          data-testid="copy-public-link"
          onClick={() =>
            navigator.clipboard
              .writeText(`${window.location.origin}/s/${spaceId}/people`)
              .then(() => toast.success("Public link copied"))
              .catch(() => toast.error("Could not copy"))
          }
        >
          <Share2Icon data-icon="inline-start" />
          Copy public link
        </Button>
      )}
    </div>
  );
}
