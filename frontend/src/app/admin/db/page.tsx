"use client";

// Proctor database viewer (SDD §5.8, v01.01). Read-only fixture inspection.
// Deletion stays DISABLED: the backend safeguards (role gate, test-Institution
// verification, explicit confirmation, audit logging, dependency-order hard
// deletion) do not exist in this repository, so the UI must not offer it.

import { useMemo, useState } from "react";
import { Database, Trash2 } from "lucide-react";
import { useRequireRole } from "@/lib/auth";
import { dbTables } from "@/lib/fixtures";
import { apiConnected, LiveApi, useLiveData } from "@/lib/live-api";
import { Badge, Banner, Button, Card, CardHeader, Input, Modal, Pagination, Select, useToast } from "@/components/ui";

const PAGE_SIZE = 8;

const PROTECTED_TABLES = ["AuditLog", "RetentionLog", "Consents"];
const NON_DELETABLE_TABLES = ["Institution", "ProctoringPolicy", "RosterAssignment"];

export default function DatabaseViewer() {
  const user = useRequireRole(["admin"]);
  const toast = useToast();
  const [table, setTable] = useState("UserAccount");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const live = apiConnected();
  const liveTables = useLiveData(LiveApi.dbTables, live);
  const liveRows = useLiveData(() => LiveApi.dbRows(table, PAGE_SIZE, (page - 1) * PAGE_SIZE), live);

  const rows = useMemo(() => {
    if (live) {
      const data = liveRows.data?.rows ?? [];
      if (!query) return data;
      const q = query.toLowerCase();
      return data.filter((r) =>
        Object.values(r).some((v) => String(v).toLowerCase().includes(q))
      );
    }
    const all = dbTables[table] ?? [];
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter((r) =>
      Object.values(r).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [live, liveRows.data, table, query]);

  if (!user) return null;

  const totalRows = live ? (liveRows.data?.total ?? 0) : rows.length;
  const pages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const pageRows = rows.slice(0, PAGE_SIZE);
  const columns = live
    ? liveRows.data?.columns ?? []
    : pageRows.length > 0
      ? Object.keys(pageRows[0])
      : [];

  const doDelete = (recordId: string) => {
    LiveApi.dbDelete(table, recordId)
      .then(() => {
        toast.push("success", `Deleted ${table}:${recordId} — audit-logged.`);
        setConfirmDelete(null);
        liveRows.reload();
      })
      .catch((e) => {
        toast.push("danger", e instanceof Error ? e.message : "Delete refused");
        setConfirmDelete(null);
      });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Database viewer</h1>
        <p className="text-sm text-slate-500">
          Read-only record inspection over demo fixtures (SDD §5.8) — scoped to your institution
        </p>
      </div>

      {live ? (
        <Banner tone="success">
          <strong>Backend connected.</strong> Rows are real, institution-scoped, read-only by
          default. Deletion is server-enforced: role authorization, dedicated test-Institution
          verification, explicit confirmation, dependency-order hard deletion, audit logging.
          Protected tables ({liveTables.data?.protected.join(", ")}) are never deletable.
        </Banner>
      ) : (
        <Banner tone="demo">
          <strong>Read-only demo viewer.</strong> Rows are labeled fixtures. Deletion is disabled
          by design here: the backend safeguards — role authorization, dedicated test-Institution
          verification, explicit confirmation, dependency-order hard deletion, and audit logging —
          are not implemented, so no delete path is offered.
        </Banner>
      )}

      <Card>
        <CardHeader
          title={`Table: ${table}`}
          subtitle={
            PROTECTED_TABLES.includes(table)
              ? "Protected table — never deletable through this interface (SDD §5.8)"
              : NON_DELETABLE_TABLES.includes(table)
                ? "Viewable but not deletable (SDD §5.8)"
                : `${rows.length} rows (demo fixtures)`
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={table} onChange={(e) => { setTable(e.target.value); setPage(1); setQuery(""); }} className="w-48" aria-label="Select table">
                {(live ? liveTables.data?.tables ?? [] : Object.keys(dbTables)).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
              <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search rows…" className="w-44" aria-label="Search rows" />
            </div>
          }
        />
        {pageRows.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-slate-400">
            No rows in {table}{query ? " matching your search" : ""}.{" "}
            <Database className="mx-auto mb-1 h-8 w-8 text-slate-200" />
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                  {columns.map((c) => (
                    <th key={c} className="px-3 py-2.5 font-semibold">{c}</th>
                  ))}
                  <th className="px-3 py-2.5 font-semibold">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pageRows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    {columns.map((c) => (
                      <td key={c} className="max-w-52 truncate px-3 py-2.5 text-slate-600">
                        {typeof row[c] === "object" && row[c] !== null
                          ? JSON.stringify(row[c]).slice(0, 80)
                          : String(row[c] ?? "—")}
                      </td>
                    ))}
                    <td className="px-3 py-2.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={
                          !live ||
                          (liveTables.data
                            ? !liveTables.data.deletable.includes(table)
                            : PROTECTED_TABLES.includes(table) || NON_DELETABLE_TABLES.includes(table))
                        }
                        title={
                          !live
                            ? "Deletion requires the backend (role gate, test-Institution verification, confirmation, audit logging)."
                            : liveTables.data && !liveTables.data.deletable.includes(table)
                              ? `${table} is never deletable through this interface (SDD §5.8).`
                              : "Backend verifies the record belongs to the dedicated test institution before deleting."
                        }
                        onClick={() => {
                          const recordId = row.id ?? row.user_id ?? row.session_id ?? row.exam_id;
                          if (recordId === undefined || recordId === null) {
                            toast.push("warning", "No record id available for this row.");
                            return;
                          }
                          setConfirmDelete(String(recordId));
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={pages} onChange={setPage} />
      </Card>

      <Modal
        open={confirmDelete !== null}
        title="Delete record?"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => confirmDelete && doDelete(confirmDelete)}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p>
          Deleting <strong>{table}:{confirmDelete}</strong> is hard deletion in dependency order
          (SDD §5.8). The backend will refuse unless the record belongs to the dedicated test
          institution; every deletion is audit-logged. This cannot be undone.
        </p>
      </Modal>

      <div className="grid gap-3 text-xs text-slate-500 md:grid-cols-2">
        <Card className="px-5 py-4">
          <p className="font-semibold text-slate-700">Deletion rules (SDD §5.8)</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Mock/test data only — confined to the dedicated test Institution</li>
            <li>Hard deletion in dependency order (EventsFlags → RiskScores → Recordings + objects → SessionSummaries → ExamSession)</li>
            <li>{PROTECTED_TABLES.join(", ")} are never deletable</li>
            <li>Every deletion: role check, confirmation, AuditLog entry</li>
          </ul>
        </Card>
        <Card className="px-5 py-4">
          <p className="font-semibold text-slate-700">Retention</p>
          <p className="mt-2 leading-relaxed">
            The scheduled retention job is the only production deletion path and logs every purge
            in <Badge tone="neutral">RetentionLog</Badge> for compliance review.
          </p>
        </Card>
      </div>
    </div>
  );
}
