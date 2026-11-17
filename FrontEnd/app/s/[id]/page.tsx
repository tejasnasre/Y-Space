import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinFlow } from "@/components/guest/join-flow";
import { JoinSkeleton } from "@/components/guest/join-skeleton";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Join space · Y-Space" };

export default function GuestPage({ params }: PageProps<"/s/[id]">) {
  return (
    <PageShell title="Join space">
      <Suspense fallback={<JoinSkeleton />}>
        <Guest params={params} />
      </Suspense>
    </PageShell>
  );
}

async function Guest({ params }: { params: PageProps<"/s/[id]">["params"] }) {
  const { id } = await params;
  return <JoinFlow spaceId={id} />;
}
