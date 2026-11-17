"use client";

import { useSyncExternalStore } from "react";
import { formatClock } from "@/lib/space";

const subscribe = (cb: () => void) => {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
};
const snapshot = () => Math.floor(Date.now() / 1000) * 1000;

/** A running clock since `since` (ms). Renders a dash on the server so there is no hydration mismatch. */
export function Elapsed({ since, className, ...rest }: { since: number; className?: string } & React.ComponentProps<"span">) {
  const now = useSyncExternalStore(subscribe, snapshot, () => 0);
  return <span className={className} {...rest}>{now ? formatClock(now - since) : "--:--"}</span>;
}
