import type { Metadata } from "next";
import { Suspense } from "react";
import { DetailSkeleton, SpaceDetailView } from "@/components/admin/space-detail";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Space details · Y-Space" };

export default function SpaceDetailPage({ params }: PageProps<"/admin/history/[id]">) {
  return (
    <PageShell title="Space details">
      <Suspense fallback={<DetailSkeleton />}>
        <Detail params={params} />
      </Suspense>
    </PageShell>
  );
}

async function Detail({ params }: { params: PageProps<"/admin/history/[id]">["params"] }) {
  const { id } = await params;
  return <SpaceDetailView spaceId={id} />;
}
