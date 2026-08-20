/**
 * Shared helpers used by both the `payroll` and `payrollEntry` modules.
 *
 * Mirrors the module-level `_company` / `_branch` / `_checked` / `USR` helpers
 * defined in FastAPI's `routers/payroll_router.py`, which `payroll_entry_router.py`
 * imports directly (`from routers.payroll_router import _company, _branch, _checked, USR`).
 * Node replicates that same cross-file import: payrollEntry.controller.js imports
 * from this file rather than duplicating the logic.
 */

import { resolveFilterLists } from "../services/adminRights.service.js";

export const PAYROLL_USR = "HR";

const toInt = (v) => {
  const n = parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * Resolve the company (UNIT_ID) a per-company payroll record belongs to: the
 * selected company when within the admin's rights, else the admin's first
 * allowed company, else 1.
 *
 * Port of payroll_router.py:_company. Note branch is passed as null (not
 * brnch) into _resolve_filter_lists, matching the Python source exactly.
 */
export const resolveCompany = async (adminCardNo, compc) => {
  const { finalCompanies } = await resolveFilterLists(adminCardNo, compc, null);

  if (compc) {
    const ci = toInt(compc);
    const allowed = new Set((finalCompanies || []).map(toInt));
    if (ci !== null && (allowed.size === 0 || allowed.has(ci))) return ci;
  }
  for (const v of finalCompanies || []) {
    const iv = toInt(v);
    if (iv !== null) return iv;
  }
  return 1;
};

/**
 * The branch (LOCATION) to filter by: the selected branch when within the
 * admin's rights, else null (all branches of the company).
 *
 * Port of payroll_router.py:_branch.
 */
export const resolveBranch = async (adminCardNo, compc, brnch) => {
  if (!brnch) return null;
  const { finalBranches } = await resolveFilterLists(adminCardNo, compc, brnch);
  const allowed = new Set((finalBranches || []).map((b) => String(b).trim()));
  const b = String(brnch).trim();
  return allowed.size === 0 || allowed.has(b) ? b : null;
};

/**
 * Port of payroll_router.py:_checked — sends the response itself. Repository
 * functions return {status:"error", message} on business failure; this turns
 * that into a 400 {detail} exactly like FastAPI's HTTPException(400, ...), and
 * otherwise sends the result dict as-is (200).
 */
export const checked = (res, result) => {
  if (result && typeof result === "object" && result.status === "error") {
    return res.status(400).json({ detail: result.message });
  }
  return res.json(result);
};
