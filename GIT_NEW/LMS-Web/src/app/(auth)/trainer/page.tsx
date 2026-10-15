"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Presentation, CalendarDays, CalendarClock, ListChecks, UserCircle2, Plus, Trash2, Users, Award, Download,
  MessageSquare, Monitor, MapPin, RefreshCw, Clock, Star,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { toLocalYmd } from "@/lib/utils";
import {
  trainerApi, trainerTestApi, downloadPdf, rateText, RATE_UNIT_LABEL,
  type TrainerProfile, type Session, type Slot, type TrainerSessionDetail, type TrainerCourse, type RateUnit,
} from "@/services/trainingService";
import {
  Tabs, SignInAgain, SessionStatusPill, ParticipantStatusPill, Stars, StarInput, ErrorBox, Empty, TextArea, Pill,
} from "@/components/training/TrainingUi";
import { OutlineEditor } from "@/components/training/OutlineEditor";
import { TestsModal } from "@/components/training/TestEditor";

type Tab = "sessions" | "slots" | "tests" | "profile";
type Auth = { card: string; token: string };

const save = async (url: string, name: string, token: string) => {
  try { await downloadPdf(url, name, token); } catch (e) { alert(e instanceof Error ? e.message : "Download failed"); }
};

// Internal trainers' own workspace: their sessions (outline, participants,
// feedback, certificate), free slots, tests and trainer profile.
export default function TrainerPortalPage() {
  const { user } = useAuth();
  const token = user?.session_token || "";
  const card = user?.card_no || "";
  const [tab, setTab] = useState<Tab>("sessions");
  const [profile, setProfile] = useState<TrainerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(() => {
    if (!card || !token) return;
    trainerApi.profile(card, token).then(setProfile).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [card, token]);
  useEffect(loadProfile, [loadProfile]);

  if (!user) return null;
  if (!token) return <div className="animate-fade-in"><PageHeader title="Trainer Portal" /><Card><SignInAgain /></Card></div>;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Trainer Portal" subtitle="Your training sessions, availability, tests and trainer profile" />
      <ErrorBox error={error} />
      {!profile && !error ? <Spinner /> : profile && !profile.is_trainer ? (
        <Card><Empty>You are not set up as a trainer. HR can add you as an internal trainer from Training → Trainers.</Empty></Card>
      ) : profile?.trainer && (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-5">
            <Stat icon={CalendarClock} label="Upcoming sessions" value={profile.stats?.upcoming ?? 0} />
            <Stat icon={Presentation} label="Sessions conducted" value={profile.stats?.completed ?? 0} />
            <Stat icon={Users} label="People trained" value={profile.stats?.people_trained ?? 0} />
            <Stat icon={Star} label="Trainer rating" value={profile.trainer.avg_rating != null ? `${profile.trainer.avg_rating} / 5` : "—"} />
          </div>
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { id: "sessions", label: "My Sessions", icon: Presentation },
            { id: "slots", label: "Free Slots", icon: CalendarDays },
            { id: "tests", label: "Tests", icon: ListChecks },
            { id: "profile", label: "Trainer Profile", icon: UserCircle2 },
          ]} />
          {tab === "sessions" && <SessionsTab card={card} token={token} />}
          {tab === "slots" && <SlotsTab card={card} token={token} />}
          {tab === "tests" && <TestsTab card={card} token={token} />}
          {tab === "profile" && <ProfileTab card={card} token={token} profile={profile} onSaved={loadProfile} />}
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-3 flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center"><Icon className="h-5 w-5" /></div>
        <div><p className="text-xs text-gray-500">{label}</p><p className="text-xl font-extrabold text-ink tabular-nums">{value}</p></div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function SessionsTab({ card, token }: Auth) {
  const [items, setItems] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(() => {
    trainerApi.sessions(card, token).then((r) => setItems(r.items)).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [card, token]);
  useEffect(load, [load]);

  if (error) return <ErrorBox error={error} />;
  if (!items) return <Spinner />;
  if (!items.length) return <Card><Empty>No sessions assigned to you yet. HR assigns you when scheduling a session.</Empty></Card>;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {items.map((s) => (
        <Card key={s.session_id} onClick={() => setOpen(s.session_id)}>
          <CardContent className="py-4">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink">{s.course_title}</p>
                <p className="text-xs text-gray-400">{s.session_code}</p>
              </div>
              <SessionStatusPill status={s.status} />
            </div>
            <div className="mt-3 grid gap-1.5 sm:grid-cols-2 text-sm text-gray-600">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-gray-400" />{s.start_date}{s.end_date !== s.start_date && ` → ${s.end_date}`}</span>
              {(s.time_from || s.time_to) && <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-gray-400" />{s.time_from}–{s.time_to}</span>}
              <span className="inline-flex items-center gap-1.5">{s.mode === "ONLINE" ? <Monitor className="h-4 w-4 text-gray-400" /> : <MapPin className="h-4 w-4 text-gray-400" />}{s.mode === "ONLINE" ? "Online" : s.venue || "Physical"}</span>
              <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-gray-400" />{s.participants} participant(s)</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.outline_text || s.outline_file_name ? <Pill tone="green">Outline shared</Pill> : !["COMPLETED"].includes(s.status) && <Pill tone="amber">Outline missing</Pill>}
              {s.trainer_cert_no && <Pill tone="indigo">Certificate ready</Pill>}
            </div>
          </CardContent>
        </Card>
      ))}
      {open && <SessionModal card={card} token={token} sessionId={open} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}

function SessionModal({ card, token, sessionId, onClose }: Auth & { sessionId: number; onClose: () => void }) {
  const [d, setD] = useState<TrainerSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sub, setSub] = useState<"outline" | "people" | "feedback">("outline");

  const load = useCallback(() => {
    trainerApi.session(card, token, sessionId).then(setD).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [card, token, sessionId]);
  useEffect(load, [load]);

  const s = d?.session;
  return (
    <Modal size="lg" title={s ? s.course_title : "Session"} onClose={onClose}
      subtitle={s ? `${s.session_code} · ${s.start_date}${s.end_date !== s.start_date ? ` → ${s.end_date}` : ""} · ${s.mode === "ONLINE" ? "Online" : s.venue || "Physical"}` : undefined}>
      <ErrorBox error={error} />
      {!d || !s ? <Spinner /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <SessionStatusPill status={s.status} />
            {s.online_link && <a href={s.online_link} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline">Meeting link</a>}
            {s.trainer_cert_no && (
              <Button size="sm" variant="secondary" className="ml-auto" onClick={() => save(trainerApi.certificatePath(card, sessionId), `certificate_${s.trainer_cert_no}.pdf`, token)}>
                <Award className="h-4 w-4 mr-1 text-amber-600" />My certificate<Download className="h-3.5 w-3.5 ml-1" /></Button>
            )}
          </div>
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
            {([["outline", "Outline"], ["people", `Participants (${d.participants.length})`], ["feedback", "Feedback"]] as const).map(([id, label]) => (
              <button key={id} onClick={() => setSub(id)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${sub === id ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600"}`}>{label}</button>
            ))}
          </div>

          {sub === "outline" && (
            <OutlineEditor key={s.outline_updated_at ?? "none"} outline={s} readOnly={s.status === "CANCELLED"}
              onSaveText={async (text) => { await trainerApi.saveOutline(card, token, sessionId, text); load(); }}
              onUpload={async (f) => { await trainerApi.uploadOutline(card, token, sessionId, f); load(); }}
              onDeleteFile={async () => { await trainerApi.deleteOutlineFile(card, token, sessionId); load(); }}
              onDownload={() => save(trainerApi.outlinePath(card, sessionId), s.outline_file_name || "outline", token)} />
          )}

          {sub === "people" && (d.participants.length === 0 ? <Empty>Nobody is booked yet.</Empty> : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase"><tr>
                  <th className="px-3 py-2 text-left">Participant</th><th className="px-3 py-2 text-right">Attend.</th>
                  <th className="px-3 py-2 text-right">Pre</th><th className="px-3 py-2 text-right">Post</th><th className="px-3 py-2 text-center">Status</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {d.participants.map((p) => (
                    <tr key={p.participant_id}>
                      <td className="px-3 py-2"><p className="font-medium text-gray-900">{p.name}</p><p className="text-xs text-gray-400">{p.dept_name}{p.desg_desc ? ` · ${p.desg_desc}` : ""}</p></td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.attend_pct == null ? "—" : `${p.attend_pct}%`}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.pre_score_pct == null ? "—" : `${p.pre_score_pct}%`}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.post_score_pct == null ? "—" : `${p.post_score_pct}%`}</td>
                      <td className="px-3 py-2 text-center"><ParticipantStatusPill status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {sub === "feedback" && <FeedbackPane card={card} token={token} d={d} reload={load} />}
        </div>
      )}
    </Modal>
  );
}

function FeedbackPane({ card, token, d, reload }: Auth & { d: TrainerSessionDetail; reload: () => void }) {
  const [content, setContent] = useState(0);
  const [overall, setOverall] = useState(0);
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const canGive = ["IN_PROGRESS", "COMPLETED"].includes(d.session.status);
  const r = d.participant_ratings;

  async function submit() {
    if (!overall) { alert("Give an overall rating"); return; }
    setSaving(true);
    try {
      await trainerApi.feedback(card, token, d.session.session_id, { rating_content: content || null, rating_overall: overall, comments });
      setContent(0); setOverall(0); setComments("");
      reload();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-gray-50 p-3 text-sm">
        <p className="font-medium text-gray-900 mb-1">What participants said ({r.count} response{r.count === 1 ? "" : "s"})</p>
        {r.count === 0 ? <p className="text-gray-500">No participant feedback yet.</p> : (
          <div className="flex flex-wrap gap-5 text-gray-600">
            <span className="inline-flex items-center gap-1.5">Trainer <Stars value={r.trainer} /></span>
            <span className="inline-flex items-center gap-1.5">Content <Stars value={r.content} /></span>
            <span className="inline-flex items-center gap-1.5">Overall <Stars value={r.overall} /></span>
          </div>
        )}
      </div>
      {canGive ? (
        <div className="rounded-xl border border-gray-100 p-3 space-y-3">
          <p className="font-medium text-gray-900 inline-flex items-center gap-1.5"><MessageSquare className="h-4 w-4 text-indigo-500" />Your feedback on this session</p>
          <StarInput label="Participants' engagement / preparation" value={content} onChange={setContent} />
          <StarInput label="Overall session" value={overall} onChange={setOverall} />
          <TextArea label="Comments for HR" value={comments} onChange={setComments} placeholder="Venue, material, group level, follow-up needed…" />
          <div className="flex justify-end"><Button size="sm" onClick={submit} loading={saving}>Submit feedback</Button></div>
        </div>
      ) : <p className="text-sm text-gray-500">You can give feedback once the session has started.</p>}
      {d.my_feedback.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {d.my_feedback.map((f) => (
            <li key={f.feedback_id} className="py-2">
              <div className="flex items-center gap-2"><Stars value={f.rating_overall} /><span className="text-xs text-gray-400 ml-auto">{f.created_at}</span></div>
              {f.comments && <p className="text-sm text-gray-700 mt-1">{f.comments}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Free slots
// ---------------------------------------------------------------------------

function SlotsTab({ card, token }: Auth) {
  const [items, setItems] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("13:00");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const today = toLocalYmd(new Date());

  const load = useCallback(() => {
    trainerApi.slots(card, token).then((r) => setItems(r.items)).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [card, token]);
  useEffect(load, [load]);

  async function add() {
    if (!date) { setError("Pick a date"); return; }
    setSaving(true);
    setError(null);
    try {
      await trainerApi.addSlot(card, token, { slot_date: date, time_from: from, time_to: to, remarks });
      setRemarks("");
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  async function remove(s: Slot) {
    try { await trainerApi.deleteSlot(card, token, s.slot_id); load(); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  const byDate = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of items ?? []) m.set(s.slot_date, [...(m.get(s.slot_date) ?? []), s]);
    return [...m.entries()];
  }, [items]);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardContent className="py-4 space-y-3">
          <p className="font-semibold text-ink">Add a free slot</p>
          <p className="text-xs text-gray-500">HR sees these when scheduling your sessions.</p>
          <ErrorBox error={error} />
          <Input label="Date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="From" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input label="To" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Input label="Note (optional)" placeholder="e.g. online only" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          <Button className="w-full" onClick={add} loading={saving}><Plus className="h-4 w-4 mr-1" />Add slot</Button>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardContent className="py-4">
          <div className="flex items-center mb-3"><p className="font-semibold text-ink">Upcoming free slots</p>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={load}><RefreshCw className="h-4 w-4" /></Button></div>
          {!items ? <Spinner /> : byDate.length === 0 ? <Empty>No free slots added.</Empty> : (
            <ul className="space-y-3">
              {byDate.map(([d, slots]) => (
                <li key={d}>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">
                    {new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}</p>
                  <div className="flex flex-wrap gap-2">
                    {slots.map((s) => (
                      <span key={s.slot_id} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-sm text-emerald-800">
                        {s.time_from}–{s.time_to}{s.remarks && <span className="text-xs text-emerald-600">· {s.remarks}</span>}
                        <button title="Remove" onClick={() => remove(s)} className="text-emerald-600 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function TestsTab({ card, token }: Auth) {
  const [items, setItems] = useState<TrainerCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<TrainerCourse | null>(null);
  const api = useMemo(() => trainerTestApi(card, token), [card, token]);

  const load = useCallback(() => {
    trainerApi.testCourses(card, token).then((r) => setItems(r.items)).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [card, token]);
  useEffect(load, [load]);

  if (error) return <ErrorBox error={error} />;
  if (!items) return <Spinner />;
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-sm text-gray-500 mb-3">Build the pre-training and post-training tests for the courses you are teaching. The post-test decides who passes.</p>
        {items.length === 0 ? <Empty>You have no upcoming sessions, so there are no tests to prepare.</Empty> : (
          <ul className="divide-y divide-gray-100">
            {items.map((c) => (
              <li key={c.course_id} className="py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0"><p className="font-medium text-gray-900">{c.title}</p>
                  <p className="text-xs text-gray-400">{c.course_code}{c.next_session ? ` · next session ${c.next_session}` : ""}</p></div>
                <Pill tone={c.has_pre_test ? "green" : "gray"}>Pre-test</Pill>
                <Pill tone={c.has_post_test ? "green" : "gray"}>Post-test</Pill>
                <Button size="sm" onClick={() => setOpen(c)}><ListChecks className="h-4 w-4 mr-1" />Edit tests</Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {open && <TestsModal api={api} course={open} onClose={() => { setOpen(null); load(); }} />}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfileTab({ card, token, profile, onSaved }: Auth & { profile: TrainerProfile; onSaved: () => void }) {
  const t = profile.trainer!;
  const [f, setF] = useState({
    expertise: t.expertise, bio: t.bio, qualifications: t.qualifications, phone: t.phone, email: t.email,
    default_rate: t.default_rate != null ? String(t.default_rate) : "", rate_unit: t.rate_unit, is_free: t.is_free,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    setDone(false);
    try {
      await trainerApi.saveProfile(card, token, { ...f, default_rate: f.is_free || !f.default_rate ? null : Number(f.default_rate) });
      setDone(true);
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-4">
        <ErrorBox error={error} />
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <span className="font-semibold text-ink">{t.name}</span><span>· {t.empcode}</span>
          <Pill tone="blue">Internal trainer</Pill><Pill tone={t.is_free ? "green" : "gray"}>{rateText(t)}</Pill>
        </div>
        <Input label="Expertise" placeholder="e.g. Excel, Leadership, Fire safety" value={f.expertise} onChange={(e) => setF({ ...f, expertise: e.target.value })} />
        <TextArea label="About me (shown to HR)" value={f.bio} onChange={(v) => setF({ ...f, bio: v })} rows={4} placeholder="Experience, topics you train on, training style…" />
        <TextArea label="Qualifications & certifications" value={f.qualifications} onChange={(v) => setF({ ...f, qualifications: v })} rows={2} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </div>
        <div className="rounded-xl border border-gray-100 p-3 space-y-3">
          <p className="text-sm font-medium text-gray-700">Training charges</p>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_free} onChange={(e) => setF({ ...f, is_free: e.target.checked })} />I train free of charge</label>
          {!f.is_free && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="My rate" type="number" min={0} value={f.default_rate} onChange={(e) => setF({ ...f, default_rate: e.target.value })} />
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">Charged</label>
                <select className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm" value={f.rate_unit} onChange={(e) => setF({ ...f, rate_unit: e.target.value as RateUnit })}>
                  {(Object.keys(RATE_UNIT_LABEL) as RateUnit[]).map((k) => <option key={k} value={k}>{RATE_UNIT_LABEL[k]}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3">
          {done && <span className="text-sm text-emerald-600">Saved</span>}
          <Button onClick={submit} loading={saving}>Save profile</Button>
        </div>
      </CardContent>
    </Card>
  );
}
