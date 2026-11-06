"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, GraduationCap, KeyRound } from "lucide-react";
import { useAuth, ROLE_HOME } from "@/lib/auth";
import { AuthService } from "@/lib/services";
import type { Role } from "@/lib/types";
import { institutions } from "@/lib/fixtures";
import { Banner, Button, Field, Input, Select, Tabs, useToast } from "@/components/ui";

const DEMO_ACCOUNTS: Record<Role, string> = {
  student: "maria.santos@westbridge.edu",
  proctor: "e.cruz@westbridge.edu",
  admin: "d.bacusmo@aism.edu",
  appeals: "p.mendoza@appeals.aism.edu",
};

export default function LoginPage() {
  const { login, demoMode } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [role, setRole] = useState<Role>("student");
  const [email, setEmail] = useState(DEMO_ACCOUNTS.student);
  const [password, setPassword] = useState("demo1234");
  const [showPw, setShowPw] = useState(false);
  const [institutionId, setInstitutionId] = useState("inst_westbridge");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid institutional email address.");
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }
    const user = AuthService.login(email, role);
    if (!user) {
      setError(`No demo ${role} account matches that email. Use "${DEMO_ACCOUNTS[role]}".`);
      return;
    }
    login(user);
    toast.push("info", `Signed in as ${user.full_name} (demo session — no real authentication).`);
    router.replace(ROLE_HOME[role]);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600">
            <GraduationCap className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-white">AIsmering</h1>
          <p className="text-xs text-slate-400">
            AI-Driven Online Proctoring &amp; Anti-Cheat System
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
          {demoMode && (
            <Banner tone="demo" className="mb-4">
              <strong>Demo authentication.</strong> No credentials are verified — this repository
              has no auth backend. Use a demo account below to explore the role-specific views.
            </Banner>
          )}

          <Tabs<Role>
            value={role}
            onChange={(r) => {
              setRole(r);
              setEmail(DEMO_ACCOUNTS[r]);
              setError(null);
            }}
            tabs={[
              { id: "student", label: "Student" },
              { id: "proctor", label: "Proctor" },
              { id: "admin", label: "Administrator" },
            ]}
          />

          <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
            {role === "admin" && (
              <Field label="Institution / tenant">
                <Select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
                  {institutions.map((i) => (
                    <option key={i.institution_id} value={i.institution_id}>
                      {i.name} ({i.code})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Institutional email or username" required>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@institution.edu"
                autoComplete="email"
              />
            </Field>
            <Field label="Password" required>
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() =>
                  toast.push("info", "Password recovery requires the backend — not available in demo mode.")
                }
                className="text-brand-700 hover:underline"
              >
                Forgot password?
              </button>
              <Link href="/register" className="text-brand-700 hover:underline">
                Create an account
              </Link>
            </div>

            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <Button
              variant="outline"
              className="w-full"
              disabled
              title="Institutional SSO requires a SAML/OAuth identity provider — not configured in this repository."
            >
              <KeyRound className="h-4 w-4" /> Sign in with institution SSO
            </Button>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              SSO is disabled: no identity provider is configured in this environment.
            </p>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-slate-500">
          Appeals reviewers: authorization is assigned separately per the SRS —{" "}
          <button
            onClick={() => {
              setRole("appeals");
              setEmail(DEMO_ACCOUNTS.appeals);
            }}
            className="text-brand-500 underline"
          >
            use the appeals demo account
          </button>
          .
        </p>
      </div>
    </div>
  );
}
