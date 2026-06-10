"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { FileText, Upload, Download, Eye, Trash2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  listDocuments, uploadDocument, deleteDocument, documentFileUrl,
  type EmployeeDocument,
} from "@/services/documentService";

const DOC_TYPES = [
  { value: "", label: "Select type" },
  { value: "CNIC", label: "CNIC" },
  { value: "Degree", label: "Degree / Certificate" },
  { value: "Appoint", label: "Appointment Letter" },
  { value: "Contract", label: "Contract" },
  { value: "Experience", label: "Experience Letter" },
  { value: "Photo", label: "Photo" },
  { value: "Other", label: "Other" },
];

export function EmployeeDocuments({ empcode, adminCardNo }: { empcode: string; adminCardNo: string }) {
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [dType, setDType] = useState("");
  const [docName, setDocName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!empcode) return;
    setLoading(true);
    try {
      const res = await listDocuments(empcode, adminCardNo);
      setDocs(res.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [empcode, adminCardNo]);

  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setError(null);
    if (!file) { setError("Please choose a file to upload."); return; }
    if (!dType) { setError("Please select a document type."); return; }
    setUploading(true);
    try {
      await uploadDocument(adminCardNo, empcode, dType, docName, remarks, file);
      setDType(""); setDocName(""); setRemarks(""); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (docId: number) => {
    if (!confirm("Delete this document? This cannot be undone.")) return;
    try {
      await deleteDocument(docId, adminCardNo);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-gray-900">Documents</h2>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>
        )}

        {/* Upload row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end mb-5">
          <Select label="Type" value={dType} onChange={(e) => setDType(e.target.value)} options={DOC_TYPES} />
          <Input label="Document Name" value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="e.g. CNIC front" />
          <Input label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">File</label>
            <input
              ref={fileRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:text-sm hover:file:bg-indigo-100"
            />
          </div>
        </div>
        <div className="mb-5">
          <Button onClick={submit} disabled={uploading} size="sm">
            {uploading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
            Upload Document
          </Button>
        </div>

        {/* List */}
        {loading ? (
          <div className="py-8 text-center text-gray-400 text-sm">Loading…</div>
        ) : docs.length === 0 ? (
          <div className="py-8 text-center text-gray-300">
            <FileText className="h-8 w-8 mx-auto mb-1" />
            <p className="text-sm text-gray-400">No documents uploaded yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Document Name</th>
                  <th className="px-3 py-2 text-left">Remarks</th>
                  <th className="px-3 py-2 text-left">Image Name (path)</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {docs.map((d) => (
                  <tr key={d.doc_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700">{d.doc_id}</td>
                    <td className="px-3 py-2 text-gray-600">{d.d_type}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{d.doc_name || "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{d.remarks || "—"}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs truncate max-w-[14rem]" title={d.img_name}>{d.img_name}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <a href={documentFileUrl(d.doc_id, adminCardNo, true)} target="_blank" rel="noreferrer"
                          className="text-indigo-600 hover:text-indigo-800" title="View">
                          <Eye className="h-4 w-4" />
                        </a>
                        <a href={documentFileUrl(d.doc_id, adminCardNo, false)}
                          className="text-emerald-600 hover:text-emerald-800" title="Download">
                          <Download className="h-4 w-4" />
                        </a>
                        <button onClick={() => remove(d.doc_id)} className="text-red-500 hover:text-red-700" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
