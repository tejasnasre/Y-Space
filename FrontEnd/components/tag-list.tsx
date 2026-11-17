import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Topic tags as pills: #tech #design. Renders nothing when there are none. */
export function TagList({ tags, className }: { tags: string[] | undefined; className?: string }) {
  if (!tags || tags.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} role="list" aria-label="Topics" data-testid="tags">
      {tags.map((tag) => (
        <li key={tag}>
          <Badge variant="outline">#{tag}</Badge>
        </li>
      ))}
    </ul>
  );
}
