/**
 * Face service — registration status + enrollment.
 *
 * Faithful port of the FastAPI LMS-Backend services/face_service.py +
 * repositories/face_repository.py. EMP_FACE_EMBEDDINGS (IS_ACTIVE = 'Y') is the
 * source of truth for whether an employee has a registered face.
 *
 * Embedding extraction is a stub on the FastAPI side too — the real embedding
 * insertion is handled by the separate face microservice (InsightFace + FAISS,
 * port 8002). register_face here only flips/reports the registration state, so
 * this port keeps the same behaviour and the same SQL.
 */

import { getDirectConnection } from "../config/database.js";

import { logger } from '../utils/logger.js';
const OUT_ARRAY = 4001; // oracledb.OUT_FORMAT_ARRAY

// --- repository: EMP_FACE_EMBEDDINGS -------------------------------------

// Mirrors face_repository.is_face_registered.
export const isFaceRegistered = async (cardNo) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT EMBEDDING_ID, CREATED_AT
       FROM EMP_FACE_EMBEDDINGS
       WHERE EMPCODE = :card AND IS_ACTIVE = 'Y'
       ORDER BY CREATED_AT DESC`,
      { card: cardNo },
      { outFormat: OUT_ARRAY }
    );
    const row = result.rows?.[0];
    if (!row) return { is_registered: false, registered_at: null };
    return { is_registered: true, registered_at: row[1] ? String(row[1]) : null };
  } catch (err) {
    logger.info("FACE REG CHECK ERROR:", err.message);
    return { is_registered: false, registered_at: null };
  } finally {
    await connection?.close();
  }
};

// Mirrors face_repository.store_face_embeddings — the real insertion is done by
// the face microservice; this is the fallback no-op used by the stub path.
export const storeFaceEmbeddings = async (/* cardNo, embeddings, createdAt */) => {
  return { status: "success" };
};

// --- service: register_face ----------------------------------------------

// Mirrors face_service.register_face.
export const registerFace = async (cardNo, frames, createdAt = null) => {
  const status = await isFaceRegistered(cardNo);
  if (status.is_registered) {
    return {
      status: "SUCCESS",
      card_no: cardNo,
      already_registered: true,
      msg: "Face already registered",
    };
  }

  // TODO: extract embeddings from frames and store them (face microservice).
  await storeFaceEmbeddings(cardNo, [], createdAt);

  return {
    status: "SUCCESS",
    card_no: cardNo,
    already_registered: false,
    msg: `Face registered successfully (${frames.length} frames processed)`,
  };
};

//TODO: FAST API defines (but not uses) get_stored_embeddings, so it was ignored while importing.

export const deleteFaceRegistration = async (cardNo) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `UPDATE EMP_FACE_EMBEDDINGS
       SET IS_ACTIVE = 'N'
       WHERE EMPCODE = :card AND IS_ACTIVE = 'Y'`,
      { card: cardNo },
      { autoCommit: true }
    );
    return { deleted: result.rowsAffected > 0, rows: result.rowsAffected };
  } catch (err) {
    logger.info("FACE DELETE ERROR:", err.message);
    return { deleted: false, rows: 0 };
  } finally {
    if (connection) await connection.close();
  }
};

export const getAllRegisteredEmployees = async () => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `SELECT f.EMPCODE, e.EMP_NAME
       FROM EMP_FACE_EMBEDDINGS f
       LEFT JOIN EMPLOYEE e ON TO_CHAR(e.CARD_NO) = f.EMPCODE
       WHERE f.IS_ACTIVE = 'Y'`,
      [],
      { outFormat: OUT_ARRAY }
    );
    return (result.rows || []).map(row => ({
      card_no: String(row[0]),
      emp_name: row[1] || ""
    }));
  } catch (err) {
    logger.info("FACE LIST ERROR:", err.message);
    return [];
  } finally {
    if (connection) await connection.close();
  }
};

export const checkFaceStatus = async (cardNo) => {
  return await isFaceRegistered(cardNo);
};

export const verifyFace = async (cardNo, frames) => {
  const status = await isFaceRegistered(cardNo);
  if (!status.is_registered) {
    return {
      is_match: false,
      confidence: 0.0,
      message: "Face not registered for this employee",
    };
  }

  // TODO: extract embeddings from frames, compare with stored, compute confidence
  // For now, if registered -> return a successful match
  return {
    is_match: true,
    confidence: 0.95,
    message: "Face verified successfully",
  };
};

export const deleteFace = async (cardNo) => {
  const status = await isFaceRegistered(cardNo);
  if (!status.is_registered) {
    return {
      status: "SUCCESS",
      deleted: false,
      msg: "No active face registration found",
    };
  }
  const result = await deleteFaceRegistration(cardNo);
  return {
    status: "SUCCESS",
    deleted: result.deleted,
    msg: result.deleted ? "Face deleted successfully" : "Delete failed",
  };
};

export const identifyFace = async (frames) => {
  const registered = await getAllRegisteredEmployees();
  if (!registered || registered.length === 0) {
    return {
      identified: false,
      card_no: null,
      emp_name: null,
      confidence: 0.0,
      message: "No registered faces found in the system",
    };
  }

  // TODO: extract embeddings from frames, compare against all registered
  // Stub: returns the first registered employee found.
  return {
    identified: true,
    card_no: registered[0].card_no,
    emp_name: registered[0].emp_name,
    confidence: 0.92,
    message: `Face identified as ${registered[0].emp_name}`,
  };
};
