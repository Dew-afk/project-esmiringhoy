"use client";

// User & institution management (SRS 3.1.6). Read-only fixture views plus
// honest boundaries for approvals and CSV import (both need the backend).

import { useMemo, useRef, useState } from "react";
import { Building2, Upload, UserCheck } from "lucide-react";
import { useRequireRole } from "@/lib/auth";
import { AdminService } from "@/lib/services";
import { institutionById, institutions } from "@/lib/fixtures";
import { apiConnected, LiveApi, useLiveData } from "@/lib/live-api";
import type { Role } from "@/lib/types";
import { Badge, Banner, Button, Card, CardHeader, Input, Pagination, Select, Tabs, useToast } from "@/components/ui";

const PAGE_SIZE = 6;

const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  proctor: "Proctor",
  admin: "Administrator",
  appeals: "Appeals Reviewer",
};

export default function UserManagement() {
  const user = useRequireRole(["admin"]);
  const toast = useToast();
  const [tab, setTab] = useState<"users" | "institutions" | "approvals">("users");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [imported, setImported] = useState<{ name: string; email: string }[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const live = apiConnected();
  const liveUsers = useLiveData(LiveApi.listUsers, live);
  const liveInstitutions = useLiveData(LiveApi.listInstitutions, live);

  const users = useMemo(() => {
    let u = live
      ? (liveUsers.data ?? []).map((apiUser) => ({
          user_id: apiUser.user_id,
          role: apiUser.role as Role,
          full_name: apiUser.full_name,
          email: apiUser.email,
          institution_id: apiUser.institution_id,
          roster_id: apiUser.roster_id ?? undefined,
          department: apiUser.department ?? undefined,
          approval_status: (apiUser.approval_status as "approved" | "pending") ?? "approved",
          consent_status: (apiUser.consent_status as "granted" | "revoked" | "none") ?? "none",
        }))
      : AdminService.listUsers();
    if (query) {
      const q = query.toLowerCase();
      u = u.filter((x) => x.full_name.toLowerCase().includes(q) || x.email.toLowerCase().includes(q));
    }
    if (roleFilter !== "all") u = u.filter((x) => x.role === roleFilter);
    return u;
  }, [query, roleFilter, live, liveUsers.data]);

  if (!user) return null;

  const pages = Math.max(1, Math.ceil(users.length / PAGE_SIZE));
  const pageRows = users.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pendingProctors = users.filter((u) => u.approval_status === "pending");

  const onCsv = (file: File) => {
    file
      .text()
      .then((text) => {
        const rows = text
          .split(/\r?\n/)
          .slice(1)
          .filter(Boolean)
          .map((line) => {
            const [name, email] = line.split(",").map((c) => c.trim());
            return { name, email };
          })
          .filter((r) => r.name && r.email);
        setImported(rows);
      })
      .catch(() => toast.push("danger", "Could not read that file."));
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Users &amp; institutions</h1>
        <p className="text-sm text-slate-500">Directory, tenants, approvals, and roster import</p>
      </div>

      {live ? (
        <Banner tone="success">
          <strong>Backend connected.</strong> Users, approvals, and imports are real and
          server-enforced. A client-side role toggle is never real authorization.
        </Banner>
      ) : (
        <Banner tone="demo">
          <strong>Demo fixtures.</strong> Proctor approvals and CSV imports require the backend —
          nothing is persisted. A client-side role toggle is never real authorization.
        </Banner>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "users", label: "User directory" },
          { id: "institutions", label: "Institutions" },
          { id: "approvals", label: `Proctor approvals (${pendingProctors.length})` },
        ]}
      />

      {tab === "users" && (
        <Card>
          <CardHeader
            title="User directory"
            action={
              <div className="flex flex-wrap gap-2">
                <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search name or email…" className="w-52" aria-label="Search users" />
                <Select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} className="w-40" aria-label="Filter by role">
                  <option value="all">All roles</option>
                  <option value="student">Students</option>
                  <option value="proctor">Proctors</option>
                  <option value="admin">Administrators</option>
                  <option value="appeals">Appeals reviewers</option>
                </Select>
              </div>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-semibold">Name</th>
                  <th className="px-3 py-2.5 font-semibold">Email</th>
                  <th className="px-3 py-2.5 font-semibold">Role</th>
                  <th className="px-3 py-2.5 font-semibold">Institution</th>
                  <th className="px-3 py-2.5 font-semibold">Consent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pageRows.map((u) => (
                  <tr key={u.user_id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-800">{u.full_name}</p>
                      {u.roster_id && <p className="text-[10px] text-slate-400">Roster {u.roster_id}</p>}
                      {u.department && <p className="text-[10px] text-slate-400">{u.department}</p>}
                    </td>
                    <td className="px-3 py-3 text-slate-600">{u.email}</td>
                    <td className="px-3 py-3">
                      <Badge tone={u.role === "admin" ? "violet" : u.role === "appeals" ? "brand" : "neutral"}>{ROLE_LABEL[u.role]}</Badge>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{institutionById(u.institution_id)?.code ?? "—"}</td>
                    <td className="px-3 py-3">
                      {u.role === "student" ? (
                        <Badge tone={u.consent_status === "granted" ? "success" : u.consent_status === "revoked" ? "danger" : "warning"}>
                          {u.consent_status === "granted" ? "Granted" : u.consent_status === "revoked" ? "Revoked" : "None"}
                        </Badge>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pages} onChange={setPage} />
        </Card>
      )}

      {tab === "institutions" && (
        <div className="grid gap-3 md:grid-cols-3">
          {(live ? (liveInstitutions.data ?? []).map((i) => ({ institution_id: i.institution_id, name: i.name, code: i.code, isTest: i.is_test })) : institutions).map((i) => (
            <Card key={i.institution_id} className="px-5 py-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-brand-600" />
                <p className="text-sm font-semibold text-slate-900">{i.name}</p>
              </div>
              <p className="mt-1 text-xs text-slate-500">Code {i.code}</p>
              {i.isTest && (
                <Badge tone="warning" className="mt-2">Dedicated test institution — mock data lives here</Badge>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                Tenant provisioning, SSO configuration, and retention settings require the backend.
              </p>
            </Card>
          ))}
        </div>
      )}

      {tab === "approvals" && (
        <Card>
          <CardHeader title="Pending proctor approvals" subtitle="Approval requires the backend — the button reflects its real unavailable state" />
          <div className="divide-y divide-slate-100">
            {pendingProctors.length === 0 && (
              <p className="px-5 py-6 text-center text-xs text-slate-400">No pending approvals.</p>
            )}
            {pendingProctors.map((p) => (
              <div key={p.user_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-slate-800">{p.full_name}</p>
                  <p className="text-xs text-slate-500">{p.email} · {p.department}</p>
                </div>
                <Button
                  size="sm"
                  disabled={!live}
                  title={live ? "Server-enforced approval + audit log" : "Proctor approval requires the backend AdminService"}
                  onClick={() =>
                    LiveApi.approveUser(p.user_id)
                      .then(() => {
                        toast.push("success", `${p.full_name} approved — audit-logged.`);
                        liveUsers.reload();
                      })
                      .catch((e) => toast.push("danger", e instanceof Error ? e.message : "Approval failed"))
                  }
                >
                  <UserCheck className="h-3.5 w-3.5" /> Approve
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="CSV roster import" subtitle="Parses locally; import requires the backend" />
        <div className="space-y-3 px-5 py-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])}
            aria-label="Choose roster CSV file"
          />
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Choose CSV file
          </Button>
          {imported && (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Name</th>
                      <th className="px-3 py-2 font-semibold">Email</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {imported.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-slate-700">{r.name}</td>
                        <td className="px-3 py-2 text-slate-600">{r.email}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">{imported.length} rows parsed (preview).</p>
              <Button
                size="sm"
                disabled={!live}
                title={live ? "Server-validated CSV import (no credential materialization)" : "Import requires the backend AdminService"}
                onClick={() => {
                  if (!fileRef.current?.files?.[0]) return;
                  const form = new FormData();
                  form.append("file", fileRef.current.files[0]);
                  LiveApi.importRoster(form)
                    .then((res) => {
                      toast.push("success", `Imported ${res.created.length} students, skipped ${res.skipped}.`);
                      setImported(null);
                      liveUsers.reload();
                    })
                    .catch((e) => toast.push("danger", e instanceof Error ? e.message : "Import failed"));
                }}
              >
                Import {imported.length} students
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
