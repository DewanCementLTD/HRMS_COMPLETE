"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Users, RefreshCw, Check, X, UserPlus, History } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import {
  hodApi, type HodRequest, type TeamMember, type Catalog, PARTICIPANT_STATUS_LABEL,
} from "@/services/trainingService";
import {
  Tabs, SignInAgain, RequestStatusPill, ApprovalChain, ErrorBox, Empty, TextArea, Pill,
} from "@/components/training/TrainingUi";
import { RequestFields, emptyDraft, draftBody, type RequestDraft } from "../training/EmployeePanels";

type Tab = "pending" | "all" | "team";

// Training requests from the people who name this user as HOD 1 / HOD 2 on
// their employee record — the same rule as Leave Approvals.
export default function TrainingApprovalsPage() {
  const { user } = useAuth();
  const token = user?.session_token || "";
  const card = user?.card_no || "";

  const [tab, setTab] = useState<Tab>("pending");
  const [data, setData] = useState<{ is_hod: boolean; pending: number; items: HodRequest[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decide, setDecide] = useState<{ r: HodRequest; decision: "approve" | "reject" } | null>(null);
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!card || !token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await hodApi.requests(card, token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [card, token]);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => (data?.items ?? []).filter((r) => tab === "all" || r.my_turn), [data, tab]);

  async function submitDecision() {
    if (!decide) return;
    if (decide.decision === "reject" && !remarks.trim()) { alert("Please give a reason for rejecting"); return; }
    setSaving(true);
    try {
      await hodApi.decide(card, token, decide.r.request_id, decide.decision, remarks.trim() || undefined);
      setDecide(null);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (!user) return null;

  return (
    <div className="animate-fade-in">
      <PageHeader title="Training Approvals" subtitle="Approve your team's training requests and nominate team members"
        actions={token ? <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh</Button> : undefined} />
      {!token ? <Card><SignInAgain /></Card> : (
        <>
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { id: "pending", label: "Waiting for me", icon: ClipboardCheck, badge: data?.pending },
            { id: "all", label: "All requests", icon: History },
            { id: "team", label: "My Team", icon: Users },
          ]} />
          <ErrorBox error={error} />
          {tab === "team" ? <TeamPanel card={card} token={token} onNominated={load} /> : (
            <Card>
              <CardContent className="py-4">
                {loading && !data ? <Spinner /> : data && !data.is_hod ? (
                  <Empty>You are not set as HOD for any employee.</Empty>
                ) : items.length === 0 ? (
                  <Empty>{tab === "pending" ? "Nothing waiting for your approval." : "No training requests from your team yet."}</Empty>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {items.map((r) => (
                      <div key={r.request_id} className="py-3 flex flex-col md:flex-row md:items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-gray-900">{r.emp_name}</p>
                            <span className="text-xs text-gray-400">{r.empcode} · {r.dept_name}</span>
                            <RequestStatusPill status={r.status} />
                            {r.priority === "HIGH" && <Pill tone="red">High priority</Pill>}
                          </div>
                          <p className="text-sm text-indigo-700 font-medium mt-1">{r.title}{r.course_code ? ` (${r.course_code})` : " — not in catalog"}</p>
                          {r.reason && <p className="text-sm text-gray-600 mt-0.5">{r.reason}</p>}
                          <p className="text-xs text-gray-400 mt-1">
                            #{r.request_id} · {r.created_at}
                            {r.preferred_from && ` · preferred ${r.preferred_from}${r.preferred_to ? ` → ${r.preferred_to}` : ""}`}
                            {r.source === "HOD" && ` · nominated by ${r.requested_by_name}`}
                          </p>
                          <div className="mt-2"><ApprovalChain r={r} /></div>
                        </div>
                        {r.my_turn && (
                          <div className="flex gap-2 shrink-0">
                            <Button size="sm" onClick={() => { setRemarks(""); setDecide({ r, decision: "approve" }); }}>
                              <Check className="h-4 w-4 mr-1" />Approve</Button>
                            <Button size="sm" variant="danger" onClick={() => { setRemarks(""); setDecide({ r, decision: "reject" }); }}>
                              <X className="h-4 w-4 mr-1" />Reject</Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {decide && (
        <Modal size="sm" title={decide.decision === "approve" ? "Approve training request" : "Reject training request"}
          subtitle={`${decide.r.emp_name} · ${decide.r.title}`} onClose={() => setDecide(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setDecide(null)}>Cancel</Button>
            <Button variant={decide.decision === "approve" ? "primary" : "danger"} onClick={submitDecision} loading={saving}>
              {decide.decision === "approve" ? "Approve" : "Reject"}
            </Button>
          </>}>
          <TextArea label={decide.decision === "approve" ? "Remarks (optional)" : "Reason for rejecting"} value={remarks} onChange={setRemarks} />
        </Modal>
      )}
    </div>
  );
}

function TeamPanel({ card, token, onNominated }: { card: string; token: string; onNominated: () => void }) {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nominate, setNominate] = useState<{ m: TeamMember; draft: RequestDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ m: TeamMember; items: Awaited<ReturnType<typeof hodApi.member>>["items"] | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([hodApi.team(card, token), hodApi.catalog(card, token)]);
      setTeam(t.items);
      setCatalog(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [card, token]);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    if (!nominate) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await hodApi.nominate(card, token, { empcode: nominate.m.empcode, ...draftBody(nominate.draft) });
      setNominate(null);
      alert(`Nominated — ${res.status === "PENDING_HR" ? "sent to HR" : "sent to HOD 2"} for approval.`);
      load();
      onNominated();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function openHistory(m: TeamMember) {
    setHistory({ m, items: null });
    try {
      const r = await hodApi.member(card, token, m.empcode);
      setHistory({ m, items: r.items });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
      setHistory(null);
    }
  }

  if (error) return <ErrorBox error={error} />;
  if (!team) return <Spinner />;

  return (
    <Card>
      <CardContent className="py-4">
        {team.length === 0 ? <Empty>No active employees name you as their HOD.</Empty> : (
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Employee</th>
                  <th className="px-3 py-2 text-left">Department</th>
                  <th className="px-3 py-2 text-center">Completed</th>
                  <th className="px-3 py-2 text-center">Upcoming</th>
                  <th className="px-3 py-2 text-center">Open requests</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {team.map((m) => (
                  <tr key={m.empcode} className="hover:bg-gray-50/60">
                    <td className="px-3 py-2"><p className="font-medium text-gray-900">{m.name}</p><p className="text-xs text-gray-400">{m.empcode} · HOD {m.my_step}</p></td>
                    <td className="px-3 py-2 text-gray-600">{m.dept_name}<p className="text-xs text-gray-400">{m.desg_desc}</p></td>
                    <td className="px-3 py-2 text-center tabular-nums">{m.completed}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{m.upcoming}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{m.open_requests}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button title="Training history" onClick={() => openHistory(m)} className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100"><History className="h-4 w-4" /></button>
                        <Button size="sm" variant="secondary" onClick={() => { setFormError(null); setNominate({ m, draft: emptyDraft() }); }}>
                          <UserPlus className="h-4 w-4 mr-1" />Nominate</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {nominate && catalog && (
        <Modal title={`Nominate ${nominate.m.name}`} subtitle="Counts as your approval; it then goes on for the remaining approvals." onClose={() => setNominate(null)}
          footer={<><Button variant="secondary" onClick={() => setNominate(null)}>Cancel</Button><Button onClick={submit} loading={saving}>Nominate</Button></>}>
          <ErrorBox error={formError} />
          <div className={formError ? "mt-3" : ""}>
            <RequestFields draft={nominate.draft} setDraft={(d) => setNominate({ ...nominate, draft: d })} courses={catalog.courses} />
          </div>
        </Modal>
      )}

      {history && (
        <Modal title={`Training history — ${history.m.name}`} onClose={() => setHistory(null)}>
          {!history.items ? <Spinner /> : history.items.length === 0 ? <Empty>No trainings yet.</Empty> : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-gray-500"><tr>
                <th className="py-1.5 text-left">Course</th><th className="text-left">Dates</th><th className="text-left">Result</th>
                <th className="text-right">Attend.</th><th className="text-right">Pre / Post</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {history.items.map((h, i) => (
                  <tr key={i}>
                    <td className="py-1.5">{h.course_title}<p className="text-xs text-gray-400">{h.session_code}{h.cert_no ? ` · ${h.cert_no}` : ""}</p></td>
                    <td className="text-gray-600">{h.start_date}</td>
                    <td>{PARTICIPANT_STATUS_LABEL[h.status]}</td>
                    <td className="text-right tabular-nums">{h.attend_pct == null ? "—" : `${h.attend_pct}%`}</td>
                    <td className="text-right tabular-nums">{h.pre_score_pct ?? "—"} / {h.post_score_pct ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </Card>
  );
}
