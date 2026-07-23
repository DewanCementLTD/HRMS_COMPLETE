import { Router } from "express";
import { validate } from "../middlewares/validate.middleware.js";
import { requireHrAdmin } from "../middlewares/hrAdmin.middleware.js";
import * as schemas from "../models/reference.schema.js";
import * as controllers from "../controllers/reference.controller.js";

const router = Router();

// ==========================================
// READ endpoints (Public for authenticated)
// ==========================================
// [x] http://localhost:8000/reference/departments
router.get("/departments", validate(schemas.readFilterSchema), controllers.listDepartments);

// [x] http://localhost:8000/reference/grades
router.get("/grades", validate(schemas.readFilterSchema), controllers.listGrades);

// [x] http://localhost:8000/reference/designations
router.get("/designations", validate(schemas.readFilterSchema), controllers.listDesignations);

// [x] http://localhost:8000/reference/emp-statuses
router.get("/emp-statuses", validate(schemas.readFilterSchema), controllers.listEmpStatuses);

// [x] http://localhost:8000/reference/banks
router.get("/banks", validate(schemas.readFilterSchema), controllers.listBanks);

// [x] http://localhost:8000/reference/bank-branches
router.get("/bank-branches", validate(schemas.readFilterSchema), controllers.listBankBranches);

// [x] http://localhost:8000/reference/qualifications
router.get("/qualifications", validate(schemas.readFilterSchema), controllers.listQualifications);

// [x] http://localhost:8000/reference/shifts
router.get("/shifts", validate(schemas.readFilterSchema), controllers.listShifts);

// [x] http://localhost:8000/reference/shift-lov
router.get("/shift-lov", controllers.listShiftLov);

// [x] http://localhost:8000/reference/blood-groups
router.get("/blood-groups", validate(schemas.readFilterSchema), controllers.listBloodGroups);

// [x] http://localhost:8000/reference/cadre
router.get("/cadre", validate(schemas.readFilterSchema), controllers.listCadre);

// [x] http://localhost:8000/reference/units
router.get("/units", controllers.listUnits);

// [x] http://localhost:8000/reference/religions
router.get("/religions", controllers.listReligions);

// [x] http://localhost:8000/reference/reporting-officers
router.get("/reporting-officers", validate(schemas.readFilterSchema), controllers.listReportingOfficers);

// [x] http://localhost:8000/reference/locations?admin_card_no=100001.1
router.get("/locations", validate(schemas.readFilterSchema), controllers.listLocations);

// ==========================================
// ADD/EDIT endpoints (HR Admin Only)
// ==========================================

// [-] http://localhost:8000/reference/departments?admin_card_no=100001.1
//     Body: { "dept_name": "Test Dept" }
router.post("/departments", validate(schemas.addDeptSchema), requireHrAdmin, controllers.createDepartment);

// [-] http://localhost:8000/reference/grades?admin_card_no=100001.1
//     Body: { "grade_cd": "T1", "descr": "Test Grade" }
router.post("/grades", validate(schemas.addGradeSchema), requireHrAdmin, controllers.createGrade);

// [-] http://localhost:8000/reference/designations?admin_card_no=100001.1
//     Body: { "grade_cd": "T1", "desg_desc": "Test Desg" }
router.post("/designations", validate(schemas.addDesignationSchema), requireHrAdmin, controllers.createDesignation);

// [-] http://localhost:8000/reference/shifts?admin_card_no=100001.1
//     Body: { "shift": "T", "shift_desc": "Test Shift", "time_from": "09:00", "time_to": "18:00" }
router.post("/shifts", validate(schemas.shiftSchema), requireHrAdmin, controllers.createShift);

// [-] http://localhost:8000/reference/shifts/1?admin_card_no=100001.1
//     Body: { "shift": "T", "shift_desc": "Updated Shift", "time_from": "10:00", "time_to": "19:00" }
router.put("/shifts/:pk", validate(schemas.shiftUpdateSchema), requireHrAdmin, controllers.editShift);

// [x] http://localhost:8000/reference/shifts/1?admin_card_no=100001.1
router.delete("/shifts/:pk", validate(schemas.shiftIdSchema), requireHrAdmin, controllers.removeShift);

// [-] http://localhost:8000/reference/blood-groups?admin_card_no=100001.1
//     Body: { "blood_group": "T+" }
router.post("/blood-groups", validate(schemas.addBloodGroupSchema), requireHrAdmin, controllers.createBloodGroup);

// [-] http://localhost:8000/reference/cadre?admin_card_no=100001.1
//     Body: { "cadre": "Test Cadre" }
router.post("/cadre", validate(schemas.addCadreSchema), requireHrAdmin, controllers.createCadre);

// [-] http://localhost:8000/reference/units?admin_card_no=100001.1
//     Body: { "unit_name": "Test Unit" }
router.post("/units", validate(schemas.addUnitSchema), requireHrAdmin, controllers.createUnit);

// [-] http://localhost:8000/reference/locations?admin_card_no=100001.1
//     Body: { "lcode": "TLOC", "descr": "Test Location", "city": "Test City" }
router.post("/locations", validate(schemas.locationSchema), requireHrAdmin, controllers.createLocation);

// [-] http://localhost:8000/reference/locations/LOC1?admin_card_no=100001.1
//     Body: { "lcode": "TLOC", "descr": "Updated Location", "city": "Test City" }
router.put("/locations/:lcode", validate(schemas.locationUpdateSchema), requireHrAdmin, controllers.editLocation);

// [-] http://localhost:8000/reference/emp-statuses?admin_card_no=100001.1
//     Body: { "descr": "Test Status" }
router.post("/emp-statuses", validate(schemas.addEmpStatusSchema), requireHrAdmin, controllers.createEmpStatus);

// [x] http://localhost:8000/reference/emp-statuses/1?admin_card_no=100001.1
router.delete("/emp-statuses/:emp_status", validate(schemas.removeEmpStatusSchema), requireHrAdmin, controllers.removeEmpStatus);

// [-] http://localhost:8000/reference/banks?admin_card_no=100001.1
//     Body: { "bnkname": "Test Bank" }
router.post("/banks", validate(schemas.addBankSchema), requireHrAdmin, controllers.createBank);

// [x] http://localhost:8000/reference/banks/BNK1?admin_card_no=100001.1
router.delete("/banks/:bnkcode", validate(schemas.removeBankSchema), requireHrAdmin, controllers.removeBank);

// [-] http://localhost:8000/reference/bank-branches?admin_card_no=100001.1
//     Body: { "bnkcode": "BNK1", "brnname": "Test Branch" }
router.post("/bank-branches", validate(schemas.addBankBranchSchema), requireHrAdmin, controllers.createBankBranch);

// [x] http://localhost:8000/reference/bank-branches/BNK1/BRN1?admin_card_no=100001.1
router.delete("/bank-branches/:bnkcode/:brncode", validate(schemas.removeBankBranchSchema), requireHrAdmin, controllers.removeBankBranch);

// [-] http://localhost:8000/reference/qualifications?admin_card_no=100001.1
//     Body: { "descr": "Test Qual" }
router.post("/qualifications", validate(schemas.addQualificationSchema), requireHrAdmin, controllers.createQualification);

// [x] http://localhost:8000/reference/qualifications/BSc?admin_card_no=100001.1
router.delete("/qualifications/:descr", validate(schemas.removeQualificationSchema), requireHrAdmin, controllers.removeQualification);

// [x] http://localhost:8000/reference/interview-types
router.get("/interview-types", validate(schemas.readFilterSchema), controllers.listInterviewTypes);

// [-] http://localhost:8000/reference/interview-types?admin_card_no=100001.1
//     Body: { "descr": "Test Interview Type" }
router.post("/interview-types", validate(schemas.addInterviewTypeSchema), requireHrAdmin, controllers.createInterviewType);

// [x] http://localhost:8000/reference/interview-types/1?admin_card_no=100001.1
router.delete("/interview-types/:type_id", validate(schemas.removeInterviewTypeSchema), requireHrAdmin, controllers.removeInterviewType);


export default router;
