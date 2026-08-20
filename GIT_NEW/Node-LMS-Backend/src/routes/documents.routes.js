import { Router } from 'express';
import { validate } from '../middlewares/validate.middleware.js';
import { requireHrAdmin } from '../middlewares/hrAdmin.middleware.js';
import { uploadSingleFile } from '../middlewares/upload.middleware.js';
// Schemas
import {
  listDocumentsSchema,
  uploadDocumentSchema,
  employeePhotoSchema,
  myPhotoSchema,
  companyLogoGetSchema,
  companyLogoUploadSchema,
  downloadDocumentSchema,
  deleteDocumentSchema,
} from '../models/documents.schema.js';
// Controllers
import {
  listEmployeeDocuments,
  uploadDocument,
  downloadDocument,
  removeDocument,
  uploadEmployeePhoto,
  getEmployeePhoto,
  uploadMyPhoto,
  getMyPhoto,
  uploadCompanyLogo,
  getCompanyLogo,
} from '../controllers/documents.controller.js';

const router = Router();
// Mounted at /documents. Mirrors FastAPI routers/document_router.py.
// validate() runs first so requireHrAdmin can read res.locals.validated.query.admin_card_no.
// uploadSingleFile (multer) runs before validate() on multipart routes so form
// fields are available in req.body.
// NOTE: literal paths (company-logo / employee-photo / my-photo) are declared
// BEFORE the /:doc_id routes so they are not swallowed by the param match.

// ---------------------------------------------------------------------------
// Employee documents (HR_DOCUMENT rows + files under EMP_DOCS)
// ---------------------------------------------------------------------------
router.get('/', validate(listDocumentsSchema), requireHrAdmin, listEmployeeDocuments); // [x] http://localhost:8000/documents?empcode=100660.1&admin_card_no=100001.1
router.post('/', uploadSingleFile, validate(uploadDocumentSchema), requireHrAdmin, uploadDocument); // [*] http://localhost:8000/documents?admin_card_no=100001.1  Body (form-data): empcode:100660.1   d_type:CNIC   doc_name:Cnic Back  remarks:Uploaded from Postman, file=<binary>

// ---------------------------------------------------------------------------
// Employee photo (HR-managed; path saved to HR_EMP_MASTER.PATH)
// ---------------------------------------------------------------------------
router.get('/employee-photo', validate(employeePhotoSchema), requireHrAdmin, getEmployeePhoto); // [*] http://localhost:8000/documents/employee-photo?admin_card_no=100001.1&empcode=100660.1
router.post('/employee-photo', uploadSingleFile, validate(employeePhotoSchema), requireHrAdmin, uploadEmployeePhoto);  // [*] http://localhost:8000/documents/employee-photo?admin_card_no=100001.1&empcode=100660.1  Body (form-data): file=<image>

// ---------------------------------------------------------------------------
// My photo (employee self-service — no HR admin required)
// ---------------------------------------------------------------------------
router.get('/my-photo', validate(myPhotoSchema), getMyPhoto); // [*] http://localhost:8000/documents/my-photo?card_no=100660.1
router.post('/my-photo', uploadSingleFile, validate(myPhotoSchema), uploadMyPhoto); // [*] http://localhost:8000/documents/my-photo?card_no=100660.1  Body (form-data): file=<image>

// ---------------------------------------------------------------------------
// Company logo (GET is public branding; POST is HR-admin gated)
// ---------------------------------------------------------------------------
router.get('/company-logo', validate(companyLogoGetSchema), getCompanyLogo); // [-] http://localhost:8000/documents/company-logo?compc=1
router.post('/company-logo', uploadSingleFile, validate(companyLogoUploadSchema), requireHrAdmin, uploadCompanyLogo); // [-] http://localhost:8000/documents/company-logo?admin_card_no=100001.1&compc=1  Body (form-data): file=<image>

// ---------------------------------------------------------------------------
// Single document by id (download / delete) — keep AFTER the literal paths
// ---------------------------------------------------------------------------
router.get('/:doc_id/download', validate(downloadDocumentSchema), requireHrAdmin, downloadDocument); // [-] http://localhost:8000/documents/5/download?admin_card_no=100001.1&inline=false
router.delete('/:doc_id', validate(deleteDocumentSchema), requireHrAdmin, removeDocument); // [-] http://localhost:8000/documents/5?admin_card_no=100001.1

export default router;
