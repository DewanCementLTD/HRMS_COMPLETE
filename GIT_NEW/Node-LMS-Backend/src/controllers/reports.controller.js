/**
 * Controller handlers for /reports/*.
 *
 * Company/branch scope is enforced here, not in the client. `resolveCompany`
 * clamps the requested company to the ones the HR admin actually has rights to
 * (falling back to their first allowed company), and `resolveBranch` returns
 * null when the sidebar is on "All Branches" — which is exactly the
 * `NVL(:mloc, a.location)` semantics the report SQL already uses. compc maps to
 * UNIT_ID and brnch to LOCATION, the same mapping used across hrmsFilters.js
 * and the payroll modules.
 *
 * The resolved unit/location are what reach the binds, so a caller cannot widen
 * its own scope by editing the query string. Report-specific filters
 * (designation, department, period range, …) are applied on top.
 *
 * compc=ALL runs the report once per company the admin has rights to and merges
 * the results (see runAllCompanies). PERIOD# is numbered per company, so in that
 * mode the period filters carry a YYYYMM month (from /lookups?compc=ALL) and
 * each company's own PERIOD# for that month is used.
 */

import { resolveCompany, resolveBranch } from "../utils/payrollShared.js";
import { getAdminRights } from "../services/adminRights.service.js";
import * as reportsService from "../services/reports.service.js";

const ALL = "ALL";
const isAll = (query) => String(query.compc ?? "").trim().toUpperCase() === ALL;

// Resolve the { unitId, location } scope shared by every report.
const scope = async (query) => {
  const { admin_card_no, compc, brnch } = query;
  const unitId = await resolveCompany(admin_card_no, compc);
  const location = await resolveBranch(admin_card_no, compc, brnch);
  return { unitId, location };
};

/** Every company the admin may report on (an unrestricted admin gets every unit). */
const allowedUnits = async (adminCardNo) => {
  const { allowedCompanies } = await getAdminRights(adminCardNo);
  const units = (allowedCompanies ?? []).map((v) => Number(v)).filter(Number.isFinite);
  return units.length ? [...new Set(units)] : reportsService.listAllUnits();
};

// Period fields per report and how a month maps onto each company's PERIOD#.
const PERIOD_FIELDS = [["period_from", "from"], ["period_to", "to"], ["period", "exact"]];

/** The query with this unit's PERIOD#s in place of the months, or null if the unit has none. */
const queryForUnit = async (query, unitId) => {
  const q = { ...query };
  for (const [field, edge] of PERIOD_FIELDS) {
    if (q[field] === undefined || q[field] === null || q[field] === "") continue;
    const p = await reportsService.unitPeriodForMonth(unitId, q[field], edge);
    if (p === null) return null;
    q[field] = p;
  }
  if (q.period_from != null && q.period_to != null && q.period_from > q.period_to) return null;
  return q;
};

const sum = (list, k) => list.reduce((t, x) => t + (Number(x?.[k]) || 0), 0);

/**
 * Merge one report's per-company results into the single-company shape the
 * client already renders. Rows/groups gain `company` (and `unit_id`).
 */
const mergeParts = (parts) => {
  const tag = (rows, p) => (rows ?? []).map((r) => ({ ...r, unit_id: r.unit_id ?? p.unitId, company: p.company }));
  const first = parts[0]?.data ?? {};
  const meta = {
    ...(first.meta ?? {}),
    unit_id: null,
    unit_name: "All Companies",
    location: null,
    location_name: "ALL Locations",
    all_companies: true,
    companies: parts.map((p) => ({ unit_id: p.unitId, name: p.company })),
  };
  if (!parts.length) return { rows: [], meta };

  // Day grid (monthly attendance): union of days, one branch group per company+branch.
  if (Array.isArray(first.days)) {
    const days = new Map();
    for (const p of parts) for (const d of p.data.days ?? []) days.set(d.date, d);
    return {
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      groups: parts.flatMap((p) => (p.data.groups ?? []).map((g) => ({
        ...g, branch: parts.length > 1 ? `${p.company} — ${g.branch}` : g.branch, company: p.company, rows: tag(g.rows, p),
      }))),
      meta,
    };
  }

  // Grouped reports. Reconciliations group by allowance/deduction, so the same
  // trans_id from several companies becomes one block; bank advice stays one
  // block per company + bank branch.
  if (Array.isArray(first.groups)) {
    if (first.groups.some((g) => g.trans_id !== undefined)) {
      const byTid = new Map();
      for (const p of parts) {
        for (const g of p.data.groups ?? []) {
          const cur = byTid.get(g.trans_id) ?? { ...g, rows: [], totals: { from_amount: 0, to_amount: 0, variance: 0 } };
          cur.rows.push(...tag(g.rows, p));
          for (const k of Object.keys(cur.totals)) cur.totals[k] += Number(g.totals?.[k]) || 0;
          byTid.set(g.trans_id, cur);
        }
      }
      const groups = [...byTid.values()].sort((a, b) => (a.descr < b.descr ? -1 : a.descr > b.descr ? 1 : 0));
      return { groups, meta };
    }
    const groups = parts.flatMap((p) => (p.data.groups ?? []).map((g) => ({
      ...g, company: p.company, location_name: g.location_name || p.company, rows: tag(g.rows, p),
    })));
    return { groups, grand_total: sum(parts.map((p) => p.data), "grand_total"), meta };
  }

  // Row reports; pivots also merge their columns and totals.
  const rows = parts.flatMap((p) => tag(p.data.rows, p));
  if (rows.some((r) => r.sr_no !== undefined)) rows.forEach((r, i) => { r.sr_no = i + 1; });
  const out = { rows, meta };
  if (Array.isArray(first.columns)) {
    const columns = [];
    for (const p of parts) for (const c of p.data.columns ?? []) if (!columns.includes(c)) columns.push(c);
    out.columns = columns;
    out.column_totals = Object.fromEntries(columns.map((c) => [c, parts.reduce((t, p) => t + (Number(p.data.column_totals?.[c]) || 0), 0)]));
    out.grand_total = sum(parts.map((p) => p.data), "grand_total");
    out.has_ot_hours = parts.some((p) => p.data.has_ot_hours);
  }
  return out;
};

/** Run one report for every allowed company and merge (companies with no data for the month are skipped). */
const runAllCompanies = async (serviceFn, build, query) => {
  const units = await allowedUnits(query.admin_card_no);
  const parts = [];
  for (const unitId of units) {
    const q = await queryForUnit(query, unitId);
    if (!q) continue;
    const data = await serviceFn({ unitId, location: null, ...build(q) });
    const company = data?.meta?.unit_name || `Company ${unitId}`;
    parts.push({ unitId, company, data });
  }
  return mergeParts(parts);
};

// Every report handler is the same shape: resolve scope, call the service,
// return { status, data }. `build` maps the validated query onto service args.
const handler = (serviceFn, build) => async (req, res, next) => {
  try {
    const query = res.locals.validated.query;
    if (isAll(query)) {
      res.json({ status: "success", data: await runAllCompanies(serviceFn, build, query) });
      return;
    }
    const { unitId, location } = await scope(query);
    const data = await serviceFn({ unitId, location, ...build(query) });
    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
};

// GET /reports/lookups — periods + designation groups for the filter bar.
export const getLookups = async (req, res, next) => {
  try {
    const query = res.locals.validated.query;
    const all = isAll(query);
    const unitId = all ? null : (await scope(query)).unitId;
    const [periods, desg_groups, deductions] = await Promise.all([
      all ? reportsService.listReportMonths(await allowedUnits(query.admin_card_no)) : reportsService.listReportPeriods(unitId),
      reportsService.listDesgGroups(),
      reportsService.listDeductionTypes(),
    ]);
    res.json({ status: "success", data: { unit_id: unitId, all_companies: all, periods, desg_groups, deductions } });
  } catch (err) {
    next(err);
  }
};

export const getAllowanceDetailReport = handler(
  reportsService.getAllowanceDetailReport,
  (q) => ({ periodFrom: q.period_from, periodTo: q.period_to, empcode: q.empcode, rtype: q.rtype })
);

export const getDeductionDetailReport = handler(
  reportsService.getDeductionDetailReport,
  (q) => ({ periodFrom: q.period_from, periodTo: q.period_to, empcode: q.empcode, rtype: q.rtype })
);

export const getAllowanceReconReport = handler(
  reportsService.getAllowanceReconReport,
  (q) => ({ periodFrom: q.period_from, periodTo: q.period_to, empcode: q.empcode })
);

export const getDeductionReconReport = handler(
  reportsService.getDeductionReconReport,
  (q) => ({ periodFrom: q.period_from, periodTo: q.period_to, empcode: q.empcode })
);

export const getMonthWiseDeductionReport = handler(
  reportsService.getMonthWiseDeductionReport,
  (q) => ({
    periodFrom: q.period_from, periodTo: q.period_to,
    deductionId: q.deduction_id, deptNo: q.dept_no, empcode: q.empcode,
  })
);

export const getBankAdviceReport = handler(
  reportsService.getBankAdviceReport,
  (q) => ({ period: q.period, desgGrp: q.desg_grp, transId: q.trans_id, rtype: q.rtype })
);

export const getAbsentSuppReport = handler(
  reportsService.getAbsentSuppReport,
  (q) => ({ period: q.period, deptNo: q.dept_no })
);

export const getMonthlyAttendanceReport = handler(
  reportsService.getMonthlyAttendanceReport,
  (q) => ({ fromDate: q.from_date, toDate: q.to_date, deptNo: q.dept_no })
);

export const getActiveEmployeesReport = handler(
  reportsService.getActiveEmployeesReport,
  (q) => ({
    rtype: q.rtype, empcode: q.empcode, empStatus: q.emp_status,
    grossFrom: q.gross_from, grossTo: q.gross_to,
    desgCd: q.desg_cd, deptNo: q.dept_no, desgGrp: q.desg_grp, gradeCd: q.grade_cd,
  })
);

// One employee's ledger. Across all companies: the first allowed company where
// that employee has a ledger (never a company outside the admin's rights).
export const getPfDetailReport = async (req, res, next) => {
  try {
    const query = res.locals.validated.query;
    if (isAll(query)) {
      let data = null;
      for (const unitId of await allowedUnits(query.admin_card_no)) {
        const d = await reportsService.getPfDetailReport({ unitId, empcode: query.empcode });
        if (!data) data = d;
        if (d.ledger.length || d.employee_header.name) { data = d; break; }
      }
      res.json({ status: "success", data });
      return;
    }
    const { unitId } = await scope(query);
    res.json({ status: "success", data: await reportsService.getPfDetailReport({ unitId, empcode: query.empcode }) });
  } catch (err) {
    next(err);
  }
};
