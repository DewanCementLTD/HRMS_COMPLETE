"use client";

import { CalendarRange, Lock, Unlock } from "lucide-react";
import type { EntryPeriod } from "@/services/payrollEntryService";

/**
 * Period picker shared by the Monthly Inputs screens (allowances, deductions,
 * absent days).
 *
 * Lists the company's open period and the earlier months of the same financial
 * year. Only the open period accepts changes — earlier ones are read-only, and
 * the panels disable their save/delete controls accordingly. That mirrors the
 * server, where writes resolve the period with an open-only lookup.
 */
export function EntryPeriodSelect({
  periods, period, onChange, disabled = false,
}: {
  periods: EntryPeriod[];
  period: number | null;
  onChange: (p: number) => void;
  disabled?: boolean;
}) {
  const selected = periods.find((p) => p.period === period) ?? null;

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500">
        <CalendarRange className="h-3.5 w-3.5 text-indigo-600" /> Period
      </span>
      <select
        value={period ?? ""}
        disabled={disabled || periods.length === 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white font-medium focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-50 disabled:text-gray-400"
      >
        {periods.length === 0 && <option value="">No periods</option>}
        {periods.map((p) => (
          <option key={p.period} value={p.period}>
            {p.label}{p.is_open ? " — Open" : ""}
          </option>
        ))}
      </select>
      {selected && (
        selected.is_open ? (
          <span className="inline-flex items-center gap-1 text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2 py-0.5">
            <Unlock className="h-3 w-3" /> Open
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-600 border border-gray-200 rounded-full px-2 py-0.5">
            <Lock className="h-3 w-3" /> Closed — read only
          </span>
        )
      )}
    </div>
  );
}

/** Banner shown above the entry form when a closed period is being viewed. */
export function ClosedPeriodNotice({
  selected, openLabel, noun,
}: { selected: EntryPeriod | null; openLabel?: string; noun: string }) {
  if (!selected || selected.is_open) return null;
  return (
    <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600 mb-3">
      <span className="font-semibold">{selected.label} is closed.</span> You can review its {noun}{" "}
      but not change them
      {openLabel ? <> — switch to <span className="font-semibold">{openLabel}</span> to make entries</> : null}.
    </div>
  );
}
