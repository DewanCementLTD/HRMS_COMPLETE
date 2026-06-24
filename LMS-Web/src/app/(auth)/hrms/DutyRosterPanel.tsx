"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Printer, CalendarDays, Pencil, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { getEmployeeRoster, updateRosterEntry, type DutyRoster } from "@/services/hrmsService";
import { fetchShiftLov, type ShiftLov } from "@/services/referenceService";

export interface RosterEmployee {
  cardNo: string;
  name?: string;
  designation?: string;
  department?: string;
  status?: string;
}

const dash = (v?: string | null) => (v == null || v === "" ? "" : v);
const COLS = 13; // total columns (for full-width rows)

export function DutyRosterPanel({
  emp,
  adminCardNo,
  onBack,
}: {
  emp: RosterEmployee;
  adminCardNo: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<DutyRoster | null>(null);
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [lov, setLov] = useState<ShiftLov[]>([]);

  // inline edit state
  const [editPk, setEditPk] = useState<number | null>(null);
  const [editVals, setEditVals] = useState<{ shift: string; remarks: string }>({ shift: "", remarks: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (m?: string) => {
    setLoading(true);
    setEditPk(null);
    try {
      const r = await getEmployeeRoster(emp.cardNo, adminCardNo, m);
      setData(r);
      setMonth(r.month ?? undefined);
    } catch (e) {
      console.error("Failed to load duty roster", e);
      setData({ months: [], month: null, rows: [] });
    } finally {
      setLoading(false);
    }
  }, [emp.cardNo, adminCardNo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchShiftLov().then((r) => setLov(r.items)).catch(() => setLov([])); }, []);

  const rows = data?.rows ?? [];

  function startEdit(pk: number, shift?: string, remarks?: string | null) {
    setEditPk(pk);
    setEditVals({ shift: shift || "", remarks: remarks || "" });
  }

  async function save() {
    if (editPk == null) return;
    setSaving(true);
    try {
      const res = await updateRosterEntry(editPk, adminCardNo, { shift: editVals.shift, remarks: editVals.remarks });
      setData((d) => d
        ? { ...d, rows: d.rows.map((row) => row.pk === editPk
            ? { ...row, shift: editVals.shift, remarks: editVals.remarks, updated_by: res.updated_by ?? row.updated_by }
            : row) }
        : d);
      setEditPk(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save roster row");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id="duty-roster-report" className="animate-fade-in rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm text-gray-900">
      {/* Print-only title (the toolbar heading is hidden when printing) */}
      <div className="hidden print:block mb-2 border-b-2 border-gray-300 pb-2">
        <h2 className="text-lg font-bold text-gray-900">Monthly Duty Roster{month ? ` — ${month}` : ""}</h2>
      </div>

      {/* Toolbar (hidden when printing) */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 print:hidden">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900">Monthly Duty Roster</h2>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month ?? ""}
            onChange={(e) => { setMonth(e.target.value); load(e.target.value); }}
            disabled={loading || (data?.months.length ?? 0) === 0}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
          >
            {(data?.months ?? []).length === 0 && <option value="">No roster</option>}
            {(data?.months ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <Button variant="secondary" size="sm" onClick={() => window.print()} disabled={rows.length === 0}>
            <Printer className="h-4 w-4 mr-1.5" /> Print
          </Button>
          <Button variant="secondary" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
          </Button>
        </div>
      </div>

      {/* Employee header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <Field label="Employee No" value={emp.cardNo} mono />
        <Field label="Name" value={emp.name} />
        <Field label="Designation" value={emp.designation} />
        <Field label="Department" value={emp.department} />
      </div>

      {/* Roster grid */}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm bg-white">
        <table className="min-w-full text-sm bg-white">
          <thead>
            <tr className="bg-indigo-600 text-white">
              <th rowSpan={2} className="px-3 py-2 text-left font-semibold border-r border-indigo-500">Roster Date</th>
              <th rowSpan={2} className="px-2 py-2 text-center font-semibold border-r border-indigo-500">Shift</th>
              <th rowSpan={2} className="px-3 py-2 text-left font-semibold border-r border-indigo-500">Day Name</th>
              <th rowSpan={2} className="px-3 py-2 text-center font-semibold border-r border-indigo-500">Time In</th>
              <th rowSpan={2} className="px-3 py-2 text-center font-semibold border-r border-indigo-500">Time Out</th>
              <th colSpan={2} className="px-3 py-1.5 text-center font-semibold border-r border-indigo-500 border-b border-indigo-500">First Half</th>
              <th colSpan={2} className="px-3 py-1.5 text-center font-semibold border-r border-indigo-500 border-b border-indigo-500">Second Half</th>
              <th rowSpan={2} className="px-3 py-2 text-center font-semibold border-r border-indigo-500">Absent / Early Out</th>
              <th rowSpan={2} className="px-3 py-2 text-left font-semibold border-r border-indigo-500">Remarks</th>
              <th rowSpan={2} className="px-3 py-2 text-left font-semibold border-r border-indigo-500">Updated By</th>
              <th rowSpan={2} className="px-3 py-2 text-center font-semibold print:hidden">Action</th>
            </tr>
            <tr className="bg-indigo-600 text-white text-xs">
              <th className="px-2 py-1.5 text-center font-medium border-r border-indigo-500">Late</th>
              <th className="px-2 py-1.5 text-center font-medium border-r border-indigo-500">Half Day</th>
              <th className="px-2 py-1.5 text-center font-medium border-r border-indigo-500">Late</th>
              <th className="px-2 py-1.5 text-center font-medium border-r border-indigo-500">Half Day</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={COLS} className="py-10 text-center"><Spinner /></td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={COLS} className="py-10 text-center text-sm text-gray-400">No roster found for this employee.</td></tr>
            )}
            {!loading && rows.map((r, i) => {
              const isRest = (r.shift || "").toUpperCase() === "R";
              const isAbsent = (r.remarks || "").toLowerCase().includes("absent");
              const editing = editPk != null && r.pk === editPk;
              const rowCls = editing ? "bg-indigo-50" : isAbsent ? "bg-red-50/70" : isRest ? "bg-sky-50/70" : "hover:bg-gray-50";
              return (
                <tr key={r.pk ?? i} className={`${rowCls} transition-colors`}>
                  <td className="px-3 py-1.5 font-medium text-gray-800 border-r border-gray-100 whitespace-nowrap">{r.roster_date}</td>

                  {/* Shift — editable */}
                  <td className="px-2 py-1.5 text-center border-r border-gray-100">
                    {editing ? (
                      <select
                        value={editVals.shift}
                        onChange={(e) => setEditVals((v) => ({ ...v, shift: e.target.value }))}
                        className="border border-indigo-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      >
                        <option value="">—</option>
                        {lov.map((l) => <option key={l.shift} value={l.shift}>{l.shift} — {l.descr}</option>)}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center justify-center h-5 min-w-5 px-1 rounded text-xs font-bold ${isRest ? "bg-sky-200 text-sky-800" : "bg-emerald-100 text-emerald-700"}`}>
                        {dash(r.shift) || "—"}
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-1.5 text-gray-700 border-r border-gray-100 whitespace-nowrap">{dash(r.day_name)}</td>
                  <td className="px-3 py-1.5 text-center text-gray-700 border-r border-gray-100">{dash(r.time_in) || "—"}</td>
                  <td className="px-3 py-1.5 text-center text-gray-700 border-r border-gray-100">{dash(r.time_out) || "—"}</td>
                  <td className="px-2 py-1.5 text-center text-gray-600 border-r border-gray-100">{dash(r.fh_late)}</td>
                  <td className="px-2 py-1.5 text-center text-gray-600 border-r border-gray-100">{dash(r.fh_half_day)}</td>
                  <td className="px-2 py-1.5 text-center text-gray-600 border-r border-gray-100">{dash(r.sh_late)}</td>
                  <td className="px-2 py-1.5 text-center text-gray-600 border-r border-gray-100">{dash(r.sh_half_day)}</td>
                  <td className="px-3 py-1.5 text-center text-gray-600 border-r border-gray-100">{dash(r.early_out)}</td>

                  {/* Remarks — editable */}
                  <td className={`px-3 py-1.5 border-r border-gray-100 ${isAbsent && !editing ? "text-red-600 font-medium" : "text-gray-500 italic"}`}>
                    {editing ? (
                      <input
                        type="text"
                        value={editVals.remarks}
                        onChange={(e) => setEditVals((v) => ({ ...v, remarks: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditPk(null); }}
                        placeholder="Remarks"
                        className="w-full border border-indigo-300 rounded px-1.5 py-0.5 text-xs not-italic text-gray-800 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                    ) : dash(r.remarks)}
                  </td>

                  {/* Updated By */}
                  <td className="px-3 py-1.5 text-[11px] text-gray-400 border-r border-gray-100 whitespace-nowrap">{dash(r.updated_by)}</td>

                  {/* Action */}
                  <td className="px-3 py-1.5 text-center whitespace-nowrap print:hidden">
                    {editing ? (
                      <div className="flex items-center justify-center gap-1.5">
                        <button onClick={save} disabled={saving} className="text-emerald-600 hover:text-emerald-800 disabled:opacity-40" title="Save">
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </button>
                        <button onClick={() => setEditPk(null)} disabled={saving} className="text-gray-400 hover:text-gray-600" title="Cancel">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => r.pk != null && startEdit(r.pk, r.shift, r.remarks)}
                        disabled={r.pk == null || editPk != null}
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-30"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Print isolation: print only this report, like the Pay Register */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          body * { visibility: hidden !important; }
          #duty-roster-report, #duty-roster-report * { visibility: visible !important; }
          #duty-roster-report {
            position: absolute; left: 0; top: 0; width: 100%;
            border: none !important; box-shadow: none !important; padding: 0 !important;
          }
          #duty-roster-report * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          #duty-roster-report table { font-size: 10px; }
        }
      `}</style>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-sm font-medium text-gray-900 ${mono ? "font-mono" : ""}`}>{value || "—"}</p>
    </div>
  );
}
