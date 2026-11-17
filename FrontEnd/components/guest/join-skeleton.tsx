import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Same shape as the join form card. */
export function JoinSkeleton() {
  return (
    <div className="flex flex-1 items-center justify-center py-6">
      <Card className="w-full max-w-md" role="status" aria-busy="true" aria-label="Loading space">
        <CardHeader>
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-1 h-8 w-3/4" />
          <Skeleton className="mt-1 h-4 w-2/3" />
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-full rounded-lg" />
            </div>
          ))}
        </CardContent>
        <CardFooter>
          <Skeleton className="h-9 w-full rounded-lg" />
        </CardFooter>
      </Card>
    </div>
  );
}
