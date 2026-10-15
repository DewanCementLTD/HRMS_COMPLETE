"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, Send, BookOpen, Monitor, MapPin, CalendarDays, Clock, Award, ClipboardCheck, MessageSquare,
  Download, RefreshCw, Link as LinkIcon, PlusCircle, Map as MapIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import {
  meApi, downloadPdf, TYPE_LABEL, MODE_LABEL,
  type Catalog, type CatalogCourse, type TrainingRequest, type MyTraining, type Priority,
} from "@/services/trainingService";
import {
  Pill, RequestStatusPill, ParticipantStatusPill, SessionStatusPill, ApprovalChain, ErrorBox, Empty, TextArea, StarInput,
} from "@/components/training/TrainingUi";
import { TestRunner } from "./TestRunner";
import { OutlineView } from "@/components/training/OutlineEditor";

type Auth = { card: string; token: string };

const PRIORITIES = [
  { value: "LOW", label: "Low" }, { value: "MEDIUM", label: "Medium" }, { value: "HIGH", label: "High" },
];

// ---------------------------------------------------------------------------
// Request form (shared by the employee page and HOD nominations)
// ---------------------------------------------------------------------------

export interface RequestDraft {
  course_id: number | null; requested_topic: string; reason: string; priority: Priority;
  preferred_from: string; preferred_to: string;
}
export const emptyDraft = (course?: CatalogCourse | null): RequestDraft => ({
  course_id: course?.course_id ?? null, requested_topic: "", reason: "", priority: "MEDIUM", preferred_from: "", preferred_to: "",
});
export const draftBody = (d: RequestDraft) => ({
  course_id: d.course_id, requested_topic: d.course_id ? null : d.requested_topic.trim(), reason: d.reason.trim(),
  priority: d.priority, preferred_from: d.preferred_from || null, preferred_to: d.preferred_to || null,
});

export function RequestFields({ draft, setDraft, courses }: {
  draft: RequestDraft; setDraft: (d: RequestDraft) => void; courses: CatalogCourse[];
}) {
  return (
    <div className="space-y-4">
      <Select label="Course" value={draft.course_id ?? ""}
        onChange={(e) => setDraft({ ...draft, course_id: e.target.value ? Number(e.target.value) : null })}
        options={courses.map((c) => ({ value: c.course_id, label: `${c.title} (${c.course_code})` }))} />
      {!draft.course_id && (
        <Input label="Training needed (not in the catalog)" placeholder="e.g. Advanced Excel, Oracle ERP basics"
          value={draft.requested_topic} onChange={(e) => setDraft({ ...draft, requested_topic: e.target.value })} />
      )}
      <TextArea label="Why is this training needed?" value={draft.reason} onChange={(v) => setDraft({ ...draft, reason: v })}
        placeholder="How it helps in the current role, skill gap, upcoming project…" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Priority" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: (e.target.value || "MEDIUM") as Priority })}
          options={PRIORITIES} />
        <Input label="Preferred from" type="date" value={draft.preferred_from} onChange={(e) => setDraft({ ...draft, preferred_from: e.target.value })} />
        <Input label="Preferred to" type="date" value={draft.preferred_to} onChange={(e) => setDraft({ ...draft, preferred_to: e.target.value })} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalog + request
// ---------------------------------------------------------------------------

export function RequestTrainingPanel({ card, token, onSubmitted }: Auth & { onSubmitted: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    meApi.catalog(card, token).then(setCatalog).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [card, token]);

  const courses = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = catalog?.courses ?? [];
    return q ? all.filter((c) => `${c.title} ${c.course_code} ${c.category_name} ${c.description}`.toLowerCase().includes(q)) : all;
  }, [catalog, query]);

  async function submit() {
    if (!draft) return;
    setSaving(true);
    setFormError(null);
    try {
      await meApi.createRequest(card, token, draftBody(draft));
      setDraft(null);
      onSubmitted();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorBox error={error} />;
  if (!catalog) return <Spinner />;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 w-full sm:w-72">
            <Search className="h-4 w-4 text-gray-400" />
            <input className="bg-transparent text-sm outline-none w-full" placeholder="Search courses…"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <p className="text-xs text-slate-500">
            {catalog.employee.has_hod ? "Requests go to your HOD first, then HR." : "Requests go straight to HR."}
          </p>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => { setFormError(null); setDraft(emptyDraft()); }}>
            <PlusCircle className="h-4 w-4 mr-1" /> Request something not listed
          </Button>
        </CardContent>
      </Card>

      {courses.length === 0 ? (
        <Card><Empty>{catalog.courses.length ? "No course matches your search." : "HR has not published any courses yet. You can still request a training that is not listed."}</Empty></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((c) => (
            <Card key={c.course_id} className="flex flex-col">
              <CardContent className="py-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    <Pill tone="indigo">{TYPE_LABEL[c.training_type]}</Pill>
                    {c.cert_required && <Pill tone="green">Certificate</Pill>}
                  </div>
                </div>
                <p className="mt-3 font-semibold text-ink leading-snug">{c.title}</p>
                <p className="text-xs text-gray-400">{c.course_code}{c.category_name ? ` · ${c.category_name}` : ""}</p>
                {c.description && <p className="mt-2 text-sm text-gray-600 line-clamp-3">{c.description}</p>}
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1">{c.default_mode === "ONLINE" ? <Monitor className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}{MODE_LABEL[c.default_mode]}</span>
                  {c.duration_hrs ? <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{c.duration_hrs} hrs</span> : null}
                  {c.next_session && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Next: {c.next_session}</span>}
                </div>
                <div className="mt-auto pt-4">
                  <Button size="sm" className="w-full" onClick={() => { setFormError(null); setDraft(emptyDraft(c)); }}>
                    <Send className="h-4 w-4 mr-1" /> Request this training
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {draft && (
        <Modal title="Request training" subtitle="Your request will be reviewed before HR books a session." onClose={() => setDraft(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={submit} loading={saving}>Submit request</Button>
          </>}>
          <ErrorBox error={formError} />
          <div className={formError ? "mt-3" : ""}>
            <RequestFields draft={draft} setDraft={setDraft} courses={catalog.courses} />
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My requests
// ---------------------------------------------------------------------------

export function MyRequestsPanel({ card, token }: Auth) {
  const [items, setItems] = useState<TrainingRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await meApi.requests(card, token)).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [card, token]);
  useEffect(() => { load(); }, [load]);

  async function cancel(r: TrainingRequest) {
    if (!confirm(`Cancel your request for "${r.title}"?`)) return;
    try {
      await meApi.cancelRequest(card, token, r.request_id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center mb-3">
          <p className="text-sm text-slate-500">{items.length} request(s)</p>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
        <ErrorBox error={error} />
        {loading && !items.length ? <Spinner /> : items.length === 0 ? <Empty>You have not requested any training yet.</Empty> : (
          <div className="divide-y divide-gray-100">
            {items.map((r) => (
              <div key={r.request_id} className="py-3 flex flex-col sm:flex-row sm:items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-gray-900">{r.title}</p>
                    <RequestStatusPill status={r.status} />
                    {r.source === "HOD" && <Pill tone="indigo">Nominated by {r.requested_by_name || "HOD"}</Pill>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">#{r.request_id} · requested {r.created_at} · priority {r.priority.toLowerCase()}</p>
                  {r.reason && <p className="text-sm text-gray-600 mt-1">{r.reason}</p>}
                  <div className="mt-2"><ApprovalChain r={r} /></div>
                  {[r.hod1?.remarks, r.hod2?.remarks, r.hr.remarks].filter(Boolean).map((m, i) => (
                    <p key={i} className="text-xs text-gray-500 mt-1 italic">“{m}”</p>
                  ))}
                  {r.session_code && (
                    <p className="text-xs text-emerald-700 mt-1">Booked: {r.session_code} · {r.session_start} → {r.session_end}</p>
                  )}
                </div>
                {["PENDING_HOD1", "PENDING_HOD2", "PENDING_HR"].includes(r.status) && (
                  <Button variant="ghost" size="sm" className="text-red-600" onClick={() => cancel(r)}>Cancel</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// My trainings
// ---------------------------------------------------------------------------

function FeedbackModal({ card, token, t, onClose }: Auth & { t: MyTraining; onClose: (saved: boolean) => void }) {
  const [content, setContent] = useState(0);
  const [trainer, setTrainer] = useState(0);
  const [overall, setOverall] = useState(0);
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!overall) { setError("Give an overall rating"); return; }
    setSaving(true);
    setError(null);
    try {
      await meApi.feedback(card, token, t.participant_id, {
        rating_content: content || null, rating_trainer: trainer || null, rating_overall: overall, comments,
      });
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal size="sm" title="Training feedback" subtitle={t.course_title} onClose={() => onClose(false)}
      footer={<><Button variant="secondary" onClick={() => onClose(false)}>Cancel</Button><Button onClick={save} loading={saving}>Submit</Button></>}>
      <div className="space-y-3">
        <ErrorBox error={error} />
        <StarInput label="Course content" value={content} onChange={setContent} />
        <StarInput label="Trainer" value={trainer} onChange={setTrainer} />
        <StarInput label="Overall" value={overall} onChange={setOverall} />
        <TextArea label="Comments" value={comments} onChange={setComments} placeholder="What worked, what could be better…" />
      </div>
    </Modal>
  );
}

export function MyTrainingsPanel({ card, token }: Auth) {
  const [items, setItems] = useState<MyTraining[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ pid: number; kind: "PRE" | "POST" } | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<MyTraining | null>(null);
  const [outlineFor, setOutlineFor] = useState<MyTraining | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await meApi.trainings(card, token)).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [card, token]);
  useEffect(() => { load(); }, [load]);

  async function certificate(t: MyTraining) {
    try {
      await downloadPdf(meApi.certificatePath(card, t.participant_id), `certificate_${t.cert_no}.pdf`, token);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Download failed");
    }
  }

  const upcoming = items.filter((t) => ["PLANNED", "OPEN", "IN_PROGRESS"].includes(t.session_status));
  const past = items.filter((t) => !["PLANNED", "OPEN", "IN_PROGRESS"].includes(t.session_status));

  const renderCard = (t: MyTraining) => (
    <Card key={t.participant_id}>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-ink">{t.course_title}</p>
            <p className="text-xs text-gray-400">{t.session_code} · {TYPE_LABEL[t.training_type]}{t.trainer_name ? ` · Trainer: ${t.trainer_name}` : ""}</p>
          </div>
          <SessionStatusPill status={t.session_status} />
          {t.session_status === "COMPLETED" && <ParticipantStatusPill status={t.status} />}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 text-sm text-gray-600">
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-gray-400" />
            {t.start_date === t.end_date ? t.start_date : `${t.start_date} → ${t.end_date}`}</span>
          {(t.time_from || t.time_to) && <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-gray-400" />{t.time_from}–{t.time_to}</span>}
          <span className="inline-flex items-center gap-1.5 min-w-0">
            {t.mode === "ONLINE" ? <Monitor className="h-4 w-4 text-gray-400" /> : <MapPin className="h-4 w-4 text-gray-400" />}
            {t.mode === "ONLINE" && t.online_link
              ? <a href={t.online_link} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-1 truncate"><LinkIcon className="h-3.5 w-3.5" />Join link</a>
              : <span className="truncate">{t.venue || MODE_LABEL[t.mode]}</span>}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
          <span>Attendance: <b className="text-ink">{t.attend_pct == null ? "—" : `${t.attend_pct}%`}</b> <span className="text-gray-400">(need {t.min_attend_pct}%)</span></span>
          {t.has_pre_test && <span>Pre-test: <b className="text-ink">{t.pre_score_pct == null ? "—" : `${t.pre_score_pct}%`}</b></span>}
          {t.has_post_test && <span>Post-test: <b className="text-ink">{t.post_score_pct == null ? "—" : `${t.post_score_pct}%`}</b> <span className="text-gray-400">(pass {t.pass_pct}%)</span></span>}
          {t.hours_attended > 0 && <span>Hours: <b className="text-ink">{t.hours_attended}</b></span>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(t.outline_text || t.outline_file_name) && (
            <Button size="sm" variant="secondary" onClick={() => setOutlineFor(t)}><MapIcon className="h-4 w-4 mr-1 text-indigo-600" />Course outline</Button>
          )}
          {t.can_take_pre && <Button size="sm" variant="secondary" onClick={() => setTest({ pid: t.participant_id, kind: "PRE" })}><ClipboardCheck className="h-4 w-4 mr-1" />Take pre-test</Button>}
          {t.can_take_post && <Button size="sm" onClick={() => setTest({ pid: t.participant_id, kind: "POST" })}>
            <ClipboardCheck className="h-4 w-4 mr-1" />Take post-test{t.post_attempts_left > 1 ? ` (${t.post_attempts_left} attempts)` : ""}</Button>}
          {t.can_give_feedback && <Button size="sm" variant="secondary" onClick={() => setFeedbackFor(t)}><MessageSquare className="h-4 w-4 mr-1" />Give feedback</Button>}
          {t.feedback_given && <Pill tone="green">Feedback given</Pill>}
          {t.cert_no && <Button size="sm" variant="secondary" onClick={() => certificate(t)}><Award className="h-4 w-4 mr-1 text-amber-600" />Certificate<Download className="h-3.5 w-3.5 ml-1" /></Button>}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-5">
      <ErrorBox error={error} />
      {loading && !items.length ? <Spinner /> : items.length === 0 ? (
        <Card><Empty>You are not booked on any training yet.</Empty></Card>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Upcoming & ongoing</h3>
              <div className="grid gap-4 lg:grid-cols-2">{upcoming.map(renderCard)}</div>
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Training history</h3>
              <div className="grid gap-4 lg:grid-cols-2">{past.map(renderCard)}</div>
            </section>
          )}
        </>
      )}
      {test && <TestRunner card={card} token={token} participantId={test.pid} kind={test.kind}
        onClose={() => { setTest(null); load(); }} />}
      {outlineFor && (
        <Modal title="Course outline" subtitle={`${outlineFor.course_title} · ${outlineFor.trainer_name || "Trainer"}`} onClose={() => setOutlineFor(null)}>
          <OutlineView outline={outlineFor} onDownload={() => downloadPdf(meApi.outlinePath(card, outlineFor.session_id), outlineFor.outline_file_name || "outline", token)
            .catch((e) => alert(e instanceof Error ? e.message : "Download failed"))} />
        </Modal>
      )}
      {feedbackFor && <FeedbackModal card={card} token={token} t={feedbackFor} onClose={(saved) => { setFeedbackFor(null); if (saved) load(); }} />}
    </div>
  );
}
