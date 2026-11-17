"use client";

import { MessageSquareIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatMessage } from "@/hooks/use-space-room";
import { fmtTime } from "@/lib/space";

const MAX = 280;

/** Text chat for the whole room. Moderators can delete messages. */
export function ChatPanel({
  messages,
  meId,
  moderator,
  disabled,
  onSend,
  onDelete,
}: {
  messages: ChatMessage[];
  meId: string | undefined;
  moderator: boolean;
  disabled: boolean;
  onSend: (text: string) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLLIElement | null>(null);

  // keep the newest message in view
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy || disabled) return;
    setBusy(true);
    try {
      await onSend(body);
      setText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="chat">
      {messages.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareIcon />
            </EmptyMedia>
            <EmptyTitle>No messages yet</EmptyTitle>
            <EmptyDescription>Say hello, or ask the speakers a question.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="h-64">
          <ol className="flex flex-col gap-3 pr-3" data-testid="chat-messages">
            {messages.map((m) => (
              <li key={m.id} className="group/message flex flex-col gap-0.5" data-testid={`chat-${m.id}`}>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="truncate text-sm font-medium text-foreground">{m.name}</span>
                  {m.participantId === meId && <span>(you)</span>}
                  {(m.role === "host" || m.role === "cohost") && <Badge variant={m.role === "host" ? "default" : "secondary"}>{m.role === "cohost" ? "co-host" : "host"}</Badge>}
                  <time className="ml-auto shrink-0 tabular-nums" dateTime={new Date(m.at).toISOString()}>
                    {fmtTime(m.at)}
                  </time>
                  {moderator && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete message from ${m.name}`}
                      onClick={() => void onDelete(m.id).catch((err) => toast.error(err instanceof Error ? err.message : "Couldn't delete"))}
                    >
                      <Trash2Icon />
                    </Button>
                  )}
                </div>
                <p className="text-sm break-words whitespace-pre-wrap">{m.text}</p>
              </li>
            ))}
            <li ref={end} aria-hidden />
          </ol>
        </ScrollArea>
      )}

      <form onSubmit={submit}>
        <InputGroup>
          <InputGroupInput
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX}
            placeholder={disabled ? "Reconnecting…" : "Message everyone"}
            aria-label="Message"
            autoComplete="off"
            disabled={disabled}
            data-testid="chat-input"
          />
          <InputGroupAddon align="inline-end">
            {text.length > MAX - 40 && <span className="text-xs text-muted-foreground tabular-nums">{MAX - text.length}</span>}
            <InputGroupButton type="submit" size="icon-xs" aria-label="Send message" disabled={!text.trim() || busy || disabled} data-testid="chat-send">
              <SendIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
