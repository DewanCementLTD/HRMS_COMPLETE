"use client";

import { useRef, useState } from "react";
import { FileText, Upload, Download, Trash2, Save, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Outline } from "@/services/trainingService";
import { ErrorBox, Empty } from "./TrainingUi";

const ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg";

/** Read-only course outline, as participants see it. */
export function OutlineView({ outline, onDownload }: { outline: Outline; onDownload?: () => void }) {
  if (!outline.outline_text && !outline.outline_file_name) return <Empty>The trainer has not shared an outline yet.</Empty>;
  return (
    <div className="space-y-3">
      {outline.outline_text && <p className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">{outline.outline_text}</p>}
      {outline.outline_file_name && onDownload && (
        <Button size="sm" variant="secondary" onClick={onDownload}>
          <FileText className="h-4 w-4 mr-1 text-indigo-600" />{outline.outline_file_name}<Download className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      )}
      {outline.outline_updated_at && <p className="text-xs text-gray-400">Last updated {outline.outline_updated_at}</p>}
    </div>
  );
}

/**
 * Course outline / roadmap editor: free text plus one optional document.
 * Used by the session's trainer and by HR; participants see OutlineView.
 */
export function OutlineEditor({ outline, readOnly, onSaveText, onUpload, onDeleteFile, onDownload }: {
  outline: Outline; readOnly?: boolean;
  onSaveText: (text: string) => Promise<unknown>;
  onUpload: (file: File) => Promise<unknown>;
  onDeleteFile: () => Promise<unknown>;
  onDownload: () => void;
}) {
  const [text, setText] = useState(outline.outline_text || "");
  const [busy, setBusy] = useState<"text" | "file" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (readOnly) return <OutlineView outline={outline} onDownload={onDownload} />;

  const run = async (kind: "text" | "file", fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    setSaved(false);
    try { await fn(); if (kind === "text") setSaved(true); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { setError("File is larger than 20 MB"); return; }
    run("file", () => onUpload(f));
  };

  return (
    <div className="space-y-3">
      <ErrorBox error={error} />
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700"><MapIcon className="h-4 w-4 text-indigo-500" />Course outline / roadmap</label>
        <textarea rows={8} value={text} maxLength={4000} onChange={(e) => { setText(e.target.value); setSaved(false); }}
          placeholder={"Day 1 — Introduction & basics\nDay 2 — Hands-on exercises\n…\nWhat to bring / prerequisites"}
          className="w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{text.length}/4000 · participants see exactly this</span>
          {saved && <span className="text-xs text-emerald-600">Saved</span>}
          <Button size="sm" className="ml-auto" loading={busy === "text"} disabled={text === (outline.outline_text || "")}
            onClick={() => run("text", () => onSaveText(text))}><Save className="h-4 w-4 mr-1" />Save outline</Button>
        </div>
      </div>
      <div className="rounded-xl border border-dashed border-gray-300 p-3 flex flex-wrap items-center gap-2">
        {outline.outline_file_name ? (
          <>
            <button onClick={onDownload} className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline">
              <FileText className="h-4 w-4" />{outline.outline_file_name}</button>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" loading={busy === "file"} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1" />Replace</Button>
              <Button size="sm" variant="ghost" className="text-red-600" disabled={!!busy}
                onClick={() => confirm("Remove the outline document?") && run("file", onDeleteFile)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-sm text-gray-500">Attach a document (PDF, Word, PowerPoint, Excel, image — max 20 MB)</span>
            <Button size="sm" variant="secondary" className="ml-auto" loading={busy === "file"} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1" />Upload</Button>
          </>
        )}
        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
      </div>
    </div>
  );
}
