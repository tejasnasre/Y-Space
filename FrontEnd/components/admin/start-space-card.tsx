"use client";

import { DicesIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DateTimePicker } from "@/components/date-time-picker";
import { TagsInput } from "@/components/tags-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type AdminSpace, api, errorMessage } from "@/lib/api";

/** Uniformly random 6-digit code (000000 to 999999) from the browser's CSPRNG. */
function randomSecret() {
  const limit = 4_294_967_296 - (4_294_967_296 % 1_000_000); // reject the biased tail so every code is equally likely
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0]! >= limit);
  return String(buf[0]! % 1_000_000).padStart(6, "0");
}

function SecretField() {
  const [value, setValue] = useState("");
  return (
    <Field>
      <FieldLabel htmlFor="secret">Secret (optional)</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id="secret"
          name="secret"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          minLength={6}
          maxLength={64}
          placeholder="Random if empty"
          autoComplete="off"
          className="font-mono"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton onClick={() => setValue(randomSecret())} data-testid="generate-secret">
            <DicesIcon data-icon="inline-start" />
            Generate
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <FieldDescription>Guests need it to join. Generate a 6-digit code, or type your own (6 to 64 characters).</FieldDescription>
    </Field>
  );
}

/** Start a space now, or book one for later (it stays closed until you open it). */
export function StartSpaceCard({ token, onCreated }: { token: string; onCreated: (space: AdminSpace) => void }) {
  const [mode, setMode] = useState<"now" | "later">("now");
  const [busy, setBusy] = useState(false);
  const [publicList, setPublicList] = useState(false);
  const [autoStart, setAutoStart] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [listed, setListed] = useState(true);
  // a sensible default for "later": tomorrow, on the hour
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 24 * 3_600_000);
    d.setMinutes(0, 0, 0);
    return d.getTime();
  });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const secret = String(form.get("secret") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    setBusy(true);
    try {
      const space = await api.createSpace(token, {
        title: String(form.get("title")).trim(),
        ...(secret ? { secret } : {}),
        ...(publicList ? { publicList: true } : {}),
        ...(tags.length ? { tags } : {}),
        ...(listed ? {} : { unlisted: true }),
        ...(mode === "later" ? { scheduledFor: when, autoStart, ...(description ? { description } : {}) } : {}),
      });
      toast.success(mode === "later" ? "Space scheduled" : "Space created");
      onCreated(space);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-(--card-spacing)">
        <CardHeader>
          <CardTitle className="text-xl font-semibold tracking-tight">Start a space</CardTitle>
          <CardDescription>
            {mode === "now" ? "Only one space can be live at a time." : "Share the link now. You open the space when it's time."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <ToggleGroup
              value={[mode]}
              onValueChange={(v) => v[0] && setMode(v[0] as "now" | "later")}
              variant="outline"
              aria-label="When to start"
              className="w-fit"
            >
              <ToggleGroupItem value="now" data-testid="mode-now">
                Start now
              </ToggleGroupItem>
              <ToggleGroupItem value="later" data-testid="mode-later">
                Schedule for later
              </ToggleGroupItem>
            </ToggleGroup>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="title">Title</FieldLabel>
                <Input id="title" name="title" required maxLength={120} placeholder="Friday founders AMA" />
              </Field>
              <SecretField />
            </div>

            <Field>
              <FieldLabel htmlFor="tags">Topics (optional)</FieldLabel>
              <TagsInput id="tags" value={tags} onChange={setTags} suggestions />
            </Field>

            {mode === "later" && (
              <>
                <Field>
                  <FieldLabel htmlFor="when">Date and time</FieldLabel>
                  <DateTimePicker id="when" value={when} onChange={setWhen} data-testid="schedule-when" />
                  <FieldDescription>In your local time. People who open the link before then see a countdown.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="description">What it&apos;s about (optional)</FieldLabel>
                  <Textarea id="description" name="description" maxLength={1000} rows={3} placeholder="Topics, who is speaking, what to bring" />
                </Field>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="auto-start">Open it automatically at this time</FieldLabel>
                    <FieldDescription>
                      Guests can join as soon as it opens, even if you aren&apos;t in the room yet. If nobody is hosting for a while, it ends on its own. Turn this off to open it yourself.
                    </FieldDescription>
                  </FieldContent>
                  <Switch id="auto-start" checked={autoStart} onCheckedChange={setAutoStart} data-testid="auto-start-switch" />
                </Field>
              </>
            )}

            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="listed">Show on the home page</FieldLabel>
                <FieldDescription>
                  Anyone can see the title, topics, host and how big it was, while it is live and afterwards. Never the secret or who joined. You can change this any time.
                </FieldDescription>
              </FieldContent>
              <Switch id="listed" checked={listed} onCheckedChange={setListed} data-testid="listed-switch" />
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="public-list">Publish the attendee list when it ends</FieldLabel>
                <FieldDescription>
                  Anyone with the link will see names and LinkedIn profiles of the people who stayed. Guests are told this before they join, so decide now: it can&apos;t be switched on once the space has started.
                </FieldDescription>
              </FieldContent>
              <Switch id="public-list" checked={publicList} onCheckedChange={setPublicList} data-testid="public-list-switch" />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button type="submit" size="lg" disabled={busy} data-testid="create-space">
            {busy && <Spinner data-icon="inline-start" />}
            {mode === "later" ? "Schedule space" : "Create space"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
