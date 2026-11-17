import type { Metadata } from "next";
import { ModerationView } from "@/components/admin/moderation";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Moderation · Y-Space" };

export default function ModerationPage() {
  return (
    <PageShell title="Moderation">
      <ModerationView />
    </PageShell>
  );
}
