"use client";

import { useCallback } from "react";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { DashboardSkeleton } from "@/components/admin/dashboard-skeleton";
import { LoginCard } from "@/components/admin/login-card";
import { ADMIN_TOKEN_KEY, useStored } from "@/hooks/use-stored";

export function AdminApp() {
  const [token, setToken, ready] = useStored(ADMIN_TOKEN_KEY);
  const signOut = useCallback(() => setToken(null), [setToken]);
  // reading the stored session takes one render; showing the sign-in form meanwhile makes it flash on refresh
  if (!ready) return <DashboardSkeleton />;
  return token ? <AdminDashboard token={token} onSignOut={signOut} /> : <LoginCard onToken={setToken} />;
}
