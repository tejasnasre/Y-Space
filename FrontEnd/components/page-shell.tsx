import { AudioLinesIcon } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

/** Consistent page container + header used by every route. */
export function PageShell({
  title,
  action,
  className,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <AudioLinesIcon className="size-4" />
            </span>
            <span className="text-base font-semibold tracking-tight">Y-Space</span>
          </Link>
          <div className="flex items-center gap-2">
            {action}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={cn("mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6", className)}>
        {title && <h1 className="sr-only">{title}</h1>}
        {children}
      </main>
    </>
  );
}
