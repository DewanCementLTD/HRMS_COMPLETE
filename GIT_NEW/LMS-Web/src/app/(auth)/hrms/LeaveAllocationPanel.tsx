"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { Search, Save, CalendarDays, RotateCcw } from "lucide-react";
import { fetchLeaveTypes } from "@/services/leaveService";
import {
  fetchLeaveOpeningYears,
  fetchAllocatableEmployees,
  fetchLeaveOpenings,
  saveLeaveOpening,
} from "@/services/leaveService";
import type { AllocatableEmployee, LeaveOpening, LeaveType, LeaveYear } from "@/models/leave";

/** CL, ML, EL — the only types ALL_LEAVE_BAL_V reports a balance for. */
const ALLOCATABLE_LEAVE_TYPES = [1, 2, 3];

/**
 * HR grants each employee their leave for a year (LEAVE_OP).
 *
 * OP_BAL is what ALL_LEAVE_BAL_V reads as the employee's entitlement, so what
 * HR types here becomes the balance the employee can apply against. The server
 * resolves the company from the admin's own rights, so this only ever shows and
 * writes the HR user's own company.
 */
export function LeaveAllocationPanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany, activeBranch, user } = useAuth();

  const [years, setYears] = useState<LeaveYear[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [employees, setEmployees] = useState<AllocatableEmployee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [rows, setRows] = useState<LeaveOpening[]>([]);

  const [cardNo, setCardNo] = useState("");
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [query, setQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadingEmp, setLoadingEmp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reference data: available years, the company's employees, and the leave-type
  // LOV the grid is built from.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchLeaveOpeningYears(adminCardNo, activeCompany || undefined),
      fetchAllocatableEmployees(adminCardNo, activeCompany || undefined, activeBranch || undefined),
      fetchLeaveTypes(user?.card_no || adminCardNo),
    ])
      .then(([y, e, t]) => {
        if (cancelled) return;
        setYears(y.items);
        // Default to the ERP's ACTIVE leave year: balances only ever reflect
        // that one, so anything else would look like the allocation vanished.
        const active = y.items.find((it) => it.active);
        setYear((cur) => cur ?? active?.year ?? y.items[0]?.year ?? new Date().getFullYear());
        setEmployees(e.items);
        // Only CL / ML / EL can be allocated — ALL_LEAVE_BAL_V reports no other
        // type, so anything else would be stored and never seen.
        setLeaveTypes(
          t.items.filter((lt) => ALLOCATABLE_LEAVE_TYPES.includes(Number(lt.leave_type_pk))),
        );
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [adminCardNo, activeCompany, activeBranch, user?.card_no]);

  const loadAllocations = useCallback(async () => {
    if (year == null) return;
    try {
      const res = await fetchLeaveOpenings(adminCardNo, {
        compc: activeCompany || undefined,
        brnch: activeBranch || undefined,
        year,
      });
      setRows(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load allocations");
    }
  }, [adminCardNo, activeCompany, activeBranch, year]);

  useEffect(() => { loadAllocations(); }, [loadAllocations]);

  // Selecting an employee fills the grid with what they already have.
  useEffect(() => {
    let cancelled = false;
    if (!cardNo || year == null) { setDraft({}); return; }
    setLoadingEmp(true);
    fetchLeaveOpenings(adminCardNo, { compc: activeCompany || undefined, year, cardNo })
      .then((res) => {
        if (cancelled) return;
        const next: Record<number, string> = {};
        for (const r of res.items) {
          if (r.op_bal != null) next[r.leave_type_fk] = String(r.op_bal);
        }
        setDraft(next);
      })
      .catch(() => { if (!cancelled) setDraft({}); })
      .finally(() => { if (!cancelled) setLoadingEmp(false); });
    return () => { cancelled = true; };
  }, [adminCardNo, activeCompany, cardNo, year]);

  const selectedEmployee = employees.find((e) => e.card_no === cardNo);
  const activeYear = years.find((y) => y.active);

  // One row per employee for the summary table, with a column per leave type.
  const summary = useMemo(() => {
    const byEmp = new Map<string, { name: string; totals: Record<number, number> }>();
    for (const r of rows) {
      let entry = byEmp.get(r.card_no);
      if (!entry) { entry = { name: r.emp_name, totals: {} }; byEmp.set(r.card_no, entry); }
      if (r.op_bal != null) entry.totals[r.leave_type_fk] = r.op_bal;
    }
    const list = [...byEmp.entries()].map(([card, v]) => ({ card_no: card, ...v }));
    const q = query.trim().toLowerCase();
    return q
      ? list.filter((r) => r.name.toLowerCase().includes(q) || r.card_no.toLowerCase().includes(q))
      : list;
  }, [rows, query]);

  async function save() {
    if (!cardNo || year == null) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      // Every leave type is sent: a blank box clears that allocation, which is
      // different from leaving it untouched.
      const entries = leaveTypes.map((lt) => {
        const raw = draft[lt.leave_type_pk];
        const val = raw == null || raw.trim() === "" ? null : Number(raw);
        return { leave_type_fk: lt.leave_type_pk, op_bal: val != null && Number.isFinite(val) ? val : null };
      });
      const res = await saveLeaveOpening(adminCardNo, activeCompany || undefined, {
        card_no: cardNo,
        year,
        entries,
      });
      setSuccess(res.message);
      await loadAllocations();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save the allocation");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}
      {success && <Alert type="success" message={success} onClose={() => setSuccess(null)} />}

      {/* ── Allocation form ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-indigo-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Allocate Leave</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Sets each leave type&apos;s entitlement for the year. This is the balance the
                employee can then apply against.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
            <Select
              label="Leave Year *"
              value={year != null ? String(year) : ""}
              onChange={(e) => setYear(Number(e.target.value))}
              options={years.map((y) => {
                // Normally a single option: the active leave year from the ERP's
                // YEAR table, which is the only year balances ever read.
                const period = y.scode || (y.year_from ? `${y.year_from} → ${y.year_to}` : "");
                const tags = [
                  y.active ? "active" : null,
                  y.open === false ? "period closed" : null,
                ].filter(Boolean).join(", ");
                return {
                  value: String(y.year),
                  label: `${y.year}${period ? ` · ${period}` : ""}${tags ? ` (${tags})` : ""}`,
                };
              })}
            />
            <div className="sm:col-span-2">
              <SearchableSelect
                label="Employee *"
                value={cardNo}
                onChange={setCardNo}
                placeholder="Search by name or card number…"
                options={employees.map((e) => ({
                  value: e.card_no,
                  label: e.department
                    ? `${e.emp_name} — ${e.department} (${e.card_no})`
                    : `${e.emp_name} (${e.card_no})`,
                }))}
              />
            </div>
          </div>

          {/* Other branches of this company are on a different active year — say
              so rather than leaving HR wondering why only one is offered. */}
          {!!activeYear?.other_active_years?.length && (
            <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs text-sky-800">
              Showing {activeYear.year}, the active leave year for{" "}
              {activeYear.employees ?? 0} employee{activeYear.employees === 1 ? "" : "s"} in this company.
              Other branches are still on {activeYear.other_active_years.join(", ")} — those are set per
              branch in the ERP&apos;s YEAR table.
            </div>
          )}

          {year != null && years.length > 0 && !years.find((y) => y.year === year)?.active && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
              {activeYear
                ? `${year} is not the active leave year (that's ${activeYear.year}).`
                : `No active leave year is configured for this company in the ERP's YEAR table.`}{" "}
              Allocations saved here are kept, but employees&apos; balances only reflect the active
              year, so this leave will not be available until that year is activated.
            </div>
          )}

          {!cardNo ? (
            <p className="text-sm text-gray-400 text-center py-10 border border-dashed border-gray-200 rounded-xl">
              Pick an employee to set their leave for {year ?? "the year"}.
            </p>
          ) : loadingEmp ? (
            <Spinner />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {leaveTypes.map((lt) => (
                  <Input
                    key={lt.leave_type_pk}
                    label={lt.leave_desc || lt.leave_type}
                    type="number"
                    min={0}
                    step="0.5"
                    placeholder="—"
                    value={draft[lt.leave_type_pk] ?? ""}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [lt.leave_type_pk]: e.target.value }))
                    }
                  />
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Leave a box empty to remove that leave type&apos;s allocation.
              </p>

              <div className="flex items-center justify-end gap-3 mt-5">
                <Button variant="secondary" onClick={() => setDraft({})} disabled={saving}>
                  <RotateCcw className="h-4 w-4 mr-1.5" /> Clear all
                </Button>
                <Button onClick={save} loading={saving}>
                  <Save className="h-4 w-4 mr-1.5" />
                  Save for {selectedEmployee?.emp_name || "employee"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── What the company already has ────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Allocated for {year ?? "—"}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {summary.length} employee{summary.length === 1 ? "" : "s"} with leave allocated
              </p>
            </div>
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-56">
              <Search className="h-4 w-4 text-gray-400" />
              <input
                className="bg-transparent text-sm outline-none w-full"
                placeholder="Filter name / card no…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {summary.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">
              Nothing allocated for this year yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Employee</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Card No</th>
                    {leaveTypes.map((lt) => (
                      <th key={lt.leave_type_pk} className="px-3 py-2 text-right font-semibold text-gray-600 whitespace-nowrap">
                        {lt.leave_type}
                      </th>
                    ))}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {summary.map((r) => (
                    <tr key={r.card_no} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-900">{r.name}</td>
                      <td className="px-3 py-2 font-mono text-gray-500">{r.card_no}</td>
                      {leaveTypes.map((lt) => (
                        <td key={lt.leave_type_pk} className="px-3 py-2 text-right tabular-nums text-gray-700">
                          {r.totals[lt.leave_type_pk] ?? ""}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => setCardNo(r.card_no)}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
