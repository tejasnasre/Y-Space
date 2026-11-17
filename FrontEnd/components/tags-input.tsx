"use client";

import { XIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { MAX_TAG_LENGTH, MAX_TAGS, TAG_SUGGESTIONS, normalizeTag } from "@/lib/tags";

/**
 * Topic tags. Type a word and press Enter, comma or space: it becomes a pill (#tech). Backspace on an empty box
 * removes the last one. Pasting "ai, design product" adds three. Up to 5.
 */
export function TagsInput({
  id,
  value,
  onChange,
  suggestions = false,
}: {
  id?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: boolean;
}) {
  const [text, setText] = useState("");
  const full = value.length >= MAX_TAGS;

  /** Add every word in `raw` that is usable and not already there, up to the limit. */
  function add(raw: string) {
    const next = [...value];
    for (const part of raw.split(/[,\s]+/)) {
      const tag = normalizeTag(part);
      if (tag && !next.includes(tag) && next.length < MAX_TAGS) next.push(tag);
    }
    if (next.length !== value.length) onChange(next);
  }

  return (
    <div className="flex flex-col gap-2" data-testid="tags-input">
      <InputGroup className="h-auto min-h-8">
        {value.length > 0 && (
          <InputGroupAddon align="block-start" className="flex-wrap gap-1.5">
            {value.map((tag) => (
              <Badge key={tag} variant="secondary" className="h-6 gap-0.5 pr-0.5 text-sm" data-testid={`tag-${tag}`}>
                #{tag}
                <Button type="button" variant="ghost" size="icon-xs" className="size-5 rounded-full" aria-label={`Remove #${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
                  <XIcon />
                </Button>
              </Badge>
            ))}
          </InputGroupAddon>
        )}
        <InputGroupInput
          id={id}
          value={text}
          disabled={full}
          maxLength={MAX_TAG_LENGTH + 1}
          autoComplete="off"
          placeholder={full ? `${MAX_TAGS} of ${MAX_TAGS} topics added` : value.length === 0 ? "Add a topic, like tech" : "Add another"}
          data-testid="tags-field"
          onChange={(e) => {
            const v = e.target.value;
            // a pasted list, or a space/comma typed on a phone keyboard: everything before the last separator becomes pills
            if (/[,\s]/.test(v)) {
              const parts = v.split(/([,\s]+)/);
              const rest = /[,\s]$/.test(v) ? "" : (parts.pop() ?? "");
              add(parts.join(""));
              setText(rest);
            } else setText(v);
          }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && text.trim()) {
              e.preventDefault(); // Enter makes a pill; it does not submit the form
              add(text);
              setText("");
            } else if (e.key === "Backspace" && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (text.trim()) add(text);
            setText("");
          }}
        />
      </InputGroup>
      <p className="text-xs text-muted-foreground tabular-nums" data-testid="tags-count">
        {value.length} of {MAX_TAGS} topics. Press Enter, comma or space to turn a word into a tag.
      </p>
      {suggestions && !full && (
        <div className="flex flex-wrap gap-1.5" aria-label="Suggested topics">
          {TAG_SUGGESTIONS.filter((t) => !value.includes(t)).map((tag) => (
            <Button key={tag} type="button" variant="outline" size="xs" onClick={() => add(tag)} data-testid={`suggest-${tag}`}>
              #{tag}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
