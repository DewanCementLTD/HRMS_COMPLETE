"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Check, X, History, CalendarPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import {
  hrApi, REQUEST_STATUS_LABEL, type Hr, type TrainingRequest, type Session, type Course, type RequestStatus,
} from "@/services/trainingService";
import { RequestStatusPill, ApprovalChain, ErrorBox, Empty, TextArea, Pill } from "@/components/training/TrainingUi";

const FILTERS: { value: string; label: string }[] = [
  { value: "OPEN", label: "Open (all pending + to book)" },
  { value: "PENDING_HR", label: REQUEST_STATUS_LABEL.PENDING_HR },
  { value: "APPROVED", label: REQUEST_STATUS_LABEL.APPROVED },
  ...(["PENDING_HOD1", "PENDING_HOD2", "BOOKED", "COMPLETED", "REJECTED", "CANCELLED"] as RequestStatus[]).map((s) => ({ value: s, label: REQUEST_STATUS_LABEL[s] })),
  { value: "", label: "All" },
];

export function RequestsPanel({ h, onOpenSession }: { h: Hr; onOpenSession: (id: number) => void }) {
  const [status, setStatus] = useState("OPEN");
  const [items, setItems] = useState<TrainingRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [act, setAct] = useState<{ r: TrainingRequest; decision: "approve" | "reject" } | null>(null);
  const [history, setHistory] = useState<{ r: TrainingRequest; rows: Awaited<ReturnType<typeof hrApi.history>>["items"] | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await hrApi.requests(h, status || undefined)).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [h, status]);
  useEffect(() => { load(); }, [load]);

  async function openHistory(r: TrainingRequest) {
    setHistory({ r, rows: null });
    try { setHistory({ r, rows: (await hrApi.history(h, r.request_id)).items }); } catch (e) { alert(e instanceof Error ? e.message : "Failed"); setHistory(null); }
  }

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="w-64">
            <select className="w-full px-3 py-2 rounded-xl border border-gray-300 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <p className="text-sm text-slate-500">{items.length} request(s)</p>
          <Button variant="secondary" size="sm" className="ml-auto" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        </div>
        <ErrorBox error={error} />
        {loading && !items.length ? <Spinner /> : items.length === 0 ? <Empty>No requests here.</Empty> : (
          <div className="divide-y divide-gray-100">
            {items.map((r) => (
              <div key={r.request_id} className="py-3 flex flex-col lg:flex-row lg:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-900">{r.emp_name}</p>
                    <span className="text-xs text-gray-400">{r.empcode} · {r.dept_name}{r.desg_desc ? ` · ${r.desg_desc}` : ""}</span>
                    <RequestStatusPill status={r.status} />
                    {r.priority === "HIGH" && <Pill tone="red">High priority</Pill>}
                    {r.source === "HOD" && <Pill tone="indigo">Nominated by {r.requested_by_name}</Pill>}
                    {r.source === "APPRAISAL" && <Pill tone="amber">From appraisal</Pill>}
                  </div>
                  <p className="text-sm font-medium mt-1 text-indigo-700">{r.title}{r.course_code ? ` (${r.course_code})` : <span className="text-amber-700"> — not in catalog</span>}</p>
                  {r.reason && <p className="text-sm text-gray-600 mt-0.5">{r.reason}</p>}
                  <p className="text-xs text-gray-400 mt-1">#{r.request_id} · {r.created_at}
                    {r.preferred_from && ` · preferred ${r.preferred_from}${r.preferred_to ? ` → ${r.preferred_to}` : ""}`}</p>
                  <div className="mt-2"><ApprovalChain r={r} /></div>
                  {r.session_id && (
                    <button onClick={() => onOpenSession(r.session_id!)} className="mt-1 text-xs text-emerald-700 hover:underline">
                      Booked in {r.session_code} · {r.session_start} → {r.session_end}</button>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button title="History" onClick={() => openHistory(r)} className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100"><History className="h-4 w-4" /></button>
                  {["PENDING_HR", "APPROVED"].includes(r.status) && (
                    <>
                      <Button size="sm" onClick={() => setAct({ r, decision: "approve" })}>
                        {r.status === "APPROVED" ? <><CalendarPlus className="h-4 w-4 mr-1" />Book</> : <><Check className="h-4 w-4 mr-1" />Approve / book</>}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setAct({ r, decision: "reject" })}><X className="h-4 w-4 mr-1" />Reject</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {act && <DecisionModal h={h} r={act.r} decision={act.decision} onClose={(changed) => { setAct(null); if (changed) load(); }} />}
      {history && (
        <Modal size="sm" title={`Request #${history.r.request_id} — history`} onClose={() => setHistory(null)}>
          {!history.rows ? <Spinner /> : history.rows.length === 0 ? <Empty>No history.</Empty> : (
            <ol className="space-y-2">
              {history.rows.map((x, i) => {
                let remarks = "";
                try { remarks = (JSON.parse(x.details || "{}") as { remarks?: string }).remarks ?? ""; } catch { /* plain text */ }
                return (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-gray-900">{x.action.replace(/_/g, " ").toLowerCase()}</span>
                    <span className="text-gray-500"> · {x.actor_name || x.actor} · {x.at}</span>
                    {remarks && <p className="text-xs text-gray-500 italic">“{remarks}”</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </Modal>
      )}
    </Card>
  );
}

function DecisionModal({ h, r, decision, onClose }: { h: Hr; r: TrainingRequest; decision: "approve" | "reject"; onClose: (changed: boolean) => void }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string>(r.course_id ? String(r.course_id) : "");
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (decision !== "approve") return;
    hrApi.courses(h, true).then((c) => setCourses(c.items)).catch(() => {});
  }, [h, decision]);

  useEffect(() => {
    if (decision !== "approve") return;
    setSessions(null);
    setSessionId("");
    if (!courseId) { setSessions([]); return; }
    hrApi.bookable(h, Number(courseId)).then((s) => setSessions(s.items)).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [h, courseId, decision]);

  async function save() {
    if (decision === "reject" && !remarks.trim()) { setError("Please give a reason for rejecting"); return; }
    setSaving(true);
    setError(null);
    try {
      await hrApi.decide(h, r.request_id, {
        decision, remarks: remarks.trim() || undefined,
        session_id: sessionId ? Number(sessionId) : null,
        course_id: courseId && Number(courseId) !== r.course_id ? Number(courseId) : null,
      });
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={decision === "approve" ? "Approve & book training" : "Reject training request"}
      subtitle={`${r.emp_name} (${r.empcode}) · ${r.title}`} onClose={() => onClose(false)}
      footer={<>
        <Button variant="secondary" onClick={() => onClose(false)}>Cancel</Button>
        <Button variant={decision === "approve" ? "primary" : "danger"} onClick={save} loading={saving}>
          {decision === "reject" ? "Reject" : sessionId ? "Approve & book" : "Approve (book later)"}
        </Button>
      </>}>
      <div className="space-y-4">
        <ErrorBox error={error} />
        {decision === "approve" && (
          <>
            <Select label={r.course_id ? "Course" : "Map to a catalog course"} value={courseId} onChange={(e) => setCourseId(e.target.value)}
              options={courses.map((c) => ({ value: c.course_id, label: `${c.title} (${c.course_code})` }))} />
            {!r.course_id && !courseId && <p className="text-xs text-amber-700 -mt-2">Requested: “{r.requested_topic}”. Add it to the catalog first if no course fits.</p>}
            {courseId && (
              sessions === null ? <Spinner /> : sessions.length === 0 ? (
                <p className="text-sm text-gray-500">No open session for this course. Approve now and book later, or create a session in the Sessions tab.</p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-gray-700">Book into session (optional)</p>
                  <label className="flex items-center gap-2 text-sm py-1"><input type="radio" name="ses" checked={!sessionId} onChange={() => setSessionId("")} />Don&apos;t book yet</label>
                  {sessions.map((s) => (
                    <label key={s.session_id} className={`flex items-center gap-2 text-sm py-1 ${s.seats_left <= 0 ? "opacity-50" : ""}`}>
                      <input type="radio" name="ses" disabled={s.seats_left <= 0} checked={sessionId === String(s.session_id)} onChange={() => setSessionId(String(s.session_id))} />
                      <span><b>{s.session_code}</b> · {s.start_date}{s.end_date !== s.start_date ? ` → ${s.end_date}` : ""} · {s.trainer_name || "no trainer"} · {s.mode === "ONLINE" ? "Online" : s.venue || "Physical"}
                        <span className="text-gray-400"> · {s.seats_left} seat(s) left</span></span>
                    </label>
                  ))}
                </div>
              )
            )}
          </>
        )}
        <TextArea label={decision === "approve" ? "Remarks (optional)" : "Reason for rejecting"} value={remarks} onChange={setRemarks} />
      </div>
    </Modal>
  );
}
