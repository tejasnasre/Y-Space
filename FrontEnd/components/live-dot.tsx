import { cn } from "@/lib/utils";

/** Pulsing "on air" dot. The pulse is the only ambient motion in the app and respects reduced motion. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-2 shrink-0", className)} aria-hidden>
      <span className="absolute inset-0 rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
      <span className="relative size-2 rounded-full bg-primary" />
    </span>
  );
}
