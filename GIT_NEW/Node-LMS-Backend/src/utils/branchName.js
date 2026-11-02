// Branch (COM_LOCATION) lookups by company + branch code.
//
// LCODE is not unique on its own: in the YDC schema codes 1-5 exist under up
// to four companies (code 3 is "Islamabad Office" for companies 2 and 3 but
// "Distillery Plant" for company 4), so a code-only lookup returned whichever
// name sorted first. The branch is therefore matched on the employee's company
// as well. The code-only lookup stays as a fallback, so a row whose branch is
// not filed under its own company still shows a name rather than none.

/**
 * SQL expression for a COM_LOCATION column (DESCR by default) of the branch
 * `lcode` within company `compc`. Both arguments are SQL expressions, e.g.
 * branchNameSql("h.LOCATION", "h.UNIT_ID").
 */
export const branchNameSql = (lcode, compc, col = "DESCR") =>
  `NVL((SELECT MIN(bl.${col}) FROM COM_LOCATION bl
         WHERE TRIM(bl.LCODE) = TRIM(${lcode}) AND TO_CHAR(bl.COMPC) = TO_CHAR(${compc})),
       (SELECT MIN(bl.${col}) FROM COM_LOCATION bl WHERE TRIM(bl.LCODE) = TRIM(${lcode})))`;

/** Standalone query for one branch name; binds :lcode and :compc. */
export const BRANCH_NAME_QUERY = `SELECT ${branchNameSql(":lcode", ":compc")} AS DESCR FROM DUAL`;
