"use client";

// Demo authentication context. There is NO authentication backend in this
// repository: nothing here verifies credentials or grants real authorization.
// The UI keeps that fact visible (demo banner) and treats every role check as
// a UI convenience — secure authorization must come from the backend.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Role, UserAccount } from "./types";
import { config } from "./config";

const STORAGE_KEY = "aism.auth";

interface AuthState {
  user: UserAccount | null;
  demoMode: boolean;
  login: (user: UserAccount) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function loadStoredUser(): UserAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserAccount;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // null until hydrated from localStorage — avoids SSR/client mismatch.
  const [user, setUser] = useState<UserAccount | null>(null);

  useEffect(() => {
    setUser(loadStoredUser());
  }, []);

  const login = useCallback((u: UserAccount) => {
    setUser(u);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    } catch {
      // storage unavailable — session stays in memory only
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, demoMode: config.demoMode, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

const ROLE_HOME: Record<Role, string> = {
  student: "/student",
  proctor: "/proctor",
  admin: "/admin/exams",
  appeals: "/appeals",
};

/** Redirects unauthenticated visitors to /login. Returns the signed-in user
 *  (or null while hydrating). UI-level only — not authorization. */
export function useRequireRole(roles?: Role[]): UserAccount | null {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (user === null && pathname !== "/login" && pathname !== "/register") {
      router.replace("/login");
    } else if (user && roles && !roles.includes(user.role)) {
      router.replace(ROLE_HOME[user.role]);
    }
  }, [user, roles, router, pathname]);

  return user;
}

export { ROLE_HOME };
