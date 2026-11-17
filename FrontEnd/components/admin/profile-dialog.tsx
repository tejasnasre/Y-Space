"use client";

import { UserRoundIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { type AdminProfile, api, errorMessage } from "@/lib/api";

/** How the host appears to attendees: a name and a LinkedIn profile. */
export function ProfileDialog({ token, profile, onSaved }: { token: string; profile: AdminProfile | null; onSaved: (p: AdminProfile) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const next = await api.updateProfile(token, {
        displayName: String(form.get("displayName") ?? "").trim() || null,
        linkedinUrl: String(form.get("linkedinUrl") ?? "").trim() || null,
      });
      onSaved(next);
      toast.success("Profile saved");
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setError(null);
      }}
    >
      <DialogTrigger render={<Button variant="outline" disabled={!profile} data-testid="open-profile" />}>
        <UserRoundIcon data-icon="inline-start" />
        Profile
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Your host profile</DialogTitle>
            <DialogDescription>This is how people see you in a space and in the list sent after it ends, so they can connect with you.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="displayName">Name</FieldLabel>
              <Input id="displayName" name="displayName" maxLength={60} defaultValue={profile?.displayName ?? ""} placeholder={profile?.username} autoComplete="name" />
              <FieldDescription>Shown instead of your login name. Leave empty to use &ldquo;{profile?.username}&rdquo;.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="linkedinUrl">LinkedIn profile</FieldLabel>
              <Input id="linkedinUrl" name="linkedinUrl" type="text" inputMode="url" defaultValue={profile?.linkedinUrl ?? ""} placeholder="https://www.linkedin.com/in/you" autoComplete="url" />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={busy} data-testid="save-profile">
              {busy && <Spinner data-icon="inline-start" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
