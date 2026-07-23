import { safeInt } from "./conversionHelpers.js";


// Builds a "TO_NUMBER(col) IN (:p0, :p1, ...)" fragment for numeric codes,
// writing the bind values into `binds`. Returns null when nothing to filter.
const buildNumericInClause = (column, values, prefix, binds) => {
  const nums = (values ?? []).map(safeInt).filter((n) => n !== null);
  if (!nums.length) return null;
  nums.forEach((n, i) => {
    binds[`${prefix}${i}`] = n;
  });
  return `TO_NUMBER(${column}) IN (${nums.map((_, i) => `:${prefix}${i}`).join(", ")})`;
};

// Builds a "col IN (:p0, :p1, ...)" fragment for string codes.
const buildStringInClause = (column, values, prefix, binds) => {
  const items = (values ?? []).map((v) => String(v).trim()).filter(Boolean);
  if (!items.length) return null;
  items.forEach((v, i) => {
    binds[`${prefix}${i}`] = v;
  });
  return `${column} IN (${items.map((_, i) => `:${prefix}${i}`).join(", ")})`;
};

export { buildNumericInClause, buildStringInClause };