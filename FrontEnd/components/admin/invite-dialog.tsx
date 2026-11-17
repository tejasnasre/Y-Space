"use client";

import { UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { ShareField } from "@/components/share-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";

/** Host-only: shows the join link and secret to share. Refetches on every open so a rotated secret is never stale. */
export function InviteDialog({ spaceId, token }: { spaceId: string; token: string }) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setError(null);
    api
      .spaceDetail(token, spaceId)
      .then((d) => setSecret(d.space.secret))
      .catch((e) => setError(errorMessage(e)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" data-testid="invite" />}>
        <UserPlusIcon data-icon="inline-start" />
        Invite
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>Guests need both the link and the secret to join.</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : secret === null ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <FieldGroup>
            <ShareField label="Join link" value={`${window.location.origin}/s/${spaceId}`} testId="join-url" />
            <ShareField label="Secret" value={secret} testId="space-secret" mono />
          </FieldGroup>
        )}
      </DialogContent>
    </Dialog>
  );
}
