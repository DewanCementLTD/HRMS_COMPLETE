"use client";

import { useState } from "react";
import { Save, Send, Check, X, Ban, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ErrorBox, Pill, TextArea } from "@/components/training/TrainingUi";
import { RatingPicker, GradeBadge, DecisionModal } from "./AppraisalUi";
import { printTablePdf } from "@/lib/printTable";
import {
  ROLE_LABEL, OUTCOME_LABEL, pctText,
  type PromotionCase, type MyCase, type CaseStatus, type CeoBody, type Designation,
} from "@/services/appraisalService";

const CASE_TONE: Record<CaseStatus, "gray" | "blue" | "amber" | "green" | "red" | "indigo"> = {
  ELIGIBILITY: "amber", COMPETENCY: "blue", MGR_RATING: "amber", HR_REVIEW: "indigo", SIGNOFF: "amber", HOD_FINAL: "amber",
  CEO_FINAL: "amber", APPROVED: "green", REJECTED: "red", NOT_ELIGIBLE: "red", CANCELLED: "gray",
};
export const CaseStatusPill = ({ status, label }: { status: CaseStatus; label: string }) => <Pill tone={CASE_TONE[status]}>{label}</Pill>;

const BAND_TONE = (outcome: string) =>
  outcome === "PROMOTE" ? "bg-emerald-600 text-white" : outcome === "PROMOTE_DEV" ? "bg-emerald-100 text-emerald-800"
    : outcome === "DEFER" ? "bg-amber-100 text-amber-800" : outcome === "NOT_RECOMMEND" || outcome === "NOT_ELIGIBLE" ? "bg-red-100 text-red-700"
      : "bg-gray-800 text-white";

const Section = ({ n, title, children, right }: { n: string; title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <Card><CardContent className="py-4 space-y-3">
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-800 text-white px-3 py-1.5">
      <span className="text-sm font-bold">{n}. {title}</span>
      <div className="ml-auto">{right}</div>
    </div>
    {children}
  </CardContent></Card>
);

export interface HrCaseActions {
  saveEligibility: (body: { answers: { criterion: string; status: "Y" | "N" | null; remarks?: string }[]; assess_date?: string | null; prop_grade_cd?: string | null }) => Promise<unknown>;
  submitEligibility: () => Promise<unknown>;
  saveHistory: (rows: PromotionCase["history"]) => Promise<unknown>;
  saveScorecard: (body: Partial<PromotionCase>) => Promise<unknown>;
  submitReview: () => Promise<unknown>;
  signoff: (decision: "RECOMMEND" | "NOT_RECOMMEND", remarks?: string) => Promise<unknown>;
  ceoDecision: (body: CeoBody) => Promise<unknown>;
  cancel: (remarks: string) => Promise<unknown>;
}
export interface ReviewCaseActions {
  rate: (rows: { competency_id: number; mgr_rating: number | null; mgr_comment?: string }[], submit: boolean) => Promise<unknown>;
  signoff: (role: "RM" | "HOD", decision: "RECOMMEND" | "NOT_RECOMMEND", remarks?: string) => Promise<unknown>;
  hodFinal: (decision: "APPROVE" | "REJECT", remarks?: string) => Promise<unknown>;
  ceoFinal: (body: CeoBody) => Promise<unknown>;
}

/** The whole promotion evaluation (sheets 1–5); editable parts depend on who is looking. */
export function PromotionCaseView({ cs, hr, review, designations, companyName }: {
  cs: PromotionCase; hr?: HrCaseActions; review?: ReviewCaseActions; designations: Designation[]; companyName?: string;
}) {
  const closed = ["APPROVED", "REJECTED", "NOT_ELIGIBLE", "CANCELLED"].includes(cs.status);
  const [cancel, setCancel] = useState(false);
  const [ceo, setCeo] = useState(false);
  const [sign, setSign] = useState<{ role: "RM" | "HOD" | "HR_HEAD"; decision: "RECOMMEND" | "NOT_RECOMMEND" } | null>(null);
  const [hod, setHod] = useState<"APPROVE" | "REJECT" | null>(null);

  function print() {
    printTablePdf({
      companyName, title: `Promotion Evaluation — ${cs.emp_name}`,
      meta: `${cs.cur_desg_desc} → ${cs.prop_desg_desc || "—"} · ${cs.status_label} · decision band ${cs.decision_band}`,
      columns: ["Item", "Value"],
      rows: [
        ["Eligibility", cs.eligibility_result.replace("_", " ")],
        ...cs.eligibility.map((e) => [`  ${e.criterion}`, `${e.status ?? "—"}${e.remarks ? ` — ${e.remarks}` : ""}`]),
        ["Competency score (manager)", pctText(cs.comp_score)],
        ...cs.competencies.map((c) => [`  ${c.name} (${c.weight_pct}%)`, `self ${c.self_rating ?? "—"} · manager ${c.mgr_rating ?? "—"}`]),
        ...cs.history.map((h) => [`  ${h.appraisal_year || `Year ${h.seq}`}`, `rating ${pctText(h.rating_pct)} · KPI ${pctText(h.kpi_pct)}`]),
        ["Performance score", pctText(cs.perf_score)],
        ["Overall weighted score", pctText(cs.overall_score)],
        ["Decision band", cs.decision_band],
        ["HR recommendation", cs.hr_recommendation || "—"],
        ["Rationale", cs.rationale || "—"],
        ...cs.signoffs.map((s) => [ROLE_LABEL[s.role] ?? s.role, `${s.actor_name} — ${s.decision} ${s.acted_at}${s.remarks ? ` — ${s.remarks}` : ""}`]),
        ["New designation / grade / package", `${cs.final_desg_desc ?? "—"} / ${cs.final_grade_cd ?? "—"} / ${cs.new_package || "—"}`],
        ["Effective date", cs.effective_date ?? "—"],
      ],
    });
  }

  return (
    <div className="space-y-4">
      <Card><CardContent className="py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-ink">Promotion evaluation — {cs.emp_name}</p>
          <CaseStatusPill status={cs.status} label={cs.status_label} />
          <span className={cn("rounded-md px-2 py-0.5 text-xs font-bold", BAND_TONE(cs.decision_outcome))}>{cs.decision_band}</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="secondary" onClick={print}><Printer className="h-4 w-4 mr-1" />Print</Button>
            {hr && !closed && <Button size="sm" variant="danger" onClick={() => setCancel(true)}><Ban className="h-4 w-4 mr-1" />Cancel case</Button>}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {([
            ["Employee name", cs.emp_name], ["Employee ID", cs.empno || cs.empcode], ["Department", cs.dept_name],
            ["Current designation", cs.cur_desg_desc], ["Current grade", cs.cur_grade || "—"], ["Proposed designation", cs.prop_desg_desc || "—"],
            ["Proposed grade", cs.prop_grade_cd || "—"], ["Date of joining (company)", cs.join_date ?? "—"],
            ["Date of joining (current role)", cs.role_since ?? "—"], ["Time in current role (years)", cs.time_in_role_yrs ?? "—"],
            ["Total tenure with company (years)", cs.tenure_yrs ?? "—"], ["Reporting manager", cs.rm_name ?? "—"],
            ["Appraisal grade this cycle", <GradeBadge key="g" g={cs.appraisal_grade} />], ["Date of assessment", cs.assess_date ?? "—"],
            ["Assessed by (HR)", cs.assessed_by_name ?? "—"],
          ] as [string, React.ReactNode][]).map(([k, v]) => (
            <div key={k} className="flex gap-2 border-b border-gray-50 py-1"><span className="w-56 shrink-0 text-gray-500">{k}</span><span className="text-gray-900">{v}</span></div>
          ))}
        </div>
      </CardContent></Card>

      <EligibilitySheet cs={cs} editable={!!hr && cs.status === "ELIGIBILITY"} hr={hr} />
      <CompetencySheet cs={cs} canRate={!!review && !!cs.can_rate} review={review} />
      <HistorySheet cs={cs} editable={!!hr && !closed} hr={hr} />
      <ScorecardSheet cs={cs} editable={!!hr && ["MGR_RATING", "HR_REVIEW", "SIGNOFF"].includes(cs.status)} hr={hr} />

      <Section n="5" title="Approval & sign-off">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">Reviewer role</th><th className="text-left">Name</th><th className="text-left">Recommendation</th><th className="text-left">Date</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {(["RM", "HOD", "HR_HEAD", "HOD_FINAL", "CEO"] as const).map((role) => {
              const s = cs.signoffs.find((x) => x.role === role);
              if (role === "RM" && !cs.rm_empcode) return null;
              if ((role === "HOD" || role === "HOD_FINAL") && !cs.has_hod) return null;
              return (
                <tr key={role}>
                  <td className="py-1.5 text-gray-600">{ROLE_LABEL[role]}{role === "HOD" && cs.hod_name ? ` (${cs.hod_name})` : role === "RM" && cs.rm_name ? ` (${cs.rm_name})` : ""}</td>
                  <td>{s?.actor_name ?? "—"}</td>
                  <td>{s ? <Pill tone={["RECOMMEND", "APPROVE"].includes(s.decision) ? "green" : "red"}>{s.decision.replace("_", " ").toLowerCase()}</Pill> : <span className="text-gray-400">pending</span>}
                    {s?.remarks && <span className="block text-xs text-gray-500">{s.remarks}</span>}</td>
                  <td className="text-gray-500">{s?.acted_at ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {cs.status === "APPROVED" && (
          <div className="p-3 rounded-lg bg-emerald-50 text-sm text-emerald-800">
            Approved: <b>{cs.final_desg_desc}</b>{cs.final_grade_cd ? ` · grade ${cs.final_grade_cd}` : ""}{cs.new_package ? ` · ${cs.new_package}` : ""} · effective <b>{cs.effective_date}</b>.
            HR applies it from <i>Increments &amp; Promotions</i>.
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-end">
          {hr && cs.status === "SIGNOFF" && !cs.signoffs.some((x) => x.role === "HR_HEAD") && <>
            <Button variant="secondary" onClick={() => setSign({ role: "HR_HEAD", decision: "NOT_RECOMMEND" })}><X className="h-4 w-4 mr-1" />HR Head: not recommend</Button>
            <Button onClick={() => setSign({ role: "HR_HEAD", decision: "RECOMMEND" })}><Check className="h-4 w-4 mr-1" />HR Head: recommend</Button>
          </>}
          {review && (cs.can_signoff ?? []).map((role) => (
            <span key={role} className="flex gap-2">
              <Button variant="secondary" onClick={() => setSign({ role: role as "RM" | "HOD", decision: "NOT_RECOMMEND" })}><X className="h-4 w-4 mr-1" />{ROLE_LABEL[role]}: not recommend</Button>
              <Button onClick={() => setSign({ role: role as "RM" | "HOD", decision: "RECOMMEND" })}><Check className="h-4 w-4 mr-1" />{ROLE_LABEL[role]}: recommend</Button>
            </span>
          ))}
          {review && cs.can_hod_final && <>
            <Button variant="secondary" onClick={() => setHod("REJECT")}><X className="h-4 w-4 mr-1" />HOD: reject</Button>
            <Button onClick={() => setHod("APPROVE")}><Check className="h-4 w-4 mr-1" />HOD: approve → CEO</Button>
          </>}
          {((review && cs.can_ceo_final) || (hr && cs.status === "CEO_FINAL" && !cs.has_ceo)) && (
            <Button onClick={() => setCeo(true)}><Check className="h-4 w-4 mr-1" />{hr ? "Record CEO decision" : "CEO decision"}</Button>
          )}
        </div>
      </Section>

      {sign && (
        <DecisionModal decision="approve" approveText={sign.decision === "RECOMMEND" ? "Recommend" : "Not recommend"} requireRemarks={sign.decision === "NOT_RECOMMEND"}
          onClose={() => setSign(null)}
          onConfirm={(remarks) => sign.role === "HR_HEAD" ? hr!.signoff(sign.decision, remarks || undefined) : review!.signoff(sign.role, sign.decision, remarks || undefined)} />
      )}
      {hod && <DecisionModal decision="approve" approveText={hod === "APPROVE" ? "Approve" : "Reject"} requireRemarks={hod === "REJECT"}
        onClose={() => setHod(null)} onConfirm={(remarks) => review!.hodFinal(hod, remarks || undefined)} />}
      {ceo && <CeoModal cs={cs} designations={designations} onClose={() => setCeo(false)}
        onSave={(body) => (hr ? hr.ceoDecision(body) : review!.ceoFinal(body))} />}
      {cancel && <DecisionModal decision="return" onClose={() => setCancel(false)}
        note={<p className="text-sm text-red-600">Cancelling closes the case and rejects the promotion recommendation.</p>}
        onConfirm={(remarks) => hr!.cancel(remarks)} />}
    </div>
  );
}

function EligibilitySheet({ cs, editable, hr }: { cs: PromotionCase; editable: boolean; hr?: HrCaseActions }) {
  const [answers, setAnswers] = useState(() => cs.eligibility.map((e) => ({ criterion: e.code, status: e.status, remarks: e.remarks })));
  const [date, setDate] = useState(cs.assess_date ?? new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const result = answers.some((a) => a.status === "N") ? "NOT ELIGIBLE" : answers.some((a) => !a.status) ? "INCOMPLETE" : "ELIGIBLE";
  async function run(kind: "save" | "submit") {
    setBusy(kind);
    setErr(null);
    try {
      await hr!.saveEligibility({ answers, assess_date: date });
      if (kind === "submit") {
        if (result === "NOT ELIGIBLE" && !confirm("Not eligible: the case will close and the promotion recommendation is rejected. Continue?")) return;
        await hr!.submitEligibility();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Section n="1" title="Employee profile & promotion eligibility (HR)"
      right={<span className={cn("rounded px-2 py-0.5 text-xs font-bold", result === "ELIGIBLE" ? "bg-emerald-500" : result === "NOT ELIGIBLE" ? "bg-red-500" : "bg-gray-500")}>
        {editable ? result : cs.eligibility_result.replace("_", " ")}</span>}>
      <p className="text-xs text-gray-500">Eligibility gate — every item must be &quot;Yes&quot; before scoring is decision-grade. An incomplete or not-eligible result flags the scorecard regardless of the scores.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">Criterion</th><th className="text-left">Minimum requirement</th><th className="text-left">Status</th><th className="text-left">Remarks</th></tr></thead>
          <tbody className="divide-y divide-gray-50 align-top">
            {cs.eligibility.map((e, i) => (
              <tr key={e.code}>
                <td className="py-2 pr-2 text-gray-900">{e.criterion}
                  {cs.eligibility_hints[e.code] && <span className="block text-[11px] text-indigo-600">{cs.eligibility_hints[e.code]}</span>}</td>
                <td className="pr-2 text-gray-600 text-xs">{e.requirement}</td>
                <td className="pr-2">
                  {editable ? (
                    <div className="flex gap-1">
                      {(["Y", "N"] as const).map((v) => (
                        <button key={v} type="button" onClick={() => setAnswers(answers.map((a, j) => (j === i ? { ...a, status: a.status === v ? null : v } : a)))}
                          className={cn("h-7 w-10 rounded-lg text-xs font-bold border",
                            answers[i].status === v ? (v === "Y" ? "bg-emerald-600 text-white border-emerald-600" : "bg-red-600 text-white border-red-600") : "bg-white text-gray-600 border-gray-200")}>
                          {v === "Y" ? "Yes" : "No"}
                        </button>
                      ))}
                    </div>
                  ) : e.status ? <Pill tone={e.status === "Y" ? "green" : "red"}>{e.status === "Y" ? "Yes" : "No"}</Pill> : <span className="text-gray-400">—</span>}
                </td>
                <td>{editable
                  ? <input className="w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm" value={answers[i].remarks ?? ""}
                    onChange={(ev) => setAnswers(answers.map((a, j) => (j === i ? { ...a, remarks: ev.target.value } : a)))} />
                  : <span className="text-xs text-gray-600">{e.remarks}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-48"><Input label="Date of assessment" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <ErrorBox error={err} />
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => run("save")} loading={busy === "save"} disabled={!!busy}><Save className="h-4 w-4 mr-1" />Save</Button>
            <Button onClick={() => run("submit")} loading={busy === "submit"} disabled={!!busy || result === "INCOMPLETE"}><Send className="h-4 w-4 mr-1" />Submit eligibility</Button>
          </div>
        </div>
      )}
    </Section>
  );
}

function CompetencySheet({ cs, canRate, review }: { cs: PromotionCase; canRate: boolean; review?: ReviewCaseActions }) {
  const [rows, setRows] = useState(() => Object.fromEntries(cs.competencies.map((c) => [c.competency_id, { mgr_rating: c.mgr_rating ?? null, mgr_comment: c.mgr_comment ?? "" }])));
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const missing = Object.values(rows).filter((r) => r.mgr_rating == null).length;
  async function run(submit: boolean) {
    setBusy(submit ? "submit" : "save");
    setErr(null);
    try {
      await review!.rate(Object.entries(rows).map(([id, v]) => ({ competency_id: Number(id), ...v })), submit);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }
  const totalW = cs.competencies.reduce((t, c) => t + c.weight_pct, 0);
  return (
    <Section n="2" title="Competency assessment" right={<span className="text-xs">Self {pctText(cs.self_comp_score)} · Manager {pctText(cs.comp_score)}</span>}>
      <p className="text-xs text-gray-500">The employee rates themself 1–5 with a real example; the line manager / HOD then rates each competency — the manager&apos;s rating counts. Weights are set by HR.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] text-gray-500 uppercase"><tr>
            <th className="text-left py-1">Competency</th><th className="text-left">Definition</th><th className="text-right">Weight</th>
            <th className="text-center">Self (1–5)</th><th className="text-right">Weighted</th><th className="text-center">Manager (1–5)</th><th className="text-right">Weighted</th>
            <th className="text-left">Evidence / development needs</th></tr></thead>
          <tbody className="divide-y divide-gray-50 align-top">
            {cs.competencies.map((c) => (
              <tr key={c.competency_id}>
                <td className="py-2 pr-2 font-medium text-gray-900 uppercase text-xs">{c.name}</td>
                <td className="pr-2 text-xs text-gray-600 max-w-xs">{c.definition}</td>
                <td className="pr-2 text-right tabular-nums">{c.weight_pct}%</td>
                <td className="text-center tabular-nums">{c.self_rating ?? "—"}</td>
                <td className="pr-2 text-right tabular-nums">{c.self_weighted?.toFixed(2) ?? "—"}</td>
                <td className="text-center">{canRate
                  ? <RatingPicker value={rows[c.competency_id]?.mgr_rating ?? null} onChange={(v) => setRows({ ...rows, [c.competency_id]: { ...rows[c.competency_id], mgr_rating: v } })} />
                  : <span className="tabular-nums">{c.mgr_rating ?? "—"}</span>}</td>
                <td className="pr-2 text-right tabular-nums">{c.mgr_weighted?.toFixed(2) ?? "—"}</td>
                <td className="text-xs text-gray-600">{c.evidence && <p><span className="text-gray-400">Evidence: </span>{c.evidence}</p>}
                  {c.dev_needs && <p><span className="text-gray-400">Needs: </span>{c.dev_needs}</p>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 font-semibold text-sm"><tr>
            <td className="py-1.5 px-1" colSpan={2}>Total / competency score</td><td className="text-right">{totalW}%</td><td /><td className="text-right">{pctText(cs.self_comp_score)}</td>
            <td /><td className="text-right">{pctText(cs.comp_score)}</td><td className="text-xs font-normal text-gray-500">Ratings: self {cs.competency_progress.self}/{cs.competency_progress.total} · manager {cs.competency_progress.mgr ?? 0}/{cs.competency_progress.total}</td>
          </tr></tfoot>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-3 text-sm">
        <div><p className="text-xs text-gray-500">Employee comments / self-reflection</p><p className="whitespace-pre-wrap">{cs.emp_comments || "—"}</p></div>
        <div><p className="text-xs text-gray-500">Technical trainings requested</p><p className="whitespace-pre-wrap">{cs.tech_trainings || "—"}</p></div>
        <div><p className="text-xs text-gray-500">Soft skills / leadership trainings requested</p><p className="whitespace-pre-wrap">{cs.soft_trainings || "—"}</p></div>
      </div>
      {cs.emp_declared_at && <p className="text-xs text-gray-500">Employee declaration signed {cs.emp_declared_at}.</p>}
      {canRate && (
        <div className="flex flex-wrap items-center gap-2">
          {missing > 0 && <Pill tone="amber">{missing} not rated</Pill>}
          <ErrorBox error={err} />
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => run(false)} loading={busy === "save"} disabled={!!busy}><Save className="h-4 w-4 mr-1" />Save</Button>
            <Button onClick={() => run(true)} loading={busy === "submit"} disabled={!!busy || missing > 0}><Send className="h-4 w-4 mr-1" />Submit to HR</Button>
          </div>
        </div>
      )}
    </Section>
  );
}

function HistorySheet({ cs, editable, hr }: { cs: PromotionCase; editable: boolean; hr?: HrCaseActions }) {
  const [rows, setRows] = useState(cs.history);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upd = (i: number, patch: Partial<PromotionCase["history"][number]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const num = (v: string) => (v === "" ? null : Number(v));
  async function save() {
    setBusy(true);
    setErr(null);
    try { await hr!.saveHistory(rows); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  return (
    <Section n="3" title="Performance & KPI track record (HR)" right={<span className="text-xs">Performance score {pctText(cs.perf_score)}</span>}>
      <p className="text-xs text-gray-500">A single strong year can be an outlier — the last 3 appraisal cycles establish the track record. Performance score = average of the 3-year average rating and the 3-year average KPI achievement. Prefilled from completed appraisals (Total &quot;A&quot; ÷ 5).</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">Appraisal year</th><th className="text-right">Overall rating %</th><th className="text-right">KPI achievement %</th><th className="text-left pl-3">Key achievements / quantified results</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r, i) => (
              <tr key={r.seq}>
                <td className="py-1.5">{editable ? <input className="w-28 px-2 py-1 rounded border border-gray-200" value={r.appraisal_year} onChange={(e) => upd(i, { appraisal_year: e.target.value })} /> : r.appraisal_year || "—"}</td>
                <td className="text-right">{editable ? <input type="number" min={0} max={100} className="w-24 px-2 py-1 rounded border border-gray-200 text-right" value={r.rating_pct ?? ""} onChange={(e) => upd(i, { rating_pct: num(e.target.value) })} /> : pctText(r.rating_pct)}</td>
                <td className="text-right">{editable ? <input type="number" min={0} max={100} className="w-24 px-2 py-1 rounded border border-gray-200 text-right" value={r.kpi_pct ?? ""} onChange={(e) => upd(i, { kpi_pct: num(e.target.value) })} /> : pctText(r.kpi_pct)}</td>
                <td className="pl-3">{editable ? <input className="w-full px-2 py-1 rounded border border-gray-200" value={r.achievements} onChange={(e) => upd(i, { achievements: e.target.value })} /> : <span className="text-xs text-gray-600">{r.achievements}</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 font-semibold"><tr><td className="py-1.5 px-1">3-year average</td><td className="text-right">{pctText(cs.history_avg.rating)}</td><td className="text-right">{pctText(cs.history_avg.kpi)}</td><td className="pl-3">Performance score: {pctText(cs.perf_score)}</td></tr></tfoot>
        </table>
      </div>
      {editable && <div className="flex items-center gap-2"><ErrorBox error={err} /><Button className="ml-auto" size="sm" onClick={save} loading={busy}><Save className="h-4 w-4 mr-1" />Save history</Button></div>}
    </Section>
  );
}

function ScorecardSheet({ cs, editable, hr }: { cs: PromotionCase; editable: boolean; hr?: HrCaseActions }) {
  const [f, setF] = useState({
    hr_recommendation: cs.hr_recommendation, rationale: cs.rationale, gap_areas: cs.gap_areas, actions_timeline: cs.actions_timeline,
    next_review_date: cs.next_review_date ?? "",
  });
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run(submit: boolean) {
    setBusy(submit ? "submit" : "save");
    setErr(null);
    try {
      await hr!.saveScorecard({ ...f, next_review_date: f.next_review_date || null });
      if (submit) await hr!.submitReview();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Section n="4" title="Scorecard & promotion decision">
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-sm">
        {([
          ["Eligibility gate result", cs.eligibility_result.replace("_", " ")],
          ["Competency score", `${pctText(cs.comp_score)} × ${cs.comp_weight_pct ?? cs.settings.comp_weight_pct}%`],
          ["Performance score", `${pctText(cs.perf_score)} × ${cs.perf_weight_pct ?? cs.settings.perf_weight_pct}%`],
          ["Overall weighted score", pctText(cs.overall_score)],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} className="flex gap-2 border-b border-gray-50 py-1"><span className="w-48 text-gray-500">{k}</span><b>{v}</b></div>
        ))}
      </div>
      <div className={cn("rounded-lg px-3 py-2 text-center font-bold", BAND_TONE(cs.decision_outcome))}>Decision band: {cs.decision_band}</div>
      <p className="text-[11px] text-gray-500">Bands: {cs.bands.map((b) => `${b.min_score}%+ ${b.label}`).join(" · ")} — {OUTCOME_LABEL[cs.decision_outcome] ? "" : "INCOMPLETE until eligibility and all scores are in."}</p>
      {editable ? (
        <div className="space-y-3">
          <Input label="HR / assessor recommendation" value={f.hr_recommendation} onChange={(e) => setF({ ...f, hr_recommendation: e.target.value })}
            placeholder="e.g. Promote / Promote with development plan / Defer" />
          <TextArea label="Rationale / justification" value={f.rationale} onChange={(v) => setF({ ...f, rationale: v })} />
          <div className="grid gap-3 md:grid-cols-2">
            <TextArea label='If "Promote with development plan": gap areas' rows={2} value={f.gap_areas} onChange={(v) => setF({ ...f, gap_areas: v })} />
            <TextArea label="Recommended actions & timeline" rows={2} value={f.actions_timeline} onChange={(v) => setF({ ...f, actions_timeline: v })} />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-48"><Input label="Next review date" type="date" value={f.next_review_date} onChange={(e) => setF({ ...f, next_review_date: e.target.value })} /></div>
            <ErrorBox error={err} />
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => run(false)} loading={busy === "save"} disabled={!!busy}><Save className="h-4 w-4 mr-1" />Save</Button>
              {cs.status === "HR_REVIEW" && <Button onClick={() => run(true)} loading={busy === "submit"} disabled={!!busy}><Send className="h-4 w-4 mr-1" />Submit for sign-off</Button>}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <p><span className="text-gray-500">HR recommendation: </span>{cs.hr_recommendation || "—"}</p>
          <p><span className="text-gray-500">Next review date: </span>{cs.next_review_date ?? "—"}</p>
          <p className="md:col-span-2"><span className="text-gray-500">Rationale: </span>{cs.rationale || "—"}</p>
          {cs.gap_areas && <p><span className="text-gray-500">Gap areas: </span>{cs.gap_areas}</p>}
          {cs.actions_timeline && <p><span className="text-gray-500">Actions & timeline: </span>{cs.actions_timeline}</p>}
        </div>
      )}
    </Section>
  );
}

function CeoModal({ cs, designations, onClose, onSave }: { cs: PromotionCase; designations: Designation[]; onClose: () => void; onSave: (b: CeoBody) => Promise<unknown> }) {
  const [b, setB] = useState<CeoBody>({ decision: "APPROVE", final_desg_cd: cs.prop_desg_cd, final_grade_cd: cs.prop_grade_cd, new_package: "", effective_date: "", remarks: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setSaving(true);
    setErr(null);
    try { await onSave(b); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }
  const approve = b.decision === "APPROVE";
  return (
    <Modal title="CEO decision" subtitle={`${cs.emp_name} · decision band ${cs.decision_band}`} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={approve ? "primary" : "danger"} onClick={save} loading={saving}
          disabled={approve ? !b.effective_date || !b.final_desg_cd : !b.remarks?.trim()}>{approve ? "Approve promotion" : "Reject"}</Button></div>}>
      <div className="space-y-3">
        <ErrorBox error={err} />
        <div className="flex gap-2">
          {(["APPROVE", "REJECT"] as const).map((d) => (
            <button key={d} onClick={() => setB({ ...b, decision: d })}
              className={cn("px-3 py-1.5 rounded-lg text-sm font-medium border", b.decision === d ? (d === "APPROVE" ? "bg-emerald-600 text-white border-emerald-600" : "bg-red-600 text-white border-red-600") : "bg-white border-gray-200")}>
              {d === "APPROVE" ? "Approve" : "Reject"}</button>
          ))}
        </div>
        {approve && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">New designation</label>
              <select className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={b.final_desg_cd ?? ""} onChange={(e) => setB({ ...b, final_desg_cd: e.target.value })}>
                <option value="">Select…</option>{designations.map((d) => <option key={d.desg_cd} value={d.desg_cd}>{d.desg_desc}</option>)}
              </select>
            </div>
            <Input label="New grade" value={b.final_grade_cd ?? ""} onChange={(e) => setB({ ...b, final_grade_cd: e.target.value })} />
            <Input label="New package (optional)" value={b.new_package ?? ""} onChange={(e) => setB({ ...b, new_package: e.target.value })} />
            <Input label="Effective date" type="date" value={b.effective_date ?? ""} onChange={(e) => setB({ ...b, effective_date: e.target.value })} />
          </div>
        )}
        <TextArea label={approve ? "Remarks (optional)" : "Reason (required)"} value={b.remarks ?? ""} onChange={(v) => setB({ ...b, remarks: v })} />
      </div>
    </Modal>
  );
}

/** Employee's own sheet 2 (self-assessment + declaration). */
export function MyCaseForm({ c, onSave, onSubmit }: {
  c: MyCase;
  onSave: (body: { competencies: { competency_id: number; self_rating: number | null; evidence: string; dev_needs: string }[]; emp_comments: string; tech_trainings: string; soft_trainings: string }) => Promise<unknown>;
  onSubmit: () => Promise<unknown>;
}) {
  const [rows, setRows] = useState(() => Object.fromEntries(c.competencies.map((x) => [x.competency_id, { self_rating: x.self_rating, evidence: x.evidence, dev_needs: x.dev_needs }])));
  const [text, setText] = useState({ emp_comments: c.emp_comments, tech_trainings: c.tech_trainings, soft_trainings: c.soft_trainings });
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const editable = c.can_self_assess;
  const missing = Object.values(rows).filter((r) => r.self_rating == null).length;
  const body = () => ({ competencies: Object.entries(rows).map(([id, v]) => ({ competency_id: Number(id), ...v })), ...text });
  async function run(submit: boolean) {
    setBusy(submit ? "submit" : "save");
    setErr(null);
    setSaved(false);
    try {
      await onSave(body());
      if (submit) {
        if (!confirm("I confirm that the ratings and examples above are my honest self-assessment. Submit?")) { setSaved(true); return; }
        await onSubmit();
      } else setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Rate yourself 1–5 per competency and give a real example from this year. Weights are pre-set by HR.</p>
      <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
        {c.competencies.map((x) => (
          <div key={x.competency_id} className="p-3 grid gap-2 lg:grid-cols-[minmax(12rem,1fr)_auto_1.2fr_1fr] lg:items-start">
            <div><p className="text-sm font-semibold text-gray-900">{x.name} <span className="text-xs font-normal text-gray-400">{x.weight_pct}%</span></p>
              <p className="text-[11px] text-gray-500">{x.definition}</p></div>
            <RatingPicker value={rows[x.competency_id]?.self_rating ?? null} disabled={!editable}
              onChange={(v) => setRows({ ...rows, [x.competency_id]: { ...rows[x.competency_id], self_rating: v } })} />
            <textarea rows={2} disabled={!editable} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="Your evidence / example (this year)"
              value={rows[x.competency_id]?.evidence ?? ""} onChange={(e) => setRows({ ...rows, [x.competency_id]: { ...rows[x.competency_id], evidence: e.target.value } })} />
            <textarea rows={2} disabled={!editable} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="Development needs (your comments)"
              value={rows[x.competency_id]?.dev_needs ?? ""} onChange={(e) => setRows({ ...rows, [x.competency_id]: { ...rows[x.competency_id], dev_needs: e.target.value } })} />
          </div>
        ))}
      </div>
      <TextArea label="Employee comments / self-reflection" value={text.emp_comments} onChange={(v) => setText({ ...text, emp_comments: v })} />
      <div className="grid gap-3 md:grid-cols-2">
        <TextArea label="Training / development I am requesting — technical" rows={2} value={text.tech_trainings} onChange={(v) => setText({ ...text, tech_trainings: v })} />
        <TextArea label="Training / development I am requesting — soft skills / leadership" rows={2} value={text.soft_trainings} onChange={(v) => setText({ ...text, soft_trainings: v })} />
      </div>
      <ErrorBox error={err} />
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Ratings completed: {c.competencies.length - missing} of {c.competencies.length}</span>
          {saved && <span className="text-xs text-emerald-600">Saved</span>}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => run(false)} loading={busy === "save"} disabled={!!busy}><Save className="h-4 w-4 mr-1" />Save draft</Button>
            <Button onClick={() => run(true)} loading={busy === "submit"} disabled={!!busy || missing > 0}><Send className="h-4 w-4 mr-1" />Sign declaration &amp; submit</Button>
          </div>
        </div>
      ) : c.emp_declared_at ? <p className="text-xs text-gray-500">Declaration signed {c.emp_declared_at}.</p> : null}
    </div>
  );
}
