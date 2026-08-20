import { apiRequest } from "./api";

const API_BASE = "/api";

export interface EmployeeDocument {
  doc_id: number;
  d_type: string;
  doc_name: string;
  remarks: string;
  img_name: string;   // stored relative path (the "Image Name" / address)
}

export const listDocuments = (empcode: string, adminCardNo: string) =>
  apiRequest<{ items: EmployeeDocument[] }>(
    `/documents?empcode=${encodeURIComponent(empcode)}&admin_card_no=${encodeURIComponent(adminCardNo)}`
  );

export async function uploadDocument(
  adminCardNo: string,
  empcode: string,
  dType: string,
  docName: string,
  remarks: string,
  file: File,
): Promise<{ status: string; doc_id: number; img_name: string }> {
  const form = new FormData();
  form.append("empcode", empcode);
  form.append("d_type", dType);
  form.append("doc_name", docName);
  form.append("remarks", remarks);
  form.append("file", file);

  const res = await fetch(`${API_BASE}/documents?admin_card_no=${encodeURIComponent(adminCardNo)}`, {
    method: "POST",
    body: form, // browser sets multipart boundary automatically
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(typeof err.detail === "string" ? err.detail : "Upload failed");
  }
  return res.json();
}

// URL the browser can open directly for viewing (inline) or downloading (attachment).
export const documentFileUrl = (docId: number, adminCardNo: string, inline = false) =>
  `${API_BASE}/documents/${docId}/download?admin_card_no=${encodeURIComponent(adminCardNo)}${inline ? "&inline=true" : ""}`;

export const deleteDocument = (docId: number, adminCardNo: string) =>
  apiRequest<{ status: string }>(
    `/documents/${docId}?admin_card_no=${encodeURIComponent(adminCardNo)}`,
    { method: "DELETE" }
  );

// ── Employee profile photo (shown on the ID card) ──
export const employeePhotoUrl = (empcode: string, adminCardNo: string, bust?: number | string) =>
  `${API_BASE}/documents/employee-photo?empcode=${encodeURIComponent(empcode)}&admin_card_no=${encodeURIComponent(adminCardNo)}${bust ? `&t=${bust}` : ""}`;

async function postFile(url: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(typeof err.detail === "string" ? err.detail : "Upload failed");
  }
  return res.json();
}

export const uploadEmployeePhoto = (adminCardNo: string, empcode: string, file: File) =>
  postFile(`${API_BASE}/documents/employee-photo?empcode=${encodeURIComponent(empcode)}&admin_card_no=${encodeURIComponent(adminCardNo)}`, file);

// Employee uploads their OWN photo (from the profile page; no admin needed).
export const uploadMyPhoto = (cardNo: string, file: File) =>
  postFile(`${API_BASE}/documents/my-photo?card_no=${encodeURIComponent(cardNo)}`, file);
export const myPhotoUrl = (cardNo: string, bust?: number | string) =>
  `${API_BASE}/documents/my-photo?card_no=${encodeURIComponent(cardNo)}${bust ? `&t=${bust}` : ""}`;

// HR uploads a company logo.
export const uploadCompanyLogo = (adminCardNo: string, compc: string, file: File) =>
  postFile(`${API_BASE}/documents/company-logo?admin_card_no=${encodeURIComponent(adminCardNo)}&compc=${encodeURIComponent(compc)}`, file);
