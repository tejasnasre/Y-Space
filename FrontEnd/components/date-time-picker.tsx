"use client";

import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");

/** Date from a Calendar pick + "HH:mm" from the time field, in the user's local time zone. */
function combine(date: Date, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(date);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

/**
 * Date and time, the shadcn way: a Calendar in a Popover for the day, a time field beside it.
 * `value` is epoch ms. Days before today can't be picked.
 */
export function DateTimePicker({
  id,
  value,
  onChange,
  className,
  "data-testid": testId,
}: {
  id?: string;
  value: number;
  onChange: (ms: number) => void;
  className?: string;
  "data-testid"?: string;
}) {
  const [open, setOpen] = useState(false);
  const now = useNow(60_000);
  const date = new Date(value);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const today = now ? new Date(now) : undefined;
  today?.setHours(0, 0, 0, 0);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-testid={testId}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button id={id} variant="outline" className="w-48 justify-start font-normal" data-testid={testId ? `${testId}-date` : undefined} />}
        >
          <CalendarIcon data-icon="inline-start" />
          {date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date}
            disabled={today ? { before: today } : undefined}
            onSelect={(picked) => {
              if (!picked) return;
              onChange(combine(picked, time).getTime());
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        value={time}
        required
        aria-label="Time"
        onChange={(e) => e.target.value && onChange(combine(date, e.target.value).getTime())}
        className="w-28 appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
        data-testid={testId ? `${testId}-time` : undefined}
      />
    </div>
  );
}
