"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { ErrorBox, Empty } from "@/components/training/TrainingUi";
import { GradeBadge } from "@/components/appraisal/AppraisalUi";
import { PromotionCaseView, CaseStatusPill } from "@/components/appraisal/PromotionCase";
import {
  apprHrApi, CASE_STATUS_LABEL, pctText, type Hr, type Cycle, type CaseRow, type CaseStatus, type PromotionCase, type Designation,
} from "@/services/appraisalService";

/**
 * Promotion evaluations — one per finalised appraisal that recommended a
 * promotion. HR fills sheets 1, 3 and 4 and gives the HR Head's
 * recommendation; the employee, manager, HOD and CEO act from their own pages.
 */
export function PromotionsPanel({ h }: { h: Hr }) {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => { apprHrApi.cycles(h).then((r) => setCycles(r.items)).catch(() => {}); }, [h]);
  const load = useCallback(() => {
    apprHrApi.cases(h, { cycle_id: cycleId || undefined, status: status || undefined })
      .then((r) => { setRows(r.items); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h, cycleId, status]);
  useEffect(() => { load(); }, [load]);

  if (open) return <CaseDetail h={h} id={open} onBack={() => { setOpen(null); load(); }} />;

  return (
    <div className="space-y-4">
      <Card><CardContent className="py-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700">Cycle</label>
          <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
            <option value="">All cycles</option>{cycles.map((c) => <option key={c.cycle_id} value={c.cycle_id}>{c.name}</option>)}
          </select></div>
        <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700">Status</label>
          <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>{(Object.keys(CASE_STATUS_LABEL) as CaseStatus[]).map((s) => <option key={s} value={s}>{CASE_STATUS_LABEL[s]}</option>)}
          </select></div>
        <p className="text-xs text-gray-500 ml-auto max-w-md">A case opens when HR finalises an appraisal whose HOD recommended a promotion. Flow: eligibility (HR) → employee self-assessment →
          manager rating → history &amp; scorecard (HR) → recommendations (RM, HOD, HR Head) → HOD decision → CEO decision → Apply.</p>
      </CardContent></Card>
      <ErrorBox error={error} />
      {!rows ? <Spinner /> : rows.length === 0 ? <Card><Empty>No promotion evaluations.</Empty></Card> : (
        <Card><CardContent className="py-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase"><tr>
              <th className="text-left px-3 py-2">Employee</th><th className="text-left px-3 py-2">Promotion</th><th className="text-center px-3 py-2">Grade</th>
              <th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Eligibility</th><th className="text-right px-3 py-2">Competency</th>
              <th className="text-right px-3 py-2">Performance</th><th className="text-right px-3 py-2">Overall</th><th className="text-left px-3 py-2">Decision band</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((c) => (
                <tr key={c.case_id} className="hover:bg-gray-50/60 cursor-pointer" onClick={() => setOpen(c.case_id)}>
                  <td className="px-3 py-2"><p className="font-medium text-gray-900">{c.emp_name}</p><p className="text-xs text-gray-400">{c.empcode} · {c.dept_name} · {c.cycle_name}</p></td>
                  <td className="px-3 py-2 text-gray-700">{c.cur_desg_desc} → <b>{c.prop_desg_desc}</b></td>
                  <td className="px-3 py-2 text-center"><GradeBadge g={c.appraisal_grade} /></td>
                  <td className="px-3 py-2"><CaseStatusPill status={c.status} label={c.status_label} /></td>
                  <td className="px-3 py-2 text-xs">{c.eligibility_result.replace("_", " ")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pctText(c.comp_score)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pctText(c.perf_score)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{pctText(c.overall_score)}</td>
                  <td className="px-3 py-2 text-xs">{c.decision_band}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      )}
    </div>
  );
}

function CaseDetail({ h, id, onBack }: { h: Hr; id: number; onBack: () => void }) {
  const { user } = useAuth();
  const [cs, setCs] = useState<PromotionCase | null>(null);
  const [desgs, setDesgs] = useState<Designation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apprHrApi.case(h, id).then(setCs).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h, id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apprHrApi.lookups(h).then((l) => setDesgs(l.designations)).catch(() => {}); }, [h]);
  if (error) return <ErrorBox error={error} />;
  if (!cs) return <Spinner />;
  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Promotions</Button>
      <PromotionCaseView key={`${cs.status}-${cs.signoffs.length}-${cs.overall_score}`} cs={cs} designations={desgs} companyName={user?.selected_company?.name}
        hr={{
          saveEligibility: (body) => apprHrApi.saveEligibility(h, id, body).then(load),
          submitEligibility: () => apprHrApi.submitEligibility(h, id).then(load),
          saveHistory: (rows) => apprHrApi.saveHistory(h, id, rows).then(load),
          saveScorecard: (body) => apprHrApi.saveScorecard(h, id, body).then(load),
          submitReview: () => apprHrApi.submitReview(h, id).then(load),
          signoff: (decision, remarks) => apprHrApi.signoff(h, id, decision, remarks).then(load),
          ceoDecision: (body) => apprHrApi.ceoDecision(h, id, body).then(load),
          cancel: (remarks) => apprHrApi.cancelCase(h, id, remarks).then(load),
        }} />
    </div>
  );
}
