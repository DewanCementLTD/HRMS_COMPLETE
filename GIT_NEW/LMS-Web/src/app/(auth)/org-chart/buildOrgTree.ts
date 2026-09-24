import type { OrgChartNode } from "@/services/orgChartService";

export interface OrgTreeNode extends OrgChartNode {
  children: OrgTreeNode[];
}

/**
 * Converts the flat parent-pointer list (rpt_officer -> manager's empcode)
 * into a forest. A node becomes a root when it has no rpt_officer, is its
 * own manager, its manager isn't in the current filtered set, or its manager
 * chain loops back to itself — orphans and bad data are always shown as
 * extra roots, never silently dropped.
 */
export function buildOrgTree(flat: OrgChartNode[]): OrgTreeNode[] {
  const byId = new Map<string, OrgTreeNode>();
  for (const n of flat) byId.set(n.empcode, { ...n, children: [] });

  const roots: OrgTreeNode[] = [];

  for (const node of byId.values()) {
    const parentId = node.rpt_officer?.trim() || "";
    if (!parentId || parentId === node.empcode || !byId.has(parentId)) {
      roots.push(node);
      continue;
    }

    // Cycle guard: walk the manager chain from the parent; if it loops back
    // to `node` before running out of nodes, treat node as a root instead of
    // attaching it — never infinite-recurse on bad RPT_OFFICER data.
    let cur = parentId;
    let hops = 0;
    let cyclic = false;
    while (cur && hops < flat.length + 1) {
      if (cur === node.empcode) { cyclic = true; break; }
      cur = byId.get(cur)?.rpt_officer?.trim() || "";
      hops++;
    }
    if (cyclic) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[org-chart] cycle detected in RPT_OFFICER chain at empcode=${node.empcode}; showing as a root`);
      }
      roots.push(node);
      continue;
    }

    byId.get(parentId)!.children.push(node);
  }

  return roots;
}

/** BFS from each root, returns the set of empcodes expanded by default (top `depth` levels). */
export function computeInitialExpanded(roots: OrgTreeNode[], depth = 2): Set<string> {
  const expanded = new Set<string>();
  let frontier = roots;
  for (let level = 0; level < depth && frontier.length; level++) {
    const next: OrgTreeNode[] = [];
    for (const n of frontier) {
      expanded.add(n.empcode);
      next.push(...n.children);
    }
    frontier = next;
  }
  return expanded;
}

/** All empcodes in the tree — used for "Expand All". */
export function allNodeIds(roots: OrgTreeNode[]): Set<string> {
  const ids = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    ids.add(n.empcode);
    stack.push(...n.children);
  }
  return ids;
}

/**
 * Empcodes to render normally for a filter: every match plus its manager
 * chain, so a match is always reachable. Non-matches stay in the tree (the
 * caller dims them) so the chart never disconnects.
 */
export function matchVisibleSet(flat: OrgChartNode[], isMatch: (n: OrgChartNode) => boolean): Set<string> {
  const byId = new Map(flat.map((n) => [n.empcode, n]));
  const visible = new Set<string>();
  for (const n of flat) {
    if (!isMatch(n)) continue;
    visible.add(n.empcode);
    let cur = n.rpt_officer?.trim() || "";
    let hops = 0;
    while (cur && byId.has(cur) && !visible.has(cur) && hops < flat.length + 1) {
      visible.add(cur);
      cur = byId.get(cur)!.rpt_officer?.trim() || "";
      hops++;
    }
  }
  return visible;
}
