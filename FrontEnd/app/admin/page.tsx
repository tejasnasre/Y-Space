import type { Metadata } from "next";
import { AdminApp } from "@/components/admin/admin-app";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Admin · Y-Space" };

export default function AdminPage() {
  return (
    <PageShell title="Admin">
      <AdminApp />
    </PageShell>
  );
}
