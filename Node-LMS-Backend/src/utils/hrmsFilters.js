/**
 * HRMS company/branch filter helpers.
 *
 * Direct 1:1 port of the private helpers in the FastAPI LMS-Backend
 * (repositories/hrms_repository.py): `_to_int`, `_emp_filter_attempts`,
 * `_execute_with_emp_filter` and `_roster_card_filter`.
 *
 * These keep the generated SQL — and its progressive COMPC+BRNCH → COMPC →
 * BRNCH → unfiltered fallback behaviour — identical to the Python side so the
 * two backends return the same rows for the same admin rights.
 */

// Parse any numeric-ish value to int, handling Oracle decimals like "2.0".
export const toInt = (v) => {
  if (v === null || v === undefined) return null;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
};

// Normalise a scalar / array / null into a list of clean integers.
const normNums = (v) => {
  if (v === null || v === undefined || v === "") return [];
  const vals = Array.isArray(v) ? v : [v];
  return vals.map(toInt).filter((n) => n !== null);
};

/**
 * Return a list of { frag, params } attempts in order of decreasing
 * restrictiveness: COMPC+BRNCH, then COMPC, then BRNCH, then unfiltered ("").
 * Each `frag` is ' AND <conditions>' (or '' for unfiltered) and is spliced into
 * a SQL template's `{filter}` marker.
 */
export const empFilterAttempts = (compc = null, brnch = null, alias = "h") => {
  const compNums = normNums(compc);
  const brnNums = normNums(brnch);

  const compFrag = () => {
    const ph = compNums.map((_, i) => `:ecompc${i}`).join(", ");
    const params = {};
    compNums.forEach((n, i) => { params[`ecompc${i}`] = n; });
    return { frag: `TO_NUMBER(${alias}.UNIT_ID) IN (${ph})`, params };
  };

  const brnFrag = () => {
    const ph = brnNums.map((_, i) => `:ebrnch${i}`).join(", ");
    const params = {};
    brnNums.forEach((n, i) => { params[`ebrnch${i}`] = n; });
    return { frag: `TO_NUMBER(${alias}.LOCATION) IN (${ph})`, params };
  };

  const attempts = [];
  if (compNums.length && brnNums.length) {
    const c = compFrag();
    const b = brnFrag();
    attempts.push({ frag: ` AND ${c.frag} AND ${b.frag}`, params: { ...c.params, ...b.params } });
  }
  if (compNums.length) {
    const c = compFrag();
    attempts.push({ frag: ` AND ${c.frag}`, params: c.params });
  }
  if (brnNums.length) {
    const b = brnFrag();
    attempts.push({ frag: ` AND ${b.frag}`, params: b.params });
  }
  attempts.push({ frag: "", params: {} });
  return attempts;
};

/**
 * Execute a SQL template (containing a `{filter}` marker) trying COMPC+BRNCH,
 * then COMPC alone, then BRNCH alone, then unfiltered — skipping to the next
 * attempt only on ORA-00904 (missing column). Returns the successful result.
 */
export const executeWithEmpFilter = async (
  connection, sqlTemplate, compc, brnch, { alias = "h", extraParams = {}, options = {} } = {}
) => {
  let lastErr = null;
  for (const { frag, params } of empFilterAttempts(compc, brnch, alias)) {
    try {
      return await connection.execute(
        sqlTemplate.replace("{filter}", frag),
        { ...extraParams, ...params },
        options
      );
    } catch (err) {
      if (String(err.message).includes("ORA-00904")) {
        lastErr = String(err.message).split("\n")[0].slice(0, 100);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`All HR_EMP_MASTER filter attempts failed: ${lastErr}`);
};

/**
 * Build a ' AND TO_CHAR(CARD_NO) IN (subquery)' fragment that restricts
 * DUTY_ROSTER / ATTENDANCE_RECORDS rows to employees of the given company /
 * branch, writing the bind values into `paramsOut`. Returns '' when no filter.
 *
 * The IN-list covers all three card representations (EMPLOYEE.CARD_NO like
 * "100011.2", its integer part "100011", and HR_EMP_MASTER.ATDTCARD#) so the
 * same filter works for both DUTY_ROSTER and ATTENDANCE_RECORDS.
 */
export const rosterCardFilter = (compc, brnch, paramsOut, prefix = "rc") => {
  const compList = normNums(compc);
  const brnList = normNums(brnch);

  const conds = [];
  if (compList.length) {
    const ph = compList.map((_, i) => `:${prefix}c${i}`).join(", ");
    conds.push(`TO_NUMBER(h.UNIT_ID) IN (${ph})`);
    compList.forEach((n, i) => { paramsOut[`${prefix}c${i}`] = n; });
  }
  if (brnList.length) {
    const ph = brnList.map((_, i) => `:${prefix}b${i}`).join(", ");
    conds.push(`TO_NUMBER(h.LOCATION) IN (${ph})`);
    brnList.forEach((n, i) => { paramsOut[`${prefix}b${i}`] = n; });
  }

  if (!conds.length) return "";

  const whereInner = conds.join(" AND ");
  return (
    ` AND TO_CHAR(CARD_NO) IN (` +
    `SELECT TO_CHAR(e.CARD_NO) FROM HR_EMP_MASTER h ` +
    `JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE WHERE ${whereInner} ` +
    `UNION ` +
    `SELECT REGEXP_SUBSTR(TO_CHAR(e.CARD_NO), '^[0-9]+') FROM HR_EMP_MASTER h ` +
    `JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE WHERE ${whereInner} ` +
    `UNION ` +
    `SELECT TO_CHAR(h."ATDTCARD#") FROM HR_EMP_MASTER h ` +
    `WHERE h."ATDTCARD#" IS NOT NULL AND ${whereInner})`
  );
};

// Build the "AND TO_NUMBER(h.UNIT_ID/LOCATION) IN (...)" fragment used by the
// list/search employee queries (mirrors the inline filter blocks in
// search_employees_hrms / list_employees_hrms / get_bulk_attendance_*).
export const empDirectFilter = (allowedCompanies, allowedBranches, paramsOut) => {
  const parts = [];
  const comp = normNums(allowedCompanies);
  const brn = normNums(allowedBranches);
  if (comp.length) {
    const ph = comp.map((_, i) => `:cmpf${i}`).join(", ");
    parts.push(`TO_NUMBER(h.UNIT_ID) IN (${ph})`);
    comp.forEach((n, i) => { paramsOut[`cmpf${i}`] = n; });
  }
  if (brn.length) {
    const ph = brn.map((_, i) => `:brnf${i}`).join(", ");
    parts.push(`TO_NUMBER(h.LOCATION) IN (${ph})`);
    brn.forEach((n, i) => { paramsOut[`brnf${i}`] = n; });
  }
  return { parts, sql: parts.length ? ` AND ${parts.join(" AND ")}` : "" };
};
