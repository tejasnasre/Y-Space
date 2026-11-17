import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicList } from "@/components/guest/public-list";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Who was there · Y-Space" };

export default function PeoplePage({ params }: PageProps<"/s/[id]/people">) {
  return (
    <PageShell title="Who was there">
      <Suspense>
        <List params={params} />
      </Suspense>
    </PageShell>
  );
}

async function List({ params }: { params: PageProps<"/s/[id]/people">["params"] }) {
  const { id } = await params;
  return <PublicList spaceId={id} />;
}
