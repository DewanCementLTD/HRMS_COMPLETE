"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// Lists longer than this get a filter box at the top.
const SEARCH_AFTER = 6;

/** Company / branch picker. `pill` is the top-bar chip, `block` the
 * full-width row used inside the mobile user menu. */
export function SwitcherDropdown<T extends { code: string; name: string }>({
  items,
  selected,
  onSelect,
  icon: Icon,
  caption,
  variant = "pill",
  allowAll = false,
  allLabel = "All",
}: {
  items: T[];
  selected: T | null;
  onSelect: (item: T) => void;
  icon: React.ElementType;
  caption: string;
  variant?: "pill" | "block";
  allowAll?: boolean;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  // Prepend a synthetic "All" entry (empty code = no filter) when allowed.
  const displayItems: T[] = allowAll
    ? ([{ code: "", name: allLabel } as T, ...items])
    : items;
  const canOpen = displayItems.length > 1;
  const q = query.trim().toLowerCase();
  const shown = q ? displayItems.filter((i) => i.name.toLowerCase().includes(q)) : displayItems;
  // Codes can arrive as numbers from older sessions — compare as strings.
  const selectedCode = selected ? String(selected.code) : allowAll ? "" : null;
  const selectedName = selected?.name ?? (allowAll ? allLabel : "—");

  return (
    <div ref={ref} className={cn("relative min-w-0", variant === "block" && "w-full")}>
      <button
        type="button"
        onClick={() => { if (canOpen) { setOpen(!open); setQuery(""); } }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2.5 text-left transition-colors min-w-0",
          variant === "pill"
            ? "h-11 pl-2 pr-3 rounded-xl border border-line bg-white max-w-[260px] shadow-sm"
            : "w-full px-2 py-2 rounded-xl border border-line bg-slate-50",
          canOpen ? "hover:border-brand/40 hover:bg-brand-soft/40 cursor-pointer" : "cursor-default",
          open && "border-brand/50 ring-2 ring-brand/15"
        )}
        title={selectedName}
      >
        <span className="h-7 w-7 rounded-lg bg-brand-soft flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-brand" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[10px] uppercase tracking-wider text-slate-400">{caption}</span>
          <span className="block text-[13px] text-ink font-semibold truncate">{selectedName}</span>
        </span>
        {canOpen && (
          <ChevronDown className={cn("h-4 w-4 text-slate-400 shrink-0 transition-transform", open && "rotate-180")} />
        )}
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute left-0 top-full mt-2 bg-white border border-line rounded-2xl shadow-xl z-[60] overflow-hidden",
            variant === "pill" ? "min-w-full w-72" : "w-full"
          )}
        >
          {displayItems.length > SEARCH_AFTER && (
            <div className="p-2 border-b border-line">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-50">
                <Search className="h-3.5 w-3.5 text-slate-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${caption.toLowerCase()}…`}
                  className="flex-1 bg-transparent text-xs outline-none text-slate-700 placeholder:text-slate-400"
                />
              </div>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto p-1.5">
            {shown.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No match</p>}
            {shown.map((item) => {
              const active = String(item.code) === selectedCode;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  key={item.code}
                  onClick={() => { onSelect(item); setOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-[13px] transition-colors",
                    active ? "bg-brand-soft text-brand font-semibold" : "text-slate-600 hover:bg-slate-50 hover:text-ink"
                  )}
                >
                  <span className="flex-1 truncate">{item.name}</span>
                  {active && <Check className="h-4 w-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
