import { AudioLinesIcon } from "lucide-react";
import Link from "next/link";
import { GithubIcon } from "@/components/github-icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REPO_URL = "https://github.com/tejasnasre/Y-Space";
const AUTHOR_URL = "https://github.com/tejasnasre";

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
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Y-Space on GitHub"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <GithubIcon />
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={cn("mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6", className)}>
        {title && <h1 className="sr-only">{title}</h1>}
        {children}
      </main>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <p>
            Built by{" "}
            <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground hover:underline">
              tejasnasre
            </a>
          </p>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 hover:text-foreground">
            <GithubIcon className="size-3.5" />
            Open source on GitHub
          </a>
        </div>
      </footer>
    </>
  );
}
