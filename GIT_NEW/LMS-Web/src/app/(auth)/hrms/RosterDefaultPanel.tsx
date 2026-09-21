"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, CalendarRange, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import {
  fetchRosterDefaults,
  saveRosterDefault,
  applyRosterDefaults,
  type RosterDefault,
} from "@/services/hrmsService";
import { fetchShiftLov, type ShiftLov } from "@/services/referenceService";

/**
 * What a branch runs, and applying it.
 *
 * Two separate things, deliberately shown together because they answer the same
 * question at different times:
 *
 *   Default   — the shift newly generated roster days get. Rosters are built 60
 *               days ahead, so on its own this takes up to two months to become
 *               visible.
 *   Apply now — rewrites an existing date range to that shift, which is what HR
 *               actually wants when a site changes what it runs.
 *
 * Neither ever touches a public holiday, a day of approved leave, or a day
 * somebody edited by hand.
 */

const WEEKDAYS = [
  { iso: 1, label: "Mon" }, { iso: 2, label: "Tue" }, { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" }, { iso: 5, label: "Fri" }, { iso: 6, label: "Sat" },
  { iso: 7, label: "Sun" },
];

export function RosterDefaultPanel({
  adminCardNo,
  compc,
  brnch,
}: {
  adminCardNo: string;
  compc?: string;
  brnch?: string;
}) {
  const [current, setCurrent] = useState<RosterDefault | null>(null);
  const [lov, setLov] = useState<ShiftLov[]>([]);
  const [shift, setShift] = useState("");
  const [restDays, setRestDays] = useState<number[]>([7]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [range, setRange] = useState({ from: "", to: "" });
  const [applying, setApplying] = useState(false);

  const scoped = Boolean(compc && brnch);

  const load = useCallback(async () => {
    if (!scoped) return;
    setLoading(true);
    setMsg(null);
    try {
      const [defaults, shifts] = await Promise.all([
        fetchRosterDefaults(adminCardNo, { compc, brnch }),
        fetchShiftLov(compc, brnch),
      ]);
      // The rest day is offered separately, so it is not a "working shift".
      setLov((shifts.items || []).filter((s) => s.shift !== "R"));
      const found = (defaults.items || [])[0] || null;
      setCurrent(found);
      setShift(found?.default_shift || "");
      setRestDays(found?.rest_days?.length ? found.rest_days : [7]);
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not load the branch default" });
    } finally {
      setLoading(false);
    }
  }, [adminCardNo, compc, brnch, scoped]);

  useEffect(() => { load(); }, [load]);

  const toggleRest = (iso: number) =>
    setRestDays((d) => (d.includes(iso) ? d.filter((x) => x !== iso) : [...d, iso].sort((a, b) => a - b)));

  async function onSave() {
    if (!shift) { setMsg({ kind: "err", text: "Pick the shift this branch runs" }); return; }
    if (!restDays.length) { setMsg({ kind: "err", text: "Pick at least one rest day" }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const res = await saveRosterDefault(adminCardNo, {
        compc: compc!, brnch: brnch!, default_shift: shift, rest_days: restDays,
      });
      setMsg({ kind: "ok", text: res.message || "Default saved" });
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  async function onApply() {
    if (!range.from || !range.to) { setMsg({ kind: "err", text: "Pick both dates" }); return; }
    if (range.from > range.to) { setMsg({ kind: "err", text: "The 'from' date must not be after the 'to' date" }); return; }
    if (!shift) { setMsg({ kind: "err", text: "Pick the shift to apply" }); return; }
    setApplying(true);
    setMsg(null);
    try {
      const res = await applyRosterDefaults(adminCardNo, {
        compc: compc!, brnch: brnch!,
        from_date: range.from, to_date: range.to,
        shift, rest_days: restDays,
      });
      setMsg({ kind: "ok", text: res.message || "Roster updated" });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not update the roster" });
    } finally {
      setApplying(false);
    }
  }

  if (!scoped) {
    return (
      <p className="text-sm text-gray-500">
        Choose a company and a branch above to set what it runs.
      </p>
    );
  }
  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900">What this branch runs</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Applies to roster days generated from now on. Every branch was previously
            fixed to General with Sunday off, whatever it actually ran.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Default shift</label>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">Select shift…</option>
              {lov.map((l) => (
                <option key={l.shift} value={l.shift}>{l.shift} — {l.descr}</option>
              ))}
            </select>
            {lov.length === 0 && (
              <p className="text-xs text-amber-600">
                No shifts are configured for this branch — add them under Shifts first.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Weekly rest days</label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.iso}
                  type="button"
                  onClick={() => toggleRest(d.iso)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    restDays.includes(d.iso)
                      ? "bg-sky-100 border-sky-300 text-sky-800"
                      : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save default
          </Button>
          {current && (
            <span className="text-xs text-gray-500">
              Currently {current.default_shift}
              {current.shift_desc ? ` — ${current.shift_desc}` : ""}, resting{" "}
              {current.rest_days.map((i) => WEEKDAYS.find((w) => w.iso === i)?.label).join(", ")}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-gray-900">Apply to existing dates</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Rosters are built 60 days ahead, so the default above only reaches days
            generated later. Use this to change a range that already exists — for every
            employee in the branch at once. Rest days, public holidays, approved leave and
            days edited by hand are left untouched.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">From</label>
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">To</label>
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={onApply} disabled={applying} className="w-full">
              {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}
              Apply to range
            </Button>
          </div>
        </div>
      </div>

      {msg && (
        <p className={`text-sm ${msg.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
