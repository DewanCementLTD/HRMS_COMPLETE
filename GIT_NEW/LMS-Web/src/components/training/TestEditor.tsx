"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import type { TestApi, CourseTests, TestDef, Question } from "@/services/trainingService";
import { ErrorBox, Empty, TextArea } from "./TrainingUi";

// Pre/post test + question bank editor. Used by HR (Courses & Tests) and by
// internal trainers for the courses they teach; `api` decides which endpoints.

// ---------------------------------------------------------------------------
// Tests & question bank
// ---------------------------------------------------------------------------

type QForm = { question_text: string; opt_a: string; opt_b: string; opt_c: string; opt_d: string; correct_opt: "A" | "B" | "C" | "D"; marks: string; is_active: boolean };
const toQForm = (q?: Question): QForm => ({
  question_text: q?.question_text ?? "", opt_a: q?.opt_a ?? "", opt_b: q?.opt_b ?? "", opt_c: q?.opt_c ?? "", opt_d: q?.opt_d ?? "",
  correct_opt: q?.correct_opt ?? "A", marks: String(q?.marks ?? 1), is_active: q?.is_active ?? true,
});

export function TestsModal({ api, course, onClose }: { api: TestApi; course: { course_id: number; title: string }; onClose: () => void }) {
  const [data, setData] = useState<CourseTests | null>(null);
  const [kind, setKind] = useState<"PRE" | "POST">("POST");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.courseTests(course.course_id).then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [api, course.course_id]);
  useEffect(load, [load]);

  const test = data ? (kind === "PRE" ? data.pre : data.post) : null;

  return (
    <Modal size="xl" title={`Tests — ${course.title}`} subtitle="Employees take these online. Pre-test before training, post-test after it starts; the post-test decides pass / fail."
      onClose={onClose}>
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit mb-4">
        {(["PRE", "POST"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${kind === k ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600"}`}>
            {k === "PRE" ? "Pre-training test" : "Post-training test"}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {!data ? <Spinner /> : <TestEditor key={kind} api={api} courseId={course.course_id} kind={kind} test={test} coursePass={data.course_pass_pct} onChanged={load} />}
    </Modal>
  );
}

function TestEditor({ api, courseId, kind, test, coursePass, onChanged }: {
  api: TestApi; courseId: number; kind: "PRE" | "POST"; test: TestDef | null; coursePass: number; onChanged: () => void;
}) {
  const [title, setTitle] = useState(test?.title ?? "");
  const [limit, setLimit] = useState(String(test?.time_limit_min ?? 30));
  const [pass, setPass] = useState(test?.pass_pct != null ? String(test.pass_pct) : "");
  const [shuffle, setShuffle] = useState(test?.shuffle ?? true);
  const [active, setActive] = useState(test?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState<{ id?: number; f: QForm } | null>(null);

  async function saveSettings() {
    setSaving(true);
    setError(null);
    try {
      await api.saveTest(courseId, kind, {
        title: title || null, time_limit_min: Number(limit || 30), pass_pct: pass === "" ? null : Number(pass), shuffle, is_active: active,
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveQuestion() {
    if (!q || !test) return;
    setError(null);
    try {
      await api.saveQuestion(test.test_id, {
        ...q.f, opt_c: q.f.opt_c || null, opt_d: q.f.opt_d || null, marks: Number(q.f.marks || 1),
      }, q.id);
      setQ(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function removeQuestion(qq: Question) {
    if (!test || !confirm("Delete this question?")) return;
    try {
      const r = await api.deleteQuestion(test.test_id, qq.question_id);
      if (r.deactivated) alert("This question was already answered in a test, so it has been deactivated instead of deleted.");
      onChanged();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  const setF = (patch: Partial<QForm>) => q && setQ({ ...q, f: { ...q.f, ...patch } });

  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      <div className="rounded-xl border border-gray-100 p-4 grid gap-3 md:grid-cols-5 items-end">
        <div className="md:col-span-2"><Input label="Test title" placeholder="(defaults to course name)" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <Input label="Time limit (min)" type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />
        <Input label={`Pass % (blank = course ${coursePass}%)`} type="number" min={0} max={100} value={pass} onChange={(e) => setPass(e.target.value)} />
        <Button onClick={saveSettings} loading={saving}><Save className="h-4 w-4 mr-1" />{test ? "Save settings" : "Create test"}</Button>
        <div className="md:col-span-5 flex flex-wrap gap-6 text-sm">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />Shuffle question order</label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active</label>
          {test && <span className="text-gray-500">{test.attempts} attempt(s) so far · total marks {test.total_marks}</span>}
        </div>
      </div>

      {!test ? <Empty>Create the test first, then add questions.</Empty> : (
        <>
          <div className="flex items-center">
            <p className="text-sm text-gray-500">{test.questions.length} question(s)</p>
            <Button size="sm" className="ml-auto" onClick={() => setQ({ f: toQForm() })}><Plus className="h-4 w-4 mr-1" />Add question</Button>
          </div>
          {test.questions.length === 0 ? <Empty>No questions yet.</Empty> : (
            <ol className="space-y-2">
              {test.questions.map((qq, i) => (
                <li key={qq.question_id} className={`rounded-xl border border-gray-100 p-3 ${qq.is_active ? "" : "opacity-50"}`}>
                  <div className="flex gap-2">
                    <p className="flex-1 font-medium text-gray-900"><span className="text-gray-400 mr-1">{i + 1}.</span>{qq.question_text}
                      <span className="ml-2 text-xs text-gray-400">{qq.marks} mark(s){!qq.is_active && " · inactive"}</span></p>
                    <button title="Edit" onClick={() => setQ({ id: qq.question_id, f: toQForm(qq) })} className="p-1 rounded text-gray-600 hover:bg-gray-100"><Pencil className="h-4 w-4" /></button>
                    <button title="Delete" onClick={() => removeQuestion(qq)} className="p-1 rounded text-red-500 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="mt-1.5 grid gap-1 sm:grid-cols-2 text-sm">
                    {(["A", "B", "C", "D"] as const).map((k) => {
                      const text = qq[`opt_${k.toLowerCase()}` as "opt_a"];
                      if (!text) return null;
                      return <span key={k} className={qq.correct_opt === k ? "text-emerald-700 font-medium" : "text-gray-600"}>{k}. {text}{qq.correct_opt === k && " ✓"}</span>;
                    })}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {q && (
        <Modal title={q.id ? "Edit question" : "Add question"} onClose={() => setQ(null)}
          footer={<><Button variant="secondary" onClick={() => setQ(null)}>Cancel</Button><Button onClick={saveQuestion}>Save</Button></>}>
          <div className="space-y-3">
            <TextArea label="Question" value={q.f.question_text} onChange={(v) => setF({ question_text: v })} rows={2} />
            {(["A", "B", "C", "D"] as const).map((k) => (
              <div key={k} className="flex items-end gap-2">
                <div className="flex-1">
                  <Input label={`Option ${k}${k === "C" || k === "D" ? " (optional)" : ""}`} value={q.f[`opt_${k.toLowerCase()}` as "opt_a"]}
                    onChange={(e) => setF({ [`opt_${k.toLowerCase()}`]: e.target.value } as Partial<QForm>)} />
                </div>
                <label className="inline-flex items-center gap-1.5 text-sm pb-3 whitespace-nowrap">
                  <input type="radio" name="correct" checked={q.f.correct_opt === k} onChange={() => setF({ correct_opt: k })} />Correct
                </label>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3 items-end">
              <Input label="Marks" type="number" min={0.5} step={0.5} value={q.f.marks} onChange={(e) => setF({ marks: e.target.value })} />
              <label className="inline-flex items-center gap-2 text-sm pb-3"><input type="checkbox" checked={q.f.is_active} onChange={(e) => setF({ is_active: e.target.checked })} />Active</label>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
