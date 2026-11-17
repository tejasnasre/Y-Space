import type { Metadata } from "next";
import { Suspense } from "react";
import { HostRoom } from "@/components/admin/host-room";
import { PageShell } from "@/components/page-shell";
import { RoomSkeleton } from "@/components/room/room-skeleton";

export const metadata: Metadata = { title: "Hosting · Y-Space" };

export default function HostPage({ params }: PageProps<"/admin/space/[id]">) {
  return (
    <PageShell title="Host room">
      <Suspense fallback={<RoomSkeleton />}>
        <Room params={params} />
      </Suspense>
    </PageShell>
  );
}

async function Room({ params }: { params: PageProps<"/admin/space/[id]">["params"] }) {
  const { id } = await params;
  return <HostRoom spaceId={id} />;
}
