"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ClipboardCheck,
  Database,
  FileBarChart,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  Scale,
  Users,
} from "lucide-react";
import { config } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";
import { Banner, StatusDot, cn } from "@/components/ui";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const NAV: Record<Role, NavItem[]> = {
  student: [
    { href: "/student", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
    { href: "/student/check-in", label: "Exam Check-in", icon: <ClipboardCheck className="h-4 w-4" /> },
  ],
  proctor: [
    { href: "/proctor", label: "Monitoring", icon: <LayoutDashboard className="h-4 w-4" /> },
  ],
  admin: [
    { href: "/admin/exams", label: "Examinations", icon: <CalendarDays className="h-4 w-4" /> },
    { href: "/admin/users", label: "Users & Institutions", icon: <Users className="h-4 w-4" /> },
    { href: "/admin/reports", label: "Reports", icon: <FileBarChart className="h-4 w-4" /> },
    { href: "/admin/db", label: "Database Viewer", icon: <Database className="h-4 w-4" /> },
  ],
  appeals: [
    { href: "/appeals", label: "Appeals Cases", icon: <Scale className="h-4 w-4" /> },
  ],
};

const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  proctor: "Proctor",
  admin: "Administrator",
  appeals: "Appeals Reviewer",
};

type ProbeStatus = "checking" | "connected" | "unavailable";

/** Real probe of the ML inference service: opens (and immediately closes)
 *  a WebSocket to webcam_demo.py to see whether it is up. */
function useMlProbe() {
  const [status, setStatus] = useState<ProbeStatus>("checking");

  const check = useCallback(() => {
    setStatus("checking");
    let done = false;
    const finish = (s: ProbeStatus) => {
      if (!done) {
        done = true;
        setStatus(s);
      }
    };
    let ws: WebSocket;
    try {
      ws = new WebSocket(config.mlWsUrl);
    } catch {
      finish("unavailable");
      return;
    }
    const timer = setTimeout(() => {
      finish("unavailable");
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }, 2500);
    ws.onopen = () => {
      clearTimeout(timer);
      finish("connected");
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      finish("unavailable");
    };
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { status, check };
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, demoMode, logout } = useAuth();
  const pathname = usePathname();
  const probe = useMlProbe();
  const navRef = useRef<HTMLElement>(null);

  const isAuthPage = pathname === "/login" || pathname === "/register";
  if (isAuthPage || !user) {
    return <>{children}</>;
  }

  const nav = NAV[user.role];

  const probeUi = {
    checking: <StatusDot color="blue" label="Checking ML service…" />,
    connected: <StatusDot color="green" label="ML service connected" pulse />,
    unavailable: <StatusDot color="red" label="ML service unavailable" />,
  }[probe.status];

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside
        ref={navRef}
        className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-navy-950 lg:flex"
      >
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
            <GraduationCap className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-white">AIsmering</p>
            <p className="text-[10px] uppercase tracking-widest text-navy-100/70">
              Online Proctoring
            </p>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3" aria-label="Main navigation">
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-navy-800 text-white"
                    : "text-navy-100/70 hover:bg-navy-900 hover:text-white"
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-navy-800 px-5 py-4">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-700 text-xs font-semibold text-white">
              {user.full_name
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-white">{user.full_name}</p>
              <p className="text-[10px] text-navy-100/70">{ROLE_LABEL[user.role]}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-navy-100/70 hover:bg-navy-900 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-6">
            {/* Mobile nav */}
            <nav className="flex items-center gap-1 overflow-x-auto lg:hidden" aria-label="Main navigation">
              {nav.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium",
                      active ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="hidden items-center gap-3 lg:flex">
              <div className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5">
                {probeUi}
                <button
                  onClick={probe.check}
                  aria-label="Re-check ML service status"
                  className="rounded p-0.5 text-slate-400 hover:text-slate-600"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                {ROLE_LABEL[user.role]}
              </span>
            </div>
          </div>
        </header>

        {demoMode && (
          <div className="px-4 pt-3 lg:px-6">
            <Banner tone="demo">
              <strong>Demo mode.</strong> Backend services are not connected — records shown are
              labeled fixtures and no data is persisted. Authentication is local only and proves
              nothing about real authorization.
            </Banner>
          </div>
        )}

        <main className="flex-1 px-4 py-5 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
