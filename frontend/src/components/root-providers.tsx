"use client";

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui";

export function RootProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppShell>{children}</AppShell>
      </AuthProvider>
    </ToastProvider>
  );
}
