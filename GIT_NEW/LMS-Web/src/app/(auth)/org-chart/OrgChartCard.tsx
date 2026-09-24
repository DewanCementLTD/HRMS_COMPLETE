"use client";

import { Building2, ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";
import { CompanyLogo } from "@/components/ui/CompanyLogo";
import { EmployeeAvatar } from "../hrms/EmployeeAvatar";
import type { OrgTreeNode } from "./buildOrgTree";
import type { DeptColor } from "./deptColors";

// One colour per hierarchy level, like the reference chart (head → managers → staff).
const LEVEL_COLORS = ["#b83280", "#f28c28", "#7cb342", "#0891b2", "#6d4ed8"];
export const levelColor = (depth: number) => LEVEL_COLORS[depth % LEVEL_COLORS.length];

export const CARD_W = 264;
const CARD_H = 96;

const EXACT = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as const;

export function EmployeeCard({
  node, depth, photoUrl, deptColor, dimmed, isExpanded, onToggle,
}: {
  node: OrgTreeNode;
  depth: number;
  photoUrl: string | null;
  deptColor: DeptColor | null;
  dimmed?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
}) {
  const c = levelColor(depth);
  const reports = node.children.length;

  return (
    <div
      className={`relative inline-block text-left align-top transition-opacity ${dimmed ? "opacity-30 grayscale" : ""}`}
      style={{ width: CARD_W, height: CARD_H, ...EXACT }}
    >
      <div className="absolute top-2 bottom-2 left-10 right-0 rounded-l-md rounded-r-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="h-[26px] flex items-center pl-12 pr-9 text-white" style={{ background: c }}>
          <span className="truncate text-[12px] font-bold uppercase tracking-wide" title={node.name}>
            {node.name || "—"}
          </span>
        </div>
        <div className="pl-12 pr-3 pt-1.5 leading-tight">
          <div className="truncate text-[10.5px] font-bold uppercase tracking-wide" style={{ color: c }} title={node.designation ?? ""}>
            {node.designation || "—"}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-gray-500 min-w-0">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: deptColor?.dot ?? "#cbd5e1" }} />
            <span className="truncate" title={node.department ?? ""}>{node.department || "No department"}</span>
          </div>
          <div className="mt-0.5 text-[9.5px] font-mono text-gray-400">{node.empcode}</div>
        </div>
      </div>

      {reports > 0 && (
        <span
          className="absolute right-1.5 top-[11px] h-5 min-w-5 px-1 rounded-full bg-white text-[10px] font-bold flex items-center justify-center"
          style={{ color: c }}
          title={`${reports} direct report${reports > 1 ? "s" : ""}`}
        >
          {reports}
        </span>
      )}

      <div
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-20 w-20 rounded-full bg-white p-[3px] shadow-md"
        style={{ border: `4px solid ${c}` }}
      >
        <div className="h-full w-full rounded-full overflow-hidden bg-gray-100">
          <EmployeeAvatar empcode={node.empcode} photoUrl={photoUrl ?? undefined} name={node.name} textClass="text-xl" />
        </div>
      </div>

      {onToggle && reports > 0 && (
        <button
          type="button"
          onClick={onToggle}
          className="absolute left-1/2 -translate-x-1/2 -bottom-1 z-20 h-5 w-5 rounded-full border-2 border-white shadow flex items-center justify-center text-white hover:scale-110 transition-transform"
          style={{ background: c }}
          title={isExpanded ? "Collapse team" : `Show team (${reports})`}
        >
          {isExpanded ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}

/** Top node of the chart: company (and branch) with logo. */
export function CompanyRootCard({
  companyName, compc, subtitle, total,
}: {
  companyName: string; compc?: string; subtitle?: string; total: number;
}) {
  return (
    <div
      className="inline-flex items-center gap-3 rounded-2xl bg-gradient-to-r from-slate-800 to-indigo-900 text-white pl-3 pr-6 py-3 shadow-lg text-left"
      style={EXACT}
    >
      <div className="h-12 w-12 rounded-xl bg-white flex items-center justify-center overflow-hidden shrink-0">
        <CompanyLogo compc={compc} className="h-10 w-10" fallback={<Building2 className="h-6 w-6 text-indigo-700" />} />
      </div>
      <div>
        <div className="font-bold text-base leading-tight">{companyName}</div>
        <div className="text-xs text-indigo-200 mt-0.5">
          {subtitle ? `${subtitle} · ` : ""}{total} employee{total === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  );
}

/**
 * A stacked grid of cards. Used for leaf-only teams (keeps a manager with 30
 * reports from producing a 30-card-wide row) and for employees with no
 * reporting line, grouped per department.
 */
export function CardGroup({
  title, color, count, maxRows = 10, collapsed, onToggle, children,
}: {
  title?: string;
  color?: string;
  count: number;
  maxRows?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  const cols = Math.max(1, Math.ceil(count / maxRows));
  return (
    <div className="inline-block text-left align-top" style={EXACT}>
      {title && (
        <button
          type="button"
          onClick={onToggle}
          disabled={!onToggle}
          className="mx-auto mb-2 flex items-center gap-2 rounded-full bg-white border border-gray-200 shadow-sm px-3 py-1 text-xs font-semibold text-gray-700 disabled:cursor-default"
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color ?? "#94a3b8" }} />
          {title}
          <span className="rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-500">{count}</span>
          {onToggle && (collapsed ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronUp className="h-3.5 w-3.5 text-gray-400" />)}
        </button>
      )}
      {!collapsed && (
        <div
          className="grid gap-x-5 gap-y-2 rounded-2xl border border-dashed border-gray-300 bg-white/70 p-3"
          style={{ gridTemplateColumns: `repeat(${cols}, ${CARD_W}px)` }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
