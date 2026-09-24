/**
 * Employee document controllers — /documents/* (HR admin only, except
 * my-photo and the company-logo GET).
 *
 * Direct port of the FastAPI LMS-Backend routers/document_router.py.
 * Upload stores the file under EMP_DOCS/Comp{unit}/branch{loc}/{doc_id}.{ext}
 * and records only the path in HR_DOCUMENT. View/download stream the file back.
 *
 * Error bodies use { detail } to match FastAPI's HTTPException JSON exactly,
 * so this server is a drop-in replacement for the Python one.
 */

import fs from 'fs';
import path from 'path';

import { logger } from '../utils/logger.js';
import {
  listDocuments,
  createDocument,
  getDocument,
  deleteDocument,
  employeePhotoTarget,
  setEmployeePhotoPath,
  getEmployeePhotoAbs,
  getEmployeeUnitLocation,
  companyLogoTarget,
  setCompanyLogo,
  getCompanyLogoAbs,
  empcodeForCard,
} from '../services/documents.service.js';

// Extensions we allow HR to upload.
const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt']);
const PHOTO_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const LOGO_EXT = new Set([...PHOTO_EXT, 'svg']);

// (os.path.splitext(file.filename)[1]).lstrip(".").lower()
const extOf = (filename) =>
  path.extname(String(filename ?? '')).replace(/^\.+/, '').toLowerCase();

const isFile = (p) => !!p && fs.existsSync(p) && fs.statSync(p).isFile();

/** Delete other-extension variants of a target file (photo/logo replace). */
const removeOtherVariants = (exts, targetOf, targetAbsPath) => {
  for (const e of exts) {
    const prev = targetOf(e).abs_path;
    if (prev !== targetAbsPath && isFile(prev)) {
      try {
        fs.unlinkSync(prev);
      } catch {
        /* best-effort, mirror the Python except OSError: pass */
      }
    }
  }
};

// ---------------------------------------------------------------------------
// HR_DOCUMENT rows
// ---------------------------------------------------------------------------

// GET /documents
export const listEmployeeDocuments = async (req, res) => {
  try {
    const { empcode } = res.locals.validated.query;
    res.json({ items: await listDocuments(empcode) });
    // res.json( {"1": 12} );
  } catch (err) {
    logger.error({ err }, 'Error listing employee documents');
    res.status(500).json({ detail: String(err.message ?? err) });
  }
};

// POST /documents  (multipart/form-data)
export const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ detail: 'file is required' });
    }
    const { empcode, d_type, doc_name, remarks } = res.locals.validated.body;

    const ext = extOf(req.file.originalname);
    if (!ALLOWED_EXT.has(ext)) {
      return res.status(400).json({ detail: `File type .${ext || '?'} not allowed` });
    }

    const info = await createDocument(empcode, d_type, doc_name, remarks, ext);
    try {
      fs.mkdirSync(info.abs_dir, { recursive: true });
      fs.writeFileSync(info.abs_path, req.file.buffer);
    } catch (e) {
      // File write failed — roll back the DB row so we don't leave an orphan.
      await deleteDocument(info.doc_id);
      return res.status(500).json({ detail: `Failed to save file: ${e.message ?? e}` });
    }

    res.json({
      status: 'success',
      doc_id: info.doc_id,
      img_name: info.rel_path,
      message: 'Document uploaded',
    });
  } catch (err) {
    next(err);
  }
};

// GET /documents/{doc_id}/download
export const downloadDocument = async (req, res, next) => {
  try {
    const { doc_id } = res.locals.validated.params;
    const { inline } = res.locals.validated.query;

    const doc = await getDocument(doc_id);
    if (!doc || !isFile(doc.abs_path)) {
      return res.status(404).json({ detail: 'Document file not found' });
    }
    const fname = path.basename(doc.abs_path);
    const disposition = inline ? 'inline' : 'attachment';
    res.set('Content-Disposition', `${disposition}; filename="${fname}"`);
    res.sendFile(doc.abs_path);
  } catch (err) {
    next(err);
  }
};

// DELETE /documents/{doc_id}
export const removeDocument = async (req, res, next) => {
  try {
    const { doc_id } = res.locals.validated.params;
    const result = await deleteDocument(doc_id);
    if (result.status === 'error') {
      return res.status(400).json({ detail: result.message });
    }
    res.json({ status: 'success', message: 'Document deleted' });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// EMPLOYEE PHOTO  (path saved to HR_EMP_MASTER.PATH; shown on the ID card)
// ---------------------------------------------------------------------------

// POST /documents/employee-photo — upload/replace an employee's profile photo.
export const uploadEmployeePhoto = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ detail: 'file is required' });
    }
    const { empcode } = res.locals.validated.query;

    const ext = extOf(req.file.originalname);
    if (!PHOTO_EXT.has(ext)) {
      return res.status(400).json({ detail: 'Photo must be an image (png/jpg/webp/gif)' });
    }
    const t = employeePhotoTarget(empcode, ext);
    try {
      fs.mkdirSync(t.abs_dir, { recursive: true });
      // Remove any previous photo of this employee (other extensions).
      removeOtherVariants(PHOTO_EXT, (e) => employeePhotoTarget(empcode, e), t.abs_path);
      fs.writeFileSync(t.abs_path, req.file.buffer);
    } catch (e) {
      return res.status(500).json({ detail: `Failed to save photo: ${e.message ?? e}` });
    }
    if (!(await setEmployeePhotoPath(empcode, t.rel_path))) {
      return res.status(404).json({ detail: 'Employee not found' });
    }
    res.json({ status: 'success', path: t.rel_path });
  } catch (err) {
    next(err);
  }
};

// GET /documents/employee-photo — serve the photo (form preview / ID card).
export const getEmployeePhoto = async (req, res, next) => {
  try {
    const { empcode } = res.locals.validated.query;
    const photoPath = await getEmployeePhotoAbs(empcode);
    if (!photoPath) {
      return res.status(404).json({ detail: 'No photo' });
    }
    res.set('Cache-Control', 'no-cache');
    res.sendFile(photoPath);
  } catch (err) {
    next(err);
  }
};

// POST /documents/my-photo — an employee uploads their OWN profile photo.
export const uploadMyPhoto = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.query;
    const empcode = await empcodeForCard(card_no);
    if (!empcode) {
      return res.status(404).json({ detail: 'Employee not found' });
    }
    if (!req.file) {
      return res.status(400).json({ detail: 'file is required' });
    }
    const ext = extOf(req.file.originalname);
    if (!PHOTO_EXT.has(ext)) {
      return res.status(400).json({ detail: 'Photo must be an image (png/jpg/webp/gif)' });
    }
    const t = employeePhotoTarget(empcode, ext);
    try {
      fs.mkdirSync(t.abs_dir, { recursive: true });
      removeOtherVariants(PHOTO_EXT, (e) => employeePhotoTarget(empcode, e), t.abs_path);
      fs.writeFileSync(t.abs_path, req.file.buffer);
    } catch (e) {
      return res.status(500).json({ detail: `Failed to save photo: ${e.message ?? e}` });
    }
    await setEmployeePhotoPath(empcode, t.rel_path);
    res.json({ status: 'success' });
  } catch (err) {
    next(err);
  }
};

// GET /documents/my-photo
export const getMyPhoto = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.query;
    const empcode = await empcodeForCard(card_no);
    const photoPath = empcode ? await getEmployeePhotoAbs(empcode) : null;
    if (!photoPath) {
      return res.status(404).json({ detail: 'No photo' });
    }
    res.set('Cache-Control', 'no-cache');
    res.sendFile(photoPath);
  } catch (err) {
    next(err);
  }
};

// GET /documents/org-chart-photo — a colleague's photo for the org chart,
// scoped to same-company/same-branch peers only (not full HR access).
export const getOrgChartPhoto = async (req, res, next) => {
  try {
    const { empcode, card_no } = res.locals.validated.query;
    const callerEmpcode = await empcodeForCard(card_no);
    const caller = callerEmpcode ? await getEmployeeUnitLocation(callerEmpcode) : null;
    const target = await getEmployeeUnitLocation(empcode);
    // Generic 404 whether the caller, the target, or the branch match fails —
    // never leak which case it was.
    if (!caller || !target || caller.unit_id !== target.unit_id || caller.location !== target.location) {
      return res.status(404).json({ detail: 'No photo' });
    }
    const photoPath = await getEmployeePhotoAbs(empcode);
    if (!photoPath) {
      return res.status(404).json({ detail: 'No photo' });
    }
    res.set('Cache-Control', 'no-cache');
    res.sendFile(photoPath);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// COMPANY LOGO  (file under COMP_LOGO, path in COMPANY_INFO.IMG)
// ---------------------------------------------------------------------------

// POST /documents/company-logo — HR uploads a company logo →
// COMP_LOGO/<CompanyName>_logo.<ext>. Stored as-is (colour/transparency preserved).
export const uploadCompanyLogo = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ detail: 'file is required' });
    }
    const { compc } = res.locals.validated.query;

    const ext = extOf(req.file.originalname);
    if (!LOGO_EXT.has(ext)) {
      return res.status(400).json({ detail: 'Logo must be an image (png/jpg/webp/gif/svg)' });
    }
    const t = await companyLogoTarget(compc, ext);
    try {
      fs.mkdirSync(t.abs_dir, { recursive: true });
      // Drop other-extension variants of this company's logo (async targets).
      for (const e of LOGO_EXT) {
        const prev = (await companyLogoTarget(compc, e)).abs_path;
        if (prev !== t.abs_path && isFile(prev)) {
          try {
            fs.unlinkSync(prev);
          } catch {
            /* best-effort */
          }
        }
      }
      fs.writeFileSync(t.abs_path, req.file.buffer);
    } catch (e) {
      return res.status(500).json({ detail: `Failed to save logo: ${e.message ?? e}` });
    }
    await setCompanyLogo(compc, t.abs_path);
    res.json({ status: 'success', filename: t.filename });
  } catch (err) {
    next(err);
  }
};

// GET /documents/company-logo — public (branding, ID card / payslip).
export const getCompanyLogo = async (req, res, next) => {
  try {
    const { compc } = res.locals.validated.query;
    const logoPath = await getCompanyLogoAbs(compc);
    if (!logoPath) {
      return res.status(404).json({ detail: 'No logo' });
    }
    res.set('Cache-Control', 'no-cache');
    res.sendFile(logoPath);
  } catch (err) {
    next(err);
  }
};
