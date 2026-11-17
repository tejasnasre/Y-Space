"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { InputGroupButton } from "@/components/ui/input-group";

/** Copy-to-clipboard button. Lives inside an `InputGroupAddon` next to the value it copies. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <InputGroupButton
      size="icon-xs"
      aria-label={done ? `Copied ${label}` : `Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Could not copy");
        }
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
    </InputGroupButton>
  );
}
