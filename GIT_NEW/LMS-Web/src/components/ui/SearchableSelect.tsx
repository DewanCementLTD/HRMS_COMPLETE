"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SSOption { value: string | number; label: string }

/** A type-ahead combobox: shows the selected label, click/focus to open a
 * filterable list. Drop-in for places that used a plain <Select>. */
export function SearchableSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  allowClear = true,
  className,
}: {
  label?: string;
  value?: string | number;
  onChange: (value: string) => void;
  options: SSOption[];
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => String(o.value) === String(value ?? ""));

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(""); }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const opts = options.filter((o) => String(o.value) !== "");   // drop a blank "Select" option; placeholder handles it
    if (!query.trim()) return opts;
    const q = query.toLowerCase();
    return opts.filter((o) => o.label.toLowerCase().includes(q) || String(o.value).toLowerCase().includes(q));
  }, [options, query]);

  function pick(v: string) { onChange(v); setOpen(false); setQuery(""); }

  return (
    <div className={cn("space-y-1.5", className)} ref={ref}>
      {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={open ? query : (selected?.label ?? "")}
          placeholder={placeholder}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => { if (!disabled) { setOpen(true); setQuery(""); } }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); if (open && filtered[active]) pick(String(filtered[active].value)); }
            else if (e.key === "Escape") { setOpen(false); setQuery(""); }
          }}
          className={cn(
            "w-full px-4 py-2.5 pr-9 rounded-xl border border-gray-300 bg-white text-gray-900",
            "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all",
            disabled && "bg-gray-50 text-gray-400 cursor-not-allowed",
          )}
        />
        {allowClear && selected && !disabled ? (
          <button type="button" tabIndex={-1} onClick={() => { onChange(""); setQuery(""); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        ) : (
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        )}

        {open && !disabled && (
          <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto bg-white border border-gray-200 rounded-xl shadow-lg">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">No matches</div>
            ) : filtered.map((o, i) => (
              <button
                key={String(o.value)}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(String(o.value))}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors",
                  i === active ? "bg-indigo-50 text-indigo-700" : "hover:bg-gray-50",
                  String(o.value) === String(value ?? "") && "font-semibold",
                )}
              >
                <span className="truncate">{o.label}</span>
                {String(o.value) === String(value ?? "") && <Check className="h-4 w-4 shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
