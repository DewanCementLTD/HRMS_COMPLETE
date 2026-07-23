/**
 * HR controllers — thin request/response handlers for the /hr/* routes.
 *
 * HR-admin access is enforced by the requireHrAdmin middleware before these
 * run. Response shaping mirrors the FastAPI LMS-Backend routers/hr_router.py.
 */

import { searchEmployees, hrEnrollFace } from "../services/hr.service.js";

// GET /hr/employees/search
export const hrSearchEmployees = async (req, res, next) => {
  try {
    const { q } = res.locals.validated.query;
    const results = await searchEmployees(q);

    // Mirror the field mapping done in hr_router.hr_search_employees.
    const items = results.map((r) => ({
      card_no: String(r.card_no ?? ""),
      emp_name: r.emp_name ?? "",
      department: r.department ?? null,
      designation: r.designation ?? null,
      face_registered: (r.face_registered ?? "N") === "Y",
      mobile_no: r.mobile_no ?? null,
      empcode: r.empcode ?? null,
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
};

// POST /hr/face/enroll
export const hrEnrollEmployeeFace = async (req, res, next) => {
  try {
    const { card_no, frames, created_at } = res.locals.validated.body;

    // Mirror the FastAPI guard: minimum 10 frames required.
    if (frames.length < 10) {
      return res.status(400).json({ detail: "Minimum 10 frames required" });
    }

    const result = await hrEnrollFace(card_no, frames, created_at ?? null);
    res.json({ body: result });
  } catch (err) {
    next(err);
  }
};
