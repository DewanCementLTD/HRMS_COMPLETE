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

// Training course outlines: one document under "file", capped at 20 MB. A
// multer error (too large) is answered as a readable 400 instead of reaching
// the global handler as a 500.
const outlineUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }).single('file');
export const uploadOutlineFile = (req, res, next) =>
  outlineUpload(req, res, (err) => {
    if (!err) return next();
    const detail = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 20 MB' : err.message || 'Upload failed';
    return res.status(400).json({ detail });
  });
