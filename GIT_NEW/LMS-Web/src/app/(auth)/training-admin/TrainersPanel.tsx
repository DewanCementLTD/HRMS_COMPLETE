"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw, CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { hrApi, rateText, RATE_UNIT_LABEL, type Hr, type Trainer, type EmployeeLite, type Slot, type RateUnit } from "@/services/trainingService";
import { Pill, Stars, ErrorBox, Empty, TextArea } from "@/components/training/TrainingUi";

type Form = {
  trainer_type: "I" | "E"; empcode: string; name: string; organization: string; phone: string; email: string;
  expertise: string; default_rate: string; is_active: boolean;
  bio: string; qualifications: string; rate_unit: RateUnit; is_free: boolean;
};
const toForm = (t?: Trainer): Form => ({
  trainer_type: t?.trainer_type ?? "E", empcode: t?.empcode ?? "", name: t?.name ?? "", organization: t?.organization ?? "",
  phone: t?.phone ?? "", email: t?.email ?? "", expertise: t?.expertise ?? "",
  default_rate: t?.default_rate != null ? String(t.default_rate) : "", is_active: t?.is_active ?? true,
  bio: t?.bio ?? "", qualifications: t?.qualifications ?? "", rate_unit: t?.rate_unit ?? "SESSION", is_free: t?.is_free ?? false,
});

export function TrainersPanel({ h }: { h: Hr }) {
  const [items, setItems] = useState<Trainer[]>([]);
  const [employees, setEmployees] = useState<EmployeeLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id?: number; f: Form } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [slotsFor, setSlotsFor] = useState<{ t: Trainer; items: Slot[] | null } | null>(null);

  async function openSlots(t: Trainer) {
    setSlotsFor({ t, items: null });
    try { setSlotsFor({ t, items: (await hrApi.trainerSlots(h, t.trainer_id)).items }); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); setSlotsFor(null); }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await hrApi.trainers(h)).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [h]);
  useEffect(() => { load(); }, [load]);

  async function openEdit(t?: Trainer) {
    setFormError(null);
    setEdit({ id: t?.trainer_id, f: toForm(t) });
    if (!employees.length) {
      try { setEmployees((await hrApi.employees(h)).items); } catch { /* picker stays empty; save will explain */ }
    }
  }

  async function save() {
    if (!edit) return;
    const f = edit.f;
    setSaving(true);
    setFormError(null);
    try {
      await hrApi.saveTrainer(h, {
        trainer_type: f.trainer_type, empcode: f.trainer_type === "I" ? f.empcode : null, name: f.name,
        organization: f.organization, phone: f.phone, email: f.email, expertise: f.expertise,
        default_rate: f.is_free || !f.default_rate ? null : Number(f.default_rate), is_active: f.is_active,
        bio: f.bio, qualifications: f.qualifications, rate_unit: f.rate_unit, is_free: f.is_free,
      }, edit.id);
      setEdit(null);
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: Trainer) {
    if (!confirm(`Delete trainer "${t.name}"?`)) return;
    try { await hrApi.deleteTrainer(h, t.trainer_id); load(); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  const set = (patch: Partial<Form>) => edit && setEdit({ ...edit, f: { ...edit.f, ...patch } });

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-2 mb-3">
          <p className="text-sm text-slate-500">{items.length} trainer(s) — internal employees or external instructors / vendors</p>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
            <Button size="sm" onClick={() => openEdit()}><Plus className="h-4 w-4 mr-1" />New trainer</Button>
          </div>
        </div>
        <ErrorBox error={error} />
        {loading && !items.length ? <Spinner /> : items.length === 0 ? <Empty>No trainers yet.</Empty> : (
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Trainer</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Expertise</th>
                  <th className="px-3 py-2 text-left">Contact</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-center">Sessions</th>
                  <th className="px-3 py-2 text-center">Rating</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((t) => (
                  <tr key={t.trainer_id} className={t.is_active ? "hover:bg-gray-50/60" : "opacity-60"}>
                    <td className="px-3 py-2"><p className="font-medium text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-400">{t.trainer_type === "I" ? t.empcode : t.organization}{!t.is_active && " · inactive"}</p></td>
                    <td className="px-3 py-2"><Pill tone={t.trainer_type === "I" ? "blue" : "amber"}>{t.trainer_type === "I" ? "Internal" : "External"}</Pill></td>
                    <td className="px-3 py-2 text-gray-600 max-w-xs truncate" title={t.expertise}>{t.expertise || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{t.phone}{t.email && <p>{t.email}</p>}</td>
                    <td className="px-3 py-2 text-right text-xs">{t.is_free ? <Pill tone="green">Free</Pill> : rateText(t)}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{t.session_count}</td>
                    <td className="px-3 py-2 text-center"><Stars value={t.avg_rating} /></td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {t.trainer_type === "I" && (
                          <button title={`Free slots (${t.upcoming_slots})`} onClick={() => openSlots(t)} className="relative p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50">
                            <CalendarDays className="h-4 w-4" />
                            {t.upcoming_slots > 0 && <span className="absolute -top-0.5 -right-0.5 rounded-full bg-emerald-500 text-white text-[9px] font-bold px-1">{t.upcoming_slots}</span>}
                          </button>
                        )}
                        <button title="Edit" onClick={() => openEdit(t)} className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100"><Pencil className="h-4 w-4" /></button>
                        <button title="Delete" onClick={() => remove(t)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {edit && (
        <Modal title={edit.id ? "Edit trainer" : "New trainer"} onClose={() => setEdit(null)}
          footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
          <div className="space-y-4">
            <ErrorBox error={formError} />
            <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
              {(["E", "I"] as const).map((k) => (
                <button key={k} onClick={() => set({ trainer_type: k })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${edit.f.trainer_type === k ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600"}`}>
                  {k === "E" ? "External instructor / vendor" : "Internal employee"}
                </button>
              ))}
            </div>
            {edit.f.trainer_type === "I" ? (
              <SearchableSelect label="Employee" value={edit.f.empcode} placeholder="Search employee…"
                onChange={(v) => set({ empcode: v, name: employees.find((e) => e.empcode === v)?.name ?? edit.f.name })}
                options={employees.map((e) => ({ value: e.empcode, label: `${e.name} (${e.empcode})${e.dept_name ? ` — ${e.dept_name}` : ""}` }))} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Name" value={edit.f.name} onChange={(e) => set({ name: e.target.value })} />
                <Input label="Organisation / institute" value={edit.f.organization} onChange={(e) => set({ organization: e.target.value })} />
              </div>
            )}
            {edit.f.trainer_type === "I" && (
              <p className="text-xs text-gray-500 -mt-2">Internal trainers can also update their own details, rate and free slots from the Trainer Portal.</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Phone" value={edit.f.phone} onChange={(e) => set({ phone: e.target.value })} />
              <Input label="Email" type="email" value={edit.f.email} onChange={(e) => set({ email: e.target.value })} />
            </div>
            <div className="rounded-xl border border-gray-100 p-3 space-y-3">
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.f.is_free} onChange={(e) => set({ is_free: e.target.checked })} />Trains free of charge</label>
              {!edit.f.is_free && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="Rate" type="number" min={0} value={edit.f.default_rate} onChange={(e) => set({ default_rate: e.target.value })} />
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-700">Charged</label>
                    <select className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm" value={edit.f.rate_unit} onChange={(e) => set({ rate_unit: e.target.value as RateUnit })}>
                      {(Object.keys(RATE_UNIT_LABEL) as RateUnit[]).map((k) => <option key={k} value={k}>{RATE_UNIT_LABEL[k]}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
            <Input label="Expertise" placeholder="e.g. Leadership, Excel, Fire safety" value={edit.f.expertise} onChange={(e) => set({ expertise: e.target.value })} />
            <TextArea label="About the trainer" value={edit.f.bio} onChange={(v) => set({ bio: v })} rows={3} />
            <TextArea label="Qualifications & certifications" value={edit.f.qualifications} onChange={(v) => set({ qualifications: v })} rows={2} />
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.f.is_active} onChange={(e) => set({ is_active: e.target.checked })} />Active</label>
          </div>
        </Modal>
      )}
      {slotsFor && (
        <Modal size="sm" title={`Free slots — ${slotsFor.t.name}`} subtitle="Published by the trainer from the Trainer Portal" onClose={() => setSlotsFor(null)}>
          {!slotsFor.items ? <Spinner /> : slotsFor.items.length === 0 ? <Empty>No upcoming free slots.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {slotsFor.items.map((s) => (
                <li key={s.slot_id} className="py-2 flex items-center gap-3 text-sm">
                  <span className="font-medium text-gray-900 w-28">{s.slot_date}</span>
                  <span className="text-emerald-700">{s.time_from}–{s.time_to}</span>
                  {s.remarks && <span className="text-xs text-gray-400">{s.remarks}</span>}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </Card>
  );
}
