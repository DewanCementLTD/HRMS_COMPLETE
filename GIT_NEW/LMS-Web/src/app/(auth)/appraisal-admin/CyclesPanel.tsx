"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Rocket, Eye, Lock, Unlock, ArrowLeft, Users, X, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ErrorBox, Empty, Pill, TextArea } from "@/components/training/TrainingUi";
import type { EmployeeLite } from "@/services/trainingService";
import {
  apprHrApi, CYCLE_TYPE_LABEL, PHASE_LABEL, type Hr, type Cycle, type CycleGoal, type CycleType, type Lookups, type Phase,
  type LaunchFilters, type LaunchPreview,
} from "@/services/appraisalService";

const STATUS_TONE = { DRAFT: "gray", ACTIVE: "green", CLOSED: "red" } as const;
const EMP_STATUSES = [
  { v: "1", l: "Probationary" }, { v: "2", l: "Permanent" }, { v: "3", l: "Contractual" }, { v: "4", l: "Temporary" },
];

const blankCycle = (): Partial<Cycle> => {
  const d = new Date();
  const fy = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return { name: `Annual Appraisal ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`, cycle_type: "ANNUAL", period_from: `${fy}-07-01`, period_to: `${fy + 1}-06-30` };
};

export function CyclesPanel({ h, onOpenAppraisals }: { h: Hr; onOpenAppraisals: (cycleId?: number) => void }) {
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id?: number; c: Partial<Cycle> } | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(() => {
    apprHrApi.cycles(h).then((r) => setCycles(r.items)).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h]);
  useEffect(() => { load(); }, [load]);

  if (open) return <CycleDetail h={h} id={open} onBack={() => { setOpen(null); load(); }} onOpenAppraisals={onOpenAppraisals} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-sm text-gray-500">An appraisal cycle covers a period; launching it creates one appraisal per selected employee.</p>
        <Button className="ml-auto" onClick={() => setEdit({ c: blankCycle() })}><Plus className="h-4 w-4 mr-1" />New cycle</Button>
      </div>
      <ErrorBox error={error} />
      {!cycles ? <Spinner /> : cycles.length === 0 ? <Card><Empty>No cycles yet.</Empty></Card> : (
        <div className="grid gap-3 md:grid-cols-2">
          {cycles.map((c) => (
            <Card key={c.cycle_id} onClick={() => setOpen(c.cycle_id)}>
              <CardContent className="py-4 space-y-2 cursor-pointer">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-ink">{c.name}</p>
                  <Pill tone={STATUS_TONE[c.status]}>{c.status.toLowerCase()}</Pill>
                  <button className="ml-auto p-1 text-gray-400 hover:text-indigo-600" title="Edit"
                    onClick={(e) => { e.stopPropagation(); setEdit({ id: c.cycle_id, c }); }}><Pencil className="h-4 w-4" /></button>
                </div>
                <p className="text-xs text-gray-500">{CYCLE_TYPE_LABEL[c.cycle_type]} · {c.period_from} → {c.period_to} · phase: <b>{PHASE_LABEL[c.phase]}</b></p>
                <div className="flex gap-4 text-xs text-gray-600">
                  <span>Appraisals <b>{c.appraisal_count ?? 0}</b></span><span>Completed <b>{c.completed_count ?? 0}</b></span><span>HR goals <b>{c.goal_count ?? 0}</b></span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {edit && <CycleForm h={h} edit={edit} onClose={() => setEdit(null)} onSaved={(id) => { setEdit(null); load(); if (!edit.id) setOpen(id); }} />}
    </div>
  );
}

function CycleForm({ h, edit, onClose, onSaved }: { h: Hr; edit: { id?: number; c: Partial<Cycle> }; onClose: () => void; onSaved: (id: number) => void }) {
  const [c, setC] = useState<Partial<Cycle>>(edit.c);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const r = await apprHrApi.saveCycle(h, {
        name: c.name, cycle_type: c.cycle_type, period_from: c.period_from, period_to: c.period_to,
        goal_deadline: c.goal_deadline || null, self_deadline: c.self_deadline || null, review_deadline: c.review_deadline || null, remarks: c.remarks,
      }, edit.id);
      onSaved(r.cycle_id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={edit.id ? "Edit cycle" : "New appraisal cycle"} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={saving} disabled={!c.name?.trim() || !c.period_from || !c.period_to}>Save</Button></div>}>
      <div className="space-y-3">
        <ErrorBox error={err} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" value={c.name ?? ""} onChange={(e) => setC({ ...c, name: e.target.value })} />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Type</label>
            <select className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm" value={c.cycle_type}
              onChange={(e) => setC({ ...c, cycle_type: e.target.value as CycleType })}>
              {Object.entries(CYCLE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <Input label="Period from" type="date" value={c.period_from ?? ""} onChange={(e) => setC({ ...c, period_from: e.target.value })} />
          <Input label="Period to" type="date" value={c.period_to ?? ""} onChange={(e) => setC({ ...c, period_to: e.target.value })} />
          <Input label="Goal setting due" type="date" value={c.goal_deadline ?? ""} onChange={(e) => setC({ ...c, goal_deadline: e.target.value })} />
          <Input label="Self review due" type="date" value={c.self_deadline ?? ""} onChange={(e) => setC({ ...c, self_deadline: e.target.value })} />
          <Input label="Reviews due" type="date" value={c.review_deadline ?? ""} onChange={(e) => setC({ ...c, review_deadline: e.target.value })} />
        </div>
        <TextArea label="Remarks" value={c.remarks ?? ""} onChange={(v) => setC({ ...c, remarks: v })} />
      </div>
    </Modal>
  );
}

function CycleDetail({ h, id, onBack, onOpenAppraisals }: { h: Hr; id: number; onBack: () => void; onOpenAppraisals: (cycleId?: number) => void }) {
  const [c, setC] = useState<(Cycle & { goals: CycleGoal[] }) | null>(null);
  const [lk, setLk] = useState<Lookups | null>(null);
  const [emps, setEmps] = useState<EmployeeLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState<{ id?: number; g: Partial<CycleGoal> } | null>(null);

  const load = useCallback(() => {
    apprHrApi.cycle(h, id).then(setC).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h, id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apprHrApi.lookups(h).then(setLk).catch(() => {});
    apprHrApi.employees(h).then((r) => setEmps(r.items)).catch(() => {});
  }, [h]);

  if (error) return <ErrorBox error={error} />;
  if (!c) return <Spinner />;
  const closed = c.status === "CLOSED";
  const total = (dept: string | null) => c.goals.filter((g) => g.level_type === "CORPORATE" || g.dept_no === dept).reduce((t, g) => t + g.weightage, 0);
  const corpTotal = total("__none__");

  async function act(fn: () => Promise<unknown>) {
    try { await fn(); load(); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Cycles</Button>
        <p className="font-semibold text-ink">{c.name}</p>
        <Pill tone={STATUS_TONE[c.status]}>{c.status.toLowerCase()}</Pill>
        <span className="text-xs text-gray-400">{CYCLE_TYPE_LABEL[c.cycle_type]} · {c.period_from} → {c.period_to}</span>
        <div className="ml-auto flex gap-2">
          {(c.appraisal_count ?? 0) > 0 && <Button size="sm" variant="secondary" onClick={() => onOpenAppraisals(c.cycle_id)}><Users className="h-4 w-4 mr-1" />Appraisals ({c.appraisal_count})</Button>}
          {c.status === "ACTIVE" && <Button size="sm" variant="secondary" onClick={() => confirm("Close this cycle? Unfinished appraisals become read-only.") && act(() => apprHrApi.setCycleStatus(h, c.cycle_id, "CLOSED"))}><Lock className="h-4 w-4 mr-1" />Close</Button>}
          {c.status === "CLOSED" && <Button size="sm" variant="secondary" onClick={() => act(() => apprHrApi.setCycleStatus(h, c.cycle_id, "ACTIVE"))}><Unlock className="h-4 w-4 mr-1" />Reopen</Button>}
          {!c.appraisal_count && <Button size="sm" variant="danger" onClick={() => confirm("Delete this cycle?") && apprHrApi.deleteCycle(h, c.cycle_id).then(onBack).catch((e) => alert(e.message))}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      </div>

      <Card><CardContent className="py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-ink">Corporate &amp; department objectives</p>
          <span className="text-xs text-gray-400">Copied into every task sheet at launch (5%–40% each); employees add their own accountabilities to reach 100%.</span>
          {corpTotal > 0 && <Pill tone={corpTotal <= 100 ? "gray" : "red"}>Corporate weight {corpTotal}</Pill>}
          {!closed && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setGoal({ g: { level_type: "CORPORATE", weightage: 20 } })}><Plus className="h-4 w-4 mr-1" />Add goal</Button>}
        </div>
        {c.goals.length === 0 ? <p className="text-sm text-gray-400">None — employees set all their goals themselves.</p> : (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">Level</th><th className="text-left">Objective</th><th className="text-left">KPI</th><th className="text-left">Target</th><th className="text-right">Weight</th><th /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {c.goals.map((g) => (
                <tr key={g.goal_id}>
                  <td className="py-1.5">{g.level_type === "CORPORATE" ? <Pill tone="indigo">Corporate</Pill> : <Pill>{g.dept_name || g.dept_no}</Pill>}</td>
                  <td>{g.objective}</td><td className="text-gray-600">{g.kpi_text || "—"}</td><td className="text-gray-600">{g.target || "—"}</td>
                  <td className="text-right tabular-nums">{g.weightage}</td>
                  <td className="text-right whitespace-nowrap">
                    {!closed && <>
                      <button className="p-1 text-gray-400 hover:text-indigo-600" onClick={() => setGoal({ id: g.goal_id, g })}><Pencil className="h-4 w-4" /></button>
                      <button className="p-1 text-gray-400 hover:text-red-600" onClick={() => confirm("Delete this goal?") && act(() => apprHrApi.deleteCycleGoal(h, c.cycle_id, g.goal_id))}><Trash2 className="h-4 w-4" /></button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent></Card>

      {!closed && <PhaseCard h={h} cycle={c} onChanged={load} />}
      {!closed && <LaunchCard h={h} cycle={c} lookups={lk} emps={emps} onLaunched={load} />}

      {goal && lk && (
        <GoalModal h={h} cycleId={c.cycle_id} goal={goal} lookups={lk} onClose={() => setGoal(null)} onSaved={() => { setGoal(null); load(); }} />
      )}
    </div>
  );
}

function GoalModal({ h, cycleId, goal, lookups, onClose, onSaved }: {
  h: Hr; cycleId: number; goal: { id?: number; g: Partial<CycleGoal> }; lookups: Lookups; onClose: () => void; onSaved: () => void;
}) {
  const [g, setG] = useState(goal.g);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await apprHrApi.saveCycleGoal(h, cycleId, {
        level_type: g.level_type, dept_no: g.level_type === "DEPARTMENT" ? g.dept_no : null, objective: g.objective,
        kpi_text: g.kpi_text, target: g.target, weightage: Number(g.weightage),
      }, goal.id);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title={goal.id ? "Edit goal" : "Add corporate / department goal"} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={saving} disabled={!g.objective?.trim() || !(Number(g.weightage) > 0)}>Save</Button></div>}>
      <div className="space-y-3">
        <ErrorBox error={err} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Level</label>
            <select className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm" value={g.level_type}
              onChange={(e) => setG({ ...g, level_type: e.target.value as CycleGoal["level_type"] })}>
              <option value="CORPORATE">Corporate — every employee</option><option value="DEPARTMENT">Department</option>
            </select>
          </div>
          {g.level_type === "DEPARTMENT" && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">Department</label>
              <select className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm" value={g.dept_no ?? ""} onChange={(e) => setG({ ...g, dept_no: e.target.value })}>
                <option value="">Select…</option>
                {lookups.departments.map((d) => <option key={d.dept_no} value={String(d.dept_no)}>{d.dept_name}</option>)}
              </select>
            </div>
          )}
        </div>
        <TextArea label="Objective" rows={2} value={g.objective ?? ""} onChange={(v) => setG({ ...g, objective: v })} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="KPI / measure" value={g.kpi_text ?? ""} onChange={(e) => setG({ ...g, kpi_text: e.target.value })} />
          <Input label="Target" value={g.target ?? ""} onChange={(e) => setG({ ...g, target: e.target.value })} />
          <Input label="Weightage" type="number" min={1} max={100} value={g.weightage ?? ""} onChange={(e) => setG({ ...g, weightage: Number(e.target.value) })} />
        </div>
      </div>
    </Modal>
  );
}

function LaunchCard({ h, cycle, lookups, emps, onLaunched }: {
  h: Hr; cycle: Cycle; lookups: Lookups | null; emps: EmployeeLite[]; onLaunched: () => void;
}) {
  const [depts, setDepts] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>(["PROBATION", "CONFIRMATION"].includes(cycle.cycle_type) ? ["1"] : []);
  const [picked, setPicked] = useState<string[]>([]);
  const [preview, setPreview] = useState<LaunchPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "launch" | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: { empcode: string; name: string; reason: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const filters = (): LaunchFilters => ({
    dept_nos: depts.length ? depts : undefined, emp_statuses: statuses.length ? statuses : undefined,
    empcodes: picked.length ? picked : undefined,
  });
  const reset = () => { setPreview(null); setResult(null); };

  async function run(kind: "preview" | "launch") {
    setBusy(kind);
    setErr(null);
    try {
      if (kind === "preview") setPreview(await apprHrApi.previewLaunch(h, cycle.cycle_id, filters()));
      else {
        setResult(await apprHrApi.launch(h, cycle.cycle_id, filters()));
        setPreview(null);
        onLaunched();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const newCount = preview ? preview.items.filter((i) => !i.already).length : 0;
  return (
    <Card><CardContent className="py-4 space-y-4">
      <div className="flex items-center gap-2"><Rocket className="h-5 w-5 text-indigo-600" /><p className="font-semibold text-ink">Launch</p>
        <span className="text-xs text-gray-400">Leave filters empty to include every active employee. Employees already in the cycle are skipped, so you can launch in batches.</span></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-gray-700">Departments</label>
          <div className="max-h-40 overflow-y-auto rounded-xl border border-gray-200 p-2 space-y-1">
            {(lookups?.departments ?? []).map((d) => (
              <label key={d.dept_no} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={depts.includes(String(d.dept_no))} onChange={(e) => {
                  reset();
                  setDepts(e.target.checked ? [...depts, String(d.dept_no)] : depts.filter((x) => x !== String(d.dept_no)));
                }} />{d.dept_name}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">Employment status</label>
            <div className="flex flex-wrap gap-2">
              {EMP_STATUSES.map((s) => (
                <label key={s.v} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={statuses.includes(s.v)} onChange={(e) => { reset(); setStatuses(e.target.checked ? [...statuses, s.v] : statuses.filter((x) => x !== s.v)); }} />{s.l}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <SearchableSelect label="Only these employees (optional)" value="" placeholder="Add employee…"
            onChange={(v) => { if (v && !picked.includes(v)) { reset(); setPicked([...picked, v]); } }}
            options={emps.map((e) => ({ value: e.empcode, label: `${e.name} (${e.empcode})` }))} />
          <div className="flex flex-wrap gap-1">
            {picked.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5">
                {emps.find((e) => e.empcode === p)?.name ?? p}
                <button onClick={() => { reset(); setPicked(picked.filter((x) => x !== p)); }}><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        </div>
      </div>
      <ErrorBox error={err} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => run("preview")} loading={busy === "preview"} disabled={!!busy}><Eye className="h-4 w-4 mr-1" />Preview</Button>
        <Button onClick={() => { if (confirm(`Launch appraisals for ${newCount} employee(s)?`)) run("launch"); }} loading={busy === "launch"}
          disabled={!!busy || !preview || newCount === 0}><Rocket className="h-4 w-4 mr-1" />Launch {preview ? `(${newCount})` : ""}</Button>
        {!preview && <span className="text-xs text-gray-400">Preview first to see who will be included.</span>}
      </div>
      {result && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100 text-sm text-emerald-800">
          <p><b>{result.created}</b> appraisal(s) launched.{result.skipped.length ? ` ${result.skipped.length} skipped:` : ""}</p>
          {result.skipped.slice(0, 30).map((s) => <p key={s.empcode} className="text-xs text-emerald-900/70">{s.name} ({s.empcode}) — {s.reason}</p>)}
        </div>
      )}
      {preview && (
        <div className="overflow-x-auto rounded-xl border border-gray-100 max-h-96">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase sticky top-0"><tr>
              <th className="text-left px-3 py-2">Employee ({preview.total})</th><th className="text-left px-3 py-2">Department</th>
              <th className="text-left px-3 py-2">Approvers</th><th className="px-3 py-2" /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {preview.items.map((i) => (
                <tr key={i.empcode} className={i.already ? "opacity-60" : ""}>
                  <td className="px-3 py-1.5">{i.name} <span className="text-xs text-gray-400">{i.empcode}</span></td>
                  <td className="px-3 py-1.5 text-gray-600">{i.dept_name}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-600">
                    Line manager: {i.has_rpt ? "reporting officer" : i.has_hod1 ? "HOD" : i.has_hod2 ? "HOD 2" : "HR"} · year end: {[i.has_hod1 ? "HOD" : i.has_rpt ? "reporting officer" : null, i.has_hod2 && "HOD 2", "HR"].filter(Boolean).join(" → ")}</td>
                  <td className="px-3 py-1.5">{i.already && <Pill>Already launched</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardContent></Card>
  );
}

/** Phase control: HR opens the mid-year and year-end reviews for the whole cycle. */
function PhaseCard({ h, cycle, onChanged }: { h: Hr; cycle: Cycle; onChanged: () => void }) {
  const order: Phase[] = ["OBJECTIVES", "MIDYEAR", "YEAREND"];
  const cur = order.indexOf(cycle.phase);
  const [busy, setBusy] = useState(false);
  async function go(p: Phase) {
    const warn = p === "MIDYEAR" && (cycle.objectives_open ?? 0) > 0 ? `\n${cycle.objectives_open} employee(s) still have objectives open — they can finish them and then do the mid-year review.` : "";
    const warn2 = p === "YEAREND" && (cycle.midyear_open ?? 0) > 0 ? `\n${cycle.midyear_open} employee(s) have not finished the mid-year review yet.` : "";
    if (!confirm(`Open "${PHASE_LABEL[p]}" for this cycle?${warn}${warn2}`)) return;
    setBusy(true);
    try { await apprHrApi.setCyclePhase(h, cycle.cycle_id, p); onChanged(); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  return (
    <Card><CardContent className="py-4 space-y-3">
      <p className="font-semibold text-ink">Phase</p>
      <div className="flex flex-wrap items-center gap-2">
        {order.map((p, i) => (
          <span key={p} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="h-4 w-4 text-gray-300" />}
            <span className={`px-3 py-1.5 rounded-lg text-sm font-medium ${i === cur ? "bg-indigo-600 text-white" : i < cur ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
              {PHASE_LABEL[p]}</span>
          </span>
        ))}
        <div className="ml-auto flex gap-2">
          {cur > 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={() => go(order[cur - 1])}>Back to {PHASE_LABEL[order[cur - 1]]}</Button>}
          {cur < order.length - 1 && <Button size="sm" disabled={busy} onClick={() => go(order[cur + 1])}>Open {PHASE_LABEL[order[cur + 1]]}</Button>}
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Objectives can be set and approved in any phase. Employees fill the mid-year review (progress + self rating) once the mid-year phase is open; HODs give the
        year-end agreed rating once the year-end phase is open. Open now: {cycle.objectives_open ?? 0} at objectives, {cycle.midyear_open ?? 0} at mid-year.
      </p>
    </CardContent></Card>
  );
}
