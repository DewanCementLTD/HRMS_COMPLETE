"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorBox, Empty, Pill } from "@/components/training/TrainingUi";
import { DecisionModal } from "@/components/appraisal/AppraisalUi";
import { money } from "@/services/trainingService";
import { apprHrApi, scoreText, type Hr, type Cycle, type RecRow, type RecStatus, type Lookups } from "@/services/appraisalService";

const TONE: Record<RecStatus, "gray" | "blue" | "green" | "red"> = { PROPOSED: "gray", APPROVED: "blue", APPLIED: "green", REJECTED: "red" };
const STATUS_TEXT: Record<RecStatus, string> = { PROPOSED: "In review", APPROVED: "Approved — ready to apply", APPLIED: "Applied", REJECTED: "Rejected" };

export function RecommendationsPanel({ h }: { h: Hr }) {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [kind, setKind] = useState<"" | "INCREMENT" | "PROMOTION">("");
  const [status, setStatus] = useState<"" | RecStatus>("APPROVED");
  const [rows, setRows] = useState<RecRow[] | null>(null);
  const [lk, setLk] = useState<Lookups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<RecRow | null>(null);
  const [rejecting, setRejecting] = useState<RecRow | null>(null);

  useEffect(() => {
    apprHrApi.cycles(h).then((r) => setCycles(r.items)).catch(() => {});
    apprHrApi.lookups(h).then(setLk).catch(() => {});
  }, [h]);
  const load = useCallback(() => {
    apprHrApi.recs(h, { cycle_id: cycleId || undefined, kind: kind || undefined, status: status || undefined })
      .then((r) => { setRows(r.items); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h, cycleId, kind, status]);
  useEffect(() => { load(); }, [load]);

  const incTotal = (rows ?? []).filter((r) => r.kind === "INCREMENT" && r.status !== "REJECTED").reduce((t, r) => t + (r.inc_amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <Card><CardContent className="py-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700">Cycle</label>
          <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
            <option value="">All cycles</option>{cycles.map((c) => <option key={c.cycle_id} value={c.cycle_id}>{c.name}</option>)}
          </select></div>
        <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700">Type</label>
          <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="">Increments & promotions</option><option value="INCREMENT">Increments</option><option value="PROMOTION">Promotions</option>
          </select></div>
        <div className="space-y-1.5"><label className="block text-sm font-medium text-gray-700">Status</label>
          <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">All</option>{(Object.keys(STATUS_TEXT) as RecStatus[]).map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}
          </select></div>
        <p className="text-xs text-gray-500 ml-auto max-w-sm">Recommendations become <b>approved</b> when the appraisal gets its final approval. Applying writes the
          increment history and updates the employee&apos;s gross / designation; payroll picks it up in the next salary run.</p>
      </CardContent></Card>

      <ErrorBox error={error} />
      {!rows ? <Spinner /> : rows.length === 0 ? <Card><Empty>No recommendations match.</Empty></Card> : (
        <Card><CardContent className="py-2">
          {incTotal > 0 && <p className="text-xs text-gray-500 px-3 pt-2">Increments listed: <b className="text-ink">{money(incTotal)}</b> per month</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase"><tr>
                <th className="text-left px-3 py-2">Employee</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Recommendation</th>
                <th className="text-right px-3 py-2">Score</th><th className="text-left px-3 py-2">Status</th><th /></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => (
                  <tr key={`${r.kind}${r.rec_id}`}>
                    <td className="px-3 py-2"><p className="text-gray-900 font-medium">{r.emp_name}</p><p className="text-xs text-gray-400">{r.empcode} · {r.dept_name} · {r.cycle_name}</p></td>
                    <td className="px-3 py-2"><Pill tone={r.kind === "INCREMENT" ? "indigo" : "amber"}>{r.kind === "INCREMENT" ? "Increment" : "Promotion"}</Pill></td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.kind === "INCREMENT"
                        ? <>{money(r.inc_amount)}{r.inc_pct != null ? ` (${r.inc_pct}%)` : ""} <span className="text-xs text-gray-400">gross {money(r.status === "APPLIED" ? r.prev_gross : r.current_gross)} → {money((r.status === "APPLIED" ? r.prev_gross ?? 0 : r.current_gross ?? 0) + (r.inc_amount ?? 0))}</span></>
                        : <>{r.cur_desg_desc || r.cur_desg_cd} → <b>{r.prop_desg_desc || r.prop_desg_cd}</b>{r.prop_grade_cd ? <span className="text-xs text-gray-400"> grade {r.prop_grade_cd}</span> : null}</>}
                      <p className="text-xs text-gray-400">by {r.recommended_by_name}{r.justification ? ` — ${r.justification}` : ""}</p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{scoreText(r.final_score)}<span className="block text-[11px] text-gray-500">{r.final_rating}</span></td>
                    <td className="px-3 py-2"><Pill tone={TONE[r.status]}>{STATUS_TEXT[r.status]}</Pill>
                      {r.applied_at && <p className="text-[11px] text-gray-400 mt-0.5">{r.applied_at}{r.hist_doc_no ? ` · doc ${r.hist_doc_no}` : ""}</p>}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.status === "APPROVED" && <Button size="sm" onClick={() => setApplying(r)}><BadgeCheck className="h-4 w-4 mr-1" />Apply</Button>}
                      {["APPROVED", "PROPOSED"].includes(r.status) && <button className="ml-1 p-1.5 text-gray-400 hover:text-red-600" title="Reject" onClick={() => setRejecting(r)}><X className="h-4 w-4" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent></Card>
      )}

      {applying && <ApplyModal h={h} r={applying} lk={lk} onClose={() => setApplying(null)} onDone={() => { setApplying(null); load(); }} />}
      {rejecting && <DecisionModal decision="return" onClose={() => setRejecting(null)}
        note={<p className="text-sm text-gray-600">Reject this {rejecting.kind.toLowerCase()} recommendation for {rejecting.emp_name}.</p>}
        onConfirm={(remarks) => apprHrApi.rejectRec(h, rejecting.kind, rejecting.rec_id, remarks).then(load)} />}
    </div>
  );
}

function ApplyModal({ h, r, lk, onClose, onDone }: { h: Hr; r: RecRow; lk: Lookups | null; onClose: () => void; onDone: () => void }) {
  const inc = r.kind === "INCREMENT";
  const [amount, setAmount] = useState(String(r.inc_amount ?? ""));
  const [period, setPeriod] = useState(String(lk?.periods[0]?.period_no ?? ""));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [arrear, setArrear] = useState(false);
  const [desg, setDesg] = useState(r.prop_desg_cd ?? "");
  const [grade, setGrade] = useState(r.prop_grade_cd ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function apply() {
    setSaving(true);
    setErr(null);
    try {
      if (inc) {
        const res = await apprHrApi.applyIncrement(h, r.rec_id, {
          inc_amount: Number(amount), effective_period: period ? Number(period) : null, effective_date: date || null, with_arrear: arrear,
        });
        setDone(`Gross ${money(res.prev_gross)} → ${money(res.new_gross)} · basic ${money(res.new_basic)} · payroll allowances total ${money(res.payroll_total)} · increment document #${res.doc_no}`);
      } else {
        const res = await apprHrApi.applyPromotion(h, r.rec_id, { prop_desg_cd: desg, prop_grade_cd: grade || null, effective_date: date || null });
        setDone(`Designation is now ${res.desg_desc}.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  const gross = r.current_gross ?? 0;
  return (
    <Modal title={inc ? `Apply increment — ${r.emp_name}` : `Apply promotion — ${r.emp_name}`} onClose={done ? onDone : onClose}
      footer={<div className="flex justify-end gap-2">{done ? <Button onClick={onDone}>Done</Button> : <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={apply} loading={saving} disabled={inc ? !(Number(amount) > 0) : !desg}>Apply now</Button></>}</div>}>
      {done ? <div className="p-3 rounded-lg bg-emerald-50 text-sm text-emerald-800">{done}</div> : (
        <div className="space-y-3">
          <ErrorBox error={err} />
          {inc ? (
            <>
              <p className="text-sm text-gray-600">Current gross <b>{money(gross)}</b> → new gross <b>{money(gross + (Number(amount) || 0))}</b>.
                Basic, house rent and utility are recalculated from the gross by the payroll setup.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Increment amount (monthly)" amount value={amount} onChange={(e) => setAmount(e.target.value)} />
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700">Effective payroll period</label>
                  <select className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={period} onChange={(e) => setPeriod(e.target.value)}>
                    {(lk?.periods ?? []).map((p) => <option key={p.period_no} value={p.period_no}>{p.period_from} → {p.period_to} (#{p.period_no})</option>)}
                  </select>
                </div>
                <Input label="Increment date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                <label className="flex items-center gap-2 text-sm text-gray-700 self-end pb-3">
                  <input type="checkbox" checked={arrear} onChange={(e) => setArrear(e.target.checked)} />With arrears (recorded on the document)
                </label>
              </div>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">New designation</label>
                <select className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={desg} onChange={(e) => setDesg(e.target.value)}>
                  {(lk?.designations ?? []).map((d) => <option key={d.desg_cd} value={d.desg_cd}>{d.desg_desc}</option>)}
                </select>
              </div>
              <Input label="New grade (optional)" value={grade} onChange={(e) => setGrade(e.target.value)} />
              <Input label="Promotion date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          )}
          <p className="text-xs text-amber-700">This changes the employee master immediately. The previous values are kept in the appraisal audit log.</p>
        </div>
      )}
    </Modal>
  );
}
