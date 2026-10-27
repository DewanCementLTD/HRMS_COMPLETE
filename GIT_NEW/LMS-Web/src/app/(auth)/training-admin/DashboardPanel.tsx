"use client";

import { useEffect, useState } from "react";
import { Inbox, CalendarClock, Users, Clock, Award, Wallet, Star, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { hrApi, money, currentFy, fyLabel, TYPE_LABEL, type Hr, type Dashboard } from "@/services/trainingService";
import { SessionStatusPill, ErrorBox, Empty } from "@/components/training/TrainingUi";

function Tile({ icon: Icon, label, value, sub, onClick, tone = "text-indigo-600 bg-indigo-50" }: {
  icon: React.ElementType; label: string; value: React.ReactNode; sub?: React.ReactNode; onClick?: () => void; tone?: string;
}) {
  return (
    <Card onClick={onClick}>
      <CardContent className="py-4 flex items-start gap-3">
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

export function DashboardPanel({ h, onGo }: { h: Hr; onGo: (tab: "requests" | "sessions" | "budget", sessionId?: number) => void }) {
  const [fy, setFy] = useState(currentFy());
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hrApi.dashboard(h, fy).then(setD).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [h, fy]);

  if (error) return <ErrorBox error={error} />;
  if (!d) return <Spinner />;

  const years = [currentFy(), currentFy() - 1, currentFy() - 2];
  const maxType = Math.max(1, ...d.by_type.map((t) => t.sessions));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select className="px-3 py-2 rounded-xl border border-gray-300 text-sm" value={fy} onChange={(e) => { setD(null); setFy(Number(e.target.value)); }}>
          {years.map((y) => <option key={y} value={y}>FY {fyLabel(y)}</option>)}
        </select>
        <span className="text-xs text-gray-400">Figures for sessions in the fiscal year (Jul–Jun); requests are current.</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={Inbox} label="Requests waiting for HR" value={d.requests.pending_hr} tone="text-blue-600 bg-blue-50"
          sub={`${d.requests.to_book} approved to book · ${d.requests.pending_hod} with HODs`} onClick={() => onGo("requests")} />
        <Tile icon={CalendarClock} label="Sessions this year" value={d.sessions.total}
          sub={`${d.sessions.COMPLETED ?? 0} completed · ${(d.sessions.OPEN ?? 0) + (d.sessions.PLANNED ?? 0) + (d.sessions.IN_PROGRESS ?? 0)} upcoming/ongoing`} onClick={() => onGo("sessions")} />
        <Tile icon={Users} label="Employees trained" value={d.employees_trained} tone="text-emerald-600 bg-emerald-50"
          sub={d.completion_rate != null ? `${d.completion_rate}% completion rate` : "No evaluations yet"} />
        <Tile icon={Clock} label="Training hours" value={Math.round(d.training_hours).toLocaleString("en-US")} tone="text-amber-600 bg-amber-50" sub="Hours × attendance" />
        <Tile icon={Wallet} label="Training cost" value={money(d.cost)} tone="text-rose-600 bg-rose-50"
          sub={d.budget != null ? `${d.budget_used_pct}% of budget ${money(d.budget)}` : "No budget set"} onClick={() => onGo("budget")} />
        <Tile icon={Award} label="Certificates issued" value={d.certificates} tone="text-yellow-700 bg-yellow-50" />
        <Tile icon={Star} label="Average feedback" value={d.avg_rating != null ? `${d.avg_rating} / 5` : "—"} tone="text-orange-600 bg-orange-50" />
        <Tile icon={TrendingUp} label="Avg. score improvement" value={d.avg_improvement != null ? `${d.avg_improvement > 0 ? "+" : ""}${d.avg_improvement}` : "—"}
          tone="text-teal-600 bg-teal-50" sub="Post-test minus pre-test (points)" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="py-4">
            <p className="font-semibold text-ink mb-3">Upcoming & ongoing sessions</p>
            {d.upcoming.length === 0 ? <Empty>Nothing scheduled.</Empty> : (
              <ul className="divide-y divide-gray-50">
                {d.upcoming.map((s) => (
                  <li key={s.session_id} className="py-2 flex items-center gap-3 cursor-pointer hover:bg-gray-50/60 rounded-lg px-1" onClick={() => onGo("sessions", s.session_id)}>
                    <div className="w-14 text-center shrink-0">
                      <p className="text-[11px] uppercase text-gray-400">{new Date(`${s.start_date}T00:00:00`).toLocaleString("en", { month: "short" })}</p>
                      <p className="text-lg font-bold text-ink leading-none">{s.start_date.slice(8)}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{s.course_title}</p>
                      <p className="text-xs text-gray-400">{s.session_code} · {s.mode === "ONLINE" ? "Online" : s.venue || "Physical"} · {s.participants}/{s.capacity} booked</p>
                    </div>
                    <SessionStatusPill status={s.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="font-semibold text-ink mb-3">Sessions by training type</p>
            {d.by_type.length === 0 ? <Empty>No sessions this year.</Empty> : (
              <ul className="space-y-2.5">
                {d.by_type.map((t) => (
                  <li key={t.training_type}>
                    <div className="flex justify-between text-sm"><span className="text-gray-700">{TYPE_LABEL[t.training_type] ?? t.training_type}</span>
                      <span className="text-gray-500 tabular-nums">{t.sessions} · {t.completed} trained</span></div>
                    <div className="h-2 rounded-full bg-gray-100 mt-1 overflow-hidden"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${(100 * t.sessions) / maxType}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
