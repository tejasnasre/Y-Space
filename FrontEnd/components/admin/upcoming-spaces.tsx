"use client";

import { CalendarClockIcon, MoreHorizontalIcon, PencilIcon, PlayIcon, Share2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DateTimePicker } from "@/components/date-time-picker";
import { TagList } from "@/components/tag-list";
import { TagsInput } from "@/components/tags-input";
import { ShareField } from "@/components/share-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useNow } from "@/hooks/use-now";
import { type AdminSpace, api, errorMessage } from "@/lib/api";
import { fmtDateTime, untilText } from "@/lib/space";

/** Spaces booked for later. They have a link and secret already; you open them when it's time. */
export function UpcomingSpaces({ token, spaces, liveExists, onChanged }: { token: string; spaces: AdminSpace[]; liveExists: boolean; onChanged: () => void }) {
  const [share, setShare] = useState<AdminSpace | null>(null);
  const [edit, setEdit] = useState<AdminSpace | null>(null);
  const [cancel, setCancel] = useState<AdminSpace | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = useNow(30_000);

  const sorted = [...spaces].sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0));

  async function start(space: AdminSpace) {
    setBusyId(space.id);
    try {
      await api.startSpace(token, space.id);
      toast.success("Space is live");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
      onChanged();
    }
  }

  return (
    <Card data-testid="upcoming">
      <CardHeader>
        <CardTitle className="text-xl font-semibold tracking-tight">Upcoming</CardTitle>
        <CardDescription>Share the link ahead of time. People who open it see when it starts.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2" role="list">
          {sorted.map((s) => (
            <li key={s.id} data-testid={`upcoming-${s.id}`}>
              <Item variant="outline" className="flex-nowrap">
                <ItemMedia variant="icon">
                  <CalendarClockIcon />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="max-w-full">
                    <span className="truncate">{s.title}</span>
                  </ItemTitle>
                  <ItemDescription>
                    {fmtDateTime(s.scheduledFor)}{now > 0 && <> · {untilText((s.scheduledFor ?? 0) - now)}</>}
                    {s.autoStart && <span data-testid={`auto-${s.id}`}> · opens automatically</span>}
                  </ItemDescription>
                  <TagList tags={s.tags} className="mt-1" />
                </ItemContent>
                <ItemActions className="shrink-0">
                  <Button
                    size="sm"
                    onClick={() => void start(s)}
                    disabled={liveExists || busyId === s.id}
                    title={liveExists ? "End the live space first" : undefined}
                    data-testid={`start-${s.id}`}
                  >
                    {busyId === s.id ? <Spinner data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
                    Start now
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Actions for ${s.title}`} />}>
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-44">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => setShare(s)} data-testid={`share-${s.id}`}>
                          <Share2Icon />
                          Share link and secret
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEdit(s)} data-testid={`edit-${s.id}`}>
                          <PencilIcon />
                          Edit
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem variant="destructive" onClick={() => setCancel(s)} data-testid={`cancel-${s.id}`}>
                          <XIcon />
                          Cancel space
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ItemActions>
              </Item>
            </li>
          ))}
        </ul>
      </CardContent>

      <Dialog open={!!share} onOpenChange={(o) => !o && setShare(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{share?.title}</DialogTitle>
            <DialogDescription>Share both. The link shows a countdown until you start the space.</DialogDescription>
          </DialogHeader>
          {share && (
            <FieldGroup>
              <ShareField label="Join link" value={`${window.location.origin}/s/${share.id}`} testId="share-link" />
              <ShareField label="Secret" value={share.secret} testId="share-secret" mono />
            </FieldGroup>
          )}
        </DialogContent>
      </Dialog>

      {edit && <EditDialog key={edit.id} token={token} space={edit} onClose={() => setEdit(null)} onSaved={onChanged} />}

      <AlertDialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel &ldquo;{cancel?.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>The link stops working. It stays in your history as cancelled.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="confirm-cancel"
              onClick={() => {
                const target = cancel!;
                setCancel(null);
                api
                  .cancelSpace(token, target.id)
                  .then(() => toast.success("Space cancelled"))
                  .catch((e) => toast.error(errorMessage(e)))
                  .finally(onChanged);
              }}
            >
              Cancel space
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function EditDialog({ token, space, onClose, onSaved }: { token: string; space: AdminSpace; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState(space.scheduledFor ?? space.createdAt);
  const [publicList, setPublicList] = useState(space.publicList);
  const [autoStart, setAutoStart] = useState(space.autoStart);
  const [tags, setTags] = useState(space.tags);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.updateSpace(token, space.id, {
        title: String(form.get("title")).trim(),
        description: String(form.get("description") ?? "").trim() || null,
        scheduledFor: when,
        publicList,
        autoStart,
        tags,
      });
      toast.success("Saved");
      onSaved();
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
            <DialogTitle>Edit scheduled space</DialogTitle>
            <DialogDescription>The link and secret stay the same.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="edit-title">Title</FieldLabel>
              <Input id="edit-title" name="title" required maxLength={120} defaultValue={space.title} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-when">Date and time</FieldLabel>
              <DateTimePicker id="edit-when" value={when} onChange={setWhen} data-testid="edit-when" />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-tags">Topics</FieldLabel>
              <TagsInput id="edit-tags" value={tags} onChange={setTags} />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-description">What it&apos;s about</FieldLabel>
              <Textarea id="edit-description" name="description" rows={3} maxLength={1000} defaultValue={space.description ?? ""} />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="edit-auto-start">Open it automatically at this time</FieldLabel>
                <FieldDescription>Guests can join as soon as it opens, even if you aren&apos;t there yet.</FieldDescription>
              </FieldContent>
              <Switch id="edit-auto-start" checked={autoStart} onCheckedChange={setAutoStart} data-testid="edit-auto-start" />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="edit-public-list">Publish the attendee list when it ends</FieldLabel>
                <FieldDescription>Guests are told before they join.</FieldDescription>
              </FieldContent>
              <Switch id="edit-public-list" checked={publicList} onCheckedChange={setPublicList} data-testid="edit-public-list" />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={busy} data-testid="save-edit">
              {busy && <Spinner data-icon="inline-start" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
