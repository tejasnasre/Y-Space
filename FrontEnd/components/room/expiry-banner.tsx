"use client";

import { TimerIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Expiring } from "@/hooks/use-space-room";
import { expiryText, formatClock } from "@/lib/space";

const subscribe = (cb: () => void) => {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
};
const snapshot = () => Math.floor(Date.now() / 1000) * 1000;

/** "This space ends in 4:32." The host gets a button to keep it going. */
export function ExpiryBanner({ expiring, canExtend, onExtend }: { expiring: Expiring; canExtend: boolean; onExtend: () => Promise<{ extendedByMinutes: number }> }) {
  const now = useSyncExternalStore(subscribe, snapshot, () => 0);
  const [busy, setBusy] = useState(false);
  const left = now ? Math.max(0, expiring.endsAt - now) : 0;

  async function keepGoing() {
    setBusy(true);
    try {
      const r = await onExtend();
      toast.success(`Added ${r.extendedByMinutes >= 60 ? `${r.extendedByMinutes / 60} h` : `${r.extendedByMinutes} min`}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't extend");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Alert data-testid="expiry-banner">
      <TimerIcon />
      <AlertTitle>
        This space ends in <span className="tabular-nums" data-testid="expiry-left">{now ? formatClock(left) : "--:--"}</span>
      </AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        {expiryText(expiring.reason, canExtend)}
        {canExtend && (
          <Button size="sm" onClick={() => void keepGoing()} disabled={busy} data-testid="keep-going">
            {busy && <Spinner data-icon="inline-start" />}
            Keep it going
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
