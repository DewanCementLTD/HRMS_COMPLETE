/**
 * Org chart service — flat, parent-pointer employee lists for the
 * organogram UI. The client builds the tree from `rpt_officer` (manager's
 * EMPCODE); this layer only resolves names and applies company/branch scope,
 * following the same resolved-join pattern as getEmployeeCard() in
 * hrms.service.js.
 */

import { getDirectConnection } from "../config/database.js";
import { empDirectFilter } from "../utils/hrmsFilters.js";

const OUT_OBJECT = 4002; // oracledb.OUT_FORMAT_OBJECT

const lowerKeys = (row) => {
  const out = {};
  for (const k of Object.keys(row)) out[k.toLowerCase()] = row[k];
  return out;
};

const ORG_CHART_SELECT = `
  SELECT
      h.EMPCODE, h.NAME, h.RPT_OFFICER, h.DEPT_NO, h.DESG_CD, h.GRADE_CD,
      TO_CHAR(h.UNIT_ID) AS UNIT_ID, h.LOCATION,
      (SELECT MIN(dg.DESG_DESC) FROM HR_DESG dg
         WHERE LTRIM(dg.DESG_CD,'0')=LTRIM(h.DESG_CD,'0') AND TO_CHAR(dg.COMPC)=TO_CHAR(h.UNIT_ID)) AS DESIGNATION,
      (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d
         WHERE LTRIM(d.DEPT_NO,'0')=LTRIM(h.DEPT_NO,'0') AND TO_CHAR(d.COMPC)=TO_CHAR(h.UNIT_ID)) AS DEPARTMENT,
      (SELECT u.UNIT_NAME FROM UNIT_MST u WHERE u.UNIT_ID = h.UNIT_ID) AS COMPANY_NAME,
      (SELECT MIN(l.DESCR) FROM COM_LOCATION l WHERE TRIM(l.LCODE) = TRIM(h.LOCATION)) AS BRANCH_NAME
  FROM HR_EMP_MASTER h`;

const mapRow = (raw) => {
  const r = lowerKeys(raw);
  for (const k of ["empcode", "name", "rpt_officer", "dept_no", "desg_cd", "designation", "department", "company_name", "location", "branch_name", "unit_id"]) {
    if (r[k] !== null && r[k] !== undefined) r[k] = String(r[k]).trim();
  }
  r.rpt_officer = r.rpt_officer || null;
  return r;
};

/** All active employees across the caller's allowed companies/branches. */
export const getOrgChartCompanyView = async (allowedCompanies = null, allowedBranches = null) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const params = {};
    const { sql: filterSql } = empDirectFilter(allowedCompanies, allowedBranches, params);

    const sql =
      ORG_CHART_SELECT +
      ` WHERE (h.STATUS = 'A' OR h.STATUS IS NULL)${filterSql} ORDER BY h.NAME`;

    const result = await connection.execute(sql, params, { outFormat: OUT_OBJECT });
    return (result.rows ?? []).map(mapRow);
  } finally {
    await connection?.close();
  }
};

/** Active employees in one employee's own branch (self-service, no HR gate). */
export const getOrgChartBranchView = async (empcode) => {
  let connection;
  try {
    connection = await getDirectConnection();

    const own = (
      await connection.execute(
        `SELECT UNIT_ID, LOCATION FROM HR_EMP_MASTER WHERE EMPCODE = :e`,
        { e: empcode },
        { outFormat: OUT_OBJECT }
      )
    ).rows?.[0];
    if (!own) return [];
    const ownRow = lowerKeys(own);

    const params = { u: ownRow.unit_id, l: String(ownRow.location ?? "").trim() };
    const sql =
      ORG_CHART_SELECT +
      ` WHERE (h.STATUS = 'A' OR h.STATUS IS NULL) AND h.UNIT_ID = :u AND TRIM(h.LOCATION) = :l ORDER BY h.NAME`;

    const result = await connection.execute(sql, params, { outFormat: OUT_OBJECT });
    return (result.rows ?? []).map(mapRow);
  } finally {
    await connection?.close();
  }
};
