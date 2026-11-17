"use client";

import { SmileIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Reaction } from "@/hooks/use-space-room";

/** Must match the server's allowed set. */
export const REACTIONS = ["👏", "❤️", "🔥", "😂", "🎉", "👍"] as const;

const NAMES: Record<string, string> = { "👏": "Clap", "❤️": "Love", "🔥": "Fire", "😂": "Laugh", "🎉": "Celebrate", "👍": "Thumbs up" };

/** A small tray of emoji in the control bar. Stays open so you can send several. */
export function ReactionPicker({ onReact, disabled }: { onReact: (emoji: string) => Promise<unknown>; disabled: boolean }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button size="lg" variant="outline" aria-label="React" disabled={disabled} data-testid="react" />}>
        <SmileIcon data-icon="inline-start" />
        React
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-auto flex-row gap-1 p-1.5">
        {REACTIONS.map((emoji) => (
          <Button
            key={emoji}
            variant="ghost"
            size="icon-lg"
            aria-label={NAMES[emoji]}
            data-testid={`react-${NAMES[emoji]!.toLowerCase().replace(" ", "-")}`}
            onClick={() => void onReact(emoji).catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't react"))}
          >
            <span className="text-xl leading-none">{emoji}</span>
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Emoji that float up from the bottom of the screen. Decorative only; reduced motion hides them. */
export function ReactionLayer({ reactions }: { reactions: Reaction[] }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-4 bottom-24 mx-auto h-40 max-w-xl overflow-hidden motion-reduce:hidden" data-testid="reaction-layer">
      {reactions.map((r) => (
        <span
          key={r.id}
          className="animate-reaction-rise absolute bottom-0 text-3xl leading-none"
          style={{ left: `${8 + ((r.id * 37) % 80)}%` }}
        >
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
