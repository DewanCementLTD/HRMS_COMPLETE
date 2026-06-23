"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, RefreshCw, Pencil, Trash2, X, Loader2, Check, Clock } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import {
  addShift, updateShift, deleteShift,
  type Shift, type ShiftLov, type ShiftInput,
} from "@/services/referenceService";

// Field groups for the form. type: "time" | "number" | "text".
type FieldDef = { key: keyof ShiftInput; label: string; type?: "time" | "number" | "text" };

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Main timing",
    fields: [
      { key: "time_from", label: "Time From", type: "time" },
      { key: "time_to", label: "Time To", type: "time" },
      { key: "overtime_start_time", label: "Overtime Start", type: "time" },
      { key: "allow_in_time", label: "Allow-In Time", type: "time" },
      { key: "late_start_tm", label: "Late Start", type: "time" },
      { key: "late_end_tm", label: "Late End", type: "time" },
      { key: "half_day_tm", label: "Half-Day Start", type: "time" },
      { key: "half_day_end_tm", label: "Half-Day End", type: "time" },
      { key: "duty_hrs", label: "Duty Hours", type: "number" },
      { key: "day_name", label: "Day Name", type: "text" },
    ],
  },
  {
    title: "Saturday",
    fields: [
      { key: "sat_start_tm", label: "Sat Start", type: "time" },
      { key: "sat_end_time", label: "Sat End", type: "time" },
      { key: "sat_allow_in_tm", label: "Sat Allow-In", type: "time" },
      { key: "sat_haf_day_tm", label: "Sat Half-Day", type: "time" },
    ],
  },
  {
    title: "Late sitting",
    fields: [
      { key: "late_sit_tm", label: "Late Sit", type: "time" },
      { key: "late_sit_allow_tm", label: "Late Sit Allow", type: "time" },
    ],
  },
  {
    title: "Early out",
    fields: [
      { key: "early_out_late_start", label: "Late — Start", type: "time" },
      { key: "early_out_late_end", label: "Late — End", type: "time" },
      { key: "early_out_hday_start", label: "Half-Day — Start", type: "time" },
      { key: "early_out_hday_end", label: "Half-Day — End", type: "time" },
    ],
  },
];

const ALL_KEYS = GROUPS.flatMap((g) => g.fields.map((f) => f.key));

function blankForm(): Record<string, string> {
  return Object.fromEntries([["shift", ""], ["shift_desc", ""], ...ALL_KEYS.map((k) => [k, ""])]);
}

function formFromShift(s: Shift): Record<string, string> {
  const f = blankForm();
  f.shift = s.shift ?? "";
  f.shift_desc = s.shift_desc ?? "";
  for (const k of ALL_KEYS) {
    const v = (s as unknown as Record<string, unknown>)[k as string];
    f[k as string] = v == null ? "" : String(v);
  }
  return f;
}

// ─── Add / Edit modal ────────────────────────────────────────
function ShiftModal({
  adminCardNo, compc, brnch, lov, editing, onClose, onSaved,
}: {
  adminCardNo: string;
  compc: string;
  brnch: string;
  lov: ShiftLov[];
  editing: Shift | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(() =>
    editing ? formFromShift(editing) : blankForm()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isEdit = !!editing;

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onPickShift(code: string) {
    const found = lov.find((l) => l.shift === code);
    setForm((f) => ({ ...f, shift: code, shift_desc: found?.descr ?? f.shift_desc }));
  }

  async function handleSave() {
    if (!form.shift.trim()) { setError("Please select a shift code"); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form } as ShiftInput;
      if (isEdit && editing?.shift_head_pk != null) {
        await updateShift(adminCardNo, editing.shift_head_pk, payload);
      } else {
        await addShift(adminCardNo, payload, compc, brnch);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save shift");
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div className="fixed inset-0 z-[1000] flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-3xl my-auto max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-white rounded-t-2xl">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-indigo-500" />
            <h3 className="text-base font-semibold text-gray-900">
              {isEdit ? `Edit Shift — ${editing?.shift}` : "Add Shift"}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Shift code (LOV) + description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Shift Code *</label>
              <select
                value={form.shift}
                onChange={(e) => onPickShift(e.target.value)}
                disabled={isEdit}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="">Select shift…</option>
                {lov.map((l) => (
                  <option key={l.shift} value={l.shift}>{l.shift} — {l.descr}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
              <input
                type="text"
                value={form.shift_desc}
                onChange={(e) => set("shift_desc", e.target.value)}
                placeholder="Auto-filled from the shift code"
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>

          {/* Grouped timing fields */}
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-500 mb-2">{g.title}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {g.fields.map((f) => (
                  <div key={f.key as string}>
                    <label className="block text-[11px] font-medium text-gray-500 mb-1">{f.label}</label>
                    <input
                      type={f.type === "number" ? "number" : f.type === "text" ? "text" : "time"}
                      step={f.type === "number" ? "0.5" : undefined}
                      value={form[f.key as string] ?? ""}
                      onChange={(e) => set(f.key as string, e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-white rounded-b-2xl">
          {error && <span className="text-xs text-red-500 mr-auto">{error}</span>}
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
            {isEdit ? "Save Changes" : "Add Shift"}
          </Button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modal, document.body);
}

// ─── Section (list + add/edit/delete) ────────────────────────
export function ShiftsSection({
  shifts, lov, loading, adminCardNo, compc, brnch, onRefresh,
}: {
  shifts: Shift[];
  lov: ShiftLov[];
  loading: boolean;
  adminCardNo: string;
  compc: string;
  brnch: string;
  onRefresh: () => void;
}) {
  const [modal, setModal] = useState<{ editing: Shift | null } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  async function handleDelete(s: Shift) {
    if (s.shift_head_pk == null) return;
    if (!confirm(`Remove shift "${s.shift} — ${s.shift_desc}"?`)) return;
    setDeleting(s.shift_head_pk);
    try {
      await deleteShift(adminCardNo, s.shift_head_pk);
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setDeleting(null);
    }
  }

  const fmt = (v?: string | number | null) => (v === null || v === undefined || v === "" ? "—" : String(v));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">
          {shifts.length} {shifts.length === 1 ? "shift" : "shifts"} for this company &amp; branch
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setModal({ editing: null })} disabled={!compc}>
            <Plus className="h-4 w-4 mr-1" />
            Add Shift
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {["Shift", "Description", "From", "To", "Overtime", "Allow-In", "Duty Hrs", "Day", ""].map((c, i) => (
                <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-50">
            {loading && (
              <tr><td colSpan={9} className="py-10 text-center"><Spinner /></td></tr>
            )}
            {!loading && shifts.length === 0 && (
              <tr><td colSpan={9} className="py-10 text-center text-sm text-gray-400">No shifts configured for this company/branch yet.</td></tr>
            )}
            {!loading && shifts.map((s) => (
              <tr key={s.shift_head_pk ?? s.shift} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 text-sm font-bold text-indigo-700">{s.shift}</td>
                <td className="px-4 py-2.5 text-sm text-gray-700">{fmt(s.shift_desc)}</td>
                <td className="px-4 py-2.5 text-sm text-gray-600">{fmt(s.time_from)}</td>
                <td className="px-4 py-2.5 text-sm text-gray-600">{fmt(s.time_to)}</td>
                <td className="px-4 py-2.5 text-sm text-gray-600">{fmt(s.overtime_start_time)}</td>
                <td className="px-4 py-2.5 text-sm text-gray-600">{fmt(s.allow_in_time)}</td>
                <td className="px-4 py-2.5 text-sm text-gray-600">{fmt(s.duty_hrs)}</td>
                <td className="px-4 py-2.5 text-sm text-gray-600">{fmt(s.day_name)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button
                    onClick={() => setModal({ editing: s })}
                    className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium mr-3"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => handleDelete(s)}
                    disabled={deleting === s.shift_head_pk}
                    className="text-red-500 hover:text-red-700 disabled:opacity-40"
                    title="Remove"
                  >
                    {deleting === s.shift_head_pk ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <ShiftModal
          adminCardNo={adminCardNo}
          compc={compc}
          brnch={brnch}
          lov={lov}
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onRefresh(); }}
        />
      )}
    </div>
  );
}
