"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import {
  Users, Briefcase, CalendarCheck, UserCheck, Plus, Search,
  TrendingUp, Clock, CheckCircle, XCircle, BarChart2,
  UserX, AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Cell, BarChart, Bar, LabelList,
} from "recharts";
import {
  listJobs, listApplications, listInterviews, listOffers,
  fetchRecruitmentAnalytics, createJob,
} from "@/services/recruitmentService";
import type { Job, Application, Interview, RecruitmentAnalytics } from "@/models/recruitment";
import { RecruitmentPanel } from "../hrms/RecruitmentPanel";

// ─── colour tokens ──────────────────────────────────────
const PIPE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#3b82f6"];

// ─── Status badge ───────────────────────────────────────
function SBadge({ status }: { status: string }) {
  const s = (status || "").toUpperCase();
  const map: Record<string, string> = {
    OPEN: "bg-emerald-100 text-emerald-700",
    CLOSED: "bg-gray-100 text-gray-600",
    ON_HOLD: "bg-amber-100 text-amber-700",
    PENDING: "bg-blue-100 text-blue-700",
    SHORTLISTED: "bg-emerald-100 text-emerald-700",
    REJECTED: "bg-red-100 text-red-600",
    SCHEDULED: "bg-indigo-100 text-indigo-700",
    COMPLETED: "bg-emerald-100 text-emerald-700",
    CANCELLED: "bg-gray-100 text-gray-500",
    SENT: "bg-amber-100 text-amber-700",
    ACCEPTED: "bg-emerald-100 text-emerald-700",
  };
  const label = s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ");
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${map[s] ?? "bg-gray-100 text-gray-600"}`}>
      {label}
    </span>
  );
}

// ─── Avatar initials ─────────────────────────────────────
const AV = ["bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-blue-500", "bg-rose-500", "bg-violet-500"];
function Av({ name, size = 8 }: { name: string; size?: number }) {
  const parts = (name || "?").trim().split(" ");
  const init = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  const idx = ((name.charCodeAt(0) || 0) + (name.charCodeAt(1) || 0)) % AV.length;
  return (
    <div className={`h-${size} w-${size} rounded-full ${AV[idx]} flex items-center justify-center text-white font-bold text-xs shrink-0`}>
      {init.toUpperCase() || "?"}
    </div>
  );
}

// ─── Quick-create Job modal ──────────────────────────────
function CreateJobModal({ adminCardNo, scope, onDone, onClose }: { adminCardNo: string; scope?: { compc?: string; brnch?: string }; onDone: () => void; onClose: () => void }) {
  const [form, setForm] = useState({ job_title: "", open_positions: 1, job_desc: "", skills_req: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!form.job_title.trim()) { setErr("Job title is required"); return; }
    setSaving(true);
    try {
      await createJob(adminCardNo, { ...form }, scope);
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to create job");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Create Job Opening</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><XCircle className="h-5 w-5" /></button>
        </div>
        {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Job Title *</label>
            <input
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={form.job_title} onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))}
              placeholder="e.g. Software Engineer"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Open Positions</label>
            <input type="number" min={1}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={form.open_positions} onChange={e => setForm(f => ({ ...f, open_positions: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Job Description</label>
            <textarea rows={2}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
              value={form.job_desc} onChange={e => setForm(f => ({ ...f, job_desc: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Skills Required</label>
            <input
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              value={form.skills_req} onChange={e => setForm(f => ({ ...f, skills_req: e.target.value }))}
              placeholder="e.g. React, Python, SQL"
            />
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50">
            {saving ? "Creating…" : "Create Job"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════
export default function RecruitmentPage() {
  const { user, activeCompany, activeBranch } = useAuth();
  const router = useRouter();
  // Scope recruitment data to the currently selected company/branch.
  const scope = { compc: activeCompany || undefined, brnch: activeBranch || undefined };

  const [analytics, setAnalytics] = useState<RecruitmentAnalytics | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [view, setView] = useState<"dashboard" | "manage">("dashboard");

  const load = useCallback(async () => {
    if (!user?.card_no) return;
    setLoading(true);
    try {
      const [a, j, apps, ivs] = await Promise.all([
        fetchRecruitmentAnalytics(user.card_no, scope),
        listJobs(user.card_no, undefined, scope),
        listApplications(user.card_no, undefined, undefined, scope),
        listInterviews(user.card_no, undefined, undefined, scope),
      ]);
      setAnalytics(a);
      setJobs(j.items ?? []);
      setApplications(apps.items ?? []);
      setInterviews(ivs.items ?? []);
    } catch {
      // silently continue with empty state
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.card_no, activeCompany, activeBranch]);

  useEffect(() => { load(); }, [load]);

  // Access guard
  if (!user?.hr_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
          <p className="text-gray-500 mt-2">You don&apos;t have HR admin privileges.</p>
        </div>
      </div>
    );
  }

  if (loading) return <Spinner />;

  // ── Derived data ──────────────────────────────────────
  const openJobs   = jobs.filter(j => j.status === "OPEN");
  const scheduled  = interviews.filter(iv => iv.status === "SCHEDULED");
  const recentApps = [...applications]
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, 6);

  const filteredApps = search.trim()
    ? applications.filter(a =>
        a.candidate_name.toLowerCase().includes(search.toLowerCase()) ||
        a.job_title.toLowerCase().includes(search.toLowerCase()))
    : applications;

  // pipeline donut data per job (top 4 open jobs)
  const topJobs = openJobs.slice(0, 4);

  // monthly hires for area chart
  const monthlyHires = analytics?.monthly_hires ?? [];

  const kpis = [
    { label: "Total Candidates",    value: analytics?.total_applications ?? 0, sub: "Across all jobs",    icon: Users,         bg: "bg-indigo-50",  ic: "text-indigo-600" },
    { label: "New Candidates",      value: `+${analytics?.pending ?? 0}`,       sub: "Pending review",    icon: UserCheck,     bg: "bg-blue-50",    ic: "text-blue-600" },
    { label: "Upcoming Interviews", value: scheduled.length,                    sub: "This week",         icon: CalendarCheck, bg: "bg-amber-50",   ic: "text-amber-600" },
    { label: "Candidates Hired",    value: analytics?.hires_this_month ?? 0,    sub: "This month",        icon: CheckCircle,   bg: "bg-emerald-50", ic: "text-emerald-600" },
  ];

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── HEADER ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white">
            Welcome{user?.emp_name ? `, ${user.emp_name.split(" ")[0]}` : ""} 👋
          </h1>
          {scheduled.length > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">
              You have{" "}
              <span className="text-indigo-600 font-semibold">{scheduled.length} upcoming interview{scheduled.length > 1 ? "s" : ""}</span>{" "}
              scheduled
            </p>
          )}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 w-52">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input
            className="bg-transparent text-sm outline-none w-full placeholder:text-gray-400"
            placeholder="Search candidate…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl text-sm">
          <button onClick={() => setView("dashboard")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${view === "dashboard" ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
            Dashboard
          </button>
          <button onClick={() => setView("manage")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-all ${view === "manage" ? "bg-white text-indigo-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`}>
            Manage
          </button>
        </div>

        {/* Create Job */}
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Create Job
        </button>
      </div>

      {/* ── CREATE JOB MODAL ─────────────────────────────── */}
      {showCreate && (
        <CreateJobModal
          adminCardNo={user.card_no}
          scope={scope}
          onDone={() => { setShowCreate(false); load(); }}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* ── MANAGE VIEW — full RecruitmentPanel ──────────── */}
      {view === "manage" && (
        <RecruitmentPanel adminCardNo={user.card_no} />
      )}

      {/* ── DASHBOARD VIEW ───────────────────────────────── */}
      {view === "dashboard" && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map(({ label, value, sub, icon: Icon, bg, ic }) => (
              <Card key={label} className="hover:shadow-md transition-shadow">
                <CardContent className="py-4 px-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`h-10 w-10 rounded-xl ${bg} flex items-center justify-center`}>
                      <Icon className={`h-5 w-5 ${ic}`} />
                    </div>
                  </div>
                  <p className="text-2xl font-extrabold text-gray-900 leading-tight">{value}</p>
                  <p className="text-sm font-medium text-gray-700 mt-0.5">{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Middle row: Job Analysis chart + Schedule */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Job Analysis — monthly hires area chart */}
            <Card className="lg:col-span-2">
              <CardContent className="py-4 px-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Job Analysis</p>
                    <p className="text-xs text-gray-400">Hires per month</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5">
                    <BarChart2 className="h-3.5 w-3.5" />
                    Monthly
                  </div>
                </div>
                {monthlyHires.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-44 text-gray-300">
                    <TrendingUp className="h-10 w-10 mb-2" />
                    <p className="text-xs">No hire data yet</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={monthlyHires} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                      <defs>
                        <linearGradient id="hireGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 11 }}
                        formatter={(v) => [Number(v), "Hires"]}
                      />
                      <Area type="monotone" dataKey="hires" stroke="#6366f1" strokeWidth={2.5}
                        fill="url(#hireGrad)" dot={{ r: 4, fill: "#6366f1" }} activeDot={{ r: 6 }}>
                        <LabelList dataKey="hires" position="top" style={{ fontSize: 9, fill: "#6366f1" }} />
                      </Area>
                    </AreaChart>
                  </ResponsiveContainer>
                )}
                {/* Open jobs legend */}
                <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-gray-50">
                  {openJobs.slice(0, 4).map((j, i) => (
                    <span key={j.job_id} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                      <span className="h-2 w-2 rounded-full" style={{ background: PIPE_COLORS[i % PIPE_COLORS.length] }} />
                      {j.job_title}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Upcoming Interviews (Schedule) */}
            <Card>
              <CardContent className="py-4 px-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-bold text-gray-900">Schedule</p>
                  <button onClick={() => setView("manage")} className="text-[11px] text-indigo-600 font-semibold hover:underline">View All</button>
                </div>
                {/* Mini week strip */}
                <div className="flex justify-around mb-4">
                  {["S","M","T","W","T","F","S"].map((d, i) => {
                    const today = new Date().getDay();
                    return (
                      <div key={i} className={`flex flex-col items-center gap-1 ${i === today ? "text-indigo-600" : "text-gray-400"}`}>
                        <span className="text-[10px] font-medium">{d}</span>
                        <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${i === today ? "bg-indigo-600 text-white" : ""}`}>
                          {new Date(new Date().setDate(new Date().getDate() - new Date().getDay() + i)).getDate()}
                        </div>
                        {i === today && <div className="h-1 w-1 rounded-full bg-indigo-600" />}
                      </div>
                    );
                  })}
                </div>

                {scheduled.length === 0 ? (
                  <div className="text-center py-8 text-gray-300">
                    <CalendarCheck className="h-8 w-8 mx-auto mb-1" />
                    <p className="text-xs">No interviews scheduled</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {scheduled.slice(0, 4).map((iv) => {
                      const d = iv.interview_date ? new Date(iv.interview_date) : null;
                      return (
                        <div key={iv.interview_id} className="flex gap-3 items-start">
                          {d ? (
                            <div className="bg-indigo-50 rounded-xl px-2.5 py-2 text-center shrink-0 min-w-[42px]">
                              <p className="text-base font-extrabold text-indigo-700 leading-none">{d.getDate()}</p>
                              <p className="text-[9px] text-indigo-400 font-semibold">{d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</p>
                            </div>
                          ) : (
                            <div className="bg-gray-100 rounded-xl px-2.5 py-2 shrink-0 min-w-[42px]">
                              <Clock className="h-4 w-4 text-gray-400 mx-auto" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-gray-900 truncate">{iv.job_title}</p>
                            <p className="text-[10px] text-indigo-500 truncate">w/ {iv.candidate_name}</p>
                            {iv.interview_type && (
                              <p className="text-[10px] text-gray-400">{iv.interview_type} Interview</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Bottom row: Job pipeline cards + Recently Applied */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Job pipeline donuts */}
            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {topJobs.length === 0 ? (
                <Card className="sm:col-span-2">
                  <CardContent className="flex flex-col items-center justify-center py-10 text-gray-300">
                    <Briefcase className="h-10 w-10 mb-2" />
                    <p className="text-sm">No open jobs yet</p>
                    <button onClick={() => setShowCreate(true)}
                      className="mt-3 text-xs text-indigo-600 font-semibold hover:underline">
                      + Create your first job
                    </button>
                  </CardContent>
                </Card>
              ) : (
                topJobs.map((job, ji) => {
                  const jobApps = applications.filter(a => a.job_id === job.job_id);
                  const pending     = jobApps.filter(a => a.status === "PENDING").length;
                  const shortlisted = jobApps.filter(a => a.status === "SHORTLISTED").length;
                  const jobIvs      = interviews.filter(iv => jobApps.some(a => a.app_id === iv.app_id)).length;
                  const hired       = (analytics?.monthly_hires ?? []).length > 0 ? job.filled_positions : 0;
                  const total       = Math.max(jobApps.length, 1);

                  const donut = [
                    { name: "In Review", value: pending },
                    { name: "Interview", value: jobIvs },
                    { name: "Offered",   value: Math.max(job.filled_positions - hired, 0) },
                    { name: "Hired",     value: job.filled_positions },
                  ].filter(d => d.value > 0);

                  return (
                    <Card key={job.job_id} className="hover:shadow-md transition-shadow">
                      <CardContent className="py-4 px-4">
                        {/* Tags */}
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          <span className="text-[10px] bg-indigo-50 text-indigo-600 font-semibold px-2 py-0.5 rounded-full">{job.dept_name ?? "General"}</span>
                          <SBadge status={job.status} />
                        </div>
                        <p className="text-sm font-bold text-gray-900 mb-3">{job.job_title}</p>

                        <div className="flex items-center justify-between">
                          {/* Donut */}
                          <div className="relative">
                            <PieChart width={90} height={90}>
                              <Pie data={donut.length ? donut : [{ name: "No Apps", value: 1 }]}
                                cx={41} cy={41} innerRadius={28} outerRadius={42}
                                dataKey="value" strokeWidth={0} paddingAngle={2}>
                                {(donut.length ? donut : [{ name: "No Apps", value: 1 }]).map((_, i) => (
                                  <Cell key={i} fill={donut.length ? PIPE_COLORS[i % PIPE_COLORS.length] : "#e5e7eb"} />
                                ))}
                              </Pie>
                            </PieChart>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                              <span className="text-base font-extrabold text-gray-900 leading-none">{jobApps.length}</span>
                              <span className="text-[9px] text-gray-400">Applied</span>
                            </div>
                          </div>

                          {/* Legend */}
                          <div className="space-y-1 text-[11px]">
                            {[
                              { label: "In Review", val: pending },
                              { label: "Interview", val: jobIvs },
                              { label: "Offered",   val: Math.max(job.filled_positions - hired, 0) },
                              { label: "Hired",     val: job.filled_positions },
                            ].map(({ label, val }, i) => (
                              <div key={label} className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: PIPE_COLORS[i] }} />
                                <span className="text-gray-500">{label}</span>
                                <span className="font-bold text-gray-800 ml-auto pl-2">{val}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Vacancy bar */}
                        <div className="mt-3">
                          <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                            <span>{job.filled_positions}/{job.open_positions} filled</span>
                            <span>{job.remaining_positions} remaining</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 rounded-full"
                              style={{ width: `${Math.min(job.filled_positions / Math.max(job.open_positions, 1) * 100, 100)}%` }} />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>

            {/* Recently Applied */}
            <Card>
              <CardContent className="py-4 px-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-bold text-gray-900">Recently Applied</p>
                  <button onClick={() => setView("manage")} className="text-[11px] text-indigo-600 font-semibold hover:underline">View All</button>
                </div>

                {search.trim() ? (
                  <div className="space-y-3 max-h-80 overflow-y-auto">
                    {filteredApps.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">No results for &quot;{search}&quot;</p>
                    ) : filteredApps.slice(0, 8).map((a) => (
                      <ApplicantRow key={a.app_id} app={a} />
                    ))}
                  </div>
                ) : recentApps.length === 0 ? (
                  <div className="text-center py-8 text-gray-300">
                    <Users className="h-8 w-8 mx-auto mb-1" />
                    <p className="text-xs">No applications yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentApps.map((a) => (
                      <ApplicantRow key={a.app_id} app={a} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Analytics strip */}
          {analytics && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: "Open Jobs",          value: analytics.open_jobs,            color: "text-indigo-600" },
                { label: "Total Applications", value: analytics.total_applications,   color: "text-blue-600" },
                { label: "Shortlisted",        value: analytics.shortlisted,          color: "text-emerald-600" },
                { label: "Interviews",         value: analytics.total_interviews,     color: "text-amber-600" },
                { label: "Avg Time to Hire",   value: `${analytics.avg_time_to_hire_days ?? 0}d`, color: "text-violet-600" },
                { label: "Rejected",           value: analytics.rejected,             color: "text-red-500" },
              ].map(({ label, value, color }) => (
                <Card key={label}>
                  <CardContent className="py-3 px-3 text-center">
                    <p className={`text-xl font-extrabold ${color}`}>{value}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Applicant row sub-component ────────────────────────
function ApplicantRow({ app }: { app: Application }) {
  const ago = app.created_at
    ? (() => {
        const diff = Date.now() - new Date(app.created_at).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
      })()
    : "";
  return (
    <div className="flex items-center gap-2.5">
      <Av name={app.candidate_name} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-gray-900 truncate">{app.candidate_name}</p>
        <p className="text-[10px] text-gray-400 truncate">Applied for <span className="text-indigo-500">{app.job_title}</span></p>
      </div>
      <div className="text-right shrink-0 space-y-0.5">
        <SBadge status={app.status} />
        {ago && <p className="text-[9px] text-gray-300">{ago}</p>}
      </div>
    </div>
  );
}
