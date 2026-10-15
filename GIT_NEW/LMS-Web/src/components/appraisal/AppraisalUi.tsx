"use client";

import { useState } from "react";
import { Check, Clock, CornerUpLeft, FileText, Paperclip, Pencil, Plus, Trash2, Download, Lock, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Pill, TextArea, Empty } from "@/components/training/TrainingUi";
import { printTablePdf } from "@/lib/printTable";
import {
  STAGE_LABEL, ROLE_LABEL, GRADES, GRADE_MEANING, GRADE_POINTS, SHEET_RULES, scoreText, downloadFile,
  type Appraisal, type Stage, type Grade, type RowBody, type SheetRow, type ApprovalStep, type Attachment, type BellCurve,
} from "@/services/appraisalService";

// ── Stage ──
const STAGE_TONE: Record<Stage, "gray" | "blue" | "amber" | "green" | "red" | "indigo"> = {
  OBJ_SETTING: "gray", OBJ_REVIEW: "amber", MIDYEAR: "blue", MID_REVIEW: "amber", RPT: "amber", HOD1: "amber", HOD2: "amber",
  HR: "indigo", COMPLETED: "green", CANCELLED: "red",
};
export const StagePill = ({ stage }: { stage: Stage }) => <Pill tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage] ?? stage}</Pill>;

/** The DCL flow with the current step highlighted and the locks shown. */
export function StageTracker({ a }: { a: Appraisal }) {
  const raterName = (r: string) => (r === "RPT" ? a.rpt_name : r === "HOD1" ? a.hod1_name : r === "HOD2" ? a.hod2_name : null);
  const steps: { key: Stage; label: string; who?: string | null; lock?: string }[] = [
    { key: "OBJ_SETTING", label: "Objectives", who: a.emp_name },
    { key: "OBJ_REVIEW", label: "Objectives approved", who: a.line_manager_name, lock: "Objectives locked" },
    { key: "MIDYEAR", label: "Mid-year self review", who: a.emp_name },
    { key: "MID_REVIEW", label: "Mid-year sign-off", who: a.line_manager_name, lock: "Half-year locked" },
    ...a.chain.map((r) => ({
      key: r as Stage, label: r === "HR" ? "HR review" : `Year-end rating (${ROLE_LABEL[r] ?? r})`, who: raterName(r),
      lock: r === "HR" ? "Rating locked" : undefined,
    })),
    { key: "COMPLETED", label: "Completed" },
  ];
  const cur = steps.findIndex((s) => s.key === a.stage);
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {steps.map((st, i) => {
        const done = a.stage === "COMPLETED" || (cur >= 0 && i < cur);
        const now = i === cur && a.stage !== "COMPLETED";
        return (
          <li key={st.key} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gray-300">→</span>}
            <span title={[st.who, done && st.lock].filter(Boolean).join(" · ") || undefined}
              className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium",
                done ? "text-emerald-700 bg-emerald-50" : now ? "text-amber-700 bg-amber-50 ring-1 ring-amber-200" : "text-gray-400 bg-gray-50")}>
              {done && st.lock ? <Lock className="h-3 w-3" /> : done ? <Check className="h-3 w-3" /> : now ? <Clock className="h-3 w-3" /> : null}
              {st.label}{st.who && !["OBJ_SETTING", "MIDYEAR"].includes(st.key) ? `: ${st.who}` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ── Grades ──
const GRADE_TONE: Record<string, string> = {
  "A+": "bg-emerald-600 text-white", A: "bg-emerald-100 text-emerald-800", B: "bg-blue-100 text-blue-800",
  C: "bg-amber-100 text-amber-800", D: "bg-red-100 text-red-700",
};
export const GradeBadge = ({ g, title }: { g: string | null | undefined; title?: string }) =>
  g ? <span title={title ?? GRADE_MEANING[g as Grade]} className={cn("inline-flex min-w-7 justify-center rounded-md px-1.5 py-0.5 text-xs font-bold", GRADE_TONE[g] ?? "bg-gray-100 text-gray-700")}>{g}</span>
    : <span className="text-gray-300">—</span>;

/** A+ … D buttons (clicking the chosen grade again clears it). */
export function GradePicker({ value, onChange, disabled }: { value: Grade | null; onChange: (g: Grade | null) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {GRADES.map((g) => (
        <button key={g} type="button" disabled={disabled} title={`${g} = ${GRADE_MEANING[g]} (${GRADE_POINTS[g]} points)`}
          onClick={() => onChange(value === g ? null : g)}
          className={cn("h-7 min-w-8 px-1.5 rounded-lg text-xs font-bold border transition",
            value === g ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300",
            disabled && "opacity-50 cursor-not-allowed")}>
          {g}
        </button>
      ))}
    </div>
  );
}

/** 1–5 buttons (promotion competencies). */
export function RatingPicker({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={disabled}
          onClick={() => onChange(value === n ? null : n)}
          className={cn("h-7 w-7 rounded-lg text-xs font-bold border transition",
            value === n ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300",
            disabled && "opacity-50 cursor-not-allowed")}>
          {n}
        </button>
      ))}
    </div>
  );
}

/** Self total / agreed total / final grade (+ HR normalisation when internal). */
export function ScoreStrip({ a, internal }: { a: Appraisal; internal: boolean }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <Tile k={'Self Total "A"'} v={scoreText(a.self_score)} />
      <Tile k={'Agreed Total "A"'} v={scoreText(internal ? a.calc_score : a.final_score)} sub="out of 5.00" />
      {internal && <Tile k="HOD grade" v={<GradeBadge g={a.hod_grade} />} sub="before HR normalisation" />}
      <Tile k="Final grade" v={<GradeBadge g={a.final_rating} />}
        sub={internal && a.hr_adj_grade ? `HR normalised — ${a.hr_adj_reason ?? ""}` : a.final_rating ? GRADE_MEANING[a.final_rating as Grade] : undefined} />
    </div>
  );
}
function Tile({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2">
      <p className="text-[11px] text-gray-500">{k}</p>
      <div className="text-xl font-extrabold text-ink tabular-nums">{v}</div>
      {sub && <p className="text-[11px] text-gray-500 truncate" title={sub}>{sub}</p>}
    </div>
  );
}

/** Rating scale legend of the form. */
export const ScaleLegend = () => (
  <div className="flex flex-wrap gap-2 text-[11px] text-gray-600">
    {GRADES.map((g) => <span key={g} className="inline-flex items-center gap-1"><GradeBadge g={g} />{GRADE_MEANING[g]} = {GRADE_POINTS[g]}</span>)}
    <span className="text-gray-400">Score = weightage × points · Total &quot;A&quot; out of 5.00</span>
  </div>
);

// ── Task sheet ──
const emptyRow = (w: number): RowBody => ({ accountability: "", task: "", kpi: "", success_criteria: "", interdependencies: "", weightage: w, due_date: null });

/** Header of the form: employee, line manager, period, dates. */
export function SheetHeader({ a }: { a: Appraisal }) {
  const cells: [string, React.ReactNode][] = [
    ["Employee name", a.emp_name], ["Employee ID", a.empno || a.empcode], ["Designation & department", `${a.desg_desc} · ${a.dept_name}`],
    ["Date of joining", a.join_date ?? "—"], ["Line manager / HOD / appraiser", a.line_manager_name ?? "HR"],
    ["Review period", `${a.cycle.period_from} → ${a.cycle.period_to}`],
    ["Mid-year review date", a.mid_locked_at ?? a.cycle.self_deadline ?? "—"], ["Year-end review date", a.completed_at ?? a.cycle.review_deadline ?? "—"],
  ];
  return (
    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
      {cells.map(([k, v]) => (
        <div key={k} className="flex gap-2 border-b border-gray-50 py-1">
          <span className="w-48 shrink-0 text-gray-500">{k}</span><span className="text-gray-900 truncate">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Objectives & KPIs editor (before the objectives are locked). */
export function ObjectivesEditor({ a, editable, onSave, onDelete }: {
  a: Appraisal; editable: boolean;
  onSave: (body: RowBody, id?: number) => Promise<unknown>; onDelete: (id: number) => Promise<unknown>;
}) {
  const [edit, setEdit] = useState<{ id?: number; body: RowBody } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const total = a.weight_total;

  async function save() {
    if (!edit) return;
    setSaving(true);
    setErr(null);
    try {
      await onSave(edit.body, edit.id);
      setEdit(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }
  const w = edit?.body.weightage ?? 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-ink">Objectives &amp; KPIs</p>
        <span className="text-xs text-gray-400">Max {SHEET_RULES.maxRows} accountabilities · weightage {SHEET_RULES.minWeight}%–{SHEET_RULES.maxWeight}% each</span>
        <Pill tone={Math.abs(total - 100) < 0.01 ? "green" : "red"}>Total weightage {total}%</Pill>
        {editable && a.rows.length < SHEET_RULES.maxRows && <Button size="sm" variant="secondary" className="ml-auto"
          onClick={() => setEdit({ body: emptyRow(Math.min(SHEET_RULES.maxWeight, Math.max(SHEET_RULES.minWeight, 100 - total))) })}>
          <Plus className="h-4 w-4 mr-1" />Add accountability</Button>}
      </div>
      {a.weight_problems.length > 0 && a.rows.length > 0 && (
        <p className="text-xs text-red-600">{a.weight_problems.join(" · ")}</p>
      )}
      <SheetTable rows={a.rows} show={{ progress: false, self: false, agreed: false }}
        actions={editable ? (r) => (
          <>
            <button className="p-1 text-gray-400 hover:text-indigo-600" title="Edit" onClick={() => setEdit({
              id: r.emp_goal_id,
              body: { accountability: r.accountability, task: r.task, kpi: r.kpi, success_criteria: r.success_criteria, interdependencies: r.interdependencies, weightage: r.weightage, due_date: r.due_date },
            })}><Pencil className="h-4 w-4" /></button>
            <button className="p-1 text-gray-400 hover:text-red-600" title="Delete"
              onClick={() => { if (confirm("Delete this accountability?")) onDelete(r.emp_goal_id).catch((e) => alert(e.message)); }}>
              <Trash2 className="h-4 w-4" /></button>
          </>
        ) : undefined} />
      {edit && (
        <Modal size="lg" title={edit.id ? "Edit accountability" : "Add accountability"} onClose={() => setEdit(null)}
          footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!edit.body.task.trim() || w < SHEET_RULES.minWeight || w > SHEET_RULES.maxWeight}>Save</Button></div>}>
          <div className="space-y-3">
            {err && <div className="p-2.5 rounded-lg bg-red-50 text-sm text-red-600">{err}</div>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Accountability (core area — keep broad)" value={edit.body.accountability ?? ""}
                onChange={(e) => setEdit({ ...edit, body: { ...edit.body, accountability: e.target.value } })} />
              <Input label={`Weightage (${SHEET_RULES.minWeight}%–${SHEET_RULES.maxWeight}%)`} type="number" min={SHEET_RULES.minWeight} max={SHEET_RULES.maxWeight}
                value={edit.body.weightage} onChange={(e) => setEdit({ ...edit, body: { ...edit.body, weightage: Number(e.target.value) } })} />
            </div>
            <TextArea label="Task for the year (start with an action verb)" rows={2} value={edit.body.task}
              onChange={(v) => setEdit({ ...edit, body: { ...edit.body, task: v } })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="KPI (what is measured)" value={edit.body.kpi ?? ""} onChange={(e) => setEdit({ ...edit, body: { ...edit.body, kpi: e.target.value } })} />
              <Input label="Success criteria (number / % / TAT — quantifiable + deadline)" value={edit.body.success_criteria ?? ""}
                onChange={(e) => setEdit({ ...edit, body: { ...edit.body, success_criteria: e.target.value } })} />
              <Input label="Interdependencies (who you work with)" value={edit.body.interdependencies ?? ""}
                onChange={(e) => setEdit({ ...edit, body: { ...edit.body, interdependencies: e.target.value } })} />
              <Input label="Deadline (optional)" type="date" value={edit.body.due_date ?? ""}
                onChange={(e) => setEdit({ ...edit, body: { ...edit.body, due_date: e.target.value || null } })} />
            </div>
            <p className="text-xs text-gray-500">The total weightage of all accountabilities must equal 100% before submission.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** The task sheet as a table (read-only cells; `actions` adds a column of buttons). */
export function SheetTable({ rows, show, actions }: {
  rows: SheetRow[]; show: { progress: boolean; self: boolean; agreed: boolean };
  actions?: (r: SheetRow) => React.ReactNode;
}) {
  if (!rows.length) return <Empty>No accountabilities yet.</Empty>;
  const total = rows.reduce((t, r) => t + r.weightage, 0);
  const sumOf = (k: "self_score" | "score") => rows.some((r) => r[k] != null) ? rows.reduce((t, r) => t + (r[k] ?? 0), 0) : null;
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-[11px] uppercase">
          <tr>
            <th className="px-2 py-2 text-left">No</th><th className="px-2 py-2 text-left">Accountability</th><th className="px-2 py-2 text-left">Task for the year</th>
            <th className="px-2 py-2 text-left">KPI</th><th className="px-2 py-2 text-left">Success criteria</th><th className="px-2 py-2 text-left">Interdependencies</th>
            {show.progress && <th className="px-2 py-2 text-left">Mid-year progress</th>}
            <th className="px-2 py-2 text-right">Weightage</th>
            {show.self && <th className="px-2 py-2 text-center">Self rating</th>}
            {show.agreed && <><th className="px-2 py-2 text-center">Agreed with HOD</th><th className="px-2 py-2 text-right">Score</th></>}
            {actions && <th className="px-2 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 align-top">
          {rows.map((r, i) => (
            <tr key={r.emp_goal_id}>
              <td className="px-2 py-2 text-gray-400">{i + 1}</td>
              <td className="px-2 py-2 text-gray-800">{r.accountability || "—"}
                {r.source !== "INDIVIDUAL" && <Pill className="ml-1" tone="indigo">{r.source === "CORPORATE" ? "Corporate" : "Dept"}</Pill>}</td>
              <td className="px-2 py-2 text-gray-900">{r.task}</td>
              <td className="px-2 py-2 text-gray-600">{r.kpi || "—"}</td>
              <td className="px-2 py-2 text-gray-600">{r.success_criteria || "—"}{r.due_date ? <span className="block text-[11px] text-gray-400">by {r.due_date}</span> : null}</td>
              <td className="px-2 py-2 text-gray-600">{r.interdependencies || "—"}</td>
              {show.progress && <td className="px-2 py-2 text-gray-700 whitespace-pre-wrap">{r.midyear_progress || "—"}</td>}
              <td className="px-2 py-2 text-right tabular-nums">{r.weightage}%</td>
              {show.self && <td className="px-2 py-2 text-center"><GradeBadge g={r.self_rating} /></td>}
              {show.agreed && <>
                <td className="px-2 py-2 text-center"><GradeBadge g={r.agreed_rating} />
                  {r.reviewer_remarks && <span className="block text-[11px] text-gray-500 mt-0.5">{r.reviewer_remarks}</span>}</td>
                <td className="px-2 py-2 text-right tabular-nums">{r.score == null ? "—" : r.score.toFixed(2)}</td>
              </>}
              {actions && <td className="px-2 py-2 text-right whitespace-nowrap">{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 text-sm font-semibold">
          <tr>
            <td className="px-2 py-2" colSpan={show.progress ? 7 : 6}>TOTAL &quot;A&quot;</td>
            <td className={cn("px-2 py-2 text-right tabular-nums", Math.abs(total - 100) > 0.01 && "text-red-600")}>{total}%</td>
            {show.self && <td className="px-2 py-2 text-center tabular-nums">{scoreText(sumOf("self_score"))}</td>}
            {show.agreed && <><td /><td className="px-2 py-2 text-right tabular-nums">{scoreText(sumOf("score"))}</td></>}
            {actions && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Approval trail ──
const ACTION_TEXT: Record<string, string> = {
  SUBMIT: "submitted", APPROVE: "approved", RETURN: "returned", SIGN: "signed", FINALISE: "finalised", ACK: "acknowledged", CANCEL: "cancelled", REOPEN: "reopened",
};
export function Trail({ steps }: { steps: ApprovalStep[] }) {
  if (!steps.length) return <Empty>No actions yet.</Empty>;
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className={cn("mt-0.5 h-6 w-6 shrink-0 rounded-full flex items-center justify-center",
            s.action === "RETURN" ? "bg-amber-50 text-amber-600" : s.action === "CANCEL" ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600")}>
            {s.action === "RETURN" ? <CornerUpLeft className="h-3.5 w-3.5" /> : s.action === "SIGN" || s.action === "ACK" ? <PenLine className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0">
            <p className="text-gray-900">
              <b>{s.actor_name || s.actor}</b> <span className="text-gray-500">({ROLE_LABEL[s.role] ?? s.role})</span>{" "}
              {ACTION_TEXT[s.action] ?? s.action.toLowerCase()}
              {s.next_stage && <span className="text-gray-500"> → {STAGE_LABEL[s.next_stage] ?? s.next_stage}</span>}
            </p>
            <p className="text-xs text-gray-400">{s.acted_at}{s.score != null ? ` · Total "A" ${s.score.toFixed(2)}` : ""}</p>
            {s.remarks && <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">“{s.remarks}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Evidence files ──
export function EvidenceList({ files, pathOf, token, onDelete, onUpload }: {
  files: Attachment[]; pathOf: (attId: number) => string; token?: string;
  onDelete?: (attId: number) => Promise<unknown>; onUpload?: (f: File) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Paperclip className="h-4 w-4 text-gray-400" />
        <p className="font-semibold text-ink text-sm">Evidence</p>
        {onUpload && (
          <label className="ml-auto inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline cursor-pointer">
            <Plus className="h-4 w-4" />{busy ? "Uploading…" : "Attach file"}
            <input type="file" className="hidden" disabled={busy} accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setBusy(true);
                try { await onUpload(f); } catch (er) { alert(er instanceof Error ? er.message : "Upload failed"); } finally { setBusy(false); }
              }} />
          </label>
        )}
      </div>
      {files.length === 0 ? <p className="text-xs text-gray-400">No files attached.</p> : (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.att_id} className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-gray-400 shrink-0" />
              <button className="text-indigo-600 hover:underline truncate text-left"
                onClick={() => downloadFile(pathOf(f.att_id), f.file_name, token).catch((e) => alert(e.message))}>{f.file_name}</button>
              <span className="text-xs text-gray-400 whitespace-nowrap">{f.uploaded_at}</span>
              <Download className="h-3.5 w-3.5 text-gray-300" />
              {onDelete && <button className="ml-auto p-1 text-gray-400 hover:text-red-600" title="Remove"
                onClick={() => { if (confirm("Remove this file?")) onDelete(f.att_id).catch((e) => alert(e.message)); }}>
                <Trash2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Approve / return dialog ──
export function DecisionModal({ decision, onClose, onConfirm, approveText = "Approve", note, requireRemarks }: {
  decision: "approve" | "return"; onClose: () => void; onConfirm: (remarks: string) => Promise<unknown>; approveText?: string;
  note?: React.ReactNode; requireRemarks?: boolean;
}) {
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ret = decision === "return";
  async function go() {
    if ((ret || requireRemarks) && !remarks.trim()) { setErr("Please give a reason"); return; }
    setSaving(true);
    setErr(null);
    try {
      await onConfirm(remarks.trim());
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal size="sm" title={ret ? "Return for changes" : approveText} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={ret ? "danger" : "primary"} onClick={go} loading={saving}>{ret ? "Return" : approveText}</Button></div>}>
      <div className="space-y-3">
        {note}
        {err && <div className="p-2.5 rounded-lg bg-red-50 text-sm text-red-600">{err}</div>}
        <TextArea label={ret || requireRemarks ? "Reason / comments (required)" : "Comments (optional)"} value={remarks} onChange={setRemarks} />
      </div>
    </Modal>
  );
}

// ── Charts ──
/**
 * Bell curve: one bar per grade = actual share of employees; the gray tick
 * marks the company standard. The HODs' own grades (before HR normalisation)
 * and the remark are given in text, not by colour alone.
 */
export function BellCurveChart({ bc }: { bc: BellCurve }) {
  const max = Math.max(10, ...bc.bands.map((b) => Math.max(b.actual_pct, b.target_pct ?? 0)));
  return (
    <div className="space-y-2" role="img" aria-label="Grade distribution: actual share of employees per grade against the standard">
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-indigo-500" />Actual %</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-gray-500" />Standard %</span>
        <span className="ml-auto">{bc.total} graded{bc.average != null ? ` · average Total "A" ${bc.average.toFixed(2)}` : ""}</span>
      </div>
      {bc.bands.map((b) => (
        <div key={b.label} className="grid grid-cols-[3rem_1fr_9rem] items-center gap-2 text-xs group"
          title={`${b.label} ${b.description}: ${b.count} employee(s), ${b.actual_pct}% — standard ${b.target_pct ?? "—"}% (${b.standard_count ?? "—"}) · HODs gave ${b.hod_count}`}>
          <GradeBadge g={b.label} />
          <div className="relative h-5 rounded bg-gray-50">
            <div className="absolute inset-y-0.5 left-0 rounded-r-[4px] bg-indigo-500 group-hover:bg-indigo-600 transition-colors"
              style={{ width: `${(b.actual_pct / max) * 100}%` }} />
            {b.target_pct != null && <div className="absolute -inset-y-0.5 w-0.5 bg-gray-500" style={{ left: `${(b.target_pct / max) * 100}%` }} />}
          </div>
          <span className={cn("tabular-nums text-right", b.remark === "ABOVE" ? "text-amber-700 font-semibold" : "text-gray-600")}>
            {b.actual_pct}% ({b.count}) <span className="text-gray-400">std {b.target_pct ?? "—"}%</span>
          </span>
        </div>
      ))}
      {bc.warnings.length > 0 && (
        <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800 space-y-0.5">
          <p className="font-semibold">▲ Above the standard distribution — consider normalising:</p>
          {bc.warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}
    </div>
  );
}

/** Total "A" per completed cycle, oldest → newest (one series, 0–5 axis). */
export function TrendChart({ points }: { points: { label: string; score: number | null; rating?: string }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = points.filter((p) => p.score != null) as { label: string; score: number; rating?: string }[];
  if (pts.length === 0) return <Empty>No completed appraisals yet.</Empty>;
  const W = 560, H = 180, L = 32, R = 12, T = 12, B = 28;
  const x = (i: number) => (pts.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (pts.length - 1));
  const y = (v: number) => T + ((5 - v) * (H - T - B)) / 5;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.score)}`).join(" ");
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Performance trend">
        {[1, 2, 3, 4, 5].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="currentColor" className="text-gray-100" />
            <text x={L - 6} y={y(g) + 3} textAnchor="end" className="fill-gray-400 text-[10px]">{g}</text>
          </g>
        ))}
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} className="text-indigo-500" />
        {pts.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle cx={x(i)} cy={y(p.score)} r={14} fill="transparent" />
            <circle cx={x(i)} cy={y(p.score)} r={hover === i ? 6 : 4.5} className="fill-indigo-500 stroke-white" strokeWidth={2} />
            <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-gray-500 text-[10px]">{p.label.length > 16 ? `${p.label.slice(0, 15)}…` : p.label}</text>
          </g>
        ))}
      </svg>
      {hover != null && (
        <div className="absolute pointer-events-none rounded-lg bg-white shadow-lg border border-gray-100 px-2.5 py-1.5 text-xs"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(pts[hover].score) / H) * 100}%`, transform: "translate(-50%, -120%)" }}>
          <p className="font-semibold text-ink">{pts[hover].label}</p>
          <p className="text-gray-600">Total &quot;A&quot; {pts[hover].score.toFixed(2)}{pts[hover].rating ? ` · grade ${pts[hover].rating}` : ""}</p>
        </div>
      )}
    </div>
  );
}

/** Print the task sheet in the layout of the DCL form (browser print → PDF). */
export function printTaskSheet(a: Appraisal, companyName?: string, internal = false) {
  const done = a.stage === "COMPLETED" || internal;
  printTablePdf({
    companyName,
    title: `Employee Task Setting & Performance Appraisal — ${a.cycle.name}`,
    meta: `${a.emp_name} (${a.empno || a.empcode}) · ${a.desg_desc} · ${a.dept_name} · joined ${a.join_date ?? "—"} · appraiser ${a.line_manager_name ?? "HR"} · `
      + `period ${a.cycle.period_from} to ${a.cycle.period_to}${done && a.final_rating ? ` · final grade ${a.final_rating}` : ""}`,
    landscape: true,
    columns: ["No", "Accountability", "Task for the year", "KPI", "Success criteria", "Interdependencies", "Mid-year progress",
      { header: "Weightage", align: "right" }, { header: "Self rating", align: "center" }, { header: "Agreed with HOD", align: "center" },
      { header: "Score", align: "right" }],
    rows: [
      ...a.rows.map((r, i) => [i + 1, r.accountability, r.task, r.kpi, r.success_criteria, r.interdependencies, r.midyear_progress,
        `${r.weightage}%`, r.self_rating ?? "", done ? r.agreed_rating ?? "" : "", done && r.score != null ? r.score.toFixed(2) : ""]),
      ["", "", "", "", "", "", 'TOTAL "A"', `${a.weight_total}%`, scoreText(a.self_score), "", done ? scoreText(internal ? a.calc_score : a.final_score) : ""],
    ],
  });
}
