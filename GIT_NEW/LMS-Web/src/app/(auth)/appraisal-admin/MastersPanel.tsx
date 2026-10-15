"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Wand2, RotateCcw, Save, UserPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ErrorBox, Empty, Pill, TextArea } from "@/components/training/TrainingUi";
import { GradeBadge } from "@/components/appraisal/AppraisalUi";
import type { EmployeeLite } from "@/services/trainingService";
import {
  apprHrApi, OUTCOME_LABEL, type Hr, type Competency, type ScaleBand, type MgmtApprover, type PromoBand, type PromoSettings,
} from "@/services/appraisalService";

export function MastersPanel({ h }: { h: Hr }) {
  return (
    <div className="space-y-4">
      <ScaleCard h={h} />
      <CompetencyCard h={h} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PromotionSetupCard h={h} />
        <MgmtCard h={h} />
      </div>
    </div>
  );
}

function CompetencyCard({ h }: { h: Hr }) {
  const [data, setData] = useState<{ items: Competency[]; active_weight: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id?: number; m: Partial<Competency> } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    apprHrApi.competencies(h).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!edit) return;
    setSaving(true);
    try {
      await apprHrApi.saveCompetency(h, {
        name: edit.m.name, description: edit.m.description, weight_pct: Number(edit.m.weight_pct ?? 10), seq: Number(edit.m.seq ?? 0),
        is_active: edit.m.is_active !== false,
      }, edit.id);
      setEdit(null);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card><CardContent className="py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-ink">Promotion competencies (sheet 2)</p>
        {data && <Pill tone={Math.abs(data.active_weight - 100) < 0.01 ? "green" : "red"}>Active weights {data.active_weight}%</Pill>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary"
            onClick={() => confirm("Load the 10 DCL competencies (10% each) and deactivate all others?")
              && apprHrApi.loadDclCompetencies(h).then((r) => { load(); alert(`${r.added} added, ${r.deactivated} deactivated`); }).catch((e) => alert(e.message))}>
            <Wand2 className="h-4 w-4 mr-1" />Load DCL competencies</Button>
          <Button size="sm" onClick={() => setEdit({ m: { is_active: true, weight_pct: 10 } })}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
      </div>
      <p className="text-xs text-gray-500">Copied into every new promotion evaluation. The active weights must total 100%; a running evaluation keeps the weights it started with.</p>
      <ErrorBox error={error} />
      {!data ? <Spinner /> : data.items.length === 0 ? <Empty>None yet — load the DCL competencies.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">#</th><th className="text-left">Competency</th><th className="text-left">Definition</th><th className="text-right">Weight</th><th /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {data.items.map((m) => (
                <tr key={m.id} className={m.is_active ? "" : "opacity-50"}>
                  <td className="py-1.5 text-gray-400">{m.seq || ""}</td>
                  <td className="font-medium text-gray-900">{m.name}{!m.is_active && <Pill className="ml-2">inactive</Pill>}</td>
                  <td className="text-xs text-gray-600">{m.description}</td>
                  <td className="text-right tabular-nums">{m.weight_pct}%</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="p-1 text-gray-400 hover:text-indigo-600" onClick={() => setEdit({ id: m.id, m })}><Pencil className="h-4 w-4" /></button>
                    <button className="p-1 text-gray-400 hover:text-red-600"
                      onClick={() => confirm(`Delete "${m.name}"?`) && apprHrApi.deleteCompetency(h, m.id).then(load).catch((e) => alert(e.message))}><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <Modal size="sm" title={edit.id ? "Edit competency" : "Add competency"} onClose={() => setEdit(null)}
          footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!edit.m.name?.trim()}>Save</Button></div>}>
          <div className="space-y-3">
            <Input label="Name" value={edit.m.name ?? ""} onChange={(e) => setEdit({ ...edit, m: { ...edit.m, name: e.target.value } })} />
            <TextArea label="Definition" value={edit.m.description ?? ""} onChange={(v) => setEdit({ ...edit, m: { ...edit.m, description: v } })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Weight %" type="number" min={1} max={100} value={edit.m.weight_pct ?? 10} onChange={(e) => setEdit({ ...edit, m: { ...edit.m, weight_pct: Number(e.target.value) } })} />
              <Input label="Order" type="number" min={0} value={edit.m.seq ?? 0} onChange={(e) => setEdit({ ...edit, m: { ...edit.m, seq: Number(e.target.value) } })} />
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.m.is_active !== false}
              onChange={(e) => setEdit({ ...edit, m: { ...edit.m, is_active: e.target.checked } })} />Active</label>
          </div>
        </Modal>
      )}
    </CardContent></Card>
  );
}

function ScaleCard({ h }: { h: Hr }) {
  const [bands, setBands] = useState<ScaleBand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    apprHrApi.scale(h).then((r) => setBands(r.items)).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h]);
  useEffect(() => { load(); }, [load]);

  const upd = (i: number, patch: Partial<ScaleBand>) => setBands((b) => (b ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const targets = (bands ?? []).reduce((t, b) => t + Number(b.target_pct || 0), 0);

  async function save() {
    if (!bands) return;
    setSaving(true);
    setError(null);
    try {
      await apprHrApi.saveScale(h, bands.map((b) => ({ ...b, min_score: Number(b.min_score), max_score: Number(b.max_score), target_pct: b.target_pct === null ? null : Number(b.target_pct) })));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card><CardContent className="py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-ink">Grade scale &amp; bell curve standard</p>
        <Pill tone={Math.abs(targets - 100) < 0.01 ? "green" : "amber"}>Standard {targets}%</Pill>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => confirm("Reset to A+ 4.5 / A 3.5 / B 2.5 / C 1.5 / D with 5/19/63/8/5%?") && apprHrApi.resetScale(h).then(load).catch((e) => alert(e.message))}>
            <RotateCcw className="h-4 w-4 mr-1" />Reset</Button>
          <Button size="sm" onClick={save} loading={saving}><Save className="h-4 w-4 mr-1" />Save</Button>
        </div>
      </div>
      <p className="text-xs text-gray-500">The final grade comes from the Total &quot;A&quot; of the task sheet (weightage × points, 1.00–5.00). Grades must cover 1–5 without gaps.</p>
      <ErrorBox error={error} />
      {!bands ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">Grade</th><th className="text-left">Meaning</th><th className="text-right">Total from</th><th className="text-right">to</th>
              <th className="text-right">Bell curve %</th><th className="text-center" title="Gets a development plan automatically">Dev. plan</th></tr></thead>
            <tbody>
              {bands.map((b, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2"><GradeBadge g={b.label} /></td>
                  <td className="pr-2"><input className="w-full px-2 py-1.5 rounded-lg border border-gray-200" value={b.description ?? ""} onChange={(e) => upd(i, { description: e.target.value })} /></td>
                  <td className="px-1 text-right"><input type="number" step="0.01" className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-right" value={b.min_score} onChange={(e) => upd(i, { min_score: Number(e.target.value) })} /></td>
                  <td className="px-1 text-right"><input type="number" step="0.01" className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-right" value={b.max_score} onChange={(e) => upd(i, { max_score: Number(e.target.value) })} /></td>
                  <td className="px-1 text-right"><input type="number" className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-right" value={b.target_pct ?? ""} onChange={(e) => upd(i, { target_pct: e.target.value === "" ? null : Number(e.target.value) })} /></td>
                  <td className="text-center"><input type="checkbox" checked={b.is_development} onChange={(e) => upd(i, { is_development: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardContent></Card>
  );
}

function PromotionSetupCard({ h }: { h: Hr }) {
  const [s, setS] = useState<PromoSettings | null>(null);
  const [bands, setBands] = useState<PromoBand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    apprHrApi.promoSetup(h).then((r) => { setS(r.settings); setBands(r.bands); }).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!s) return;
    setSaving(true);
    setError(null);
    try {
      await apprHrApi.savePromoSetup(h, {
        settings: { comp_weight_pct: Number(s.comp_weight_pct), perf_weight_pct: Number(s.perf_weight_pct), min_tenure_yrs: Number(s.min_tenure_yrs) },
        bands: bands.map((b) => ({ ...b, min_score: Number(b.min_score) })),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card><CardContent className="py-4 space-y-3">
      <div className="flex items-center gap-2">
        <p className="font-semibold text-ink">Promotion scorecard (sheet 4)</p>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => confirm("Reset to 50/50, 2 years and the default bands?") && apprHrApi.resetPromoSetup(h).then(load).catch((e) => alert(e.message))}>
            <RotateCcw className="h-4 w-4" /></Button>
          <Button size="sm" onClick={save} loading={saving}><Save className="h-4 w-4 mr-1" />Save</Button>
        </div>
      </div>
      <ErrorBox error={error} />
      {!s ? <Spinner /> : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Weight — competency %" type="number" value={s.comp_weight_pct} onChange={(e) => setS({ ...s, comp_weight_pct: Number(e.target.value), perf_weight_pct: 100 - Number(e.target.value) })} />
            <Input label="Weight — performance %" type="number" value={s.perf_weight_pct} onChange={(e) => setS({ ...s, perf_weight_pct: Number(e.target.value), comp_weight_pct: 100 - Number(e.target.value) })} />
            <Input label="Min. years in role" type="number" step="0.5" value={s.min_tenure_yrs} onChange={(e) => setS({ ...s, min_tenure_yrs: Number(e.target.value) })} />
          </div>
          <p className="text-xs text-gray-500">Decision band on the overall weighted score (only when the eligibility gate is all &quot;Yes&quot;):</p>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">From score %</th><th className="text-left">Band label</th><th className="text-left">Outcome</th><th /></tr></thead>
            <tbody>
              {bands.map((b, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2"><input type="number" className="w-20 px-2 py-1.5 rounded-lg border border-gray-200 text-right" value={b.min_score}
                    onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, min_score: Number(e.target.value) } : x)))} /></td>
                  <td className="pr-2"><input className="w-full px-2 py-1.5 rounded-lg border border-gray-200" value={b.label}
                    onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></td>
                  <td className="pr-2"><select className="px-2 py-1.5 rounded-lg border border-gray-200" value={b.outcome}
                    onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, outcome: e.target.value as PromoBand["outcome"] } : x)))}>
                    {Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                  <td><button className="p-1 text-gray-400 hover:text-red-600" onClick={() => setBands(bands.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button size="sm" variant="secondary" onClick={() => setBands([...bands, { min_score: 0, label: "", outcome: "DEFER" }])}><Plus className="h-4 w-4 mr-1" />Add band</Button>
        </>
      )}
    </CardContent></Card>
  );
}

function MgmtCard({ h }: { h: Hr }) {
  const [items, setItems] = useState<MgmtApprover[] | null>(null);
  const [emps, setEmps] = useState<EmployeeLite[]>([]);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apprHrApi.mgmt(h).then((r) => setItems(r.items)).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apprHrApi.employees(h).then((r) => setEmps(r.items)).catch(() => {}); }, [h]);

  return (
    <Card><CardContent className="py-4 space-y-3">
      <p className="font-semibold text-ink">CEO (final promotion decision)</p>
      <p className="text-xs text-gray-500">The CEO gives the final decision on promotion evaluations after the HOD. With nobody set up here, HR records the CEO&apos;s decision.</p>
      <div className="flex items-end gap-2">
        <div className="flex-1"><SearchableSelect value={pick} onChange={setPick} placeholder="Choose employee…"
          options={emps.map((e) => ({ value: e.empcode, label: `${e.name} (${e.empcode}) — ${e.desg_desc}` }))} /></div>
        <Button disabled={!pick} onClick={() => apprHrApi.addMgmt(h, pick).then(() => { setPick(""); load(); }).catch((e) => alert(e.message))}>
          <UserPlus className="h-4 w-4 mr-1" />Add</Button>
      </div>
      <ErrorBox error={error} />
      {!items ? <Spinner /> : items.length === 0 ? <Empty>Nobody set up.</Empty> : (
        <ul className="divide-y divide-gray-50 text-sm">
          {items.map((m) => (
            <li key={m.approver_id} className="py-1.5 flex items-center gap-2">
              <span className={m.is_active ? "text-gray-900" : "text-gray-400"}>{m.name}</span>
              <span className="text-xs text-gray-400">{m.empcode} · {m.desg_desc}</span>
              <label className="ml-auto flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" checked={m.is_active} onChange={(e) => apprHrApi.setMgmt(h, m.approver_id, e.target.checked).then(load).catch((er) => alert(er.message))} />Active
              </label>
              <button className="p-1 text-gray-400 hover:text-red-600"
                onClick={() => confirm(`Remove ${m.name}?`) && apprHrApi.deleteMgmt(h, m.approver_id).then(load).catch((e) => alert(e.message))}><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </CardContent></Card>
  );
}
