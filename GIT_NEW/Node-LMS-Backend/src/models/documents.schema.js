import { z } from "zod";

/**
 * Zod schemas for the /documents/* routes (Employee Documents).
 *
 * Mirrors the FastAPI LMS-Backend routers/document_router.py.
 *
 * NOTE: the validate() middleware runs `schema.parse(...)` which strips any
 * query/param key not declared here, so `admin_card_no` (read by the
 * requireHrAdmin middleware from res.locals.validated.query) MUST be present
 * in every HR-admin-gated query schema below.
 */

// FastAPI bool query params accept these truthy spellings (case-insensitive).
const boolFromQuery = z
  .string()
  .optional()
  .default("false")
  .transform((v) => ["true", "1", "yes", "on", "y", "t"].includes(String(v).toLowerCase()));

// GET /documents
export const listDocumentsSchema = z.object({
  query: z.object({
    empcode: z.string().min(1, "empcode is required"),
    admin_card_no: z.string().min(1, "admin_card_no is required"),
  }),
});

// POST /documents  (multipart/form-data — text fields land in body via multer)
export const uploadDocumentSchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
  }),
  body: z.object({
    empcode: z.string().min(1, "empcode is required"),
    d_type: z.string().optional().default(""),
    doc_name: z.string().optional().default(""),
    remarks: z.string().optional().default(""),
  }),
});

// GET + POST /documents/employee-photo
export const employeePhotoSchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
    empcode: z.string().min(1, "empcode is required"),
  }),
});

// GET + POST /documents/my-photo (employee self-service — no HR admin)
export const myPhotoSchema = z.object({
  query: z.object({
    card_no: z.string().min(1, "card_no is required"),
  }),
});

// GET /documents/company-logo (public — branding)
export const companyLogoGetSchema = z.object({
  query: z.object({
    compc: z.string().min(1, "compc is required"),
  }),
});

// POST /documents/company-logo
export const companyLogoUploadSchema = z.object({
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
    compc: z.string().min(1, "compc is required"),
  }),
});

// GET /documents/{doc_id}/download
export const downloadDocumentSchema = z.object({
  params: z.object({
    doc_id: z.coerce.number().int("doc_id must be an integer"),
  }),
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
    inline: boolFromQuery,
  }),
});

// DELETE /documents/{doc_id}
export const deleteDocumentSchema = z.object({
  params: z.object({
    doc_id: z.coerce.number().int("doc_id must be an integer"),
  }),
  query: z.object({
    admin_card_no: z.string().min(1, "admin_card_no is required"),
  }),
});
