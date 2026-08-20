import multer from 'multer';

/**
 * Multipart upload middleware — Node equivalent of FastAPI's UploadFile.
 *
 * Files are kept in memory (like FastAPI's `await file.read()`) and written to
 * disk by the controller, so the on-disk layout stays identical to the
 * FastAPI LMS-Backend (EMP_DOCS / EMP_PHOTOS / COMP_LOGO).
 */
const upload = multer({ storage: multer.memoryStorage() });

// All document/photo/logo endpoints take a single file under the "file" field.
export const uploadSingleFile = upload.single('file');

// Bulk CV uploads take an array of files under the "files" field.
export const uploadCvArray = upload.array('files', 20);
