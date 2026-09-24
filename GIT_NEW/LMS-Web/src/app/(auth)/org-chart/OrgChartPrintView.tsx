"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Printer, X } from "lucide-react";
import { CompanyLogo } from "@/components/ui/CompanyLogo";
import { OrgChartTree, type TreeRenderProps } from "./OrgChartTree";
import { allNodeIds, type OrgTreeNode } from "./buildOrgTree";
import { ScaledContent, type Size } from "./ScaledContent";

type Paper = "A4" | "A3";
type Orientation = "auto" | "landscape" | "portrait";
type Scope = "screen" | "all";

const PAPER_MM: Record<Paper, { long: number; short: number }> = {
  A4: { long: 297, short: 210 },
  A3: { long: 420, short: 297 },
};
const MARGIN_MM = 8;
const PX_PER_MM = 96 / 25.4;
const HEADER_H = 64;
// Sheet is kept a few px under the printable area so rounding can never
// push a sliver of it onto a second page.
const SAFETY_PX = 6;
// Layouts tried for the print: column height for stacked teams × the depth at
// which subtrees switch to the compact (listed-downward) layout.
const LAYOUTS: { rows: number; compact?: number }[] = [4, 8, 16].flatMap((rows) =>
  [undefined, 2, 1].map((compact) => ({ rows, compact }))
);
const layoutKey = (l: { rows: number; compact?: number }) => `${l.rows}/${l.compact ?? "-"}`;

const stamp = () => {
  const t = new Date();
  return `${t.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}, ` +
    t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

const Seg = <T extends string>({ value, options, onChange }: {
  value: T; options: { v: T; label: string }[]; onChange: (v: T) => void;
}) => (
  <div className="flex rounded-lg bg-gray-100 p-0.5">
    {options.map((o) => (
      <button
        key={o.v}
        type="button"
        onClick={() => onChange(o.v)}
        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
          value === o.v ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500 hover:text-gray-800"
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export function OrgChartPrintView({
  roots, companyName, compc, subtitle, total, filterCaption, onClose, ...tree
}: {
  roots: OrgTreeNode[];
  companyName: string;
  compc?: string;
  subtitle?: string;
  total: number;
  filterCaption?: string;
  onClose: () => void;
} & Omit<TreeRenderProps, "interactive" | "onToggleExpand" | "onToggleGroup">) {
  const [paper, setPaper] = useState<Paper>("A4");
  const [orientation, setOrientation] = useState<Orientation>("auto");
  const [scope, setScope] = useState<Scope>("screen");
  const [measures, setMeasures] = useState<Record<string, Size>>({});
  const [busy, setBusy] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  const allIds = useMemo(() => allNodeIds(roots), [roots]);
  const expanded = scope === "all" ? allIds : tree.expanded;
  const collapsedGroups = useMemo(
    () => (scope === "all" ? new Set<string>() : tree.collapsedGroups),
    [scope, tree.collapsedGroups]
  );

  // Hidden copies of the chart are laid out with different column heights for
  // stacked teams; whichever prints largest on the chosen paper wins.
  const measureCbs = useMemo(
    () => Object.fromEntries(LAYOUTS.map((l) => [layoutKey(l), (sz: Size) => {
      if (!sz.w || !sz.h) return;
      setMeasures((m) => {
        const k = `${scope}:${layoutKey(l)}`;
        return m[k]?.w === sz.w && m[k]?.h === sz.h ? m : { ...m, [k]: sz };
      });
    }])) as Record<string, (s: Size) => void>,
    [scope]
  );

  const mm = PAPER_MM[paper];
  const pageDims = (o: "landscape" | "portrait") => {
    const w = Math.floor(((o === "landscape" ? mm.long : mm.short) - 2 * MARGIN_MM) * PX_PER_MM) - SAFETY_PX;
    const h = Math.floor(((o === "landscape" ? mm.short : mm.long) - 2 * MARGIN_MM) * PX_PER_MM) - SAFETY_PX;
    return { w, h, areaH: h - HEADER_H };
  };
  const fit = (sz: Size, o: "landscape" | "portrait") => {
    const d = pageDims(o);
    return Math.min(1, d.w / sz.w, d.areaH / sz.h);
  };

  const orientChoices: ("landscape" | "portrait")[] = orientation === "auto" ? ["landscape", "portrait"] : [orientation];
  let best: { layout: (typeof LAYOUTS)[number]; orient: "landscape" | "portrait"; scale: number } =
    { layout: LAYOUTS[0], orient: orientChoices[0], scale: 0 };
  for (const l of LAYOUTS) {
    const sz = measures[`${scope}:${layoutKey(l)}`];
    if (!sz) continue;
    for (const o of orientChoices) {
      // Prefer the classic layout unless compact is clearly (>8%) bigger.
      const sc = fit(sz, o) * (l.compact === undefined ? 1.08 : 1);
      if (sc > best.scale + 0.001) best = { layout: l, orient: o, scale: sc };
    }
  }
  // The visible sheet renders the same layout as the winning hidden copy, so
  // its measured size is used directly; printing waits until every copy is in.
  const measured = LAYOUTS.every((l) => measures[`${scope}:${layoutKey(l)}`]);
  const orient = best.orient;
  const { w: pageW, h: pageH } = pageDims(orient);
  const bestSize = measures[`${scope}:${layoutKey(best.layout)}`];
  const scale = bestSize ? fit(bestSize, orient) : 1;
  const tooSmall = measured && scale < 0.4;

  async function doPrint() {
    setBusy(true);
    // Wait for photos so the printout doesn't show initials for late images.
    const imgs = Array.from(sheetRef.current?.querySelectorAll("img") ?? []);
    await Promise.race([
      Promise.all(imgs.map((i) => (i.complete ? null : i.decode().catch(() => null)))),
      new Promise((r) => setTimeout(r, 6000)),
    ]);
    setBusy(false);
    window.print();
  }

  const sheet = (
    <div className="org-chart-print-modal fixed inset-0 z-[1000] bg-slate-900/80 overflow-auto">
      <div className="ocp-toolbar sticky top-0 z-10 flex flex-wrap items-center gap-3 px-4 py-3 bg-white shadow">
        <Printer className="h-5 w-5 text-indigo-600" />
        <span className="font-semibold text-gray-900">Print Organogram</span>
        <Seg value={scope} onChange={setScope} options={[{ v: "screen", label: "As on screen" }, { v: "all", label: "Entire chart" }]} />
        <Seg value={paper} onChange={setPaper} options={[{ v: "A4", label: "A4" }, { v: "A3", label: "A3" }]} />
        <Seg
          value={orientation}
          onChange={setOrientation}
          options={[{ v: "auto", label: "Auto" }, { v: "landscape", label: "Landscape" }, { v: "portrait", label: "Portrait" }]}
        />
        <span className="text-xs text-gray-500">{measured ? `Fits on 1 page · ${orient} · ${Math.round(scale * 100)}%` : "Laying out…"}</span>
        {tooSmall && (
          <span className="flex items-center gap-1 text-xs text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            Small text: try A3, collapse some teams, or filter by department
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={doPrint}
            disabled={busy || !measured}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
          >
            <Printer className="h-4 w-4" /> {busy ? "Loading photos…" : "Print"}
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200"
          >
            <X className="h-4 w-4" /> Close
          </button>
        </div>
      </div>

      <div className="ocp-stage flex justify-center p-8">
        {/* The sheet is exactly one printable page: nothing inside can overflow it. */}
        <div
          ref={sheetRef}
          className="ocp-page bg-white shadow-2xl overflow-hidden flex flex-col shrink-0"
          style={{ width: pageW, height: pageH, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
        >
          <div className="flex items-center gap-3 border-b-2 border-indigo-600 px-4 shrink-0" style={{ height: HEADER_H }}>
            <CompanyLogo compc={compc} className="h-10 max-w-[90px]" />
            <div className="min-w-0">
              <div className="text-lg font-bold text-indigo-900 leading-tight truncate">{companyName}</div>
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Organizational Chart{subtitle ? ` · ${subtitle}` : ""}{filterCaption ? ` · ${filterCaption}` : ""}
              </div>
            </div>
            <div className="ml-auto text-right text-[10px] text-gray-400 leading-snug">
              <div>{total} employees</div>
              <div>Printed {stamp()}</div>
            </div>
          </div>
          <div className="flex-1 flex justify-center items-start overflow-hidden">
            <ScaledContent scale={scale}>
              <OrgChartTree
                roots={roots}
                companyName={companyName}
                compc={compc}
                subtitle={subtitle}
                total={total}
                {...tree}
                expanded={expanded}
                collapsedGroups={collapsedGroups}
                onToggleExpand={() => {}}
                onToggleGroup={() => {}}
                interactive={false}
                maxRows={best.layout.rows}
                compactFrom={best.layout.compact}
              />
            </ScaledContent>
          </div>
        </div>
      </div>

      <div className="ocp-measure" aria-hidden style={{ position: "fixed", left: -100000, top: 0, visibility: "hidden", pointerEvents: "none" }}>
        {LAYOUTS.map((l) => (
          <ScaledContent key={`${scope}:${layoutKey(l)}`} scale={1} onMeasure={measureCbs[layoutKey(l)]}>
            <OrgChartTree
              roots={roots}
              companyName={companyName}
              compc={compc}
              subtitle={subtitle}
              total={total}
              {...tree}
              expanded={expanded}
              collapsedGroups={collapsedGroups}
              onToggleExpand={() => {}}
              onToggleGroup={() => {}}
              interactive={false}
              maxRows={l.rows}
              compactFrom={l.compact}
            />
          </ScaledContent>
        ))}
      </div>

      <style>{`
        @media print {
          @page { size: ${paper} ${orient}; margin: ${MARGIN_MM}mm; }
          html, body {
            margin: 0 !important; padding: 0 !important; background: #fff !important;
            height: auto !important; min-height: 0 !important; overflow: visible !important;
          }
          body > *:not(.org-chart-print-modal) { display: none !important; }
          .org-chart-print-modal {
            position: static !important; inset: auto !important; background: none !important;
            overflow: visible !important; padding: 0 !important;
          }
          .ocp-toolbar, .ocp-measure { display: none !important; }
          .ocp-stage { display: block !important; padding: 0 !important; margin: 0 !important; }
          .ocp-page {
            box-shadow: none !important; margin: 0 !important;
            break-inside: avoid; page-break-inside: avoid; break-after: avoid; page-break-after: avoid;
          }
          .ocp-page * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </div>
  );

  return createPortal(sheet, document.body);
}
