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

/**
 * Stringify an Oracle DATE/TIMESTAMP exactly like Python's `str(datetime)`,
 * i.e. "YYYY-MM-DD HH:MM:SS.ffffff" (the fractional part omitted when zero).
 *
 * node-oracledb hands these columns back as JS Date objects, and `String(date)`
 * yields "Mon Jun 29 2026 12:02:01 GMT+0500 (Pakistan Standard Time)" — a format
 * no client that was written against the FastAPI backend can parse. Use this
 * wherever the FastAPI repository did `str(row[i])` on a datetime.
 */
export const pyStrDatetime = (value) => {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date)) return String(value);

  const p = (n, w = 2) => String(n).padStart(w, "0");
  const base =
    `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())} ` +
    `${p(value.getHours())}:${p(value.getMinutes())}:${p(value.getSeconds())}`;
  const micros = value.getMilliseconds() * 1000;
  return micros ? `${base}.${p(micros, 6)}` : base;
};