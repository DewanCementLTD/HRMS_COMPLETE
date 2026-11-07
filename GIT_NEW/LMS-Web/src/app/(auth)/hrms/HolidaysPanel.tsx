"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, Save, Pencil, Trash2, X, CalendarHeart } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import {
  fetchHolidays,
  fetchHolidayBranches,
  saveHoliday,
  deleteHoliday,
  type Holiday,
  type HolidayBranchOption,
} from "@/services/holidayService";

/**
 * Public holidays for chosen branches of the selected company.
 *
 * Saving marks those days as Holiday on the duty roster of every employee in
 * the ticked branches — no absence, no late, no leave charged — and shows the
 * reason in attendance. Deleting gives the days back as normal days. Approved
 * leave is never touched. Days the roster has not generated yet are marked
 * automatically once it does.
 *
 * With an active branch selected in the main settings, the tab works on that
 * branch only: it is the only branch offered, only its holidays are listed,
 * and removing a holiday other branches share takes just this branch off it.
 */

const EMPTY = { from: "", to: "", reason: "", branches: [] as string[] };

const dayLabel = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
};

const rangeLabel = (h: Holiday) =>
  h.holiday_from === h.holiday_to
    ? dayLabel(h.holiday_from)
    : `${dayLabel(h.holiday_from)} → ${dayLabel(h.holiday_to)}`;

const todayYmd = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function HolidaysPanel({
  adminCardNo,
  compc,
  brnch,
}: {
  adminCardNo: string;
  compc?: string;
  brnch?: string;
}) {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [branches, setBranches] = useState<HolidayBranchOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, b] = await Promise.all([
        fetchHolidays(adminCardNo, { compc, brnch }),
        fetchHolidayBranches(adminCardNo, { compc, brnch }),
      ]);
      setHolidays(h.items || []);
      setBranches(b.items || []);
      // One branch in scope: it is the only choice, so tick it up front.
      if (brnch && (b.items || []).length === 1) {
        setForm((f) => (f.branches.length ? f : { ...f, branches: [b.items[0].brnch] }));
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not load holidays" });
    } finally {
      setLoading(false);
    }
  }, [adminCardNo, compc, brnch]);

  useEffect(() => {
    setForm(EMPTY);
    setEditingId(null);
    load();
  }, [load]);

  const toggleBranch = (b: string) =>
    setForm((f) => ({
      ...f,
      branches: f.branches.includes(b) ? f.branches.filter((x) => x !== b) : [...f.branches, b],
    }));

  const allPicked = branches.length > 0 && branches.every((b) => form.branches.includes(b.brnch));
  const pickedEmployees = useMemo(
    () => branches.filter((b) => form.branches.includes(b.brnch)).reduce((s, b) => s + b.employees, 0),
    [branches, form.branches],
  );

  const upcoming = holidays.filter((h) => h.holiday_to >= todayYmd());
  const past = holidays.filter((h) => h.holiday_to < todayYmd());

  function startEdit(h: Holiday) {
    setEditingId(h.holiday_id);
    setForm({
      from: h.holiday_from,
      to: h.holiday_to === h.holiday_from ? "" : h.holiday_to,
      reason: h.reason,
      // Only branches this admin can see; the server keeps the others.
      branches: h.branches.map((b) => b.brnch).filter((b) => branches.some((x) => x.brnch === b)),
    });
    setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // A fresh form: in branch scope the one branch stays ticked.
  const emptyForm = () =>
    brnch && branches.length === 1 ? { ...EMPTY, branches: [branches[0].brnch] } : EMPTY;

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm());
  }

  async function onSave() {
    if (!form.from) { setMsg({ kind: "err", text: "Pick the holiday date" }); return; }
    if (form.to && form.to < form.from) { setMsg({ kind: "err", text: '"To" cannot be before "From"' }); return; }
    if (!form.reason.trim()) { setMsg({ kind: "err", text: 'Enter a reason, e.g. "Iqbal Day"' }); return; }
    if (!form.branches.length) { setMsg({ kind: "err", text: "Tick at least one branch" }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const res = await saveHoliday(
        adminCardNo,
        { compc, brnch },
        {
          holiday_from: form.from,
          holiday_to: form.to || form.from,
          reason: form.reason.trim(),
          branches: form.branches,
        },
        editingId ?? undefined,
      );
      setMsg({ kind: "ok", text: res.message });
      setEditingId(null);
      setForm(emptyForm());
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not save the holiday" });
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(h: Holiday) {
    const shared = !!brnch && h.branches.some((b) => b.brnch !== brnch);
    const question = shared
      ? `Remove your branch from "${h.reason}" (${rangeLabel(h)})? Its days become normal working days again; the other branches keep the holiday.`
      : `Remove "${h.reason}" (${rangeLabel(h)})? Those days become normal working days again.`;
    if (!confirm(question)) return;
    setDeletingId(h.holiday_id);
    setMsg(null);
    try {
      const res = await deleteHoliday(adminCardNo, { compc, brnch }, h.holiday_id);
      setMsg({ kind: "ok", text: res.message });
      if (editingId === h.holiday_id) cancelEdit();
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not remove the holiday" });
    } finally {
      setDeletingId(null);
    }
  }

  if (loading && !holidays.length && !branches.length) return <Spinner />;

  const table = (rows: Holiday[], muted = false) => (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Reason</th>
            <th className="px-3 py-2 text-left">Branches</th>
            <th className="px-3 py-2 text-right">Roster days</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((h) => (
            <tr key={h.holiday_id} className={`${muted ? "text-gray-500" : ""} ${editingId === h.holiday_id ? "bg-indigo-50/60" : "hover:bg-gray-50"}`}>
              <td className="px-3 py-2 whitespace-nowrap font-medium">{rangeLabel(h)}</td>
              <td className="px-3 py-2">{h.reason}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {h.branches.map((b) => (
                    <span key={b.brnch} className="px-2 py-0.5 rounded-full bg-sky-50 border border-sky-200 text-xs text-sky-800">
                      {b.name}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{h.roster_days}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <button onClick={() => startEdit(h)} className="p-1.5 rounded-lg text-gray-500 hover:text-indigo-700 hover:bg-indigo-50" title="Edit">
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onDelete(h)}
                  disabled={deletingId === h.holiday_id}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                  title="Remove"
                >
                  {deletingId === h.holiday_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── Add / edit ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
              <CalendarHeart className="h-4 w-4 text-indigo-600" />
              {editingId ? "Edit holiday" : "Add a holiday"}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Marks the day(s) as <b>Holiday</b> for every employee of the ticked branches: no absence
              or late is counted and no leave is charged. Approved leave is left as it is. Other
              branches keep working as normal.
            </p>
          </div>
          {editingId && (
            <button onClick={cancelEdit} className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1 shrink-0">
              <X className="h-3.5 w-3.5" /> Cancel edit
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Date *</label>
            <input
              type="date"
              value={form.from}
              onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">
              To <span className="text-gray-400 font-normal">(only for more than one day)</span>
            </label>
            <input
              type="date"
              value={form.to}
              min={form.from || undefined}
              onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Reason *</label>
            <input
              type="text"
              maxLength={100}
              value={form.reason}
              placeholder="e.g. Iqbal Day"
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-700">
              {brnch ? "Branch" : "Branches *"}
            </label>
            {!brnch && branches.length > 1 && (
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, branches: allPicked ? [] : branches.map((b) => b.brnch) }))}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
              >
                {allPicked ? "Clear all" : "Select all"}
              </button>
            )}
          </div>
          {brnch && (
            <p className="text-xs text-gray-500">
              Your active branch is selected in the main settings, so holidays here apply to this branch
              only. Clear the active branch to give a holiday to several branches at once.
            </p>
          )}
          {branches.length === 0 ? (
            <p className="text-xs text-amber-600">
              {brnch ? "The active branch is not one you can manage here." : "No branches found for this company."}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {branches.map((b) => {
                const on = form.branches.includes(b.brnch);
                return (
                  <label
                    key={b.brnch}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-sm transition ${
                      on ? "bg-indigo-50 border-indigo-300 text-indigo-900" : "bg-white border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleBranch(b.brnch)}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                    />
                    <span className="flex-1 truncate">{b.name || `Branch ${b.brnch}`}</span>
                    <span className="text-xs text-gray-400 shrink-0">{b.employees} emp</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {editingId ? "Save changes" : "Save holiday"}
          </Button>
          {form.branches.length > 0 && (
            <span className="text-xs text-gray-500">
              {form.branches.length} branch{form.branches.length === 1 ? "" : "es"} · {pickedEmployees} active employee
              {pickedEmployees === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {msg && (
          <p className={`text-sm ${msg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>
        )}
      </div>

      {/* ── List ───────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="text-sm font-bold text-gray-900">Upcoming &amp; current</h3>
        {upcoming.length ? table(upcoming) : (
          <p className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-xl">
            No upcoming holidays.
          </p>
        )}
      </div>
      {past.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-gray-500">Past</h3>
          {table(past, true)}
        </div>
      )}
    </div>
  );
}
