"use client";

import { useState, useRef } from "react";
import { Camera, Upload, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { uploadEmployeePhoto, employeePhotoUrl } from "@/services/documentService";

export function EmployeePhoto({ empcode, adminCardNo }: { empcode: string; adminCardNo: string }) {
  const [bust, setBust] = useState(() => Date.now());
  const [err, setErr] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true); setError(null);
    try {
      await uploadEmployeePhoto(adminCardNo, empcode, f);
      setErr(false);
      setBust(Date.now());
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const url = employeePhotoUrl(empcode, adminCardNo, bust);
  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-semibold text-gray-900">Profile Photo</h2>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-5">
          <div className="h-28 w-28 rounded-xl overflow-hidden border border-gray-200 bg-gray-50 flex items-center justify-center shrink-0">
            {!err ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" onError={() => setErr(true)} className="h-full w-full object-cover" />
            ) : (
              <span className="text-gray-300 text-xs text-center px-2">No photo</span>
            )}
          </div>
          <div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} className="hidden" />
            <Button size="sm" type="button" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
              Upload Photo
            </Button>
            <p className="text-xs text-gray-400 mt-2">JPG / PNG / WebP. Appears on the employee ID card.</p>
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
