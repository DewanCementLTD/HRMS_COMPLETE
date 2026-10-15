"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, RefreshCw, Search, ListChecks, Tags } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import {
  hrApi, hrTestApi, TYPE_LABEL, MODE_LABEL, type Hr, type Course, type Category,
  type TrainingType, type TrainingMode,
} from "@/services/trainingService";
import { Pill, ErrorBox, Empty, TextArea } from "@/components/training/TrainingUi";
import { TestsModal } from "@/components/training/TestEditor";

const TYPES = (Object.keys(TYPE_LABEL) as TrainingType[]).map((k) => ({ value: k, label: TYPE_LABEL[k] }));
const MODES = (Object.keys(MODE_LABEL) as TrainingMode[]).map((k) => ({ value: k, label: MODE_LABEL[k] }));

type CourseForm = {
  title: string; category_id: string; training_type: TrainingType; default_mode: TrainingMode; duration_hrs: string;
  description: string; cert_required: boolean; pass_pct: string; min_attend_pct: string; is_active: boolean;
};
const toForm = (c?: Course): CourseForm => ({
  title: c?.title ?? "", category_id: c?.category_id ? String(c.category_id) : "", training_type: c?.training_type ?? "TECHNICAL",
  default_mode: c?.default_mode ?? "PHYSICAL", duration_hrs: c?.duration_hrs != null ? String(c.duration_hrs) : "",
  description: c?.description ?? "", cert_required: c?.cert_required ?? true, pass_pct: String(c?.pass_pct ?? 70),
  min_attend_pct: String(c?.min_attend_pct ?? 80), is_active: c?.is_active ?? true,
});

export function CoursesPanel({ h }: { h: Hr }) {
  const [items, setItems] = useState<Course[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [edit, setEdit] = useState<{ id?: number; f: CourseForm } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testsFor, setTestsFor] = useState<Course | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const testApi = useMemo(() => hrTestApi(h), [h]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, k] = await Promise.all([hrApi.courses(h), hrApi.categories(h)]);
      setItems(c.items);
      setCats(k.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [h]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((c) => `${c.title} ${c.course_code} ${c.category_name}`.toLowerCase().includes(q)) : items;
  }, [items, query]);

  async function save() {
    if (!edit) return;
    const f = edit.f;
    setSaving(true);
    setFormError(null);
    try {
      await hrApi.saveCourse(h, {
        title: f.title, category_id: f.category_id ? Number(f.category_id) : null, training_type: f.training_type,
        default_mode: f.default_mode, duration_hrs: f.duration_hrs ? Number(f.duration_hrs) : null, description: f.description,
        cert_required: f.cert_required, pass_pct: Number(f.pass_pct || 70), min_attend_pct: Number(f.min_attend_pct || 80),
        is_active: f.is_active,
      }, edit.id);
      setEdit(null);
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Course) {
    if (!confirm(`Delete course "${c.title}"? Courses already used by sessions cannot be deleted — deactivate them instead.`)) return;
    try { await hrApi.deleteCourse(h, c.course_id); load(); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  const set = (patch: Partial<CourseForm>) => edit && setEdit({ ...edit, f: { ...edit.f, ...patch } });

  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-full sm:w-64">
              <Search className="h-4 w-4 text-gray-400" />
              <input className="bg-transparent text-sm outline-none w-full" placeholder="Search courses…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCatsOpen(true)}><Tags className="h-4 w-4 mr-1" />Categories</Button>
              <Button variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
              <Button size="sm" onClick={() => { setFormError(null); setEdit({ f: toForm() }); }}><Plus className="h-4 w-4 mr-1" />New course</Button>
            </div>
          </div>
          {loading && !items.length ? <Spinner /> : filtered.length === 0 ? <Empty>No courses yet. Add the trainings your company offers.</Empty> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Course</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Mode</th>
                    <th className="px-3 py-2 text-right">Hours</th>
                    <th className="px-3 py-2 text-center">Pass / Attend.</th>
                    <th className="px-3 py-2 text-center">Tests</th>
                    <th className="px-3 py-2 text-center">Sessions</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((c) => (
                    <tr key={c.course_id} className={c.is_active ? "hover:bg-gray-50/60" : "opacity-60"}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900">{c.title}</p>
                        <p className="text-xs text-gray-400">{c.course_code}{c.category_name ? ` · ${c.category_name}` : ""}{!c.is_active && " · inactive"}</p>
                      </td>
                      <td className="px-3 py-2"><Pill tone="indigo">{TYPE_LABEL[c.training_type]}</Pill></td>
                      <td className="px-3 py-2 text-gray-600">{MODE_LABEL[c.default_mode]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.duration_hrs ?? "—"}</td>
                      <td className="px-3 py-2 text-center text-gray-600">{c.pass_pct}% / {c.min_attend_pct}%{c.cert_required && <span title="Certificate" className="ml-1">🎓</span>}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex gap-1 justify-center">
                          <Pill tone={c.has_pre_test ? "green" : "gray"}>Pre</Pill>
                          <Pill tone={c.has_post_test ? "green" : "gray"}>Post</Pill>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">{c.session_count}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button title="Tests & questions" onClick={() => setTestsFor(c)} className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50"><ListChecks className="h-4 w-4" /></button>
                          <button title="Edit" onClick={() => { setFormError(null); setEdit({ id: c.course_id, f: toForm(c) }); }} className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100"><Pencil className="h-4 w-4" /></button>
                          <button title="Delete" onClick={() => remove(c)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {edit && (
        <Modal title={edit.id ? "Edit course" : "New course"} onClose={() => setEdit(null)}
          footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
          <div className="space-y-4">
            <ErrorBox error={formError} />
            <Input label="Title" value={edit.f.title} onChange={(e) => set({ title: e.target.value })} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Category" value={edit.f.category_id} onChange={(e) => set({ category_id: e.target.value })}
                options={cats.filter((k) => k.is_active || String(k.category_id) === edit.f.category_id).map((k) => ({ value: k.category_id, label: k.name }))} />
              <Select label="Type" value={edit.f.training_type} onChange={(e) => set({ training_type: (e.target.value || "TECHNICAL") as TrainingType })} options={TYPES} />
              <Select label="Default mode" value={edit.f.default_mode} onChange={(e) => set({ default_mode: (e.target.value || "PHYSICAL") as TrainingMode })} options={MODES} />
            </div>
            <TextArea label="Description" value={edit.f.description} onChange={(v) => set({ description: v })} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Duration (hours)" type="number" min={0} value={edit.f.duration_hrs} onChange={(e) => set({ duration_hrs: e.target.value })} />
              <Input label="Pass mark %" type="number" min={0} max={100} value={edit.f.pass_pct} onChange={(e) => set({ pass_pct: e.target.value })} />
              <Input label="Min. attendance %" type="number" min={0} max={100} value={edit.f.min_attend_pct} onChange={(e) => set({ min_attend_pct: e.target.value })} />
            </div>
            <div className="flex flex-wrap gap-6 text-sm">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={edit.f.cert_required} onChange={(e) => set({ cert_required: e.target.checked })} />Issue certificate on completion</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={edit.f.is_active} onChange={(e) => set({ is_active: e.target.checked })} />Active (visible to employees)</label>
            </div>
          </div>
        </Modal>
      )}

      {catsOpen && <CategoriesModal h={h} cats={cats} onClose={() => { setCatsOpen(false); load(); }} />}
      {testsFor && <TestsModal api={testApi} course={testsFor} onClose={() => { setTestsFor(null); load(); }} />}
    </div>
  );
}

function CategoriesModal({ h, cats, onClose }: { h: Hr; cats: Category[]; onClose: () => void }) {
  const [list, setList] = useState(cats);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = async () => setList((await hrApi.categories(h)).items);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await reload(); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <Modal size="sm" title="Training categories" onClose={onClose}>
      <div className="space-y-3">
        <ErrorBox error={error} />
        <div className="flex gap-2">
          <input className="flex-1 px-3 py-2 rounded-xl border border-gray-300 text-sm" placeholder="New category, e.g. Leadership"
            value={name} onChange={(e) => setName(e.target.value)} />
          <Button size="sm" disabled={!name.trim()} onClick={() => run(async () => { await hrApi.saveCategory(h, { name: name.trim() }); setName(""); })}>Add</Button>
        </div>
        {list.length === 0 ? <Empty>No categories yet.</Empty> : (
          <ul className="divide-y divide-gray-100">
            {list.map((k) => (
              <li key={k.category_id} className="py-2 flex items-center gap-2">
                <span className={k.is_active ? "text-gray-900" : "text-gray-400 line-through"}>{k.name}</span>
                <span className="text-xs text-gray-400">{k.course_count} course(s)</span>
                <div className="ml-auto flex gap-1">
                  <button className="text-xs text-indigo-600 hover:underline" onClick={() => {
                    const n = prompt("Rename category", k.name);
                    if (n && n.trim()) run(() => hrApi.saveCategory(h, { name: n.trim(), is_active: k.is_active }, k.category_id));
                  }}>Rename</button>
                  <button className="text-xs text-gray-500 hover:underline" onClick={() => run(() => hrApi.saveCategory(h, { name: k.name, is_active: !k.is_active }, k.category_id))}>
                    {k.is_active ? "Deactivate" : "Activate"}</button>
                  {k.course_count === 0 && <button className="text-xs text-red-500 hover:underline" onClick={() => run(() => hrApi.deleteCategory(h, k.category_id))}>Delete</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
