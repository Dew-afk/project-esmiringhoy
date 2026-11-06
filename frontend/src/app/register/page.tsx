"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { useAuth, ROLE_HOME } from "@/lib/auth";
import { AuthService } from "@/lib/services";
import type { Role, UserAccount } from "@/lib/types";
import { institutions } from "@/lib/fixtures";
import { Banner, Button, Field, Input, Select, Tabs, useToast } from "@/components/ui";

type RegRole = Extract<Role, "student" | "proctor">;

export default function RegisterPage() {
  const { login } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [role, setRole] = useState<RegRole>("student");
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    institutionId: "inst_westbridge",
    password: "",
    confirm: "",
    rosterId: "",
    staffId: "",
    department: "",
    consent: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: string, v: string | boolean) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (form.fullName.trim().length < 2) errs.fullName = "Enter your full name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Enter a valid institutional email.";
    if (form.password.length < 8) errs.password = "At least 8 characters.";
    if (form.password !== form.confirm) errs.confirm = "Passwords do not match.";
    if (role === "student") {
      if (!form.rosterId.trim()) errs.rosterId = "Roster ID is required for students.";
      if (!form.consent) errs.consent = "Monitoring consent is required to register as a student.";
    } else {
      if (!form.staffId.trim()) errs.staffId = "Staff ID is required for proctors.";
      if (!form.department.trim()) errs.department = "Department is required.";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const user: UserAccount = {
      user_id: `u_demo_${Date.now()}`,
      role,
      full_name: form.fullName.trim(),
      email: form.email.trim(),
      institution_id: form.institutionId,
      roster_id: role === "student" ? form.rosterId.trim() : undefined,
      department: role === "proctor" ? form.department.trim() : undefined,
      approval_status: role === "proctor" ? "pending" : "approved",
      consent_status: role === "student" ? "granted" : undefined,
    };
    AuthService.register(user);
    login(user);
    toast.push(
      "warning",
      role === "proctor"
        ? "Demo mode: account created in browser memory only. Proctor accounts require institutional approval before first login."
        : "Demo mode: account created in browser memory only — nothing was persisted."
    );
    router.replace(ROLE_HOME[role]);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600">
            <GraduationCap className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-white">Create an account</h1>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
          <Banner tone="demo" className="mb-4">
            <strong>Demo registration.</strong> Accounts are created in browser memory only and
            disappear on reload — no backend exists to store them.
          </Banner>

          <Tabs<RegRole>
            value={role}
            onChange={setRole}
            tabs={[
              { id: "student", label: "Student" },
              { id: "proctor", label: "Proctor" },
            ]}
          />

          <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
            <Field label="Full name" required error={errors.fullName}>
              <Input
                value={form.fullName}
                onChange={(e) => set("fullName", e.target.value)}
                placeholder="e.g. Maria Santos"
              />
            </Field>
            <Field label="Institutional email" required error={errors.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="name@institution.edu"
              />
            </Field>
            <Field label="Institution" required>
              <Select value={form.institutionId} onChange={(e) => set("institutionId", e.target.value)}>
                {institutions.map((i) => (
                  <option key={i.institution_id} value={i.institution_id}>
                    {i.name} ({i.code})
                  </option>
                ))}
              </Select>
            </Field>
            {role === "student" ? (
              <Field
                label="Student roster ID"
                required
                error={errors.rosterId}
                hint="Shown on your class roster or registration form."
              >
                <Input value={form.rosterId} onChange={(e) => set("rosterId", e.target.value)} placeholder="e.g. 2024-01821" />
              </Field>
            ) : (
              <>
                <Field label="Staff ID" required error={errors.staffId}>
                  <Input value={form.staffId} onChange={(e) => set("staffId", e.target.value)} placeholder="e.g. F-0441" />
                </Field>
                <Field label="Department" required error={errors.department}>
                  <Input value={form.department} onChange={(e) => set("department", e.target.value)} placeholder="e.g. College of Science" />
                </Field>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Password" required error={errors.password}>
                <Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} />
              </Field>
              <Field label="Confirm" required error={errors.confirm}>
                <Input type="password" value={form.confirm} onChange={(e) => set("confirm", e.target.value)} />
              </Field>
            </div>

            {role === "student" && (
              <div>
                <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.consent}
                    onChange={(e) => set("consent", e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-brand-600"
                  />
                  <span>
                    I understand that exams are monitored via webcam, microphone, and browser
                    behavior, and I <strong>grant consent</strong> for biometric monitoring during
                    exams. I can review or revoke this consent at any time in my profile.
                  </span>
                </label>
                {errors.consent && <p className="mt-1 text-xs text-red-600">{errors.consent}</p>}
              </div>
            )}

            {role === "proctor" && (
              <Banner tone="info">
                Proctor accounts require <strong>institutional administrator approval</strong>{" "}
                before first login (SDD §6.3).
              </Banner>
            )}

            <Button type="submit" className="w-full">
              Create {role} account
            </Button>
            <p className="text-center text-xs text-slate-500">
              Already registered?{" "}
              <Link href="/login" className="text-brand-700 hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
