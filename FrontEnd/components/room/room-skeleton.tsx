import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function TileSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
      <Skeleton className={compact ? "size-8 rounded-full" : "size-10 rounded-full"} />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  );
}

/** Placeholder with the same shape as the room, so nothing jumps when the real content arrives. */
export function RoomSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading space" className="flex w-full flex-col gap-6 pb-28">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-16 rounded-4xl" />
          <Skeleton className="h-5 w-24 rounded-4xl" />
        </div>
        <Skeleton className="h-9 w-3/5 max-w-md" />
        <Skeleton className="h-4 w-56" />
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <Skeleton className="h-6 w-24" />
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <TileSkeleton key={i} />
              ))}
            </div>
          </section>
          <section className="flex flex-col gap-3">
            <Skeleton className="h-6 w-28" />
            <div className="grid gap-2 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <TileSkeleton key={i} compact />
              ))}
            </div>
          </section>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-8 w-full rounded-lg" />
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="fixed inset-x-4 bottom-4 mx-auto flex max-w-xl items-center gap-2 rounded-xl bg-card p-2 ring-1 ring-foreground/10">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-28" />
      </div>
    </div>
  );
}
