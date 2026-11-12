"use client";

import { useState } from "react";
import { Save, Send, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ErrorBox, Pill } from "@/components/training/TrainingUi";
import { GradePicker, GradeBadge, ScaleLegend, CompPicker, CompGuide, Behaviours, CompetencyView } from "./AppraisalUi";
import { money, type Course } from "@/services/trainingService";
import {
  GRADE_POINTS, type Appraisal, type Designation, type RecsBody, type Grade, type CompRating, type YearEndBody,
} from "@/services/appraisalService";


// ---------------------------------------------------------------------------
// Mid-year review (employee): progress + self rating per accountability
// ---------------------------------------------------------------------------

const live = (rows: { weightage: number; g: Grade | null }[]) =>
  rows.some((r) => r.g) ? rows.reduce((t, r) => t + (r.g ? (r.weightage / 100) * GRADE_POINTS[r.g] : 0), 0) : null;

export function MidYearForm({ a, onSave, onSubmit }: {
  a: Appraisal;
  onSave: (rows: { emp_goal_id: number; midyear_progress: string; self_rating: Grade | null }[]) => Promise<unknown>;
  onSubmit: () => Promise<unknown>;
}) {
  const [rows, setRows] = useState(() => Object.fromEntries(a.rows.map((r) => [r.emp_goal_id, { midyear_progress: r.midyear_progress, self_rating: r.self_rating }])));
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const body = () => Object.entries(rows).map(([id, v]) => ({ emp_goal_id: Number(id), ...v }));
  const missing = Object.values(rows).filter((r) => !r.self_rating).length;
  const total = live(a.rows.map((r) => ({ weightage: r.weightage, g: rows[r.emp_goal_id]?.self_rating ?? null })));

  async function run(kind: "save" | "submit") {
    setBusy(kind);
    setError(null);
    setSaved(false);
    try {
      await onSave(body());
      if (kind === "submit") {
        if (!confirm("Submit your mid-year review to your line manager? It cannot be changed afterwards unless they return it.")) { setSaved(true); return; }
        await onSubmit();
      } else setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <ScaleLegend />
      <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
        {a.rows.map((r, i) => (
          <div key={r.emp_goal_id} className="p-3 grid gap-2 lg:grid-cols-[minmax(14rem,1.2fr)_1.4fr_auto] lg:items-start">
            <div className="min-w-0">
              <p className="text-sm text-gray-900"><span className="text-gray-400 mr-1">{i + 1}.</span>{r.task}</p>
              <p className="text-[11px] text-gray-400">{r.accountability || "—"} · KPI {r.kpi || "—"} · {r.weightage}%</p>
              {r.success_criteria && <p className="text-[11px] text-gray-500">Target: {r.success_criteria}</p>}
            </div>
            <textarea rows={2} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="Mid-year progress — facts & numbers"
              value={rows[r.emp_goal_id]?.midyear_progress ?? ""}
              onChange={(e) => setRows({ ...rows, [r.emp_goal_id]: { ...rows[r.emp_goal_id], midyear_progress: e.target.value } })} />
            <div className="space-y-1">
              <p className="text-[11px] text-gray-500">Self rating</p>
              <GradePicker value={rows[r.emp_goal_id]?.self_rating ?? null}
                onChange={(g) => setRows({ ...rows, [r.emp_goal_id]: { ...rows[r.emp_goal_id], self_rating: g } })} />
            </div>
          </div>
        ))}
      </div>
      <ErrorBox error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">Self Total &quot;A&quot;: <b className="tabular-nums">{total == null ? "—" : total.toFixed(2)}</b></span>
        {missing > 0 && <Pill tone="amber">{missing} rating(s) still to give</Pill>}
        {saved && <span className="text-xs text-emerald-600">Draft saved</span>}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => run("save")} loading={busy === "save"} disabled={!!busy}><Save className="h-4 w-4 mr-1" />Save draft</Button>
          <Button onClick={() => run("submit")} loading={busy === "submit"} disabled={!!busy}><Send className="h-4 w-4 mr-1" />Submit mid-year review</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year end (employee): year-end progress per accountability + the competency
// self-assessment (rating HD / D / ND, evidence, comments, trainings, declaration)
// ---------------------------------------------------------------------------

const area = "w-full px-3 py-2 rounded-lg border border-gray-200 text-sm";

export function YearEndForm({ a, onSave, onSubmit }: {
  a: Appraisal; onSave: (body: YearEndBody) => Promise<unknown>; onSubmit: (declared: boolean) => Promise<unknown>;
}) {
  const c = a.competency;
  const [progress, setProgress] = useState<Record<number, string>>(() => Object.fromEntries(a.rows.map((r) => [r.emp_goal_id, r.yearend_progress ?? ""])));
  const [comps, setComps] = useState<Record<number, { rating: CompRating | null; evidence: string }>>(
    () => Object.fromEntries(c.items.map((x) => [x.competency_id, { rating: x.rating, evidence: x.evidence ?? "" }])));
  const [notes, setNotes] = useState({ comments: c.comments ?? "", tech_trainings: c.tech_trainings ?? "", soft_trainings: c.soft_trainings ?? "" });
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const noProgress = a.rows.filter((r) => !(progress[r.emp_goal_id] ?? "").trim()).length;
  const unrated = c.items.filter((x) => !comps[x.competency_id]?.rating).length;
  const hasComps = c.items.length > 0;
  const ready = noProgress === 0 && unrated === 0 && (!hasComps || declared);
  const body = (): YearEndBody => ({
    rows: a.rows.map((r) => ({ emp_goal_id: r.emp_goal_id, yearend_progress: progress[r.emp_goal_id] ?? "" })),
    competencies: c.items.map((x) => ({ competency_id: x.competency_id, rating: comps[x.competency_id]?.rating ?? null, evidence: comps[x.competency_id]?.evidence ?? "" })),
    ...notes,
  });

  async function run(kind: "save" | "submit") {
    setBusy(kind);
    setError(null);
    setSaved(false);
    try {
      await onSave(body());
      if (kind === "submit") {
        if (!confirm("Submit your year-end review and competency self-assessment to your HOD? It cannot be changed afterwards unless they return it.")) { setSaved(true); return; }
        await onSubmit(declared);
      } else setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="font-semibold text-ink">1. Year-end progress per accountability</p>
        <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
          {a.rows.map((r, i) => (
            <div key={r.emp_goal_id} className="p-3 grid gap-2 lg:grid-cols-[minmax(14rem,1fr)_1.4fr] lg:items-start">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm text-gray-900"><span className="text-gray-400 mr-1">{i + 1}.</span>{r.task}</p>
                <p className="text-[11px] text-gray-400">{r.accountability || "—"} · target {r.success_criteria || "—"} · {r.weightage}%</p>
                <p className="text-xs text-gray-600"><span className="text-gray-400">Mid-year progress: </span>{r.midyear_progress || "—"}</p>
                <p className="text-xs text-gray-600 inline-flex items-center gap-1"><span className="text-gray-400">Self rating:</span><GradeBadge g={r.self_rating} /></p>
                {r.mid_remarks && <p className="text-xs text-gray-600"><span className="text-gray-400">HOD remarks: </span>{r.mid_remarks}</p>}
              </div>
              <textarea rows={3} className={area} maxLength={2000} placeholder="Year-end progress — facts & numbers"
                value={progress[r.emp_goal_id] ?? ""} onChange={(e) => setProgress({ ...progress, [r.emp_goal_id]: e.target.value })} />
            </div>
          ))}
        </div>
      </div>

      {hasComps && (
        <div className="space-y-2">
          <p className="font-semibold text-ink">2. Competency self-assessment</p>
          <p className="text-xs text-gray-500">For each competency give a real example from this year and rate yourself.</p>
          <CompGuide />
          <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
            {c.items.map((x, i) => (
              <div key={x.competency_id} className="p-3 grid gap-2 lg:grid-cols-[minmax(13rem,1fr)_minmax(12rem,1fr)_1.3fr_auto] lg:items-start">
                <div>
                  <p className="text-sm font-semibold text-gray-900 uppercase"><span className="text-gray-400 mr-1 font-normal">{i + 1}.</span>{x.name}</p>
                  <p className="text-xs text-gray-600">{x.definition}</p>
                </div>
                <Behaviours text={x.behaviours} />
                <textarea rows={3} className={area} maxLength={1000} placeholder="Your evidence / example (this year)"
                  value={comps[x.competency_id]?.evidence ?? ""}
                  onChange={(e) => setComps({ ...comps, [x.competency_id]: { ...comps[x.competency_id], evidence: e.target.value } })} />
                <div className="space-y-1">
                  <p className="text-[11px] text-gray-500">Rating</p>
                  <CompPicker value={comps[x.competency_id]?.rating ?? null}
                    onChange={(r) => setComps({ ...comps, [x.competency_id]: { ...comps[x.competency_id], rating: r } })} />
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1"><label className="block text-sm font-medium text-gray-700">Employee comments / self-reflection</label>
              <textarea rows={4} className={area} maxLength={2000} value={notes.comments} onChange={(e) => setNotes({ ...notes, comments: e.target.value })} /></div>
            <div className="space-y-1"><label className="block text-sm font-medium text-gray-700">Technical trainings I am requesting</label>
              <textarea rows={4} className={area} maxLength={1000} value={notes.tech_trainings} onChange={(e) => setNotes({ ...notes, tech_trainings: e.target.value })} /></div>
            <div className="space-y-1"><label className="block text-sm font-medium text-gray-700">Soft skills / leadership trainings I am requesting</label>
              <textarea rows={4} className={area} maxLength={1000} value={notes.soft_trainings} onChange={(e) => setNotes({ ...notes, soft_trainings: e.target.value })} /></div>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-800 rounded-lg bg-indigo-50 p-3">
            <input type="checkbox" className="mt-0.5" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
            <span><b>Employee declaration.</b> I confirm that the ratings and examples above are my own honest self-assessment for this review period.</span>
          </label>
        </div>
      )}

      <ErrorBox error={error} />
      <div className="flex flex-wrap items-center gap-2">
        {noProgress > 0 && <Pill tone="amber">{noProgress} year-end progress still to write</Pill>}
        {unrated > 0 && <Pill tone="amber">{unrated} competency rating(s) still to give</Pill>}
        {hasComps && noProgress === 0 && unrated === 0 && !declared && <Pill tone="amber">Tick the declaration to submit</Pill>}
        {saved && <span className="text-xs text-emerald-600">Draft saved</span>}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => run("save")} loading={busy === "save"} disabled={!!busy}><Save className="h-4 w-4 mr-1" />Save draft</Button>
          <Button onClick={() => run("submit")} loading={busy === "submit"} disabled={!!busy || !ready}><Send className="h-4 w-4 mr-1" />Submit year-end review</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year end (HOD / reporting officer / HOD 2): agreed rating per accountability
// and the HOD comments on the competency self-assessment
// ---------------------------------------------------------------------------

export function AgreedRatingsForm({ a, onSave }: {
  a: Appraisal;
  onSave: (rows: { emp_goal_id: number; agreed_rating: Grade | null; reviewer_remarks?: string }[], compHodComments?: string) => Promise<unknown>;
}) {
  const hasComps = a.competency.items.length > 0;
  const [hodComments, setHodComments] = useState(a.competency.hod_comments ?? "");
  // HOD 2 starts from HOD 1's agreed ratings.
  const [rows, setRows] = useState(() => Object.fromEntries(a.rows.map((r) => [r.emp_goal_id, {
    agreed_rating: r.agreed_rating, reviewer_remarks: r.reviewer_remarks,
  }])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const missing = Object.values(rows).filter((r) => !r.agreed_rating).length;
  const total = live(a.rows.map((r) => ({ weightage: r.weightage, g: rows[r.emp_goal_id]?.agreed_rating ?? null })));

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(Object.entries(rows).map(([id, v]) => ({ emp_goal_id: Number(id), ...v })), hasComps ? hodComments : undefined);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ScaleLegend />
      <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
        {a.rows.map((r, i) => (
          <div key={r.emp_goal_id} className="p-3 grid gap-2 lg:grid-cols-[minmax(14rem,1.2fr)_1fr_auto] lg:items-start">
            <div className="min-w-0">
              <p className="text-sm text-gray-900"><span className="text-gray-400 mr-1">{i + 1}.</span>{r.task}</p>
              <p className="text-[11px] text-gray-400">{r.accountability || "—"} · KPI {r.kpi || "—"} · target {r.success_criteria || "—"} · {r.weightage}%</p>
              <p className="text-xs text-gray-600 mt-1"><span className="text-gray-400">Mid-year progress: </span>{r.midyear_progress || "—"}</p>
              {r.mid_remarks && <p className="text-xs text-gray-600"><span className="text-gray-400">HOD remarks (mid-year): </span>{r.mid_remarks}</p>}
              <p className="text-xs text-gray-600 whitespace-pre-wrap"><span className="text-gray-400">Year-end progress: </span>{r.yearend_progress || "—"}</p>
              <p className="text-xs text-gray-600 inline-flex items-center gap-1"><span className="text-gray-400">Self rating:</span><GradeBadge g={r.self_rating} /></p>
            </div>
            <input className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="HOD remarks (optional)"
              value={rows[r.emp_goal_id]?.reviewer_remarks ?? ""}
              onChange={(e) => setRows({ ...rows, [r.emp_goal_id]: { ...rows[r.emp_goal_id], reviewer_remarks: e.target.value } })} />
            <div className="space-y-1">
              <p className="text-[11px] text-gray-500">Agreed rating</p>
              <GradePicker value={rows[r.emp_goal_id]?.agreed_rating ?? null}
                onChange={(g) => setRows({ ...rows, [r.emp_goal_id]: { ...rows[r.emp_goal_id], agreed_rating: g } })} />
            </div>
          </div>
        ))}
      </div>
      {hasComps && (
        <div className="space-y-3 pt-2">
          <p className="font-semibold text-ink">Competency self-assessment</p>
          <CompetencyView c={{ ...a.competency, hod_comments: "", hod_at: null }} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Head of department (HOD) review — your comments</label>
            <textarea rows={3} className={area} maxLength={2000} value={hodComments} onChange={(e) => setHodComments(e.target.value)} />
          </div>
        </div>
      )}
      <ErrorBox error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">Total &quot;A&quot;: <b className="tabular-nums">{total == null ? "—" : total.toFixed(2)}</b></span>
        {missing > 0 ? <Pill tone="amber">{missing} not rated</Pill> : <Pill tone="green">All rated</Pill>}
        {saved && <span className="text-xs text-emerald-600">Saved — grade recalculated</span>}
        <Button className="ml-auto" onClick={save} loading={busy}><Save className="h-4 w-4 mr-1" />Save ratings</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recommendations: promotion, increment, trainings (BRD §20)
// ---------------------------------------------------------------------------

export function RecommendationsForm({ a, designations, courses, onSave }: {
  a: Appraisal; designations: Designation[]; courses: Course[]; onSave: (body: RecsBody) => Promise<unknown>;
}) {
  const p = a.promotion && a.promotion.status !== "REJECTED" ? a.promotion : null;
  const inc = a.increment && a.increment.status !== "REJECTED" ? a.increment : null;
  const [promote, setPromote] = useState(!!p);
  const [promo, setPromo] = useState({ prop_desg_cd: p?.prop_desg_cd ?? "", prop_grade_cd: p?.prop_grade_cd ?? "", justification: p?.justification ?? "" });
  const [increase, setIncrease] = useState(!!inc);
  const [incMode, setIncMode] = useState<"pct" | "amount">(inc?.inc_pct != null ? "pct" : "amount");
  const [incVal, setIncVal] = useState(String(inc ? (inc.inc_pct ?? inc.inc_amount) : ""));
  const [incWhy, setIncWhy] = useState(inc?.justification ?? "");
  const editableTrainings = a.dev_plan.filter((d) => d.source !== "AUTO" && !d.training_request_id);
  const [trainings, setTrainings] = useState(editableTrainings.map((d) => ({
    area: d.area, course_id: d.course_id ? String(d.course_id) : "", target_date: d.target_date ?? "", action_plan: d.action_plan,
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const locked = (p && p.status !== "PROPOSED") || (inc && inc.status !== "PROPOSED");

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const n = Number(incVal);
      await onSave({
        promotion: promote ? { prop_desg_cd: promo.prop_desg_cd, prop_grade_cd: promo.prop_grade_cd || null, justification: promo.justification || null } : null,
        increment: increase ? { inc_pct: incMode === "pct" ? n : null, inc_amount: incMode === "amount" ? n : null, justification: incWhy || null } : null,
        trainings: trainings.filter((t) => t.area.trim() || t.course_id).map((t) => ({
          area: t.area.trim() || courses.find((c) => String(c.course_id) === t.course_id)?.title || "Training",
          course_id: t.course_id ? Number(t.course_id) : null, target_date: t.target_date || null, action_plan: t.action_plan || null,
        })),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {locked && <p className="text-xs text-amber-700">Some recommendations are already approved or applied and cannot be changed here.</p>}
      <div className="rounded-xl border border-gray-100 p-3 space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <input type="checkbox" checked={promote} onChange={(e) => setPromote(e.target.checked)} />Recommend for promotion
          <span className="text-xs font-normal text-gray-500">— opens the promotion evaluation (sheets 1–5) once HR finalises the appraisal</span>
        </label>
        {promote && (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Proposed designation</label>
              <select className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={promo.prop_desg_cd}
                onChange={(e) => {
                  const d = designations.find((x) => x.desg_cd === e.target.value);
                  setPromo({ ...promo, prop_desg_cd: e.target.value, prop_grade_cd: promo.prop_grade_cd || d?.grade_cd || "" });
                }}>
                <option value="">Select…</option>
                {designations.map((d) => <option key={d.desg_cd} value={d.desg_cd}>{d.desg_desc}</option>)}
              </select>
            </div>
            <Input label="Proposed grade (optional)" value={promo.prop_grade_cd} onChange={(e) => setPromo({ ...promo, prop_grade_cd: e.target.value })} />
            <Input label="Justification" value={promo.justification} onChange={(e) => setPromo({ ...promo, justification: e.target.value })} />
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-100 p-3 space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <input type="checkbox" checked={increase} onChange={(e) => setIncrease(e.target.checked)} />Recommend increment
        </label>
        {increase && (
          <div className="grid gap-3 md:grid-cols-3 items-end">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Increment</label>
              <div className="flex gap-2">
                <select className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={incMode} onChange={(e) => setIncMode(e.target.value as "pct" | "amount")}>
                  <option value="pct">% of gross</option><option value="amount">Amount</option>
                </select>
                <input type="number" min={0} className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={incVal} onChange={(e) => setIncVal(e.target.value)} />
              </div>
            </div>
            <Input label="Justification" value={incWhy} onChange={(e) => setIncWhy(e.target.value)} />
            {inc && <p className="text-xs text-gray-500">Saved: {money(inc.inc_amount)}{inc.prev_gross ? ` on gross ${money(inc.prev_gross)} → ${money(inc.new_gross)}` : ""}</p>}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-100 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-800">Recommended training / development</p>
          <Button size="sm" variant="secondary" className="ml-auto"
            onClick={() => setTrainings([...trainings, { area: "", course_id: "", target_date: "", action_plan: "" }])}>
            <Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
        {trainings.length === 0 && <p className="text-xs text-gray-400">None. A course picked here becomes a training request for HR once the appraisal is approved.</p>}
        {trainings.map((t, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_10rem_auto] items-end">
            <Input label={i === 0 ? "Area to develop" : undefined} placeholder="e.g. Communication" value={t.area}
              onChange={(e) => setTrainings(trainings.map((x, j) => (j === i ? { ...x, area: e.target.value } : x)))} />
            <div className="space-y-1.5">
              {i === 0 && <label className="block text-sm font-medium text-gray-700">Course (optional)</label>}
              <select className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm" value={t.course_id}
                onChange={(e) => setTrainings(trainings.map((x, j) => (j === i ? { ...x, course_id: e.target.value } : x)))}>
                <option value="">No course — action only</option>
                {courses.map((c) => <option key={c.course_id} value={c.course_id}>{c.title}</option>)}
              </select>
            </div>
            <Input label={i === 0 ? "Target date" : undefined} type="date" value={t.target_date}
              onChange={(e) => setTrainings(trainings.map((x, j) => (j === i ? { ...x, target_date: e.target.value } : x)))} />
            <button className="p-2 text-gray-400 hover:text-red-600" title="Remove" onClick={() => setTrainings(trainings.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      <ErrorBox error={error} />
      <div className="flex items-center gap-2">
        {saved && <span className="text-xs text-emerald-600">Recommendations saved</span>}
        <Button className="ml-auto" onClick={save} loading={busy}
          disabled={(promote && !promo.prop_desg_cd) || (increase && !(Number(incVal) > 0))}>
          <Save className="h-4 w-4 mr-1" />Save recommendations</Button>
      </div>
    </div>
  );
}

/** Read-only view of recommendations and the development plan. */
export function RecommendationsView({ a, showPay }: { a: Appraisal; showPay: boolean }) {
  return (
    <div className="space-y-2 text-sm">
      {showPay && (
        <>
          <p><span className="text-gray-500">Promotion: </span>{a.promotion
            ? <>{a.promotion.cur_desg_desc || a.promotion.cur_desg_cd} → <b>{a.promotion.prop_desg_desc || a.promotion.prop_desg_cd}</b> <Pill>{a.promotion.status}</Pill>
              <span className="text-xs text-gray-400"> by {a.promotion.recommended_by_name}</span></>
            : "—"}</p>
          <p><span className="text-gray-500">Increment: </span>{a.increment
            ? <><b>{money(a.increment.inc_amount)}</b>{a.increment.inc_pct != null ? ` (${a.increment.inc_pct}%)` : ""} <Pill>{a.increment.status}</Pill>
              <span className="text-xs text-gray-400"> by {a.increment.recommended_by_name}</span></>
            : "—"}</p>
        </>
      )}
      {a.dev_plan.length > 0 && (
        <div>
          <p className="text-gray-500 mb-1">Development plan</p>
          <ul className="space-y-1">
            {a.dev_plan.map((d) => (
              <li key={d.plan_id} className="flex flex-wrap items-center gap-2">
                <span className="text-gray-900">{d.area}</span>
                {d.course_title && <Pill tone="indigo">{d.course_title}</Pill>}
                {d.source === "AUTO" && <Pill tone="amber">Auto</Pill>}
                {d.training_request_status && <Pill tone="blue">Training: {d.training_request_status.replace(/_/g, " ").toLowerCase()}</Pill>}
                {d.target_date && <span className="text-xs text-gray-400">by {d.target_date}</span>}
                {d.action_plan && <span className="text-xs text-gray-500 w-full">{d.action_plan}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!showPay && a.dev_plan.length === 0 && <p className="text-gray-400">No development plan.</p>}
    </div>
  );
}
