import {
  batchInsertLocations,
  getLocationHistory,
  getLocationSummary,
  getLocationReportSummary,
  getLocationTrail,
} from "../services/location.service.js";
import { resolveFilterLists } from "../services/adminRights.service.js";
import { toList } from "../utils/conversionHelpers.js";

// POST /auth/location/batch — mirrors FastAPI post_location_batch:
// success → { body: { inserted: <count> } }, error → 500 { detail: <msg> }.
export const locationBatch = async (req, res) => {
  try {
    const { card_no, locations } = res.locals.validated.body;
    const inserted = await batchInsertLocations(card_no, locations);
    return res.json({ body: { inserted } });
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
