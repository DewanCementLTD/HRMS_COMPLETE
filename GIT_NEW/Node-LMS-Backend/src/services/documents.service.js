/**
 * Employee document service (HR_DOCUMENT).
 *
 * Direct port of the FastAPI LMS-Backend (repositories/document_repository.py).
 *
 * Files are stored on disk under EMP_DOCS, organised by company and branch:
 *     EMP_DOCS/Comp{unit_id}/branch{location}/{doc_id}.{ext}
 * Only the relative path is kept in the DB (HR_DOCUMENT.IMG_NM) — never the bytes.
 *
 * Column mapping:
 *     DOC_ID      -> id
 *     OLD_EMPCODE -> employee identifier (the empcode used by the app)
 *     UNIT_ID     -> company
 *     D_TYPE      -> document type
 *     D_PATH      -> document name
 *     REMRK       -> remarks
 *     IMG_NM      -> saved relative file path (the "Image Name" / address)
 */

import fs from 'fs';
import path from 'path';
import oracledb from 'oracledb';
import { getDirectConnection } from '../config/database.js';

import { logger } from '../utils/logger.js';
// Root directory for all employee documents. Overridable via EMP_DOCS_ROOT.
// Default: C:\Erp_Systems\HRMS_LMS_APP\EMP_DOCS — same location the FastAPI
// backend writes to, so both servers see the same files.
export const DOCS_ROOT = process.env.EMP_DOCS_ROOT || 'E:\\DCL_LMS\\HRMS_COMPLETE\\Node-LMS-Backend\\EMP_PHOTOS';
// Parent of EMP_DOCS — relative paths stored in HR_DOCUMENT.IMG_NM resolve against this.
export const DOCS_BASE = path.dirname(DOCS_ROOT);

/**
 * Make a string safe to use as a folder name: strip filesystem-illegal
 * characters, collapse whitespace, trim trailing dots/spaces. (mirror _safe_name)
 */
export const safeName = (name, fallback) => {
  let s = String(name ?? '').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  s = s.replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
  return s || fallback;
};

/**
 * Return { unit, branch, companyFolder, branchFolder } for an employee.
 * Folder names use the real company/branch names where available, falling
 * back to Comp{id}/branch{code}. (mirror _emp_unit_branch)
 */
const empUnitBranch = async (connection, empcode) => {
  const r = (
    await connection.execute(
      `SELECT NVL(UNIT_ID, 1), NVL(LOCATION, '0') FROM HR_EMP_MASTER WHERE EMPCODE = :e`,
      { e: empcode },
      { outFormat: oracledb.OUT_FORMAT_ARRAY }
    )
  ).rows?.[0];

  const unit = r && r[0] !== null && r[0] !== undefined ? parseInt(r[0], 10) : 1;
  const branch =
    (r && r[1] !== null && r[1] !== undefined ? String(r[1]).trim() : '0') || '0';

  let companyName = null;
  try {
    const cr = (
      await connection.execute(
        `SELECT UNIT_NAME FROM UNIT_MST WHERE UNIT_ID = :u`,
        { u: unit },
        { outFormat: oracledb.OUT_FORMAT_ARRAY }
      )
    ).rows?.[0];
    companyName = cr ? cr[0] : null;
  } catch {
    /* ignore — fall back to Comp{unit} */
  }

  let branchName = null;
  try {
    const br = (
      await connection.execute(
        `SELECT DESCR FROM COM_LOCATION WHERE LCODE = :l`,
        { l: branch },
        { outFormat: oracledb.OUT_FORMAT_ARRAY }
      )
    ).rows?.[0];
    branchName = br ? br[0] : null;
  } catch {
    /* ignore — fall back to branch{code} */
  }

  return {
    unit,
    branch,
    companyFolder: safeName(companyName, `Comp${unit}`),
    branchFolder: safeName(branchName, `branch${branch}`),
  };
};

// ---------------------------------------------------------------------------
// HR_DOCUMENT rows
// ---------------------------------------------------------------------------

export const listDocuments = async (empcode) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const rows =
      (
        await connection.execute(
          `
          SELECT DOC_ID, D_TYPE, D_PATH, REMRK, IMG_NM
          FROM HR_DOCUMENT
          WHERE OLD_EMPCODE = :e
          ORDER BY DOC_ID DESC
          `,
          { e: String(empcode) },
          { outFormat: oracledb.OUT_FORMAT_ARRAY }
        )
      ).rows ?? [];

    return rows.map((r) => ({
      doc_id: parseInt(r[0], 10),
      d_type: String(r[1] ?? '').trim(),
      doc_name: String(r[2] ?? '').trim(),
      remarks: String(r[3] ?? '').trim(),
      img_name: String(r[4] ?? '').trim(),
    }));
  } finally {
    await connection?.close();
  }
};

/**
 * Insert an HR_DOCUMENT row and return where the file should be written.
 * Returns { doc_id, rel_path, abs_path, abs_dir }. (mirror create_document)
 */
export const createDocument = async (empcode, dType, docName, remarks, ext) => {
  let connection;
  try {
    connection = await getDirectConnection();

    const { unit, companyFolder, branchFolder } = await empUnitBranch(connection, empcode);

    const docId = parseInt(
      (
        await connection.execute(
          `SELECT NVL(MAX(DOC_ID), 0) + 1 FROM HR_DOCUMENT`,
          {},
          { outFormat: oracledb.OUT_FORMAT_ARRAY }
        )
      ).rows[0][0],
      10
    );

    const cleanExt = String(ext ?? '').replace(/^\.+/, '').toLowerCase() || 'bin';
    // File name: <empcode>_<doc_id>.<ext>  e.g. 100011.2_5.png
    const fname = `${safeName(String(empcode), 'emp')}_${docId}.${cleanExt}`;
    const relDir = path.join('EMP_DOCS', companyFolder, branchFolder);
    const relPath = path.join(relDir, fname);
    const absDir = path.join(DOCS_BASE, relDir);
    const absPath = path.join(DOCS_BASE, relPath);

    await connection.execute(
      `
      INSERT INTO HR_DOCUMENT (DOC_ID, OLD_EMPCODE, UNIT_ID, D_TYPE, D_PATH, REMRK, IMG_NM)
      VALUES (:id, :e, :u, :t, :p, :r, :img)
      `,
      {
        id: docId,
        e: String(empcode),
        u: unit,
        t: String(dType ?? '').slice(0, 10),
        p: String(docName ?? '').slice(0, 500),
        r: String(remarks ?? '').slice(0, 500),
        img: relPath.slice(0, 500),
      },
      { autoCommit: true }
    );

    return { doc_id: docId, rel_path: relPath, abs_path: absPath, abs_dir: absDir };
  } finally {
    await connection?.close();
  }
};

export const getDocument = async (docId) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const r = (
      await connection.execute(
        `
        SELECT DOC_ID, OLD_EMPCODE, D_TYPE, D_PATH, REMRK, IMG_NM
        FROM HR_DOCUMENT WHERE DOC_ID = :id
        `,
        { id: docId },
        { outFormat: oracledb.OUT_FORMAT_ARRAY }
      )
    ).rows?.[0];

    if (!r) return null;
    const rel = String(r[5] ?? '').trim();
    return {
      doc_id: parseInt(r[0], 10),
      empcode: String(r[1] ?? '').trim(),
      d_type: String(r[2] ?? '').trim(),
      doc_name: String(r[3] ?? '').trim(),
      remarks: String(r[4] ?? '').trim(),
      img_name: rel,
      abs_path: rel ? path.join(DOCS_BASE, rel) : null,
    };
  } finally {
    await connection?.close();
  }
};

/** Delete the DB row and remove the file from disk (best-effort). */
export const deleteDocument = async (docId) => {
  const doc = await getDocument(docId);
  let connection;
  try {
    connection = await getDirectConnection();
    await connection.execute(
      `DELETE FROM HR_DOCUMENT WHERE DOC_ID = :id`,
      { id: docId },
      { autoCommit: true }
    );
    if (doc?.abs_path && fs.existsSync(doc.abs_path) && fs.statSync(doc.abs_path).isFile()) {
      try {
        fs.unlinkSync(doc.abs_path);
      } catch (e) {
        logger.info(`[DOCS] file remove failed (row deleted): ${e.message ?? e}`);
      }
    }
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: String(e.message ?? e) };
  } finally {
    await connection?.close();
  }
};

// ---------------------------------------------------------------------------
// EMPLOYEE PHOTO  (stored on disk under EMP_PHOTOS, path in HR_EMP_MASTER.PATH)
// ---------------------------------------------------------------------------

const PHOTO_DIRNAME = 'EMP_PHOTOS';

/**
 * Return where an employee's photo should be written + the relative path to
 * store in HR_EMP_MASTER.PATH. (mirror employee_photo_target)
 */
export const employeePhotoTarget = (empcode, ext) => {
  const safe = safeName(String(empcode), 'emp');
  const cleanExt = String(ext ?? '').replace(/^\.+/, '').toLowerCase() || 'jpg';
  const rel = path.join(PHOTO_DIRNAME, `${safe}.${cleanExt}`);
  return {
    rel_path: rel,
    abs_path: path.join(DOCS_BASE, rel),
    abs_dir: path.join(DOCS_BASE, PHOTO_DIRNAME),
  };
};

export const setEmployeePhotoPath = async (empcode, relPath) => {
  let connection;
  try {
    connection = await getDirectConnection();
    let result = await connection.execute(
      `UPDATE HR_EMP_MASTER SET PATH = :p WHERE EMPCODE = :e`,
      { p: relPath, e: String(empcode) }
    );
    if ((result.rowsAffected ?? 0) === 0) {
      result = await connection.execute(
        `UPDATE HR_EMP_MASTER SET PATH = :p WHERE OLD_EMPCODE = :e`,
        { p: relPath, e: String(empcode) }
      );
    }
    await connection.commit();
    return (result.rowsAffected ?? 0) > 0;
  } finally {
    await connection?.close();
  }
};

/** Absolute path to an employee's photo file, or null if not set/missing. */
export const getEmployeePhotoAbs = async (empcode) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const r = (
      await connection.execute(
        `SELECT PATH FROM HR_EMP_MASTER WHERE EMPCODE = :e OR OLD_EMPCODE = :e`,
        { e: String(empcode) },
        { outFormat: oracledb.OUT_FORMAT_ARRAY }
      )
    ).rows?.[0];

    const rel = r ? String(r[0] ?? '').trim() : '';
    if (!rel) return null;
    const absPath = path.isAbsolute(rel) ? rel : path.join(DOCS_BASE, rel);
    logger.info(absPath);
    return fs.existsSync(absPath) && fs.statSync(absPath).isFile() ? absPath : null;
  } finally {
    await connection?.close();
  }
};

/** Resolve an employee's EMPCODE from their login card_no. (mirror _empcode_for_card) */
export const empcodeForCard = async (cardNo) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const r = (
      await connection.execute(
        `
        SELECT h.EMPCODE FROM HR_EMP_MASTER h
        LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
        WHERE h.EMPCODE = :c OR TO_CHAR(e.CARD_NO) = :c
        `,
        { c: String(cardNo) },
        { outFormat: oracledb.OUT_FORMAT_ARRAY }
      )
    ).rows?.[0];
    return r && r[0] ? String(r[0]).trim() : null;
  } finally {
    await connection?.close();
  }
};

// ---------------------------------------------------------------------------
// COMPANY LOGO  (file under COMP_LOGO, path in COMPANY_INFO.IMG)
// ---------------------------------------------------------------------------

export const COMP_LOGO_ROOT =
  process.env.COMP_LOGO_ROOT || 'C:\\Erp_Systems\\HRMS_LMS_APP\\COMP_LOGO';
const LOGO_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];

const companyDescr = async (connection, compc) => {
  try {
    const r = (
      await connection.execute(
        `SELECT DESCR FROM COMPANY_INFO WHERE TO_CHAR(COMPC) = :c`,
        { c: String(compc) },
        { outFormat: oracledb.OUT_FORMAT_ARRAY }
      )
    ).rows?.[0];
    return r ? String(r[0] ?? '').trim() : '';
  } catch {
    return '';
  }
};

/** Where a company's logo is saved: COMP_LOGO/<CompanyName>_logo.<ext>. */
export const companyLogoTarget = async (compc, ext) => {
  let connection;
  let descr = '';
  try {
    connection = await getDirectConnection();
    descr = await companyDescr(connection, compc);
  } finally {
    await connection?.close();
  }
  const safe = safeName(descr, `company${compc}`);
  const cleanExt = String(ext || 'png').replace(/^\.+/, '').toLowerCase();
  const fname = `${safe}_logo.${cleanExt}`;
  return {
    abs_dir: COMP_LOGO_ROOT,
    abs_path: path.join(COMP_LOGO_ROOT, fname),
    filename: fname,
  };
};

export const setCompanyLogo = async (compc, absPath) => {
  let connection;
  try {
    connection = await getDirectConnection();
    const result = await connection.execute(
      `UPDATE COMPANY_INFO SET IMG = :p WHERE TO_CHAR(COMPC) = :c`,
      { p: absPath, c: String(compc) },
      { autoCommit: true }
    );
    return (result.rowsAffected ?? 0) > 0;
  } finally {
    await connection?.close();
  }
};

/**
 * Absolute path to a company's logo file. Prefers COMPANY_INFO.IMG when it
 * points to an existing file, else looks for <CompanyName>_logo.* in COMP_LOGO.
 */
export const getCompanyLogoAbs = async (compc) => {
  let connection;
  let r;
  try {
    connection = await getDirectConnection();
    r = (
      await connection.execute(
        `SELECT IMG, DESCR FROM COMPANY_INFO WHERE TO_CHAR(COMPC) = :c`,
        { c: String(compc) },
        { outFormat: oracledb.OUT_FORMAT_ARRAY }
      )
    ).rows?.[0];
  } finally {
    await connection?.close();
  }

  const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

  const img = r ? String(r[0] ?? '').trim() : '';
  if (img) {
    // IMG may be a full path, or a bare filename relative to COMP_LOGO.
    if (isFile(img)) return img;
    const cand = path.join(COMP_LOGO_ROOT, path.basename(img));
    if (isFile(cand)) return cand;
  }
  const descr = r ? String(r[1] ?? '').trim() : '';
  const safe = safeName(descr, '');
  if (safe) {
    for (const ext of LOGO_EXTS) {
      const p = path.join(COMP_LOGO_ROOT, `${safe}_logo.${ext}`);
      if (isFile(p)) return p;
    }
  }
  return null;
};
