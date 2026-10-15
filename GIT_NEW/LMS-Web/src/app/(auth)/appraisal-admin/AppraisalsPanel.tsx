"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CornerUpLeft, Search, SlidersHorizontal, UserCog, Ban, CheckCheck, Printer, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import { ErrorBox, Empty, Pill, TextArea } from "@/components/training/TrainingUi";
import {
  StagePill, StageTracker, ScoreStrip, ObjectivesEditor, SheetTable, SheetHeader, Trail, EvidenceList, DecisionModal, BellCurveChart,
  GradeBadge, GradePicker, printTaskSheet,
} from "@/components/appraisal/AppraisalUi";
import { RecommendationsForm, RecommendationsView } from "@/components/appraisal/AppraisalForms";
import type { EmployeeLite } from "@/services/trainingService";
import {
  apprHrApi, STAGE_LABEL, PHASE_LABEL, ROLE_LABEL, scoreText,
  type Hr, type HrRow, type Cycle, type Appraisal, type Lookups, type BellCurve, type Stage, type Grade,
} from "@/services/appraisalService";

export function AppraisalsPanel({ h, initialCycle }: { h: Hr; initialCycle: number | null }) {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleId, setCycleId] = useState<string>(initialCycle ? String(initialCycle) : "");
  const [stage, setStage] = useState("");
  const [qText, setQText] = useState("");
  const [rows, setRows] = useState<HrRow[] | null>(null);
  const [bc, setBc] = useState<BellCurve | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());

  useEffect(() => {
    apprHrApi.cycles(h).then((r) => {
      setCycles(r.items);
      if (!initialCycle) {
        const act = r.items.find((c) => c.status === "ACTIVE") ?? r.items[0];
        if (act) setCycleId(String(act.cycle_id));
      }
    }).catch(() => {});
  }, [h, initialCycle]);

  const load = useCallback(() => {
    if (!cycleId) return;
    apprHrApi.appraisals(h, { cycle_id: cycleId, stage, q: qText.trim() || undefined })
      .then((r) => { setRows(r.items); setSel(new Set()); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    apprHrApi.bellCurve(h, Number(cycleId)).then(setBc).catch(() => setBc(null));
  }, [h, cycleId, stage, qText]);
  useEffect(() => { load(); }, [load]);

  const hrRows = useMemo(() => (rows ?? []).filter((r) => r.stage === "HR"), [rows]);
  const cycle = cycles.find((c) => String(c.cycle_id) === cycleId);

  if (open) return <HrDetail h={h} id={open} onBack={() => { setOpen(null); load(); }} />;

  async function bulk() {
    const ids = sel.size ? [...sel] : hrRows.map((r) => r.appraisal_id);
    if (!ids.length || !confirm(`Finalise ${ids.length} appraisal(s) at the HR stage without grade changes? Their ratings will be locked.`)) return;
    try {
      const r = await apprHrApi.bulkApprove(h, Number(cycleId), ids);
      alert(`${r.approved} finalised`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="space-y-4">
      <Card><CardContent className="py-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Cycle</label>
          <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm min-w-56" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
            {cycles.map((c) => <option key={c.cycle_id} value={c.cycle_id}>{c.name}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Stage</label>
          <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="">All stages</option>
            {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="relative">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-3" />
          <input className="pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-sm" placeholder="Name or code" value={qText} onChange={(e) => setQText(e.target.value)} />
        </div>
        {cycle && <Pill>Phase: {PHASE_LABEL[cycle.phase]}</Pill>}
        {hrRows.length > 0 && <Button className="ml-auto" variant="secondary" onClick={bulk}>
          <CheckCheck className="h-4 w-4 mr-1" />Finalise {sel.size ? `${sel.size} selected` : `all ${hrRows.length} at HR`}</Button>}
      </CardContent></Card>

      {bc && bc.total > 0 && (
        <Card><CardContent className="py-4 space-y-2"><p className="font-semibold text-ink">Bell curve — this cycle</p><BellCurveChart bc={bc} /></CardContent></Card>
      )}

      <ErrorBox error={error} />
      {!cycleId ? <Card><Empty>No appraisal cycle yet.</Empty></Card> : !rows ? <Spinner /> : rows.length === 0 ? <Card><Empty>No appraisals match.</Empty></Card> : (
        <Card><CardContent className="py-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase">
              <tr><th className="px-2 py-2" /><th className="text-left px-3 py-2">Employee</th><th className="text-left px-3 py-2">Stage</th>
                <th className="text-left px-3 py-2">Line manager</th><th className="text-right px-3 py-2">Self</th><th className="text-right px-3 py-2">Total &quot;A&quot;</th>
                <th className="text-center px-3 py-2">HOD grade</th><th className="text-center px-3 py-2">Final</th><th className="text-left px-3 py-2">Promotion</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r) => (
                <tr key={r.appraisal_id} className="hover:bg-gray-50/60 cursor-pointer" onClick={() => setOpen(r.appraisal_id)}>
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    {r.stage === "HR" && <input type="checkbox" checked={sel.has(r.appraisal_id)} onChange={(e) => {
                      const n = new Set(sel);
                      if (e.target.checked) n.add(r.appraisal_id); else n.delete(r.appraisal_id);
                      setSel(n);
                    }} />}
                  </td>
                  <td className="px-3 py-2"><p className="text-gray-900 font-medium">{r.emp_name}</p><p className="text-xs text-gray-400">{r.empcode} · {r.desg_desc} · {r.dept_name}</p></td>
                  <td className="px-3 py-2"><StagePill stage={r.stage} /></td>
                  <td className="px-3 py-2 text-xs text-gray-600">{r.line_manager_role === "RPT" ? r.rpt_name : ROLE_LABEL[r.line_manager_role]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{scoreText(r.self_score)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{scoreText(r.calc_score)}</td>
                  <td className="px-3 py-2 text-center"><GradeBadge g={r.hod_grade} /></td>
                  <td className="px-3 py-2 text-center"><GradeBadge g={["HR", "COMPLETED"].includes(r.stage) ? r.final_rating : null} />
                    {r.hr_adj_grade && <span className="block text-[10px] text-amber-600">normalised</span>}</td>
                  <td className="px-3 py-2">{r.promo_recommended && <Pill tone="indigo">Recommended</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      )}
    </div>
  );
}

function HrDetail({ h, id, onBack }: { h: Hr; id: number; onBack: () => void }) {
  const { user } = useAuth();
  const [a, setA] = useState<Appraisal | null>(null);
  const [lk, setLk] = useState<Lookups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decide, setDecide] = useState<"approve" | "return" | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [reassign, setReassign] = useState(false);
  const [cancel, setCancel] = useState(false);

  const load = useCallback(() => {
    apprHrApi.appraisal(h, id).then(setA).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h, id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apprHrApi.lookups(h).then(setLk).catch(() => {}); }, [h]);

  if (error) return <ErrorBox error={error} />;
  if (!a) return <Spinner />;
  const atHr = !!a.can_hr_act;
  const objectives = ["OBJ_SETTING", "OBJ_REVIEW"].includes(a.stage);
  const open = !["COMPLETED", "CANCELLED"].includes(a.stage);
  const hrAsLm = a.can_hr_objectives || a.can_hr_midyear;
  const approveText = objectives ? "Approve & lock objectives" : a.stage === "MID_REVIEW" ? "Sign mid-year review" : "Finalise & lock rating";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <p className="font-semibold text-ink">{a.emp_name}</p>
        <StagePill stage={a.stage} />
        {a.emp_ack_at && <Pill tone="green">Employee signed off</Pill>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => printTaskSheet(a, user?.selected_company?.name, true)}><Printer className="h-4 w-4 mr-1" />Print</Button>
          {open && <Button size="sm" variant="secondary" onClick={() => setReassign(true)}><UserCog className="h-4 w-4 mr-1" />Approvers</Button>}
          {open && <Button size="sm" variant="danger" onClick={() => setCancel(true)}><Ban className="h-4 w-4 mr-1" />Cancel</Button>}
        </div>
      </div>

      <Card><CardContent className="py-4 space-y-3">
        <SheetHeader a={a} />
        <StageTracker a={a} />
        {!objectives && <ScoreStrip a={a} internal />}
        {atHr && <Button size="sm" variant="secondary" onClick={() => setAdjust(true)}><SlidersHorizontal className="h-4 w-4 mr-1" />Normalise grade (bell curve)</Button>}
      </CardContent></Card>

      <Card><CardContent className="py-4 space-y-3">
        {objectives ? (
          <ObjectivesEditor a={a} editable={!!a.can_edit_rows}
            onSave={(body, gid) => apprHrApi.saveRow(h, id, body, gid).then(load)}
            onDelete={(gid) => apprHrApi.deleteRow(h, id, gid).then(load)} />
        ) : (
          <>
            <p className="font-semibold text-ink inline-flex items-center gap-1.5">Task sheet <Lock className="h-3.5 w-3.5 text-gray-400" /></p>
            <SheetTable rows={a.rows} show={{ progress: true, self: true, agreed: !["MIDYEAR", "MID_REVIEW"].includes(a.stage) }} />
            {a.mid_comments && <p className="text-sm"><span className="text-gray-500">Mid-year comments: </span>{a.mid_comments}</p>}
          </>
        )}
      </CardContent></Card>

      {!objectives && !["MIDYEAR", "MID_REVIEW"].includes(a.stage) && (
        <Card><CardContent className="py-4 space-y-3">
          <p className="font-semibold text-ink">Recommendations &amp; development</p>
          {atHr && lk ? (
            <RecommendationsForm a={a} designations={lk.designations} courses={lk.courses}
              onSave={(body) => apprHrApi.recommendations(h, id, body).then(load)} />
          ) : <RecommendationsView a={a} showPay />}
          {a.promotion_case && <p className="text-sm">Promotion evaluation: <b>{a.promotion_case.status_label}</b>{a.promotion_case.decision_band ? ` · ${a.promotion_case.decision_band}` : ""} — open it in the Promotions tab.</p>}
        </CardContent></Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardContent className="py-4">
          <EvidenceList files={a.attachments} pathOf={(att) => apprHrApi.evidencePath(h, id, att)} />
        </CardContent></Card>
        <Card><CardContent className="py-4 space-y-2"><p className="font-semibold text-ink text-sm">History</p><Trail steps={a.approvals} /></CardContent></Card>
      </div>

      {(atHr || hrAsLm) && (
        <div className="sticky bottom-3 flex flex-wrap justify-end gap-2 rounded-xl bg-white/90 backdrop-blur border border-gray-100 shadow-sm p-3">
          <span className="text-xs text-gray-500 mr-auto self-center">
            {hrAsLm ? "No reporting officer / HOD is set — HR acts as the line manager." :
              "Finalising locks the rating, writes the performance history and opens a promotion evaluation if one was recommended."}
          </span>
          {(atHr || a.stage === "OBJ_REVIEW" || a.stage === "MID_REVIEW") && <Button variant="secondary" onClick={() => setDecide("return")}><CornerUpLeft className="h-4 w-4 mr-1" />Return</Button>}
          <Button onClick={() => setDecide("approve")}><Check className="h-4 w-4 mr-1" />{approveText}</Button>
        </div>
      )}

      {decide && <DecisionModal decision={decide} onClose={() => setDecide(null)} approveText={approveText}
        onConfirm={(remarks) => apprHrApi.decide(h, id, decide, remarks || undefined).then(load)} />}
      {adjust && <AdjustModal a={a} onClose={() => setAdjust(false)} onSave={(grade, reason) => apprHrApi.adjust(h, id, grade, reason).then(load)} />}
      {reassign && <ReassignModal h={h} a={a} onClose={() => setReassign(false)} onSaved={() => { setReassign(false); load(); }} />}
      {cancel && (
        <DecisionModal decision="return" onClose={() => setCancel(false)}
          note={<p className="text-sm text-red-600">Cancelling closes this appraisal for good. Give the reason below.</p>}
          onConfirm={(remarks) => apprHrApi.cancel(h, id, remarks).then(onBack)} />
      )}
    </div>
  );
}

function AdjustModal({ a, onClose, onSave }: { a: Appraisal; onClose: () => void; onSave: (grade: string | null, reason?: string) => Promise<unknown> }) {
  const [grade, setGrade] = useState<Grade | null>((a.hr_adj_grade as Grade) ?? null);
  const [reason, setReason] = useState(a.hr_adj_reason ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(clear: boolean) {
    setSaving(true);
    setErr(null);
    try {
      await onSave(clear ? null : grade, clear ? undefined : reason.trim());
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal size="sm" title="Normalise grade" subtitle={`Total "A" ${scoreText(a.calc_score)} · HOD grade ${a.hod_grade ?? "—"}`} onClose={onClose}
      footer={<div className="flex justify-end gap-2">
        {a.hr_adj_grade && <Button variant="secondary" onClick={() => save(true)} disabled={saving}>Use the HOD grade</Button>}
        <Button onClick={() => save(false)} loading={saving} disabled={!grade || !reason.trim()}>Save</Button></div>}>
      <div className="space-y-3">
        <ErrorBox error={err} />
        <p className="text-sm text-gray-600">Final grade</p>
        <GradePicker value={grade} onChange={setGrade} />
        <TextArea label="Reason (required — kept in the audit trail)" value={reason} onChange={setReason} />
      </div>
    </Modal>
  );
}

type Pick = { mode: "keep" | "remove" | "set"; empcode: string };

function ReassignModal({ h, a, onClose, onSaved }: { h: Hr; a: Appraisal; onClose: () => void; onSaved: () => void }) {
  const [emps, setEmps] = useState<EmployeeLite[]>([]);
  const [p, setP] = useState<Record<"rpt" | "hod1" | "hod2", Pick>>({
    rpt: { mode: "keep", empcode: "" }, hod1: { mode: "keep", empcode: "" }, hod2: { mode: "keep", empcode: "" },
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { apprHrApi.employees(h).then((r) => setEmps(r.items)).catch(() => {}); }, [h]);
  const opts = emps.filter((e) => e.empcode !== a.empcode).map((e) => ({ value: e.empcode, label: `${e.name} (${e.empcode})` }));
  const val = (x: Pick) => (x.mode === "keep" ? undefined : x.mode === "remove" ? null : x.empcode || null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await apprHrApi.reassign(h, a.appraisal_id, { rpt_empcode: val(p.rpt), hod1_empcode: val(p.hod1), hod2_empcode: val(p.hod2) });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }
  const levels: { k: "rpt" | "hod1" | "hod2"; label: string; now: string | null }[] = [
    { k: "rpt", label: "Reporting officer", now: a.rpt_name },
    { k: "hod1", label: "HOD", now: a.has_hod1 ? a.hod1_name ?? "set" : null },
    { k: "hod2", label: "HOD 2", now: a.has_hod2 ? a.hod2_name ?? "set" : null },
  ];
  return (
    <Modal title="Change approvers" subtitle="Use when a reviewer has left or the reporting line changed" onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></div>}>
      <div className="space-y-4">
        <ErrorBox error={err} />
        {levels.map(({ k, label, now }) => (
          <div key={k} className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-gray-700 w-36">{label}</span>
              <span className="text-gray-500 truncate">now: {now ?? "none"}</span>
              <select className="ml-auto px-2 py-1.5 rounded-lg border border-gray-300 text-sm" value={p[k].mode}
                onChange={(e) => setP({ ...p, [k]: { ...p[k], mode: e.target.value as Pick["mode"] } })}>
                <option value="keep">Keep</option><option value="set">Change to…</option><option value="remove">Remove level</option>
              </select>
            </div>
            {p[k].mode === "set" && (
              <SearchableSelect value={p[k].empcode} onChange={(v) => setP({ ...p, [k]: { mode: "set", empcode: v } })} options={opts} placeholder="Choose employee…" />
            )}
          </div>
        ))}
        <p className="text-xs text-gray-500">The line manager (objectives, mid-year) is the reporting officer, else HOD, else HR. The year-end rating is given by the HOD (or the reporting officer when there is no HOD), then HOD 2, then HR. HODs sign in by the mobile number on their employee record.</p>
      </div>
    </Modal>
  );
}
