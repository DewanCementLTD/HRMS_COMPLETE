import {
  batchInsertLocations,
  getLocationHistory,
  getLocationSummary,
  getLocationReportSummary,
  getLocationTrail,
} from "../services/location.service.js";
import { resolveFilterLists } from "../services/adminRights.service.js";
import { toList } from "../utils/conversionHelpers.js";
import { verifyEmployeeToken } from "../services/employeeSession.service.js";
import { logger } from "../utils/logger.js";

// 2026-09-22: this endpoint accepted uploads with no Authorization header at
// all, so anyone could write location history for any card_no. Reusing the
// SAME session token /auth/location/sync already requires (issued at login,
// services/employeeSession.service.js) — no new token scheme needed, since
// this backend already mints one.
//
// Deliberately NOT requireEmployee: that middleware also enforces the
// token's card_no == the request's card_no, which must NOT apply here. On a
// shared phone the app can legitimately upload a previous employee's
// buffered points under that employee's card while a different person is
// now logged in — only proof of *some* logged-in session is required, never
// a card match.
//
// Rollout (LOCATION_BATCH_ENFORCE_TOKEN env var, no redeploy needed):
//   unset/false (current default) — missing/invalid tokens are only logged,
//     so the app (which does not yet store/send this token) keeps uploading
//     normally.
//   true — missing/invalid tokens are rejected with 401. The app keeps those
//     points locally and retries later, so nothing is lost — flip this on
//     only once an app build that sends the token has had a few days to roll
//     out.
const locationBatchEnforceToken = () =>
  String(process.env.LOCATION_BATCH_ENFORCE_TOKEN ?? '').trim().toLowerCase() === 'true';

// POST /auth/location/batch — mirrors FastAPI post_location_batch:
// success → { body: { inserted: <count>, discarded: <count> } },
// error → 500 { detail: <msg> }.
//
// Always 200 on a processed request, even when every point was discarded for
// falling outside its session window (no check-in that day / after checkout /
// past the shift-end+grace cutoff) — the app retries anything but 200
// forever, and an out-of-window point must never be retried. `inserted` keeps
// its original meaning; `discarded` is additive.
export const locationBatch = async (req, res) => {
  try {
    const { card_no, locations } = res.locals.validated.body;

    const header = String(req.headers.authorization ?? '');
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const session = token ? verifyEmployeeToken(token) : null;
    if (!session) {
      const reason = !header
        ? 'missing Authorization header'
        : !token
          ? 'malformed Authorization header'
          : 'invalid/expired token';
      logger.warn(
        `[LOCATION_BATCH_AUTH] card_no=${card_no}: ${reason} (enforce=${locationBatchEnforceToken()})`,
      );
      if (locationBatchEnforceToken()) {
        return res.status(401).json({ detail: 'Login required' });
      }
    }

    const { inserted, discarded } = await batchInsertLocations(card_no, locations);
    return res.json({ body: { inserted, discarded } });
  } catch (e) {
    return res.status(500).json({ detail: String(e.message ?? e) });
  }
};

export const locationHistory = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const { date } = res.locals.validated.query;
    const body = await getLocationHistory(card_no, date);
    res.json({ body });
  } catch (err) {
    next(err);
  }
};

export const locationSummary = async (req, res, next) => {
  try {
    const { date, admin_card_no, compc, brnch } = res.locals.validated.query;

    // Company/branch are always intersected with the admin's rights server-side.
    const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);

    const employees = await getLocationSummary(date, finalCompanies, finalBranches);
    res.json({ body: { date, employees } });
  } catch (err) {
    next(err);
  }
};

export const locationReportSummary = async (req, res, next) => {
  try {
    const {
      from_date,
      to_date,
      admin_card_no,
      compc,
      brnch,
      dept_no,
      desg_cd,
    } = res.locals.validated.query;

    // Bug 5.1: Enforce company/branch scoping — same as locationTrail.
    const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);

    const items = await getLocationReportSummary({
      from_date,
      to_date,
      allowedCompanies: finalCompanies,
      allowedBranches: finalBranches,
      dept_no: toList(dept_no),
      desg_cd: toList(desg_cd),
    });

    res.json({
      items,
      from_date,
      to_date,
    });
  } catch (err) {
    next(err);
  }
};

export const locationTrail = async (req, res, next) => {
  try {
    const {
      from_date,
      to_date,
      admin_card_no,
      compc,
      brnch,
      dept_no,
      desg_cd,
      empcodes,
      region,
      category,
    } = res.locals.validated.query;

    // Company/branch are always intersected with the admin's rights server-side.
    const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);

    const items = await getLocationTrail({
      fromDate: from_date,
      toDate: to_date,
      allowedCompanies: finalCompanies,
      allowedBranches: finalBranches,
      deptNo: toList(dept_no),
      desgCd: toList(desg_cd),
      empcodes: toList(empcodes),
      region: toList(region),
      category: toList(category),
    });

    res.json({ items, from_date, to_date });
  } catch (err) {
    next(err);
  }
};
