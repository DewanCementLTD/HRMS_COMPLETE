"use client";

import { useEffect, useState } from "react";
import { Users, CheckCircle2, Inbox, Gauge, ArrowUpRight, BadgeDollarSign, GraduationCap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorBox, Empty } from "@/components/training/TrainingUi";
import { BellCurveChart, GradeBadge } from "@/components/appraisal/AppraisalUi";
import { money } from "@/services/trainingService";
import { apprHrApi, scoreText, PHASE_LABEL, type Hr, type Dashboard, type Performer } from "@/services/appraisalService";

function Tile({ icon: Icon, label, value, sub, onClick, tone = "text-indigo-600 bg-indigo-50" }: {
  icon: React.ElementType; label: string; value: React.ReactNode; sub?: React.ReactNode; onClick?: () => void; tone?: string;
}) {
  return (
    <Card onClick={onClick}>
      <CardContent className={`py-4 flex items-start gap-3 ${onClick ? "cursor-pointer" : ""}`}>
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${tone}`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-2xl font-extrabold text-ink tabular-nums leading-tight">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

const PerformerList = ({ title, rows }: { title: string; rows: Performer[] }) => (
  <Card><CardContent className="py-4 space-y-2">
    <p className="font-semibold text-ink">{title}</p>
    {rows.length === 0 ? <Empty>No scored appraisals yet.</Empty> : (
      <ul className="divide-y divide-gray-50 text-sm">
        {rows.map((p) => (
          <li key={p.appraisal_id} className="py-1.5 flex items-center gap-2">
            <div className="min-w-0"><p className="text-gray-900 truncate">{p.name}</p><p className="text-xs text-gray-400 truncate">{p.desg_desc} · {p.dept_name}</p></div>
            <span className="ml-auto text-right inline-flex items-center gap-2"><GradeBadge g={p.final_rating} /><b className="tabular-nums">{scoreText(p.final_score)}</b></span>
          </li>
        ))}
      </ul>
    )}
  </CardContent></Card>
);

export function DashboardPanel({ h, onOpenAppraisals }: { h: Hr; onOpenAppraisals: (cycleId?: number) => void }) {
  const [cycleId, setCycleId] = useState<string>("");
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apprHrApi.dashboard(h, cycleId || undefined).then(setD).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h, cycleId]);

  if (error) return <ErrorBox error={error} />;
  if (!d) return <Spinner />;
  if (!d.cycle) return <Card><Empty>No appraisal cycle has been launched yet. Start in the Cycles tab.</Empty></Card>;

  const cid = d.cycle.cycle_id;
  const maxStage = Math.max(1, ...(d.stages ?? []).map((s) => s.count));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="px-3 py-2 rounded-xl border border-gray-300 text-sm" value={cycleId || String(cid)}
          onChange={(e) => { setD(null); setCycleId(e.target.value); }}>
          {!d.active_cycles.some((c) => c.cycle_id === cid) && <option value={cid}>{d.cycle.name}</option>}
          {d.active_cycles.map((c) => <option key={c.cycle_id} value={c.cycle_id}>{c.name}</option>)}
        </select>
        <span className="text-xs text-gray-400">{d.cycle.period_from} → {d.cycle.period_to} · {d.cycle.status.toLowerCase()} · phase: {PHASE_LABEL[d.cycle.phase]}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={Users} label="Appraisals" value={d.total} sub={`${d.completed} completed`} onClick={() => onOpenAppraisals(cid)} />
        <Tile icon={Inbox} label="Waiting for HR" value={d.pending_hr} tone="text-blue-600 bg-blue-50" sub={`${d.awaiting_ack ?? 0} completed, not yet signed by employee`} onClick={() => onOpenAppraisals(cid)} />
        <Tile icon={Gauge} label='Average Total "A"' value={scoreText(d.avg_score)} tone="text-emerald-600 bg-emerald-50" sub="Out of 5.00, from HR stage onward" />
        <Tile icon={ArrowUpRight} label="Promotions recommended" value={d.promotions_recommended} tone="text-amber-600 bg-amber-50"
          sub={`${d.promotion_cases_open} evaluation(s) open · ${d.promotions_approved} approved`} />
        <Tile icon={BadgeDollarSign} label="Increment cost / month" value={money(d.increment_cost)} tone="text-rose-600 bg-rose-50" sub={`${d.increments} recommended`} />
        <Tile icon={GraduationCap} label="Training requests raised" value={d.training_requests} tone="text-indigo-600 bg-indigo-50" sub="From appraisal recommendations" />
        <Tile icon={CheckCircle2} label="Completion" value={d.total ? `${Math.round(((d.completed ?? 0) / d.total) * 100)}%` : "—"} tone="text-emerald-600 bg-emerald-50" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardContent className="py-4 space-y-2">
          <p className="font-semibold text-ink">Where appraisals are</p>
          {(d.stages ?? []).map((s) => (
            <div key={s.stage} className="grid grid-cols-[11rem_1fr_2.5rem] items-center gap-2 text-xs" title={`${s.label}: ${s.count}`}>
              <span className="text-gray-700">{s.label}</span>
              <div className="h-4 rounded bg-gray-50"><div className="h-full rounded-r-[4px] bg-indigo-500" style={{ width: `${(s.count / maxStage) * 100}%` }} /></div>
              <span className="text-right tabular-nums text-gray-600">{s.count}</span>
            </div>
          ))}
        </CardContent></Card>
        <Card><CardContent className="py-4 space-y-2">
          <p className="font-semibold text-ink">Bell curve</p>
          {d.bell_curve && <BellCurveChart bc={d.bell_curve} />}
        </CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1"><CardContent className="py-4 space-y-2">
          <p className="font-semibold text-ink">Department ranking</p>
          {(d.departments ?? []).length === 0 ? <Empty>No data.</Empty> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-1">#</th><th className="text-left">Department</th><th className="text-right">Avg</th><th className="text-right">Done</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {(d.departments ?? []).map((x) => (
                  <tr key={x.dept_no || x.dept_name}><td className="py-1.5 text-gray-400">{x.rank ?? "—"}</td><td>{x.dept_name}</td>
                    <td className="text-right tabular-nums">{scoreText(x.avg_score)}</td><td className="text-right tabular-nums text-gray-500">{x.completed}/{x.employees}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent></Card>
        <PerformerList title="Top performers" rows={d.top ?? []} />
        <PerformerList title="Lowest scores" rows={d.low ?? []} />
      </div>
    </div>
  );
}
