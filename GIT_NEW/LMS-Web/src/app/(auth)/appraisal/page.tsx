"use client";

import { useCallback, useEffect, useState } from "react";
import { Target, TrendingUp, ArrowLeft, Send, RefreshCw, Award, Printer, PenLine } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { Tabs, SignInAgain, ErrorBox, Empty, Pill } from "@/components/training/TrainingUi";
import {
  StagePill, StageTracker, ScoreStrip, ObjectivesEditor, SheetTable, SheetHeader, Trail, EvidenceList, TrendChart, DecisionModal,
  GradeBadge, printTaskSheet,
} from "@/components/appraisal/AppraisalUi";
import { MidYearForm, RecommendationsView } from "@/components/appraisal/AppraisalForms";
import { MyCaseForm, CaseStatusPill } from "@/components/appraisal/PromotionCase";
import {
  apprMeApi, CYCLE_TYPE_LABEL, PHASE_LABEL, scoreText, type Appraisal, type MyAppraisalRow, type History, type MyCase,
} from "@/services/appraisalService";

type Tab = "appraisals" | "promotion" | "history";

// The employee's own appraisal (DCL task sheet) and promotion self-assessment.
// Every call carries the signed session token, so the API only returns and
// changes the token holder's data. Agreed ratings and the grade stay hidden
// until HR finalises the appraisal.
export default function MyAppraisalPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("appraisals");
  const [open, setOpen] = useState<number | null>(null);
  const [cases, setCases] = useState<{ case_id: number; cycle_name: string; status: MyCase["status"]; status_label: string; prop_desg_desc: string; my_turn: boolean }[]>([]);
  const token = user?.session_token || "";
  const card = user?.card_no || "";
  useEffect(() => {
    if (!card || !token) return;
    apprMeApi.cases(card, token).then((r) => setCases(r.items)).catch(() => setCases([]));
  }, [card, token]);
  if (!user) return null;

  return (
    <div className="animate-fade-in">
      <PageHeader title="My Appraisal" subtitle="Employee Task Setting & Performance Appraisal — objectives, mid-year review and year-end result" />
      {!token ? <Card><SignInAgain /></Card> : open ? (
        <AppraisalDetail card={card} token={token} id={open} companyName={user.selected_company?.name} onBack={() => setOpen(null)} />
      ) : (
        <>
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { id: "appraisals", label: "My Appraisals", icon: Target },
            ...(cases.length ? [{ id: "promotion" as Tab, label: "Promotion evaluation", icon: Award, badge: cases.filter((c) => c.my_turn).length }] : []),
            { id: "history", label: "History & Development", icon: TrendingUp },
          ]} />
          {tab === "appraisals" && <MyList card={card} token={token} onOpen={setOpen} />}
          {tab === "promotion" && <MyCases card={card} token={token} cases={cases} />}
          {tab === "history" && <MyHistory card={card} token={token} />}
        </>
      )}
    </div>
  );
}

function MyList({ card, token, onOpen }: { card: string; token: string; onOpen: (id: number) => void }) {
  const [items, setItems] = useState<MyAppraisalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apprMeApi.list(card, token).then((r) => setItems(r.items)).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [card, token]);
  if (error) return <ErrorBox error={error} />;
  if (!items) return <Spinner />;
  if (!items.length) return <Card><Empty>No appraisal has been started for you yet.</Empty></Card>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((r) => (
        <Card key={r.appraisal_id} onClick={() => onOpen(r.appraisal_id)}>
          <CardContent className="py-4 space-y-2 cursor-pointer">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-ink">{r.cycle.name}</p>
              <span className="text-xs text-gray-400">{CYCLE_TYPE_LABEL[r.cycle.cycle_type]} · {r.cycle.period_from} → {r.cycle.period_to}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StagePill stage={r.stage} />
              {r.my_turn && <Pill tone="red">Action needed</Pill>}
              {r.cycle.status === "CLOSED" && <Pill>Cycle closed</Pill>}
              {r.final_rating && <span className="ml-auto text-sm inline-flex items-center gap-1.5">Grade <GradeBadge g={r.final_rating} /> <span className="text-gray-400 tabular-nums">{scoreText(r.final_score)}</span></span>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AppraisalDetail({ card, token, id, companyName, onBack }: { card: string; token: string; id: number; companyName?: string; onBack: () => void }) {
  const [a, setA] = useState<Appraisal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"objectives" | "ack" | null>(null);

  const load = useCallback(() => {
    apprMeApi.get(card, token, id).then(setA).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [card, token, id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorBox error={error} />;
  if (!a) return <Spinner />;
  const done = a.stage === "COMPLETED";
  const lastReturn = [...a.approvals].reverse().find((s) => s.action === "RETURN");
  const returnedToMe = lastReturn && lastReturn.next_stage === a.stage && ["OBJ_SETTING", "MIDYEAR"].includes(a.stage) ? lastReturn : null;
  const pastObjectives = !["OBJ_SETTING", "OBJ_REVIEW"].includes(a.stage);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <p className="font-semibold text-ink">{a.cycle.name}</p>
        <StagePill stage={a.stage} />
        <Pill>Phase: {PHASE_LABEL[a.cycle.phase]}</Pill>
        <div className="ml-auto flex gap-1">
          <Button variant="secondary" size="sm" onClick={() => printTaskSheet(a, companyName)}><Printer className="h-4 w-4 mr-1" />Print</Button>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      <Card><CardContent className="py-4 space-y-3">
        <SheetHeader a={a} />
        <StageTracker a={a} />
        {returnedToMe && (
          <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-100 text-sm text-amber-800">
            Returned by <b>{returnedToMe.actor_name}</b>: “{returnedToMe.remarks}”
          </div>
        )}
        {a.midyear_waiting_phase && <p className="text-sm text-blue-700">Your objectives are approved and locked. HR will open the mid-year review.</p>}
        {done && <ScoreStrip a={a} internal={false} />}
      </CardContent></Card>

      {!pastObjectives && (
        <Card><CardContent className="py-4 space-y-3">
          <ObjectivesEditor a={a} editable={!!a.can_edit_rows}
            onSave={(body, gid) => apprMeApi.saveRow(card, token, id, body, gid).then(load)}
            onDelete={(gid) => apprMeApi.deleteRow(card, token, id, gid).then(load)} />
          {a.can_edit_rows && (
            <div className="flex justify-end">
              <Button onClick={() => setConfirm("objectives")} disabled={a.weight_problems.length > 0}>
                <Send className="h-4 w-4 mr-1" />Submit objectives to {a.line_manager_name ?? "your line manager"}</Button>
            </div>
          )}
          {a.stage === "OBJ_REVIEW" && <p className="text-sm text-gray-500">Waiting for {a.line_manager_name ?? "your line manager"} to approve your objectives. Once approved they are locked.</p>}
        </CardContent></Card>
      )}

      {a.can_midyear && (
        <Card><CardContent className="py-4 space-y-3">
          <p className="font-semibold text-ink">Mid-year review — your progress and self rating</p>
          <MidYearForm a={a}
            onSave={(rows) => apprMeApi.saveMidYear(card, token, id, rows)}
            onSubmit={() => apprMeApi.submitMidYear(card, token, id).then(load)} />
        </CardContent></Card>
      )}

      {pastObjectives && !a.can_midyear && (
        <Card><CardContent className="py-4 space-y-3">
          <p className="font-semibold text-ink">{done ? "Final task sheet" : "Your task sheet"}</p>
          <SheetTable rows={a.rows} show={{ progress: true, self: true, agreed: done }} />
          {a.mid_comments && <p className="text-sm"><span className="text-gray-500">Line manager&apos;s mid-year comments: </span>{a.mid_comments}</p>}
          {done && <RecommendationsView a={a} showPay={false} />}
          {a.can_acknowledge && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-indigo-50">
              <span className="text-sm text-indigo-800">Your appraisal is final. Please sign it off (final year-end approval).</span>
              <Button className="ml-auto" onClick={() => setConfirm("ack")}><PenLine className="h-4 w-4 mr-1" />Sign off</Button>
            </div>
          )}
          {a.emp_ack_at && <p className="text-xs text-gray-500">You signed off on {a.emp_ack_at}{a.emp_ack_comment ? ` — “${a.emp_ack_comment}”` : ""}.</p>}
        </CardContent></Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardContent className="py-4">
          <EvidenceList files={a.attachments} token={token} pathOf={(att) => apprMeApi.evidencePath(card, id, att)}
            onUpload={["OBJ_SETTING", "OBJ_REVIEW", "MIDYEAR"].includes(a.stage) && a.cycle.status === "ACTIVE" ? (f) => apprMeApi.uploadEvidence(card, token, id, f).then(load) : undefined}
            onDelete={["OBJ_SETTING", "OBJ_REVIEW", "MIDYEAR"].includes(a.stage) && a.cycle.status === "ACTIVE" ? (att) => apprMeApi.deleteEvidence(card, token, id, att).then(load) : undefined} />
        </CardContent></Card>
        <Card><CardContent className="py-4 space-y-2">
          <p className="font-semibold text-ink text-sm">History</p>
          <Trail steps={a.approvals} />
        </CardContent></Card>
      </div>

      {confirm === "objectives" && (
        <DecisionModal decision="approve" approveText="Submit objectives" onClose={() => setConfirm(null)}
          note={<p className="text-sm text-gray-600">Your line manager reviews them. After their approval the objectives are permanently locked.</p>}
          onConfirm={(remarks) => apprMeApi.submitObjectives(card, token, id, remarks || undefined).then(load)} />
      )}
      {confirm === "ack" && (
        <DecisionModal decision="approve" approveText="Sign off" onClose={() => setConfirm(null)}
          note={<p className="text-sm text-gray-600">You confirm you have seen your final rating. Add a comment if you wish.</p>}
          onConfirm={(remarks) => apprMeApi.acknowledge(card, token, id, remarks || undefined).then(load)} />
      )}
    </div>
  );
}

function MyCases({ card, token, cases }: { card: string; token: string; cases: { case_id: number; cycle_name: string; status: MyCase["status"]; status_label: string; prop_desg_desc: string; my_turn: boolean }[] }) {
  const [open, setOpen] = useState<number | null>(cases.find((c) => c.my_turn)?.case_id ?? cases[0]?.case_id ?? null);
  const [c, setC] = useState<MyCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!open) return;
    apprMeApi.case(card, token, open).then(setC).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [card, token, open]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {cases.map((x) => (
          <button key={x.case_id} onClick={() => { setC(null); setOpen(x.case_id); }}
            className={`px-3 py-1.5 rounded-lg text-sm border ${open === x.case_id ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-gray-200"}`}>
            {x.cycle_name} → {x.prop_desg_desc}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {open && !c ? <Spinner /> : c && (
        <Card><CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink">Competency self-assessment — {c.cur_desg_desc} → {c.prop_desg_desc}</p>
            <CaseStatusPill status={c.status} label={c.status_label} />
          </div>
          {c.outcome === "APPROVED" && <div className="p-3 rounded-lg bg-emerald-50 text-sm text-emerald-800">Congratulations — your promotion to <b>{c.final_desg_desc}</b> is approved, effective {c.effective_date}.</div>}
          {c.outcome && c.outcome !== "APPROVED" && <div className="p-3 rounded-lg bg-gray-50 text-sm text-gray-700">This promotion evaluation is closed ({c.status_label}).</div>}
          <MyCaseForm key={c.status} c={c}
            onSave={(body) => apprMeApi.saveSelfAssessment(card, token, c.case_id, body)}
            onSubmit={() => apprMeApi.submitSelfAssessment(card, token, c.case_id).then(load)} />
        </CardContent></Card>
      )}
    </div>
  );
}

function MyHistory({ card, token }: { card: string; token: string }) {
  const [h, setH] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apprMeApi.history(card, token).then(setH).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [card, token]);
  if (error) return <ErrorBox error={error} />;
  if (!h) return <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardContent className="py-4 space-y-3">
        <p className="font-semibold text-ink">Performance trend</p>
        <TrendChart points={h.history.map((x) => ({ label: x.cycle_name, score: x.final_score, rating: x.final_rating }))} />
        {h.history.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">Cycle</th><th className="text-left">Period to</th><th className="text-right">Total &quot;A&quot;</th><th className="text-left pl-3">Grade</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {h.history.map((x) => (
                <tr key={x.appraisal_id}><td className="py-1.5">{x.cycle_name}</td><td className="text-gray-500">{x.period_to}</td>
                  <td className="text-right tabular-nums">{scoreText(x.final_score)}</td><td className="pl-3"><GradeBadge g={x.final_rating} /></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent></Card>
      <Card><CardContent className="py-4 space-y-3">
        <p className="font-semibold text-ink">My development plan</p>
        {h.dev_plan.length === 0 ? <Empty>Nothing planned.</Empty> : (
          <ul className="space-y-2 text-sm">
            {h.dev_plan.map((d) => (
              <li key={d.plan_id} className="rounded-xl border border-gray-100 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{d.area}</span>
                  {d.course_title && <Pill tone="indigo">{d.course_title}</Pill>}
                  {d.training_request_status && <Pill tone="blue">Training request: {d.training_request_status.replace(/_/g, " ").toLowerCase()}</Pill>}
                  <Pill>{d.status.replace(/_/g, " ").toLowerCase()}</Pill>
                </div>
                {d.action_plan && <p className="text-xs text-gray-600 mt-1">{d.action_plan}</p>}
                {d.target_date && <p className="text-xs text-gray-400">Target {d.target_date}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>
    </div>
  );
}
