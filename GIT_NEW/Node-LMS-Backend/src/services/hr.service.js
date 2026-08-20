/**
 * HR service — employee search + HR-initiated face enrollment.
 *
 * Faithful port of the FastAPI LMS-Backend services/hr_service.py. The search
 * SQL (EMPLOYEE view LEFT JOIN HR_EMP_MASTER, LIKE across name/mobile/card/
 * empcode) is kept identical so both backends return the same rows.
 *
 * NOTE: unlike /hrms, the FastAPI /hr/employees/search is NOT company/branch
 * scoped — it searches the whole EMPLOYEE view — so this port intentionally
 * applies no compc/brnch filter here either.
 */

import { getDirectConnection } from "../config/database.js";
import { registerFace } from "./face.service.js";

const OUT_OBJECT = 4002; // oracledb.OUT_FORMAT_OBJECT

// Lowercase every key of an OBJECT-format row (matches Python's
// [col[0].lower() for col in cursor.description]).
const lowerKeys = (row) => {
  const out = {};
  for (const k of Object.keys(row)) out[k.toLowerCase()] = row[k];
  return out;
};

// GET /hr/employees/search  — mirrors hr_service.search_employees.
export const searchEmployees = async (query) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const like = `%${query.toUpperCase()}%`;
    const result = await connection.execute(
      `SELECT
          TO_CHAR(e.CARD_NO)              AS card_no,
          e.EMP_NAME,
          e.DEPARTMENT,
          e.DESIGNATION,
          NVL((SELECT MAX(f.IS_ACTIVE) FROM EMP_FACE_EMBEDDINGS f WHERE f.EMPCODE = e.EMPCODE AND f.IS_ACTIVE = 'Y'), 'N') AS face_registered,
          e.MOBILE_NO,
          e.EMPCODE
      FROM EMPLOYEE e
      LEFT JOIN HR_EMP_MASTER h ON e.EMPCODE = h.EMPCODE
      WHERE UPPER(e.EMP_NAME) LIKE :q
          OR e.MOBILE_NO LIKE :q
          OR TO_CHAR(e.CARD_NO) LIKE :q
          OR UPPER(e.EMPCODE) LIKE :q
      ORDER BY e.EMP_NAME
      FETCH FIRST 50 ROWS ONLY`,
      { q: like },
      { outFormat: OUT_OBJECT },
    );
    return (result.rows ?? []).map(lowerKeys);
  } finally {
    await connection?.close();
  }
};

// POST /hr/face/enroll  — mirrors hr_service.hr_enroll_face (same as register,
// but HR-initiated).
export const hrEnrollFace = async (cardNo, frames, createdAt = null) => {
  return registerFace(cardNo, frames, createdAt);
};
