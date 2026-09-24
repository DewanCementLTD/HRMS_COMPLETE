"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Maximize2, Minimize2, Minus, Plus, ScanSearch, Users } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { fetchCompanyOrgChart, fetchBranchOrgChart, type OrgChartNode } from "@/services/orgChartService";
import { employeePhotoUrl, orgChartPhotoUrl } from "@/services/documentService";
import { buildOrgTree, computeInitialExpanded, allNodeIds, matchVisibleSet, type OrgTreeNode } from "./buildOrgTree";
import { buildDeptColorMap } from "./deptColors";
import { OrgChartTree, deptGroupKey } from "./OrgChartTree";
import { OrgChartFilters } from "./OrgChartFilters";
import { OrgChartPrintView } from "./OrgChartPrintView";
import { ScaledContent, type Size } from "./ScaledContent";

const ZOOM_STEPS = [0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 0.85, 1, 1.15, 1.3];

function depthOf(roots: OrgTreeNode[]): number {
  let max = 0;
  const stack: [OrgTreeNode, number][] = roots.map((r) => [r, 1]);
  while (stack.length) {
    const [n, d] = stack.pop()!;
    max = Math.max(max, d);
    for (const c of n.children) stack.push([c, d + 1]);
  }
  return max;
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-white border border-gray-200 px-3 py-1.5 shadow-sm">
      <span className="text-sm font-bold text-gray-900">{value}</span>
      <span className="ml-1.5 text-xs text-gray-500">{label}</span>
    </div>
  );
}

export default function OrgChartPage() {
  const { user, activeCompany, activeBranch, switchCompany, switchBranch } = useAuth();
  const isHrAdmin = Boolean(user?.hr_admin);

  const [nodes, setNodes] = useState<OrgChartNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState("");
  const [search, setSearch] = useState("");
  const [printing, setPrinting] = useState(false);
  const [zoom, setZoom] = useState<number | "fit">(0.85);
  const [natural, setNatural] = useState<Size | null>(null);
  const [canvasW, setCanvasW] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const res = isHrAdmin
        ? await fetchCompanyOrgChart(user.card_no, activeCompany || undefined, activeBranch || undefined)
        : await fetchBranchOrgChart(user.card_no);
      setNodes(res.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load org chart");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.card_no, isHrAdmin, activeCompany, activeBranch]);

  useEffect(() => { load(); }, [load]);

  const roots = useMemo(() => buildOrgTree(nodes), [nodes]);

  // Expand/collapse state resets whenever a new tree is fetched; keyed on the
  // tree itself instead of resetting from an effect.
  const initialExpanded = useMemo(() => computeInitialExpanded(roots, 2), [roots]);
  const [expState, setExpState] = useState<{ key: OrgTreeNode[] | null; set: Set<string> }>({ key: null, set: new Set() });
  const expanded = expState.key === roots ? expState.set : initialExpanded;
  const setExpanded = (fn: (prev: Set<string>) => Set<string>) => setExpState({ key: roots, set: fn(expanded) });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  // Wide charts open scrolled to the company/head node rather than the far left.
  const centeredFor = useRef<OrgTreeNode[] | null>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !natural || centeredFor.current === roots) return;
    centeredFor.current = roots;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [natural, roots]);

  const deptColors = useMemo(() => buildDeptColorMap(nodes.map((n) => n.dept_no || "")), [nodes]);

  const departments = useMemo(() => {
    const seen = new Map<string, string>();
    for (const n of nodes) if (n.dept_no && !seen.has(n.dept_no)) seen.set(n.dept_no, n.department || n.dept_no);
    return [...seen.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [nodes]);

  // Department and search filters: matches + their manager chains render
  // normally and are force-expanded; everything else is dimmed, not removed.
  const visibleSet = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!selectedDept && !q) return null;
    return matchVisibleSet(nodes, (n) =>
      (!selectedDept || n.dept_no === selectedDept) &&
      (!q || n.name?.toLowerCase().includes(q) || n.empcode?.toLowerCase().includes(q))
    );
  }, [selectedDept, search, nodes]);
  const effectiveExpanded = useMemo(
    () => (visibleSet ? new Set([...expanded, ...visibleSet]) : expanded),
    [expanded, visibleSet]
  );

  const photoUrlFor = useCallback(
    (empcode: string) => {
      if (!user) return null;
      return isHrAdmin ? employeePhotoUrl(empcode, user.card_no) : orgChartPhotoUrl(empcode, user.card_no);
    },
    [isHrAdmin, user]
  );

  const toggleExpand = (empcode: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(empcode)) next.delete(empcode); else next.add(empcode);
      return next;
    });
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  const expandAll = () => { setExpanded(() => allNodeIds(roots)); setCollapsedGroups(new Set()); };
  const collapseAll = () => {
    setExpanded(() => computeInitialExpanded(roots, 1));
    setCollapsedGroups(new Set(nodes.map((n) => deptGroupKey(n.dept_no || null))));
  };

  const fitScale = natural && canvasW ? Math.max(0.2, Math.min(1, (canvasW - 8) / natural.w)) : 1;
  const scale = zoom === "fit" ? fitScale : zoom;
  const stepZoom = (dir: 1 | -1) => {
    const i = ZOOM_STEPS.findIndex((z) => z >= scale - 0.001);
    const cur = i === -1 ? ZOOM_STEPS.length - 1 : i;
    setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, cur + dir))]);
  };

  const branchesForCompany = (user?.branch_list ?? []).filter(
    (b) => !activeCompany || !b.compc || String(b.compc) === String(activeCompany)
  );
  const companyName = (isHrAdmin ? user?.selected_company?.name : null) || nodes[0]?.company_name || "Organization";
  const branchName = isHrAdmin ? (activeBranch ? user?.selected_branch?.name : "All Branches") : nodes[0]?.branch_name || undefined;
  const compc = isHrAdmin ? activeCompany || user?.selected_company?.code : nodes[0]?.unit_id;
  const deptName = departments.find((d) => d.code === selectedDept)?.name;

  const noLine = roots.filter((r) => r.children.length === 0).length;
  const treeProps = {
    collapsedGroups, photoUrlFor, deptColors, visibleSet,
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Organogram"
        subtitle={isHrAdmin ? "Reporting structure across your company and branches" : "Reporting structure of your branch"}
      />

      <Card className="hover:shadow-sm">
        <CardContent className="py-4 space-y-3">
          <OrgChartFilters
            isHrAdmin={isHrAdmin}
            companies={user?.company_list || []}
            branches={branchesForCompany}
            activeCompany={activeCompany}
            activeBranch={activeBranch}
            onCompanyChange={(code) => {
              const c = user?.company_list.find((x) => x.code === code);
              if (c) switchCompany(c);
            }}
            onBranchChange={(code) => {
              const b = branchesForCompany.find((x) => x.code === code);
              switchBranch(b ?? { code: "", name: "All Branches" });
            }}
            departments={departments}
            selectedDept={selectedDept}
            onDeptChange={setSelectedDept}
            search={search}
            onSearchChange={setSearch}
            onPrint={() => setPrinting(true)}
            printDisabled={loading || nodes.length === 0}
          />

          {!loading && !error && nodes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Stat label="employees" value={nodes.length} />
              <Stat label="departments" value={departments.length} />
              <Stat label="levels" value={depthOf(roots)} />
              {noLine > 0 && <Stat label="without reporting officer" value={noLine} />}
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={expandAll} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  <Maximize2 className="h-3.5 w-3.5" /> Expand all
                </button>
                <button onClick={collapseAll} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  <Minimize2 className="h-3.5 w-3.5" /> Collapse all
                </button>
                <div className="ml-1 flex items-center rounded-lg border border-gray-200 bg-white">
                  <button onClick={() => stepZoom(-1)} className="px-2 py-1.5 text-gray-600 hover:bg-gray-50 rounded-l-lg" title="Zoom out">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-12 text-center text-xs font-semibold text-gray-700">{Math.round(scale * 100)}%</span>
                  <button onClick={() => stepZoom(1)} className="px-2 py-1.5 text-gray-600 hover:bg-gray-50" title="Zoom in">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setZoom("fit")}
                    className={`px-2 py-1.5 border-l border-gray-200 rounded-r-lg ${zoom === "fit" ? "text-indigo-600 bg-indigo-50" : "text-gray-600 hover:bg-gray-50"}`}
                    title="Fit to width"
                  >
                    <ScanSearch className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="py-24 flex justify-center"><Spinner /></div>
          ) : error ? (
            <div className="py-24 text-center text-red-500">{error}</div>
          ) : nodes.length === 0 ? (
            <div className="py-24 text-center text-gray-400">
              <Users className="h-8 w-8 mx-auto mb-2" />
              No employees found for this selection.
            </div>
          ) : (
            <div
              ref={canvasRef}
              className="overflow-auto rounded-2xl border border-gray-200 bg-slate-50 bg-[radial-gradient(#dbe1ea_1px,transparent_1px)] [background-size:18px_18px]"
              style={{ height: "calc(100vh - 290px)", minHeight: 480 }}
            >
              <div className="flex justify-center min-w-max">
                <ScaledContent scale={scale} onMeasure={setNatural}>
                  <OrgChartTree
                    roots={roots}
                    companyName={companyName}
                    compc={compc}
                    subtitle={branchName}
                    total={nodes.length}
                    {...treeProps}
                    expanded={effectiveExpanded}
                    onToggleExpand={toggleExpand}
                    onToggleGroup={toggleGroup}
                    interactive
                  />
                </ScaledContent>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {printing && (
        <OrgChartPrintView
          roots={roots}
          companyName={companyName}
          compc={compc}
          subtitle={branchName}
          total={nodes.length}
          filterCaption={[deptName, search.trim() ? `"${search.trim()}"` : ""].filter(Boolean).join(" · ") || undefined}
          {...treeProps}
          expanded={effectiveExpanded}
          onClose={() => setPrinting(false)}
        />
      )}
    </div>
  );
}
