import * as refService from "../services/reference.service.js";
import { resolveFilterLists, getAdminUsrid } from "../services/adminRights.service.js";

// Helper for POST endpoints targeting setup tables
const setupCompany = async (adminCardNo, compc) => {
  const { finalCompanies } = await resolveFilterLists(adminCardNo, compc, null);
  const parse = (v) => {
    const num = parseInt(String(v).trim(), 10);
    return isNaN(num) ? null : num;
  };
  if (compc) {
    const ci = parse(compc);
    const allowed = new Set((finalCompanies || []).map((c) => parse(c)));
    if (ci !== null && (allowed.size === 0 || allowed.has(ci))) {
      return ci;
    }
  }
  for (const v of finalCompanies || []) {
    const iv = parse(v);
    if (iv !== null) return iv;
  }
  return 1;
};

const setupCompanyBranch = async (adminCardNo, compc, brnch) => {
  const { finalCompanies, finalBranches } = await resolveFilterLists(adminCardNo, compc, brnch);
  const parse = (v) => {
    const num = parseInt(String(v).trim(), 10);
    return isNaN(num) ? null : num;
  };
  const firstInt = (lst, def) => {
    for (const v of lst || []) {
      const num = parse(v);
      if (num !== null) return num;
    }
    return def;
  };
  return [firstInt(finalCompanies, 1), firstInt(finalBranches, 1)];
};

const adminCompcBrnch = async (adminCardNo) => {
  return await setupCompanyBranch(adminCardNo, null, null);
};

const handleResult = (res, result) => {
  if (result.status === "error") {
    return res.status(400).json({ detail: result.message });
  }
  return res.json(result);
};

export const listDepartments = async (req, res, next) => {
  try {
    const { compc, brnch } = res.locals.validated.query;
    res.json({ items: await refService.getDepartments(compc, brnch) });
  } catch (err) { next(err); }
};

export const listGrades = async (req, res, next) => {
  try {
    const { compc, brnch } = res.locals.validated.query;
    res.json({ items: await refService.getGrades(compc, brnch) });
  } catch (err) { next(err); }
};

export const listDesignations = async (req, res, next) => {
  try {
    const { grade_cd, compc, brnch } = res.locals.validated.query;
    res.json({ items: await refService.getDesignations(grade_cd, compc, brnch) });
  } catch (err) { next(err); }
};

export const listEmpStatuses = async (req, res, next) => {
  try {
    const { compc } = res.locals.validated.query;
    res.json({ items: await refService.getEmpStatuses(compc) });
  } catch (err) { next(err); }
};

export const listBanks = async (req, res, next) => {
  try {
    const { compc } = res.locals.validated.query;
    res.json({ items: await refService.getBanks(compc) });
  } catch (err) { next(err); }
};

export const listBankBranches = async (req, res, next) => {
  try {
    const { bnkcode } = res.locals.validated.query;
    res.json({ items: await refService.getBankBranches(bnkcode) });
  } catch (err) { next(err); }
};

export const listQualifications = async (req, res, next) => {
  try {
    const { compc } = res.locals.validated.query;
    res.json({ items: await refService.getQualifications(compc) });
  } catch (err) { next(err); }
};

export const listShifts = async (req, res, next) => {
  try {
    const { compc, brnch } = res.locals.validated.query;
    res.json({ items: await refService.getShifts(compc, brnch) });
  } catch (err) { next(err); }
};

export const listShiftLov = async (req, res, next) => {
  try {
    res.json({ items: await refService.getShiftLov() });
  } catch (err) { next(err); }
};

export const listBloodGroups = async (req, res, next) => {
  try {
    const { compc, brnch } = res.locals.validated.query;
    res.json({ items: await refService.getBloodGroups(compc, brnch) });
  } catch (err) { next(err); }
};

export const listCadre = async (req, res, next) => {
  try {
    const { compc, brnch } = res.locals.validated.query;
    res.json({ items: await refService.getCadre(compc, brnch) });
  } catch (err) { next(err); }
};

export const listUnits = async (req, res, next) => {
  try {
    res.json({ items: await refService.getUnits() });
  } catch (err) { next(err); }
};

export const listReligions = async (req, res, next) => {
  try {
    res.json({ items: await refService.getReligions() });
  } catch (err) { next(err); }
};

export const listReportingOfficers = async (req, res, next) => {
  try {
    const { compc, brnch } = res.locals.validated.query;
    res.json({ items: await refService.getReportingOfficers(compc, brnch) });
  } catch (err) { next(err); }
};

export const listLocations = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch } = res.locals.validated.query;
    let allowedBranches = null;
    if (admin_card_no) {
      const { finalBranches } = await resolveFilterLists(admin_card_no, compc, brnch);
      if (finalBranches) allowedBranches = finalBranches;
    }
    res.json({ items: await refService.getLocations(allowedBranches, compc) });
  } catch (err) { next(err); }
};

export const createDepartment = async (req, res, next) => {
  try {
    const { admin_card_no } = res.locals.validated.query;
    const { dept_name } = res.locals.validated.body;
    const [compc, brnch] = await adminCompcBrnch(admin_card_no);
    handleResult(res, await refService.addDepartment(dept_name, compc, brnch));
  } catch (err) { next(err); }
};

export const createGrade = async (req, res, next) => {
  try {
    const { admin_card_no } = res.locals.validated.query;
    const { grade_cd, descr } = res.locals.validated.body;
    const [compc, brnch] = await adminCompcBrnch(admin_card_no);
    handleResult(res, await refService.addGrade(grade_cd, descr, compc, brnch));
  } catch (err) { next(err); }
};

export const createDesignation = async (req, res, next) => {
  try {
    const { admin_card_no } = res.locals.validated.query;
    const { grade_cd, desg_desc } = res.locals.validated.body;
    const [compc, brnch] = await adminCompcBrnch(admin_card_no);
    handleResult(res, await refService.addDesignation(grade_cd, desg_desc, compc, brnch));
  } catch (err) { next(err); }
};

export const createShift = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch } = res.locals.validated.query;
    const [rc, rb] = await setupCompanyBranch(admin_card_no, compc, brnch);
    handleResult(res, await refService.addShiftHead(res.locals.validated.body, rc, rb));
  } catch (err) { next(err); }
};

export const editShift = async (req, res, next) => {
  try {
    const { pk } = res.locals.validated.params;
    handleResult(res, await refService.updateShiftHead(pk, res.locals.validated.body));
  } catch (err) { next(err); }
};

export const removeShift = async (req, res, next) => {
  try {
    const { pk } = res.locals.validated.params;
    handleResult(res, await refService.deleteShiftHead(pk));
  } catch (err) { next(err); }
};

export const createBloodGroup = async (req, res, next) => {
  try {
    const { admin_card_no } = res.locals.validated.query;
    const { blood_group } = res.locals.validated.body;
    const [compc, brnch] = await adminCompcBrnch(admin_card_no);
    handleResult(res, await refService.addBloodGroup(blood_group, compc, brnch));
  } catch (err) { next(err); }
};

export const createCadre = async (req, res, next) => {
  try {
    const { admin_card_no } = res.locals.validated.query;
    const { cadre } = res.locals.validated.body;
    const [compc, brnch] = await adminCompcBrnch(admin_card_no);
    handleResult(res, await refService.addCadre(cadre, compc, brnch));
  } catch (err) { next(err); }
};

export const createUnit = async (req, res, next) => {
  try {
    const { unit_name } = res.locals.validated.body;
    handleResult(res, await refService.addUnit(unit_name));
  } catch (err) { next(err); }
};

export const getNextLocationCode = async (req, res, next) => {
  try {
    res.json({ lcode: await refService.getNextLocationCode() });
  } catch (err) { next(err); }
};

export const createLocation = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const { descr, sname, regioncode, city } = res.locals.validated.body;
    const company = await setupCompany(admin_card_no, compc);
    // COM_LOCATION.USRID is NOT NULL — stamp the acting admin's SEC_USERNAME id.
    const usrid = await getAdminUsrid(admin_card_no);
    // LCODE is globally unique across all companies (PK_LOC), unlike
    // HR_DEPT/HR_DESG whose codes repeat per COMPC — always auto-generate it
    // server-side so admins can never collide with another company's code.
    const lcode = await refService.getNextLocationCode();
    handleResult(res, await refService.addLocation(lcode, descr, sname || descr, regioncode || "", city || "", company, usrid));
  } catch (err) { next(err); }
};

export const editLocation = async (req, res, next) => {
  try {
    const { lcode } = res.locals.validated.params;
    const { descr, sname, regioncode, city } = res.locals.validated.body;
    handleResult(res, await refService.updateLocation(lcode, descr, sname || descr, regioncode || "", city || ""));
  } catch (err) { next(err); }
};

export const createEmpStatus = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const { descr } = res.locals.validated.body;
    const company = await setupCompany(admin_card_no, compc);
    handleResult(res, await refService.addEmpStatus(descr, company));
  } catch (err) { next(err); }
};

export const removeEmpStatus = async (req, res, next) => {
  try {
    const { emp_status } = res.locals.validated.params;
    const { admin_card_no, compc } = res.locals.validated.query;
    const company = await setupCompany(admin_card_no, compc);
    handleResult(res, await refService.deleteEmpStatus(emp_status, company));
  } catch (err) { next(err); }
};

export const createBank = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const { bnkname } = res.locals.validated.body;
    const company = await setupCompany(admin_card_no, compc);
    handleResult(res, await refService.addBank(bnkname, company));
  } catch (err) { next(err); }
};

export const removeBank = async (req, res, next) => {
  try {
    const { bnkcode } = res.locals.validated.params;
    const { admin_card_no, compc } = res.locals.validated.query;
    const company = await setupCompany(admin_card_no, compc);
    handleResult(res, await refService.deleteBank(bnkcode, company));
  } catch (err) { next(err); }
};

export const createBankBranch = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const { bnkcode, brnname } = res.locals.validated.body;
    const company = await setupCompany(admin_card_no, compc);
    handleResult(res, await refService.addBankBranch(bnkcode, brnname, company));
  } catch (err) { next(err); }
};

export const removeBankBranch = async (req, res, next) => {
  try {
    const { bnkcode, brncode } = res.locals.validated.params;
    const { admin_card_no, compc } = res.locals.validated.query;
    const company = await setupCompany(admin_card_no, compc);
    handleResult(res, await refService.deleteBankBranch(bnkcode, brncode, company));
  } catch (err) { next(err); }
};

export const createQualification = async (req, res, next) => {
  try {
    const { admin_card_no, compc } = res.locals.validated.query;
    const { descr } = res.locals.validated.body;
    const company = await setupCompany(admin_card_no, compc);
    handleResult(res, await refService.addQualification(descr, company));
  } catch (err) { next(err); }
};

export const removeQualification = async (req, res, next) => {
  try {
    const { descr } = res.locals.validated.params;
    const { admin_card_no, compc } = res.locals.validated.query;
    const company = await setupCompany(admin_card_no, compc);
    handleResult(res, await refService.deleteQualification(descr, company));
  } catch (err) { next(err); }
};

export const listInterviewTypes = async (req, res, next) => {
  try {
    const { compc, brnch } = res.locals.validated.query;
    res.json({ items: await refService.getInterviewTypes(compc, brnch) });
  } catch (err) { next(err); }
};

export const createInterviewType = async (req, res, next) => {
  try {
    const { admin_card_no, compc, brnch } = res.locals.validated.query;
    const { descr } = res.locals.validated.body;
    const company = await setupCompany(admin_card_no, compc);
    handleResult(res, await refService.addInterviewType(descr, company, brnch));
  } catch (err) { next(err); }
};

export const removeInterviewType = async (req, res, next) => {
  try {
    const { type_id } = res.locals.validated.params;
    const { admin_card_no, compc } = res.locals.validated.query;
    const company = await setupCompany(admin_card_no, compc);
    handleResult(res, await refService.removeInterviewType(type_id, company));
  } catch (err) { next(err); }
};
