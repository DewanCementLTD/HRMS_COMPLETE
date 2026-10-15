"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Pencil, RefreshCw, Users, CalendarCheck, MessageSquare, Flag, UserPlus, UserMinus, RotateCcw,
  Award, Search, Monitor, MapPin, Eye, AlertTriangle, Map as MapIcon, Download,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { toLocalYmd } from "@/lib/utils";
import {
  hrApi, downloadPdf, money, rateText, MODE_LABEL, SESSION_STATUS_LABEL, type Slot,
  type Hr, type Session, type SessionDetail, type Course, type Trainer, type Department, type EmployeeLite,
  type SessionStatus, type TrainingMode, type Participant, type AttemptRow,
} from "@/services/trainingService";
import {
  SessionStatusPill, ParticipantStatusPill, Stars, StarInput, ErrorBox, Empty, TextArea, Pill,
} from "@/components/training/TrainingUi";
import { OutlineEditor } from "@/components/training/OutlineEditor";

type Form = {
  course_id: string; trainer_id: string; mode: TrainingMode; venue: string; online_link: string;
  start_date: string; end_date: string; time_from: string; time_to: string; total_hours: string; capacity: string;
  dept_no: string; trainer_cost: string; venue_cost: string; material_cost: string; other_cost: string;
  status: "PLANNED" | "OPEN"; remarks: string;
};
const toForm = (s?: Session): Form => ({
  course_id: s ? String(s.course_id) : "", trainer_id: s?.trainer_id ? String(s.trainer_id) : "", mode: s?.mode ?? "PHYSICAL",
  venue: s?.venue ?? "", online_link: s?.online_link ?? "", start_date: s?.start_date ?? "", end_date: s?.end_date ?? "",
  time_from: s?.time_from ?? "", time_to: s?.time_to ?? "", total_hours: s?.total_hours != null ? String(s.total_hours) : "",
  capacity: String(s?.capacity ?? 20), dept_no: s?.dept_no != null ? String(s.dept_no) : "",
  trainer_cost: String(s?.trainer_cost ?? 0), venue_cost: String(s?.venue_cost ?? 0), material_cost: String(s?.material_cost ?? 0),
  other_cost: String(s?.other_cost ?? 0), status: s?.status === "OPEN" ? "OPEN" : "PLANNED", remarks: s?.remarks ?? "",
});

const STATUS_FILTER = [{ value: "", label: "All statuses" }, ...(Object.keys(SESSION_STATUS_LABEL) as SessionStatus[]).map((k) => ({ value: k, label: SESSION_STATUS_LABEL[k] }))];

export function SessionsPanel({ h, openSessionId, onOpened }: { h: Hr; openSessionId?: number | null; onOpened?: () => void }) {
  const [items, setItems] = useState<Session[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id?: number; f: Form } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await hrApi.sessions(h, { status: status || undefined })).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [h, status]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Promise.all([hrApi.courses(h), hrApi.trainers(h), hrApi.departments(h)])
      .then(([c, t, d]) => { setCourses(c.items); setTrainers(t.items); setDepts(d.items); })
      .catch(() => { /* list error already shown */ });
  }, [h]);

  useEffect(() => {
    if (openSessionId) { setDetailId(openSessionId); onOpened?.(); }
  }, [openSessionId, onOpened]);

  const set = (patch: Partial<Form>) => edit && setEdit({ ...edit, f: { ...edit.f, ...patch } });

  function pickCourse(id: string) {
    const c = courses.find((x) => String(x.course_id) === id);
    set({ course_id: id, ...(c && !edit?.id ? { mode: c.default_mode, total_hours: c.duration_hrs != null ? String(c.duration_hrs) : "" } : {}) });
  }
  function pickTrainer(id: string) {
    const t = trainers.find((x) => String(x.trainer_id) === id);
    const cost = t?.is_free ? { trainer_cost: "0" }
      : t?.default_rate != null && Number(edit?.f.trainer_cost || 0) === 0 ? { trainer_cost: String(t.default_rate) } : {};
    set({ trainer_id: id, ...cost });
    loadSlots(t);
  }
  function loadSlots(t?: Trainer) {
    setSlots(null);
    if (t?.trainer_type === "I") hrApi.trainerSlots(h, t.trainer_id).then((r) => setSlots(r.items)).catch(() => setSlots([]));
  }
  const pickedTrainer = trainers.find((x) => String(x.trainer_id) === edit?.f.trainer_id);

  async function save() {
    if (!edit) return;
    const f = edit.f;
    setSaving(true);
    setFormError(null);
    try {
      const res = await hrApi.saveSession(h, {
        course_id: Number(f.course_id), trainer_id: f.trainer_id ? Number(f.trainer_id) : null, mode: f.mode,
        venue: f.venue, online_link: f.online_link, start_date: f.start_date, end_date: f.end_date || f.start_date,
        time_from: f.time_from, time_to: f.time_to, total_hours: f.total_hours ? Number(f.total_hours) : null,
        capacity: Number(f.capacity || 1), dept_no: f.dept_no ? Number(f.dept_no) : null,
        trainer_cost: Number(f.trainer_cost || 0), venue_cost: Number(f.venue_cost || 0),
        material_cost: Number(f.material_cost || 0), other_cost: Number(f.other_cost || 0),
        status: edit.id ? undefined : f.status, remarks: f.remarks,
      }, edit.id);
      if (res.warnings?.length) alert(`Saved.\n\n⚠ ${res.warnings.join("\n⚠ ")}`);
      setEdit(null);
      load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const total = edit ? ["trainer_cost", "venue_cost", "material_cost", "other_cost"].reduce((a, k) => a + Number(edit.f[k as keyof Form] || 0), 0) : 0;

  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="w-44">
              <select className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_FILTER.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
              <Button size="sm" disabled={!courses.length} title={courses.length ? undefined : "Add a course first"}
                onClick={() => { setFormError(null); setSlots(null); setEdit({ f: toForm() }); }}><Plus className="h-4 w-4 mr-1" />New session</Button>
            </div>
          </div>
          {loading && !items.length ? <Spinner /> : items.length === 0 ? <Empty>No sessions yet. Schedule one for a course from the catalog.</Empty> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Session</th>
                    <th className="px-3 py-2 text-left">Dates</th>
                    <th className="px-3 py-2 text-left">Trainer / Venue</th>
                    <th className="px-3 py-2 text-center">Seats</th>
                    <th className="px-3 py-2 text-right">Cost</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((s) => (
                    <tr key={s.session_id} className="hover:bg-gray-50/60">
                      <td className="px-3 py-2"><p className="font-medium text-gray-900">{s.course_title}</p><p className="text-xs text-gray-400">{s.session_code}{s.dept_name ? ` · ${s.dept_name}` : ""}</p></td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{s.start_date}{s.end_date !== s.start_date && <> → {s.end_date}</>}
                        {(s.time_from || s.time_to) && <p className="text-xs text-gray-400">{s.time_from}–{s.time_to}</p>}</td>
                      <td className="px-3 py-2 text-gray-600">{s.trainer_name || "—"}
                        <p className="text-xs text-gray-400 inline-flex items-center gap-1">{s.mode === "ONLINE" ? <Monitor className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}{s.mode === "ONLINE" ? "Online" : s.venue || MODE_LABEL[s.mode]}</p></td>
                      <td className="px-3 py-2 text-center tabular-nums">{s.participants}/{s.capacity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(s.total_cost)}</td>
                      <td className="px-3 py-2 text-center"><SessionStatusPill status={s.status} /></td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button title="Open" onClick={() => setDetailId(s.session_id)} className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50"><Eye className="h-4 w-4" /></button>
                          {!["COMPLETED", "CANCELLED"].includes(s.status) && (
                            <button title="Edit" onClick={() => { setFormError(null); setEdit({ id: s.session_id, f: toForm(s) }); loadSlots(trainers.find((t) => t.trainer_id === s.trainer_id)); }} className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100"><Pencil className="h-4 w-4" /></button>
                          )}
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
        <Modal size="lg" title={edit.id ? "Edit session" : "New session"} onClose={() => setEdit(null)}
          footer={<><span className="mr-auto text-sm text-gray-500">Total cost <b className="text-ink">{money(total)}</b></span>
            <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
          <div className="space-y-4">
            <ErrorBox error={formError} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Course" value={edit.f.course_id} onChange={(e) => pickCourse(e.target.value)}
                options={courses.filter((c) => c.is_active || String(c.course_id) === edit.f.course_id).map((c) => ({ value: c.course_id, label: `${c.title} (${c.course_code})` }))} />
              <Select label="Trainer" value={edit.f.trainer_id} onChange={(e) => pickTrainer(e.target.value)}
                options={trainers.filter((t) => t.is_active || String(t.trainer_id) === edit.f.trainer_id).map((t) => ({ value: t.trainer_id, label: `${t.name}${t.trainer_type === "E" && t.organization ? ` — ${t.organization}` : ""}` }))} />
            </div>
            {pickedTrainer && (
              <div className="rounded-xl bg-gray-50 p-3 text-sm space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{pickedTrainer.name}</span>
                  <Pill tone={pickedTrainer.trainer_type === "I" ? "blue" : "amber"}>{pickedTrainer.trainer_type === "I" ? "Internal" : "External"}</Pill>
                  <Pill tone={pickedTrainer.is_free ? "green" : "gray"}>{rateText(pickedTrainer)}</Pill>
                </div>
                {pickedTrainer.trainer_type === "I" && (
                  slots === null ? <p className="text-xs text-gray-400">Loading free slots…</p>
                    : slots.length === 0 ? <p className="text-xs text-gray-500">The trainer has not published free slots.</p> : (
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-xs text-gray-500 mr-1">Free slots:</span>
                        {slots.slice(0, 12).map((sl) => (
                          <button key={sl.slot_id} type="button" title="Use this slot"
                            onClick={() => set({ start_date: sl.slot_date, end_date: sl.slot_date, time_from: sl.time_from, time_to: sl.time_to })}
                            className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-100">
                            {sl.slot_date.slice(5)} {sl.time_from}–{sl.time_to}
                          </button>
                        ))}
                      </div>
                    )
                )}
                {pickedTrainer.trainer_type === "I" && slots && slots.length > 0 && edit.f.start_date
                  && !slots.some((sl) => sl.slot_date === edit.f.start_date) && (
                  <p className="text-xs text-amber-700 inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />The start date is not one of the trainer&apos;s free slots.</p>
                )}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-4">
              <Input label="Start date" type="date" value={edit.f.start_date} onChange={(e) => set({ start_date: e.target.value, end_date: edit.f.end_date && edit.f.end_date >= e.target.value ? edit.f.end_date : e.target.value })} />
              <Input label="End date" type="date" min={edit.f.start_date} value={edit.f.end_date} onChange={(e) => set({ end_date: e.target.value })} />
              <Input label="From" type="time" value={edit.f.time_from} onChange={(e) => set({ time_from: e.target.value })} />
              <Input label="To" type="time" value={edit.f.time_to} onChange={(e) => set({ time_to: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Select label="Mode" value={edit.f.mode} onChange={(e) => set({ mode: (e.target.value || "PHYSICAL") as TrainingMode })}
                options={[{ value: "PHYSICAL", label: "Physical" }, { value: "ONLINE", label: "Online" }]} />
              <div className="sm:col-span-2">
                {edit.f.mode === "ONLINE"
                  ? <Input label="Meeting link" placeholder="https://…" value={edit.f.online_link} onChange={(e) => set({ online_link: e.target.value })} />
                  : <Input label="Venue" value={edit.f.venue} onChange={(e) => set({ venue: e.target.value })} />}
              </div>
              <Input label="Total hours" type="number" min={0} value={edit.f.total_hours} onChange={(e) => set({ total_hours: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Capacity (seats)" type="number" min={1} value={edit.f.capacity} onChange={(e) => set({ capacity: e.target.value })} />
              <Select label="Charge cost to department" value={edit.f.dept_no} onChange={(e) => set({ dept_no: e.target.value })}
                options={depts.map((d) => ({ value: d.dept_no, label: d.dept_name }))} />
              {!edit.id && <Select label="Initial status" value={edit.f.status} onChange={(e) => set({ status: (e.target.value || "PLANNED") as "PLANNED" | "OPEN" })}
                options={[{ value: "PLANNED", label: "Planned" }, { value: "OPEN", label: "Open (confirmed)" }]} />}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1.5">Cost</p>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                <Input label="Trainer" labelClassName="text-xs text-gray-500" type="number" min={0} value={edit.f.trainer_cost} onChange={(e) => set({ trainer_cost: e.target.value })} />
                <Input label="Venue" labelClassName="text-xs text-gray-500" type="number" min={0} value={edit.f.venue_cost} onChange={(e) => set({ venue_cost: e.target.value })} />
                <Input label="Material" labelClassName="text-xs text-gray-500" type="number" min={0} value={edit.f.material_cost} onChange={(e) => set({ material_cost: e.target.value })} />
                <Input label="Other" labelClassName="text-xs text-gray-500" type="number" min={0} value={edit.f.other_cost} onChange={(e) => set({ other_cost: e.target.value })} />
              </div>
            </div>
            <TextArea label="Remarks" value={edit.f.remarks} onChange={(v) => set({ remarks: v })} rows={2} />
          </div>
        </Modal>
      )}

      {detailId && <SessionDetailModal h={h} sessionId={detailId} onClose={() => { setDetailId(null); load(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session detail
// ---------------------------------------------------------------------------

type DTab = "participants" | "attendance" | "feedback" | "outline";

function datesBetween(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (d <= end && out.length < 366) { out.push(toLocalYmd(d)); d.setDate(d.getDate() + 1); }
  return out;
}

function SessionDetailModal({ h, sessionId, onClose }: { h: Hr; sessionId: number; onClose: () => void }) {
  const [data, setData] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DTab>("participants");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await hrApi.session(h, sessionId)); } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }, [h, sessionId]);
  useEffect(() => { load(); }, [load]);

  const s = data?.session;

  async function changeStatus(st: SessionStatus) {
    let remarks: string | undefined;
    if (st === "CANCELLED") {
      const r = prompt("Cancel this session? Booked employees are withdrawn and their requests go back to 'Approved — to book'.\n\nReason:");
      if (r === null) return;
      remarks = r;
    }
    setBusy(true);
    try { await hrApi.setSessionStatus(h, sessionId, st, remarks); await load(); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }

  async function complete() {
    if (!s) return;
    const again = s.status === "COMPLETED";
    if (!confirm(again
      ? "Re-evaluate? Participants who have since passed a retest are marked completed and get certificates. Nobody is downgraded."
      : `Complete & evaluate this session?\n\nEach participant is marked Completed when attendance ≥ ${s.min_attend_pct}%${s.has_post_test ? ` and post-test ≥ ${s.pass_pct}%` : ""}${s.cert_required ? ", and gets a certificate." : "."}`)) return;
    setBusy(true);
    try {
      const r = await hrApi.completeSession(h, sessionId);
      alert(`Completed: ${r.completed}\nFailed: ${r.failed}\nNo-show: ${r.no_show}\nCertificates issued: ${r.certificates}${r.trainer_certificate ? `\nTrainer certificate: ${r.trainer_certificate}` : ""}`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal size="xl" title={s ? `${s.course_title} — ${s.session_code}` : "Session"}
      subtitle={s ? `${s.start_date}${s.end_date !== s.start_date ? ` → ${s.end_date}` : ""} · ${s.trainer_name || "no trainer"} · ${s.mode === "ONLINE" ? "Online" : s.venue || "Physical"} · cost ${money(s.total_cost)}` : undefined}
      onClose={onClose}>
      <ErrorBox error={error} />
      {!data || !s ? <Spinner /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SessionStatusPill status={s.status} />
            <span className="text-sm text-gray-500">{s.participants}/{s.capacity} booked</span>
            {s.has_pre_test && <Pill tone="gray">Pre-test</Pill>}
            {s.has_post_test ? <Pill tone="gray">Post-test · pass {s.pass_pct}%</Pill> : <Pill tone="amber">No post-test — attendance only</Pill>}
            {s.avg_rating != null && <span className="inline-flex items-center gap-1 text-sm"><Stars value={s.avg_rating} /> {s.avg_rating}</span>}
            {s.trainer_cert_no && (
              <button className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1"
                onClick={() => downloadPdf(hrApi.trainerCertificateUrl(h, sessionId), `certificate_${s.trainer_cert_no}.pdf`).catch((e) => alert(e instanceof Error ? e.message : "Failed"))}>
                <Award className="h-3.5 w-3.5 text-amber-600" />Trainer certificate {s.trainer_cert_no}<Download className="h-3 w-3" /></button>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {s.status === "PLANNED" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => changeStatus("OPEN")}>Mark open</Button>}
              {s.status === "OPEN" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => changeStatus("IN_PROGRESS")}>Start training</Button>}
              {["OPEN", "IN_PROGRESS", "COMPLETED"].includes(s.status) && (
                <Button size="sm" disabled={busy} onClick={complete}><Flag className="h-4 w-4 mr-1" />{s.status === "COMPLETED" ? "Re-evaluate" : "Complete & evaluate"}</Button>
              )}
              {!["COMPLETED", "CANCELLED"].includes(s.status) && <Button size="sm" variant="ghost" className="text-red-600" disabled={busy} onClick={() => changeStatus("CANCELLED")}>Cancel session</Button>}
            </div>
          </div>

          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
            {([["participants", "Participants", Users], ["attendance", "Attendance", CalendarCheck], ["outline", "Outline", MapIcon], ["feedback", "Feedback", MessageSquare]] as const).map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${tab === id ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600"}`}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>

          {tab === "participants" && <ParticipantsTab h={h} data={data} reload={load} />}
          {tab === "attendance" && <AttendanceTab h={h} data={data} reload={load} />}
          {tab === "feedback" && <FeedbackTab h={h} data={data} reload={load} />}
          {tab === "outline" && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">{s.trainer_empcode ? "Written by the trainer from the Trainer Portal; HR can edit it too." : "External trainer — HR maintains the outline."} Participants see it in My Training.</p>
              <OutlineEditor key={s.outline_updated_at ?? "none"} outline={s} readOnly={s.status === "CANCELLED"}
                onSaveText={async (text) => { await hrApi.saveOutline(h, sessionId, text); await load(); }}
                onUpload={async (f) => { await hrApi.uploadOutline(h, sessionId, f); await load(); }}
                onDeleteFile={async () => { await hrApi.deleteOutlineFile(h, sessionId); await load(); }}
                onDownload={() => downloadPdf(hrApi.outlineFileUrl(h, sessionId), s.outline_file_name || "outline").catch((e) => alert(e instanceof Error ? e.message : "Failed"))} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ParticipantsTab({ h, data, reload }: { h: Hr; data: SessionDetail; reload: () => Promise<void> }) {
  const s = data.session;
  const [adding, setAdding] = useState(false);
  const [attemptsFor, setAttemptsFor] = useState<{ p: Participant; rows: AttemptRow[] | null } | null>(null);
  const editable = ["PLANNED", "OPEN", "IN_PROGRESS"].includes(s.status);

  async function withdraw(p: Participant) {
    if (!confirm(`Withdraw ${p.name} from this session?${p.request_id ? " Their request goes back to 'Approved — to book'." : ""}`)) return;
    try { await hrApi.withdraw(h, s.session_id, p.participant_id); await reload(); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }
  async function retest(p: Participant) {
    if (!confirm(`Allow ${p.name} one more post-test attempt?`)) return;
    try { await hrApi.retest(h, s.session_id, p.participant_id); await reload(); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }
  async function cert(p: Participant) {
    try { await downloadPdf(hrApi.certificateUrl(h, p.participant_id), `certificate_${p.cert_no}.pdf`); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }
  async function showAttempts(p: Participant) {
    setAttemptsFor({ p, rows: null });
    try { setAttemptsFor({ p, rows: (await hrApi.attempts(h, p.participant_id)).items }); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); setAttemptsFor(null); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center">
        <p className="text-sm text-gray-500">{data.participants.filter((p) => p.status !== "WITHDRAWN").length} participant(s)</p>
        {editable && <Button size="sm" className="ml-auto" disabled={s.seats_left <= 0} onClick={() => setAdding(true)}>
          <UserPlus className="h-4 w-4 mr-1" />Assign employees{s.seats_left <= 0 ? " (full)" : ""}</Button>}
      </div>
      {data.participants.length === 0 ? <Empty>Nobody is booked yet. Book approved requests from the Requests tab, or assign employees directly.</Empty> : (
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-center">Source</th>
                <th className="px-3 py-2 text-right">Attend.</th>
                <th className="px-3 py-2 text-right">Pre</th>
                <th className="px-3 py-2 text-right">Post</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-left">Certificate</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.participants.map((p) => (
                <tr key={p.participant_id} className={p.status === "WITHDRAWN" ? "opacity-50" : "hover:bg-gray-50/60"}>
                  <td className="px-3 py-2"><p className="font-medium text-gray-900">{p.name}</p><p className="text-xs text-gray-400">{p.empcode} · {p.dept_name}</p></td>
                  <td className="px-3 py-2 text-center"><Pill tone={p.request_id ? "blue" : "gray"}>{p.request_id ? `Request #${p.request_id}` : "HR assigned"}</Pill></td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.attend_pct == null ? "—" : `${p.attend_pct}%`}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.pre_score_pct == null ? "—" : `${p.pre_score_pct}%`}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.post_score_pct == null ? "—" : `${p.post_score_pct}%`}
                    {p.improvement != null && <p className={`text-[11px] ${p.improvement >= 0 ? "text-emerald-600" : "text-red-500"}`}>{p.improvement >= 0 ? "+" : ""}{p.improvement}</p>}</td>
                  <td className="px-3 py-2 text-center"><ParticipantStatusPill status={p.status} /></td>
                  <td className="px-3 py-2">{p.cert_no ? <button onClick={() => cert(p)} className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1"><Award className="h-3.5 w-3.5 text-amber-600" />{p.cert_no}</button> : <span className="text-gray-400 text-xs">—</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {p.post_attempts > 0 && <button title="Test attempts" onClick={() => showAttempts(p)} className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100"><Eye className="h-4 w-4" /></button>}
                      {s.has_post_test && p.status !== "WITHDRAWN" && p.status !== "COMPLETED" && p.post_attempts > 0 && (
                        <button title={`Allow retest (${p.retest_allowed} granted)`} onClick={() => retest(p)} className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50"><RotateCcw className="h-4 w-4" /></button>
                      )}
                      {editable && p.status === "BOOKED" && <button title="Withdraw" onClick={() => withdraw(p)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"><UserMinus className="h-4 w-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AssignModal h={h} session={s} existing={data.participants.filter((p) => p.status !== "WITHDRAWN").map((p) => p.empcode)}
        onClose={async (changed) => { setAdding(false); if (changed) await reload(); }} />}
      {attemptsFor && (
        <Modal size="sm" title={`Test attempts — ${attemptsFor.p.name}`} onClose={() => setAttemptsFor(null)}>
          {!attemptsFor.rows ? <Spinner /> : attemptsFor.rows.length === 0 ? <Empty>No attempts.</Empty> : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-gray-500"><tr><th className="py-1 text-left">Test</th><th className="text-left">Started</th><th className="text-right">Score</th><th className="text-right">Result</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {attemptsFor.rows.map((a) => (
                  <tr key={a.attempt_id}>
                    <td className="py-1.5">{a.test_kind}</td><td className="text-gray-600">{a.started_at}</td>
                    <td className="text-right tabular-nums">{a.pct == null ? "in progress" : `${a.score}/${a.total} (${a.pct}%)`}</td>
                    <td className="text-right">{a.passed == null ? "—" : a.passed ? <Pill tone="green">Pass</Pill> : <Pill tone="red">Fail</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  );
}

function AssignModal({ h, session, existing, onClose }: { h: Hr; session: Session; existing: string[]; onClose: (changed: boolean) => void }) {
  const [emps, setEmps] = useState<EmployeeLite[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => { hrApi.employees(h).then((r) => setEmps(r.items)).catch((e) => alert(e instanceof Error ? e.message : "Failed")); }, [h]);

  const taken = useMemo(() => new Set(existing), [existing]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (emps ?? []).filter((e) => !taken.has(e.empcode) && (!q || `${e.name} ${e.empcode} ${e.dept_name} ${e.desg_desc}`.toLowerCase().includes(q)));
  }, [emps, query, taken]);

  const toggle = (code: string) => setPicked((p) => { const n = new Set(p); if (n.has(code)) n.delete(code); else n.add(code); return n; });

  async function save() {
    setSaving(true);
    try {
      const r = await hrApi.addParticipants(h, session.session_id, [...picked]);
      const msg = [`Assigned: ${r.added.length}`];
      if (r.skipped.length) msg.push("", "Skipped:", ...r.skipped.map((x) => `• ${x.empcode}: ${x.reason}`));
      alert(msg.join("\n"));
      onClose(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Assign employees" subtitle={`Direct assignment — no approval needed. ${session.seats_left} seat(s) left.`} onClose={() => onClose(false)}
      footer={<><span className="mr-auto text-sm text-gray-500">{picked.size} selected</span>
        <Button variant="secondary" onClick={() => onClose(false)}>Cancel</Button>
        <Button onClick={save} loading={saving} disabled={!picked.size}>Assign</Button></>}>
      {picked.size > session.seats_left && (
        <p className="mb-2 text-xs text-amber-700 inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />More people selected than seats left — the extra ones will be skipped.</p>
      )}
      <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 mb-3">
        <Search className="h-4 w-4 text-gray-400" />
        <input className="bg-transparent text-sm outline-none w-full" placeholder="Search name / code / department…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!emps ? <Spinner /> : list.length === 0 ? <Empty>No employees found.</Empty> : (
        <ul className="divide-y divide-gray-50 max-h-[50vh] overflow-y-auto">
          {list.map((e) => (
            <li key={e.empcode}>
              <label className="flex items-center gap-3 py-2 cursor-pointer">
                <input type="checkbox" checked={picked.has(e.empcode)} onChange={() => toggle(e.empcode)} />
                <span className="flex-1 min-w-0"><span className="font-medium text-gray-900">{e.name}</span>
                  <span className="text-xs text-gray-400 ml-2">{e.empcode} · {e.dept_name}{e.desg_desc ? ` · ${e.desg_desc}` : ""}</span></span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function AttendanceTab({ h, data, reload }: { h: Hr; data: SessionDetail; reload: () => Promise<void> }) {
  const s = data.session;
  const people = data.participants.filter((p) => p.status !== "WITHDRAWN");
  const dates = useMemo(() => datesBetween(s.start_date, s.end_date), [s.start_date, s.end_date]);
  const today = toLocalYmd(new Date());
  const [date, setDate] = useState(dates.includes(today) ? today : dates[0]);
  const [marks, setMarks] = useState<Record<number, { status: "P" | "A" | "L"; hours: string }>>({});
  const [saving, setSaving] = useState(false);
  const locked = s.status === "CANCELLED";

  const marked = useMemo(() => new Set(data.attendance.map((a) => a.date)), [data.attendance]);

  useEffect(() => {
    const m: Record<number, { status: "P" | "A" | "L"; hours: string }> = {};
    for (const p of people) {
      const a = data.attendance.find((x) => x.participant_id === p.participant_id && x.date === date);
      m[p.participant_id] = { status: a?.status ?? "P", hours: a?.hours != null ? String(a.hours) : "" };
    }
    setMarks(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, data]);

  async function save() {
    setSaving(true);
    try {
      await hrApi.saveAttendance(h, s.session_id, date, people.map((p) => ({
        participant_id: p.participant_id, status: marks[p.participant_id]?.status ?? "P",
        hours: marks[p.participant_id]?.hours ? Number(marks[p.participant_id].hours) : null,
      })));
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (!people.length) return <Empty>Book participants first.</Empty>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {dates.map((d) => (
          <button key={d} onClick={() => setDate(d)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${d === date ? "bg-indigo-600 text-white border-indigo-600" : marked.has(d) ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-white text-gray-600 border-gray-200"}`}>
            {d.slice(5)}{marked.has(d) && d !== date ? " ✓" : ""}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-400">Only days you save count towards attendance %. Late counts as present.</p>
      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr><th className="px-3 py-2 text-left">Employee</th><th className="px-3 py-2 text-center">Status on {date}</th><th className="px-3 py-2 text-right">Hours</th><th className="px-3 py-2 text-right">Overall</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {people.map((p) => {
              const m = marks[p.participant_id] ?? { status: "P", hours: "" };
              return (
                <tr key={p.participant_id}>
                  <td className="px-3 py-2"><p className="font-medium text-gray-900">{p.name}</p><p className="text-xs text-gray-400">{p.empcode}</p></td>
                  <td className="px-3 py-2">
                    <div className="flex justify-center gap-1">
                      {(["P", "L", "A"] as const).map((st) => (
                        <button key={st} disabled={locked} onClick={() => setMarks((x) => ({ ...x, [p.participant_id]: { ...m, status: st } }))}
                          className={`w-9 py-1 rounded-lg text-xs font-bold border ${m.status === st
                            ? st === "P" ? "bg-emerald-600 text-white border-emerald-600" : st === "L" ? "bg-amber-500 text-white border-amber-500" : "bg-red-500 text-white border-red-500"
                            : "bg-white text-gray-500 border-gray-200"}`}>{st}</button>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min={0} max={24} step={0.5} disabled={locked} className="w-20 px-2 py-1 rounded-lg border border-gray-200 text-right text-sm"
                      value={m.hours} onChange={(e) => setMarks((x) => ({ ...x, [p.participant_id]: { ...m, hours: e.target.value } }))} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{p.attend_pct == null ? "—" : `${p.attend_pct}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!locked && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setMarks(Object.fromEntries(people.map((p) => [p.participant_id, { status: "P" as const, hours: marks[p.participant_id]?.hours ?? "" }])))}>All present</Button>
          <Button size="sm" onClick={save} loading={saving}>Save attendance for {date}</Button>
        </div>
      )}
    </div>
  );
}

function FeedbackTab({ h, data, reload }: { h: Hr; data: SessionDetail; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"HR" | "TRAINER" | "MANAGER">("HR");
  const [content, setContent] = useState(0);
  const [trainer, setTrainer] = useState(0);
  const [overall, setOverall] = useState(0);
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!overall) { alert("Give an overall rating"); return; }
    setSaving(true);
    try {
      await hrApi.sessionFeedback(h, data.session.session_id, {
        given_by_type: type, rating_content: content || null, rating_trainer: trainer || null, rating_overall: overall, comments,
      });
      setOpen(false);
      setContent(0); setTrainer(0); setOverall(0); setComments("");
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center">
        <p className="text-sm text-gray-500">{data.feedback.length} feedback entr{data.feedback.length === 1 ? "y" : "ies"}</p>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add HR / trainer feedback</Button>
      </div>
      {data.feedback.length === 0 ? <Empty>No feedback yet. Employees can give feedback once the training has started.</Empty> : (
        <ul className="divide-y divide-gray-100">
          {data.feedback.map((f) => (
            <li key={f.feedback_id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={f.given_by_type === "EMPLOYEE" ? "blue" : "indigo"}>{f.given_by_type.toLowerCase()}</Pill>
                <span className="text-sm font-medium text-gray-900">{f.given_by_name || f.given_by}</span>
                <Stars value={f.rating_overall} />
                <span className="text-xs text-gray-400 ml-auto">{f.created_at}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">Content {f.rating_content ?? "—"} · Trainer {f.rating_trainer ?? "—"}</p>
              {f.comments && <p className="text-sm text-gray-700 mt-1">{f.comments}</p>}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <Modal size="sm" title="Add feedback" onClose={() => setOpen(false)}
          footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
          <div className="space-y-3">
            <Select label="Feedback from" value={type} onChange={(e) => setType((e.target.value || "HR") as "HR" | "TRAINER" | "MANAGER")}
              options={[{ value: "HR", label: "HR" }, { value: "TRAINER", label: "Trainer" }, { value: "MANAGER", label: "Manager" }]} />
            <StarInput label="Content" value={content} onChange={setContent} />
            <StarInput label="Trainer" value={trainer} onChange={setTrainer} />
            <StarInput label="Overall" value={overall} onChange={setOverall} />
            <TextArea label="Comments" value={comments} onChange={setComments} />
          </div>
        </Modal>
      )}
    </div>
  );
}
