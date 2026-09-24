"use client";

import type { ReactNode } from "react";
import { Tree, TreeNode } from "react-organizational-chart";
import { EmployeeCard, CompanyRootCard, CardGroup } from "./OrgChartCard";
import type { OrgTreeNode } from "./buildOrgTree";
import type { DeptColor } from "./deptColors";

export interface TreeRenderProps {
  expanded: Set<string>;
  onToggleExpand: (empcode: string) => void;
  collapsedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  photoUrlFor: (empcode: string) => string | null;
  deptColors: Map<string, DeptColor>;
  visibleSet: Set<string> | null; // null = no filter active (nothing dimmed)
  interactive: boolean;
  /** Stacked teams wrap into another column after this many cards. */
  maxRows?: number;
  /** From this depth down, subtrees are listed vertically (compact print layout). */
  compactFrom?: number;
}

export const deptGroupKey = (deptNo: string | null) => `dept:${deptNo ?? ""}`;
export const teamGroupKey = (empcode: string) => `team:${empcode}`;

function card(node: OrgTreeNode, depth: number, p: TreeRenderProps) {
  const isExpanded = p.expanded.has(node.empcode);
  return (
    <EmployeeCard
      key={node.empcode}
      node={node}
      depth={depth}
      photoUrl={p.photoUrlFor(node.empcode)}
      deptColor={node.dept_no ? p.deptColors.get(node.dept_no) ?? null : null}
      dimmed={p.visibleSet !== null && !p.visibleSet.has(node.empcode)}
      isExpanded={isExpanded}
      onToggle={p.interactive ? () => p.onToggleExpand(node.empcode) : undefined}
    />
  );
}

const STUB = "absolute -left-5 w-5 border-t-[1.5px] border-dashed border-gray-400";

/** A manager with their whole team listed downward and indented. */
function CompactSubtree({ node, depth, p }: { node: OrgTreeNode; depth: number; p: TreeRenderProps }) {
  const open = p.expanded.has(node.empcode) && node.children.length > 0;
  const branches = node.children.filter((c) => c.children.length > 0);
  const leaves = node.children.filter((c) => c.children.length === 0);
  return (
    <div className="inline-flex flex-col items-start text-left align-top">
      {card(node, depth, p)}
      {open && (
        <div className="ml-10 pl-5 pt-1 flex flex-col items-start gap-2 border-l-[1.5px] border-dashed border-gray-400">
          {branches.map((b) => (
            <div key={b.empcode} className="relative">
              <span className={STUB} style={{ top: 48 }} />
              <CompactSubtree node={b} depth={depth + 1} p={p} />
            </div>
          ))}
          {leaves.length > 0 && (
            <div className="relative">
              <span className={STUB} style={{ top: 60 }} />
              <CardGroup count={leaves.length} maxRows={p.maxRows}>{leaves.map((l) => card(l, depth + 1, p))}</CardGroup>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function renderNode(node: OrgTreeNode, depth: number, p: TreeRenderProps): ReactNode {
  if (p.compactFrom !== undefined && depth >= p.compactFrom && node.children.length > 0) {
    return <TreeNode key={node.empcode} label={<CompactSubtree node={node} depth={depth} p={p} />} />;
  }
  // Children are built as an array: the library counts a `false` child as a
  // child and draws a dangling connector under collapsed cards.
  const kids: ReactNode[] = [];
  if (p.expanded.has(node.empcode)) {
    const branches = node.children.filter((c) => c.children.length > 0);
    const leaves = node.children.filter((c) => c.children.length === 0);
    for (const b of branches) kids.push(renderNode(b, depth + 1, p));

    // Stack leaf-only teams under their manager (as in a printed org chart)
    // instead of spreading them sideways — this is what keeps the chart narrow.
    if (leaves.length >= 2) {
      kids.push(
        <TreeNode
          key={teamGroupKey(node.empcode)}
          label={<CardGroup count={leaves.length} maxRows={p.maxRows}>{leaves.map((l) => card(l, depth + 1, p))}</CardGroup>}
        />
      );
    } else {
      for (const l of leaves) kids.push(<TreeNode key={l.empcode} label={card(l, depth + 1, p)} />);
    }
  }
  return <TreeNode key={node.empcode} label={card(node, depth, p)}>{kids}</TreeNode>;
}

export function OrgChartTree({
  roots, companyName, compc, subtitle, total, ...p
}: {
  roots: OrgTreeNode[];
  companyName: string;
  compc?: string;
  subtitle?: string;
  total: number;
} & TreeRenderProps) {
  const heads = roots.filter((r) => r.children.length > 0);
  const loners = roots.filter((r) => r.children.length === 0);

  // Employees with no reporting line are grouped by department under the
  // company, so they are still shown without turning into one endless row.
  const byDept = new Map<string, OrgTreeNode[]>();
  for (const n of loners) {
    const k = n.dept_no ?? "";
    if (!byDept.has(k)) byDept.set(k, []);
    byDept.get(k)!.push(n);
  }
  const deptGroups = [...byDept.entries()]
    .map(([deptNo, nodes]) => ({ deptNo, nodes, name: nodes[0].department || "No department" }))
    .filter((g) => p.visibleSet === null || g.nodes.some((n) => p.visibleSet!.has(n.empcode)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const kids: ReactNode[] = heads.map((h) => renderNode(h, 0, p));
  for (const g of deptGroups) {
    const key = deptGroupKey(g.deptNo || null);
    kids.push(
      <TreeNode
        key={key}
        label={
          <CardGroup
            title={g.name}
            color={p.deptColors.get(g.deptNo)?.dot}
            count={g.nodes.length}
            maxRows={p.maxRows}
            collapsed={p.collapsedGroups.has(key)}
            onToggle={p.interactive ? () => p.onToggleGroup(key) : undefined}
          >
            {g.nodes.map((n) => card(n, 1, p))}
          </CardGroup>
        }
      />
    );
  }

  return (
    <div className="px-6 py-6">
      <Tree
        lineWidth="1.5px"
        lineColor="#9ca3af"
        lineStyle="dashed"
        lineHeight="28px"
        lineBorderRadius="10px"
        nodePadding="10px"
        label={<CompanyRootCard companyName={companyName} compc={compc} subtitle={subtitle} total={total} />}
      >
        {kids}
      </Tree>
    </div>
  );
}

