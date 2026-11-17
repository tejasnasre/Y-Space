import { ArrowRightIcon, LinkIcon } from "lucide-react";
import Link from "next/link";
import { SpaceDirectory } from "@/components/home/space-directory";
import { StageDiagram } from "@/components/home/stage-diagram";
import { PageShell } from "@/components/page-shell";
import { buttonVariants } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <PageShell title="Home" className="gap-14 py-12 lg:py-16">
      <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <section className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h2 className="max-w-xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Live audio spaces, one link away.
            </h2>
            <p className="max-w-lg text-lg text-pretty text-muted-foreground">
              One room, up to five speakers, everyone else listening. Hosts sign in; guests join with a link and a secret.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Link href="/admin" className={cn(buttonVariants({ size: "lg" }), "w-fit")} data-testid="go-admin">
              Sign in to host
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
            <Item variant="muted" className="max-w-lg">
              <ItemMedia variant="icon">
                <LinkIcon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>Joining someone else&apos;s space?</ItemTitle>
                <ItemDescription>
                  Open the link the host sent you. It looks like <span className="font-mono">/s/&lt;id&gt;</span>.
                </ItemDescription>
              </ItemContent>
            </Item>
          </div>
        </section>

        <StageDiagram />
      </div>
      <SpaceDirectory />
    </PageShell>
  );
}
