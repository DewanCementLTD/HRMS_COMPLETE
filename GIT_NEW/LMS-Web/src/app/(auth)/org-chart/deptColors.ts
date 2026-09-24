// Small categorical palette, assigned round-robin per distinct department so
// the same dept always gets the same colour within a given fetch.
const PALETTE: { bg: string; fg: string; dot: string }[] = [
  { bg: "#eef2ff", fg: "#4338ca", dot: "#6366f1" }, // indigo
  { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" }, // emerald
  { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" }, // amber
  { bg: "#fff1f2", fg: "#be123c", dot: "#f43f5e" }, // rose
  { bg: "#f0f9ff", fg: "#0369a1", dot: "#0ea5e9" }, // sky
  { bg: "#f5f3ff", fg: "#6d28d9", dot: "#8b5cf6" }, // violet
  { bg: "#f0fdfa", fg: "#0f766e", dot: "#14b8a6" }, // teal
  { bg: "#fff7ed", fg: "#c2410c", dot: "#f97316" }, // orange
];

export type DeptColor = { bg: string; fg: string; dot: string };

export function buildDeptColorMap(deptNos: string[]): Map<string, DeptColor> {
  const unique = Array.from(new Set(deptNos.filter(Boolean))).sort();
  const map = new Map<string, DeptColor>();
  unique.forEach((code, i) => map.set(code, PALETTE[i % PALETTE.length]));
  return map;
}
