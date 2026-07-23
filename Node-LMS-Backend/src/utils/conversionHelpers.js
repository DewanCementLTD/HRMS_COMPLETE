/**
 * Split a comma-separated query-string value into a trimmed, non-empty list.
 * Mirrors `_csv_list` in the FastAPI LMS-Backend (routers/location_router.py),
 * used to turn multi-select filters (dept_no, desg_cd, empcodes, ...) sent as
 * "a,b,c" into ["a", "b", "c"].
 */
export const toList = (value) => {
  if (!value) return null;
  const items = String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length ? items : null;
};


export const safeInt = (value) => {
  const n = parseInt(String(value).trim(), 10);
  return Number.isFinite(n) ? n : null;
};

export const cardInt = (card_no) =>
  String(card_no).split(".")[0];