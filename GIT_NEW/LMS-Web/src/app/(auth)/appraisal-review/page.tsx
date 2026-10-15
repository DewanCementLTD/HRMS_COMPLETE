"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, History as HistoryIcon, ArrowLeft, RefreshCw, Check, CornerUpLeft, Award, PenLine, Lock, Printer } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { Tabs, SignInAgain, ErrorBox, Empty, Pill } from "@/components/training/TrainingUi";
import {
  StagePill, StageTracker, ScoreStrip, ObjectivesEditor, SheetTable, SheetHeader, Trail, EvidenceList, DecisionModal, GradeBadge, printTaskSheet,
} from "@/components/appraisal/AppraisalUi";
import { AgreedRatingsForm, RecommendationsForm, RecommendationsView } from "@/components/appraisal/AppraisalForms";
import { PromotionCaseView, CaseStatusPill } from "@/components/appraisal/PromotionCase";
import {
  apprReviewApi, ROLE_LABEL, PHASE_LABEL, scoreText, pctText,
  type Appraisal, type InboxRow, type Designation, type CaseRow, type PromotionCase,
} from "@/services/appraisalService";
import type { Course } from "@/services/trainingService";

type Tab = "pending" | "all" | "cases";

// Appraisals of the people this user manages — as line manager (objectives,
// mid-year) or as HOD (year-end rating) — and the promotion evaluations where
// they are the reporting manager, HOD or CEO.
export default function AppraisalReviewPage() {
  const { user } = useAuth();
  const token = user?.session_token || "";
  const card = user?.card_no || "";
  const [tab, setTab] = useState<Tab>("pending");
  const [data, setData] = useState<{ is_reviewer: boolean; pending: number; appraisal_pending: number; items: InboxRow[]; cases: CaseRow[]; case_pending: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [openCase, setOpenCase] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!card || !token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await apprReviewApi.inbox(card, token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [card, token]);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => (data?.items ?? []).filter((r) => tab === "all" || r.my_turn), [data, tab]);
  if (!user) return null;
  const back = () => { setOpen(null); setOpenCase(null); load(); };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Appraisal Reviews" subtitle="Approve objectives, sign mid-year reviews, give year-end ratings and decide promotions"
        actions={token && !open && !openCase ? <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh</Button> : undefined} />
      {!token ? <Card><SignInAgain /></Card> : open ? (
        <ReviewDetail card={card} token={token} id={open} companyName={user.selected_company?.name} onBack={back} />
      ) : openCase ? (
        <CaseDetail card={card} token={token} id={openCase} companyName={user.selected_company?.name} onBack={back} />
      ) : (
        <>
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { id: "pending", label: "Waiting for me", icon: ClipboardCheck, badge: data?.appraisal_pending },
            { id: "all", label: "All my team", icon: HistoryIcon },
            { id: "cases", label: "Promotion evaluations", icon: Award, badge: data?.case_pending },
          ]} />
          <ErrorBox error={error} />
          {!data ? <Spinner /> : tab === "cases" ? (
            data.cases.length === 0 ? <Card><Empty>No promotion evaluations for you.</Empty></Card> : (
              <Card><CardContent className="py-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left px-3 py-2">Employee</th><th className="text-left px-3 py-2">Promotion</th>
                    <th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">My role</th><th className="text-right px-3 py-2">Overall</th><th /></tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.cases.map((c) => (
                      <tr key={c.case_id} className="hover:bg-gray-50/60 cursor-pointer" onClick={() => setOpenCase(c.case_id)}>
                        <td className="px-3 py-2"><p className="font-medium text-gray-900">{c.emp_name}</p><p className="text-xs text-gray-400">{c.empcode} · {c.dept_name}</p></td>
                        <td className="px-3 py-2 text-gray-700">{c.cur_desg_desc} → <b>{c.prop_desg_desc}</b></td>
                        <td className="px-3 py-2"><CaseStatusPill status={c.status} label={c.status_label} /></td>
                        <td className="px-3 py-2 text-xs text-gray-600">{(c.my_roles ?? []).map((r) => ROLE_LABEL[r] ?? r).join(", ")}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pctText(c.overall_score)}</td>
                        <td className="px-3 py-2 text-right">{c.my_turn && <Pill tone="red">Your turn</Pill>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent></Card>
            )
          ) : items.length === 0 ? (
            <Card><Empty>{tab === "pending" ? "Nothing is waiting for you." : "No appraisals of your team yet."}</Empty></Card>
          ) : (
            <Card><CardContent className="py-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 uppercase">
                  <tr><th className="text-left px-3 py-2">Employee</th><th className="text-left px-3 py-2">Cycle</th><th className="text-left px-3 py-2">Stage</th>
                    <th className="text-left px-3 py-2">My role</th><th className="text-right px-3 py-2">Self</th><th className="text-left px-3 py-2">Grade</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {items.map((r) => (
                    <tr key={r.appraisal_id} className="hover:bg-gray-50/60 cursor-pointer" onClick={() => setOpen(r.appraisal_id)}>
                      <td className="px-3 py-2"><p className="text-gray-900 font-medium">{r.emp_name}</p><p className="text-xs text-gray-400">{r.empcode} · {r.desg_desc} · {r.dept_name}</p></td>
                      <td className="px-3 py-2 text-gray-600">{r.cycle.name}<span className="block text-[11px] text-gray-400">{PHASE_LABEL[r.cycle.phase]}</span></td>
                      <td className="px-3 py-2"><StagePill stage={r.stage} /></td>
                      <td className="px-3 py-2 text-xs text-gray-600">{r.my_roles.map((x) => ROLE_LABEL[x] ?? x).join(", ")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{scoreText(r.self_score)}</td>
                      <td className="px-3 py-2"><GradeBadge g={r.final_rating} /></td>
                      <td className="px-3 py-2 text-right">{r.my_turn ? <Pill tone="red">Your turn</Pill> : r.waiting_phase ? <Pill>Waiting for HR to open the phase</Pill> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}

function ReviewDetail({ card, token, id, companyName, onBack }: { card: string; token: string; id: number; companyName?: string; onBack: () => void }) {
  const [a, setA] = useState<Appraisal | null>(null);
  const [lk, setLk] = useState<{ designations: Designation[]; courses: Course[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decide, setDecide] = useState<"approve" | "return" | null>(null);

  const load = useCallback(() => {
    apprReviewApi.get(card, token, id).then(setA).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [card, token, id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apprReviewApi.lookups(card, token, id).then(setLk).catch(() => setLk({ designations: [], courses: [] }));
  }, [card, token, id]);

  if (error) return <ErrorBox error={error} />;
  if (!a) return <Spinner />;
  const objectives = ["OBJ_SETTING", "OBJ_REVIEW"].includes(a.stage);
  const mid = a.stage === "MID_REVIEW";
  const yearEnd = !!a.can_rate;
  const approveText = objectives ? "Approve & lock objectives" : mid ? "Sign mid-year review" : "Approve & forward";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <p className="font-semibold text-ink">{a.emp_name}</p>
        <StagePill stage={a.stage} />
        {a.act_role && <Pill tone="red">Waiting for you as {ROLE_LABEL[a.act_role]}</Pill>}
        {a.waiting_phase && <Pill>Waiting for HR to open the {a.stage === "MID_REVIEW" ? "mid-year" : "year-end"} phase</Pill>}
        <Button className="ml-auto" variant="secondary" size="sm" onClick={() => printTaskSheet(a, companyName, true)}><Printer className="h-4 w-4 mr-1" />Print</Button>
      </div>

      <Card><CardContent className="py-4 space-y-3">
        <SheetHeader a={a} />
        <StageTracker a={a} />
        {!objectives && !["MIDYEAR", "MID_REVIEW"].includes(a.stage) && <ScoreStrip a={a} internal />}
      </CardContent></Card>

      {objectives ? (
        <Card><CardContent className="py-4">
          <ObjectivesEditor a={a} editable={!!a.can_edit_rows}
            onSave={(body, gid) => apprReviewApi.saveRow(card, token, id, body, gid).then(load)}
            onDelete={(gid) => apprReviewApi.deleteRow(card, token, id, gid).then(load)} />
          {a.stage === "OBJ_SETTING" && a.can_approve_objectives && (
            <p className="text-xs text-gray-500 mt-2">The employee is still drafting. You can set the objectives together and approve them directly.</p>
          )}
        </CardContent></Card>
      ) : yearEnd ? (
        <Card><CardContent className="py-4 space-y-3">
          <p className="font-semibold text-ink">Year-end — agreed rating per accountability</p>
          {a.mid_comments && <p className="text-sm"><span className="text-gray-500">Mid-year comments: </span>{a.mid_comments}</p>}
          <AgreedRatingsForm key={a.stage} a={a} onSave={(rows) => apprReviewApi.ratings(card, token, id, rows).then(load)} />
        </CardContent></Card>
      ) : (
        <Card><CardContent className="py-4 space-y-3">
          <p className="font-semibold text-ink inline-flex items-center gap-1.5">Task sheet {a.obj_locked_at && <Lock className="h-3.5 w-3.5 text-gray-400" />}</p>
          <SheetTable rows={a.rows} show={{ progress: true, self: true, agreed: !["MIDYEAR", "MID_REVIEW"].includes(a.stage) }} />
          {a.mid_comments && <p className="text-sm"><span className="text-gray-500">Mid-year comments: </span>{a.mid_comments}</p>}
          {mid && a.can_sign_midyear && <p className="text-xs text-gray-500">Review the employee&apos;s progress and self ratings, then sign. Signing locks the half-year review.</p>}
        </CardContent></Card>
      )}

      {yearEnd && lk && (
        <Card><CardContent className="py-4 space-y-3">
          <p className="font-semibold text-ink">Promotion, increment &amp; training recommendation</p>
          <RecommendationsForm a={a} designations={lk.designations} courses={lk.courses}
            onSave={(body) => apprReviewApi.recommendations(card, token, id, body).then(load)} />
        </CardContent></Card>
      )}
      {!yearEnd && !objectives && !["MIDYEAR", "MID_REVIEW"].includes(a.stage) && (
        <Card><CardContent className="py-4 space-y-2"><p className="font-semibold text-ink">Recommendations</p><RecommendationsView a={a} showPay /></CardContent></Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardContent className="py-4">
          <EvidenceList files={a.attachments} token={token} pathOf={(att) => apprReviewApi.evidencePath(card, id, att)} />
        </CardContent></Card>
        <Card><CardContent className="py-4 space-y-2"><p className="font-semibold text-ink text-sm">History</p><Trail steps={a.approvals} /></CardContent></Card>
      </div>

      {a.act_role && (a.can_approve_objectives || a.can_sign_midyear || a.can_rate) && (
        <div className="sticky bottom-3 flex flex-wrap justify-end gap-2 rounded-xl bg-white/90 backdrop-blur border border-gray-100 shadow-sm p-3">
          <span className="text-xs text-gray-500 mr-auto self-center">
            {objectives ? "Approving locks the objectives permanently." : mid ? "Signing locks the half-year review; the year-end rating comes next." :
              "Save your ratings first. Approving sends it to the next level."}
          </span>
          {a.can_return && <Button variant="secondary" onClick={() => setDecide("return")}><CornerUpLeft className="h-4 w-4 mr-1" />Return</Button>}
          <Button onClick={() => setDecide("approve")}>{mid ? <PenLine className="h-4 w-4 mr-1" /> : <Check className="h-4 w-4 mr-1" />}{approveText}</Button>
        </div>
      )}
      {decide && (
        <DecisionModal decision={decide} onClose={() => setDecide(null)} approveText={approveText}
          note={mid && decide === "approve" ? <p className="text-sm text-gray-600">Your comments are recorded as the mid-year sign-off.</p> : undefined}
          onConfirm={(remarks) => apprReviewApi.decide(card, token, id, decide, remarks || undefined).then(onBack)} />
      )}
    </div>
  );
}

function CaseDetail({ card, token, id, companyName, onBack }: { card: string; token: string; id: number; companyName?: string; onBack: () => void }) {
  const [cs, setCs] = useState<PromotionCase | null>(null);
  const [desgs, setDesgs] = useState<Designation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apprReviewApi.case(card, token, id).then(setCs).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [card, token, id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apprReviewApi.caseLookups(card, token, id).then((r) => setDesgs(r.designations)).catch(() => {}); }, [card, token, id]);
  if (error) return <ErrorBox error={error} />;
  if (!cs) return <Spinner />;
  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
      <PromotionCaseView key={`${cs.status}-${cs.signoffs.length}`} cs={cs} designations={desgs} companyName={companyName}
        review={{
          rate: (rows, submit) => apprReviewApi.rateCase(card, token, id, rows, submit).then(load),
          signoff: (role, decision, remarks) => apprReviewApi.caseSignoff(card, token, id, role, decision, remarks).then(load),
          hodFinal: (decision, remarks) => apprReviewApi.hodFinal(card, token, id, decision, remarks).then(load),
          ceoFinal: (body) => apprReviewApi.ceoFinal(card, token, id, body).then(load),
        }} />
    </div>
  );
}
