import { getDirectConnection } from '../config/database.js';

import { logger } from '../utils/logger.js';
export const getDashboardData = async (card_no) => {
  let connection;
  try {
    connection = await getDirectConnection();

    // Step 1: core employee record — mirrors FastAPI's get_dashboard in
    // repositories/user_repository.py: raw DEPT_NO/DESG_CD codes, HOD1
    // (not RPT_OFFICER), and isolated name lookups so one failure doesn't
    // crash the endpoint.
    let row = null;
    try {
      const result = await connection.execute(
        `SELECT
          h.EMPCODE                              AS "emp_pk",
          TO_CHAR(e.CARD_NO)                     AS "card_no",
          h."ATDTCARD#"                          AS "emp_no",
          h.NAME                                 AS "emp_name",
          TO_CHAR(h.DTOFAPPT, 'YYYY-MM-DD')      AS "date_of_join",
          h.NICNO                                AS "nic_no",
          TO_CHAR(h.DESG_CD)                     AS "designation",
          TO_CHAR(h.DEPT_NO)                     AS "department",
          h.UNIT_ID                              AS "compc",
          h.LOCATION                             AS "branch",
          h.HOD1                                 AS "hod"
        FROM HR_EMP_MASTER h
        LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
        WHERE TO_CHAR(e.CARD_NO) = :card_no
           OR h."ATDTCARD#"      = :card_no
           OR h.EMPCODE          = :card_no
        FETCH FIRST 1 ROWS ONLY`,
        { card_no },
        { outFormat: 4002 }
      );
      row = result.rows?.[0] ?? null;
    } catch (e) {
      logger.info(`[DASHBOARD] HR_EMP_MASTER + EMPLOYEE join failed for ${card_no}: ${e.message ?? e}`);
      // Fallback: HR_EMP_MASTER alone (no EMPLOYEE join)
      try {
        const result = await connection.execute(
          `SELECT
            h.EMPCODE                              AS "emp_pk",
            h."ATDTCARD#"                          AS "card_no",
            h."ATDTCARD#"                          AS "emp_no",
            h.NAME                                 AS "emp_name",
            TO_CHAR(h.DTOFAPPT, 'YYYY-MM-DD')      AS "date_of_join",
            h.NICNO                                AS "nic_no",
            TO_CHAR(h.DESG_CD)                     AS "designation",
            TO_CHAR(h.DEPT_NO)                     AS "department",
            h.UNIT_ID                              AS "compc",
            h.LOCATION                             AS "branch",
            h.HOD1                                 AS "hod"
          FROM HR_EMP_MASTER h
          WHERE h."ATDTCARD#" = :card_no OR h.EMPCODE = :card_no
          FETCH FIRST 1 ROWS ONLY`,
          { card_no },
          { outFormat: 4002 }
        );
        row = result.rows?.[0] ?? null;
      } catch (e2) {
        logger.info(`[DASHBOARD] HR_EMP_MASTER fallback also failed for ${card_no}: ${e2.message ?? e2}`);
      }
    }

    if (!row) return null;

    // Isolated name lookups — any failure leaves the field as null
    const safeLookup = async (sql, value, tag) => {
      if (value === null || value === undefined) return null;
      try {
        const r = await connection.execute(sql, { v: value }, { outFormat: 4002 });
        const v = r.rows?.[0];
        return v ? Object.values(v)[0] ?? null : null;
      } catch (e) {
        logger.info(`[DASHBOARD] ${tag} lookup failed for value=${value}: ${e.message ?? e}`);
        return null;
      }
    };

    row.compcnm = await safeLookup(
      "SELECT MAX(DESCR) AS V FROM COMPANY_INFO WHERE COMPC = :v",
      row.compc, "compcnm"
    );
    row.brnchnm = await safeLookup(
      "SELECT MAX(DESCR) AS V FROM COM_LOCATION WHERE LCODE = :v",
      row.branch, "brnchnm"
    );
    row.hod_nm = await safeLookup(
      "SELECT MAX(NAME) AS V FROM HR_EMP_MASTER WHERE EMPCODE = TO_CHAR(:v)",
      row.hod, "hod_nm"
    );

    // Leave balance — isolated, may throw if ALL_LEAVE_BAL_V internals fail
    let balance = null;
    try {
      const balRow = (
        await connection.execute(
          `SELECT SUM(BALANCE) AS "balance" FROM ALL_LEAVE_BAL_V WHERE CARD_NO = :card_no`,
          { card_no: row.card_no ?? card_no },
          { outFormat: 4002 }
        )
      ).rows?.[0];
      balance = balRow?.balance ?? null;
    } catch (e) {
      logger.info(`[DASHBOARD] balance lookup failed for ${card_no}: ${e.message ?? e}`);
    }

    return { ...row, balance: balance ?? 0 };
  } finally {
    await connection?.close();
  }
};
