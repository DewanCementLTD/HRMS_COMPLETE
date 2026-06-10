"use client";

import { useState } from "react";
import { Plus, X, Check, Loader2 } from "lucide-react";

interface Option {
  value: string;
  label: string;
}

interface DynamicSelectProps {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  onAdd?: (input: string, extra?: string) => Promise<{ value: string; label: string }>;
  addLabel?: string;
  addPlaceholder?: string;
  addExtraPlaceholder?: string; // for a second field (e.g. grade_cd when adding designation)
  addExtraLabel?: string;
  required?: boolean;
  disabled?: boolean;
}

export function DynamicSelect({
  label,
  value,
  options,
  onChange,
  onAdd,
  addLabel = "Add new",
  addPlaceholder = "Enter name...",
  addExtraPlaceholder,
  addExtraLabel,
  required,
  disabled,
}: DynamicSelectProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [extraVal, setExtraVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!inputVal.trim()) return;
    if (addExtraPlaceholder && !extraVal.trim()) { setError(`${addExtraLabel || "Extra field"} is required`); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await onAdd!(inputVal.trim(), extraVal.trim() || undefined);
      onChange(created.value);
      setShowAdd(false);
      setInputVal("");
      setExtraVal("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="block text-sm font-medium text-gray-700">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      <div className="flex gap-1.5">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="flex-1 block border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-50 disabled:text-gray-400"
        >
          <option value="">— Select —</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {onAdd && !disabled && (
          <button
            type="button"
            onClick={() => { setShowAdd(!showAdd); setError(null); }}
            title={addLabel}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-dashed border-indigo-300 text-indigo-500 hover:bg-indigo-50 transition-colors shrink-0"
          >
            {showAdd ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>
        )}
      </div>

      {showAdd && (
        <div className="mt-1 p-3 bg-indigo-50 border border-indigo-100 rounded-lg space-y-2">
          {addExtraPlaceholder && (
            <input
              type="text"
              value={extraVal}
              onChange={(e) => setExtraVal(e.target.value)}
              placeholder={addExtraPlaceholder}
              className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          )}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder={addPlaceholder}
              className="flex-1 border border-gray-300 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving || !inputVal.trim()}
              className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save
            </button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}
