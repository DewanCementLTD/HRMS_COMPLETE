"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Briefcase,
  FileText,
  ClipboardList,
  Gift,
  TrendingUp,
  Plus,
  CheckCircle,
  XCircle,
  Clock,
  Users,
  BarChart2,
  ArrowLeft,
  Search,
  Upload,
  Download,
  Trash2,
  MapPin,
  Mail,
  Phone,
  GraduationCap,
  Building2,
  Send,
  Sparkles,
  UploadCloud,
  Loader2,
  X,
  ChevronDown,
} from "lucide-react";
import {
  listJobs,
  createJob,
  updateJob,
  listApplications,
  createApplication,
  updateApplicationStatus,
  listInterviews,
  updateInterview,
  rescheduleInterview,
  getPanelPool,
  addPanelPoolMembers,
  deactivatePanelPoolMember,
  getInterviewPanelOptions,
  createInterviewAssignments,
  listNotificationTemplates,
  createNotificationSelections,
  listOffers,
  createOffer,
  updateOffer,
  fetchRecruitmentAnalytics,
  listCandidates,
  getCandidate,
  createCandidate,
  updateCandidate,
  applyCandidateToJob,
  uploadCandidateCv,
  candidateCvUrl,
  getTopCandidates,
  uploadCvsBulk,
  getCvStatus,
} from "@/services/recruitmentService";
import type {
  Job, Application, Interview, Offer, RecruitmentAnalytics,
  CandidateListItem, CandidateDetail, RankedApplicant, TopCandidatesResponse,
  CvFileState, PanelPoolResponse, PanelOption, NotificationTemplate,
} from "@/models/recruitment";
import { listHRMSEmployees } from "@/services/hrmsService";
import { fetchInterviewTypes } from "@/services/referenceService";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

type RecTab = "jobs" | "candidates" | "applications" | "ai-ranking" | "interviews" | "offers" | "analytics";

const REC_TABS: { value: RecTab; label: string; icon: React.ReactNode }[] = [
  { value: "jobs", label: "Jobs", icon: <Briefcase className="h-4 w-4" /> },
  { value: "candidates", label: "Talent Pool", icon: <Users className="h-4 w-4" /> },
  { value: "applications", label: "Applications", icon: <FileText className="h-4 w-4" /> },
  { value: "ai-ranking", label: "AI Ranking", icon: <Sparkles className="h-4 w-4" /> },
  { value: "interviews", label: "Interviews", icon: <ClipboardList className="h-4 w-4" /> },
  { value: "offers", label: "Offers", icon: <Gift className="h-4 w-4" /> },
  { value: "analytics", label: "Analytics", icon: <TrendingUp className="h-4 w-4" /> },
];

const JOB_STATUS_OPTS = [
  { value: "OPEN", label: "Open" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "CLOSED", label: "Closed" },
];

const EMPLOYMENT_TYPE_OPTS = [
  { value: "", label: "Select type" },
  { value: "Full-time", label: "Full-time" },
  { value: "Part-time", label: "Part-time" },
  { value: "Contract", label: "Contract" },
  { value: "Internship", label: "Internship" },
];

const WORK_MODE_OPTS = [
  { value: "", label: "Select work mode" },
  { value: "On-site", label: "On-site" },
  { value: "Hybrid", label: "Hybrid" },
  { value: "Remote", label: "Remote" },
];

// All-strings form shape (numbers are parsed on save). Shared so the initial
// state, "New job" reset, and edit-prefill stay in sync.
const BLANK_JOB_FORM = {
  job_title: "", dept_no: "", open_positions: "1", job_desc: "", skills_req: "",
  employment_type: "", work_mode: "", nice_to_have_skills: "",
  min_experience_years: "", education_req: "", salary_min: "", salary_max: "",
  status: "OPEN",
};

const SOURCE_OPTS = [
  { value: "", label: "Select source" },
  { value: "Walk-in", label: "Walk-in" },
  { value: "Online", label: "Online" },
  { value: "Referral", label: "Referral" },
  { value: "Agency", label: "Agency" },
];

const INTERVIEW_TYPE_OPTS = [
  { value: "", label: "Select type" },
  { value: "HR", label: "HR" },
  { value: "Technical", label: "Technical" },
  { value: "Final", label: "Final" },
];

const INTERVIEW_MODE_OPTS = [
  { value: "", label: "Select mode" },
  { value: "On-site", label: "On-site" },
  { value: "Online", label: "Online" },
  { value: "Phone", label: "Phone" },
];

const RATING_OPTS = [
  { value: "", label: "—" },
  { value: "Excellent", label: "Excellent" },
  { value: "Good", label: "Good" },
  { value: "Average", label: "Average" },
  { value: "Poor", label: "Poor" },
];

const EMPTY_FEEDBACK = {
  feedback_owner: "", technical_rating: "", communication_rating: "",
  culture_fit_rating: "", feedback: "",
};

// ─────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────

export function RecruitmentPanel({ adminCardNo }: { adminCardNo: string }) {
  const [tab, setTab] = useState<RecTab>("jobs");
  // Set when another tab wants to open a specific candidate profile.
  const [jumpCandidateId, setJumpCandidateId] = useState<number | null>(null);
  const { activeCompany, activeBranch } = useAuth();
  // Recruitment data — including the Talent Pool — is filtered to the currently
  // selected company/branch (backend-enforced): company 1's candidates are
  // invisible to company 2. scopeKey re-mounts the active tab on switch → refetch.
  const scope = { compc: activeCompany || undefined, brnch: activeBranch || undefined };
  const scopeKey = `${activeCompany}|${activeBranch}`;

  function openCandidate(id: number) {
    setJumpCandidateId(id);
    setTab("candidates");
  }

  return (
    <div>
      <PageHeader
        title="Recruitment"
        subtitle="Manage job openings, candidates, interviews and offers"
      />

      {/* Sub-tab bar */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-6 overflow-x-auto">
        {REC_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              tab === t.value
                ? "bg-white text-indigo-700 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "jobs" && <JobsTab key={scopeKey} adminCardNo={adminCardNo} scope={scope} />}
      {tab === "candidates" && (
        <CandidatesTab
          key={scopeKey}
          adminCardNo={adminCardNo}
          scope={scope}
          initialCandidateId={jumpCandidateId}
          onConsumeJump={() => setJumpCandidateId(null)}
          onGoToRanking={() => setTab("ai-ranking")}
        />
      )}
      {tab === "applications" && (
        <ApplicationsTab key={scopeKey} adminCardNo={adminCardNo} scope={scope} onOpenCandidate={openCandidate} />
      )}
      {tab === "ai-ranking" && (
        <AiRankingTab key={scopeKey} adminCardNo={adminCardNo} scope={scope} onOpenCandidate={openCandidate} />
      )}
      {tab === "interviews" && <InterviewsTab key={scopeKey} adminCardNo={adminCardNo} scope={scope} />}
      {tab === "offers" && <OffersTab key={scopeKey} adminCardNo={adminCardNo} scope={scope} />}
      {tab === "analytics" && <AnalyticsTab key={scopeKey} adminCardNo={adminCardNo} scope={scope} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// AI RANKING TAB — top-K applicants for a job, ranked by AI score
// ─────────────────────────────────────────────────────────────────

function scorePillClasses(band: string | null): string {
  if (band === "strong") return "bg-green-100 text-green-700";
  if (band === "review") return "bg-amber-100 text-amber-700";
  if (band === "weak") return "bg-red-100 text-red-700";
  return "bg-gray-100 text-gray-500";
}

function avatarInitials(name: string | null): string {
  const parts = (name || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

type RankFilter = "all" | "pending" | "flagged" | "shortlisted" | "rejected";
const TOP_K_OPTS = [
  { value: "10", label: "Top 10" },
  { value: "20", label: "Top 20" },
  { value: "50", label: "Top 50" },
  { value: "200", label: "All" },
];
const RANK_SORT_OPTS = [
  { value: "score", label: "Sort: AI score" },
  { value: "name", label: "Sort: Name" },
];

function AiRankingTab({
  adminCardNo, scope, onOpenCandidate,
}: {
  adminCardNo: string;
  scope?: { compc?: string; brnch?: string };
  onOpenCandidate: (id: number) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [data, setData] = useState<TopCandidatesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"score" | "name">("score");
  const [filter, setFilter] = useState<RankFilter>("all");
  const [topK, setTopK] = useState(10);
  const [busyApp, setBusyApp] = useState<number | null>(null);
  const [notifyCtx, setNotifyCtx] = useState<NotifyContext | null>(null);

  // Load the job list (for the selector) once per scope; default to the first.
  useEffect(() => {
    let alive = true;
    listJobs(adminCardNo, undefined, scope)
      .then((res) => {
        if (!alive) return;
        setJobs(res.items);
        setJobId((prev) => prev ?? (res.items[0]?.job_id ?? null));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load jobs"));
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, scope?.compc, scope?.brnch]);

  const loadRanking = useCallback(async () => {
    if (jobId == null) { setData(null); return; }
    setLoading(true);
    setError(null);
    try {
      // Fetch all applicants (up to 200) so the filter chips/counts are accurate;
      // the "Top K" selector then caps how many cards are shown in the All view.
      const res = await getTopCandidates(adminCardNo, jobId, 200, scope);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ranking");
      setData(null);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, jobId, scope?.compc, scope?.brnch]);

  useEffect(() => { loadRanking(); }, [loadRanking]);

  async function setStatus(appId: number, status: string) {
    setBusyApp(appId);
    try {
      await updateApplicationStatus(adminCardNo, appId, status);
      // Shortlist/Reject open the notification dialog for that event.
      const evt = status === "SHORTLISTED" ? "Shortlisted" : status === "REJECTED" ? "Rejected" : null;
      if (evt) {
        const cand = (data?.candidates ?? []).find((c) => c.app_id === appId);
        const job = jobs.find((j) => j.job_id === jobId);
        setNotifyCtx({
          appId, eventType: evt,
          title: `${cand?.candidate_name || `Application #${appId}`}${job ? ` — ${job.job_title}` : ""}`,
          interviewerEmpcodes: [],
        });
      }
      await loadRanking();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setBusyApp(null);
    }
  }

  const all = data?.candidates ?? [];
  // Client-side partition so the chips sum to the total (matches the mockup).
  const bucket = (c: RankedApplicant): RankFilter => {
    if (c.status === "SHORTLISTED") return "shortlisted";
    if (c.status === "REJECTED") return "rejected";
    return c.ai_flagged ? "flagged" : "pending";
  };
  const chipCounts = {
    all: all.length,
    pending: all.filter((c) => bucket(c) === "pending").length,
    flagged: all.filter((c) => bucket(c) === "flagged").length,
    shortlisted: all.filter((c) => bucket(c) === "shortlisted").length,
    rejected: all.filter((c) => bucket(c) === "rejected").length,
  };

  const term = search.trim().toLowerCase();
  let visible = all.filter((c) => (filter === "all" ? true : bucket(c) === filter));
  if (term) {
    visible = visible.filter((c) =>
      [c.candidate_name, c.preferred_job_title, c.ai_note, c.email]
        .some((v) => (v || "").toLowerCase().includes(term))
    );
  }
  visible = [...visible].sort((a, b) =>
    sort === "name"
      ? (a.candidate_name || "").localeCompare(b.candidate_name || "")
      : (b.overall_score ?? -1) - (a.overall_score ?? -1)
  );
  // Cap to Top K only in the default (All + score) view; drilling into a bucket
  // or searching shows every match.
  const capped = filter === "all" && sort === "score" && !term ? visible.slice(0, topK) : visible;

  const jobOpts = jobs.map((j) => ({ value: String(j.job_id), label: j.job_title }));
  const CHIPS: { key: RankFilter; label: string; count: number; active: string }[] = [
    { key: "all", label: "All", count: chipCounts.all, active: "bg-gray-900 text-white" },
    { key: "pending", label: "Pending", count: chipCounts.pending, active: "bg-amber-500 text-white" },
    { key: "flagged", label: "AI flagged for review", count: chipCounts.flagged, active: "bg-indigo-600 text-white" },
    { key: "shortlisted", label: "Shortlisted", count: chipCounts.shortlisted, active: "bg-green-600 text-white" },
    { key: "rejected", label: "Rejected", count: chipCounts.rejected, active: "bg-red-500 text-white" },
  ];

  return (
    <div className="animate-fade-in">
      {error && <div className="mb-4"><Alert type="error" message={error} onClose={() => setError(null)} /></div>}

      {notifyCtx && (
        <NotificationDialog
          adminCardNo={adminCardNo}
          ctx={notifyCtx}
          onClose={() => setNotifyCtx(null)}
        />
      )}

      {/* Controls */}
      <div className="flex flex-col lg:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidate name or skill"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
        <div className="flex gap-3">
          <Select
            options={jobOpts.length ? jobOpts : [{ value: "", label: "No jobs" }]}
            value={jobId != null ? String(jobId) : ""}
            onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : null)}
          />
          <Select options={TOP_K_OPTS} value={String(topK)} onChange={(e) => setTopK(Number(e.target.value))} />
          <Select options={RANK_SORT_OPTS} value={sort} onChange={(e) => setSort(e.target.value as "score" | "name")} />
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        {CHIPS.map((chip) => (
          <button
            key={chip.key}
            onClick={() => setFilter(chip.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === chip.key ? chip.active : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {chip.label} ({chip.count})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : jobId == null ? (
        <Card><CardContent className="py-12 text-center text-gray-500">Select a job to see its AI-ranked candidates.</CardContent></Card>
      ) : capped.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-gray-500">
          {all.length === 0 ? "No applicants for this job yet. Drop CVs into the job's CV_Buffer to have the AI screen them." : "No candidates match this filter."}
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-gray-100">
            {capped.map((c) => (
              <div key={c.app_id} className="p-4 hover:bg-gray-50">
                <div className="flex items-center gap-4">
                  <div className="h-11 w-11 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-sm font-semibold text-gray-600">
                    {avatarInitials(c.candidate_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => c.candidate_id && onOpenCandidate(c.candidate_id)}
                      className="font-semibold text-gray-900 hover:text-indigo-700 truncate block text-left"
                      disabled={!c.candidate_id}
                    >
                      {c.candidate_name || "Unknown"}
                    </button>
                    <p className="text-sm text-gray-500 truncate">
                      {c.preferred_job_title || data?.job_title}
                      {c.location ? ` · ${c.location}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      title={c.recommendation || undefined}
                      className={`px-2.5 py-1 rounded-md text-sm font-semibold ${scorePillClasses(c.score_band)}`}
                    >
                      {c.overall_score != null ? `${c.overall_score}%` : "Pending"}
                    </span>
                    {c.candidate_id && c.cv_file_name ? (
                      <a
                        href={candidateCvUrl(adminCardNo, c.candidate_id, true, scope)}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <FileText className="h-4 w-4" /> View CV
                      </a>
                    ) : null}
                  </div>
                </div>

                {c.ai_flagged && c.ai_note ? (
                  <div className="mt-3 ml-[60px] flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                    <Sparkles className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-amber-800"><span className="font-medium">AI note:</span> {c.ai_note}</p>
                  </div>
                ) : null}

                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={() => setStatus(c.app_id, "SHORTLISTED")}
                    disabled={busyApp === c.app_id || c.status === "SHORTLISTED"}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-green-300 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CheckCircle className="h-4 w-4" /> {c.status === "SHORTLISTED" ? "Shortlisted" : "Shortlist"}
                  </button>
                  <button
                    onClick={() => setStatus(c.app_id, "REJECTED")}
                    disabled={busyApp === c.app_id || c.status === "REJECTED"}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <XCircle className="h-4 w-4" /> {c.status === "REJECTED" ? "Rejected" : "Reject"}
                  </button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// JOBS TAB
// ─────────────────────────────────────────────────────────────────

function JobsTab({ adminCardNo, scope }: { adminCardNo: string; scope?: { compc?: string; brnch?: string } }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [form, setForm] = useState({ ...BLANK_JOB_FORM });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listJobs(adminCardNo, undefined, scope);
      setJobs(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, scope?.compc, scope?.brnch]);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditJob(null);
    setForm({ ...BLANK_JOB_FORM });
    setShowForm(true);
  }

  function openEdit(j: Job) {
    setEditJob(j);
    setForm({
      job_title: j.job_title,
      dept_no: j.dept_no?.toString() || "",
      open_positions: j.open_positions?.toString() || "1",
      job_desc: j.job_desc || "",
      skills_req: j.skills_req || "",
      employment_type: j.employment_type || "",
      work_mode: j.work_mode || "",
      nice_to_have_skills: j.nice_to_have_skills || "",
      min_experience_years: j.min_experience_years?.toString() || "",
      education_req: j.education_req || "",
      salary_min: j.salary_min?.toString() || "",
      salary_max: j.salary_max?.toString() || "",
      status: j.status,
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.job_title.trim()) { setError("Job title is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const data = {
        job_title: form.job_title.trim(),
        dept_no: form.dept_no ? parseInt(form.dept_no) : undefined,
        open_positions: parseInt(form.open_positions) || 1,
        job_desc: form.job_desc || undefined,
        skills_req: form.skills_req || undefined,
        employment_type: form.employment_type || undefined,
        work_mode: form.work_mode || undefined,
        nice_to_have_skills: form.nice_to_have_skills || undefined,
        min_experience_years: form.min_experience_years ? parseInt(form.min_experience_years) : undefined,
        education_req: form.education_req || undefined,
        salary_min: form.salary_min ? parseFloat(form.salary_min) : undefined,
        salary_max: form.salary_max ? parseFloat(form.salary_max) : undefined,
        status: form.status,
      };
      if (editJob) {
        await updateJob(adminCardNo, editJob.job_id, data);
        setSuccess("Job updated successfully");
      } else {
        await createJob(adminCardNo, data, scope);
        setSuccess("Job created successfully");
      }
      setShowForm(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (showForm) {
    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h2 className="text-xl font-semibold text-gray-900">{editJob ? "Edit Job" : "New Job Opening"}</h2>
        </div>
        {error && <div className="mb-4"><Alert type="error" message={error} onClose={() => setError(null)} /></div>}
        <Card className="mb-4">
          <CardContent className="py-6 space-y-6">
            {/* ── Basic information ── */}
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-3">Basic information</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Input label="Job Title *" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="e.g. Senior Software Engineer" />
                </div>
                <Input label="Department No" type="number" value={form.dept_no} onChange={(e) => setForm({ ...form, dept_no: e.target.value })} placeholder="e.g. 11" />
                <Input label="Open Positions" type="number" value={form.open_positions} onChange={(e) => setForm({ ...form, open_positions: e.target.value })} min={1} />
                <Select label="Employment Type" options={EMPLOYMENT_TYPE_OPTS} value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })} />
                <Select label="Work Mode" options={WORK_MODE_OPTS} value={form.work_mode} onChange={(e) => setForm({ ...form, work_mode: e.target.value })} />
              </div>
            </div>

            {/* ── Requirements — used for AI CV matching ── */}
            <div className="border-t border-gray-200 pt-6">
              <p className="text-sm font-semibold text-gray-900 mb-1">
                Requirements <span className="font-normal text-gray-500 text-xs">— used for AI CV matching</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Job Description</label>
                  <textarea
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    rows={3}
                    value={form.job_desc}
                    onChange={(e) => setForm({ ...form, job_desc: e.target.value })}
                    placeholder="Describe the role and responsibilities..."
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Must-have skills</label>
                  <textarea
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    rows={2}
                    value={form.skills_req}
                    onChange={(e) => setForm({ ...form, skills_req: e.target.value })}
                    placeholder="e.g. Python, Oracle ERP, SQL"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nice-to-have skills</label>
                  <textarea
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    rows={2}
                    value={form.nice_to_have_skills}
                    onChange={(e) => setForm({ ...form, nice_to_have_skills: e.target.value })}
                    placeholder="e.g. Power BI, AWS"
                  />
                </div>
                <Input label="Min. Experience (years)" type="number" min={0} value={form.min_experience_years} onChange={(e) => setForm({ ...form, min_experience_years: e.target.value })} placeholder="e.g. 3" />
                <Input label="Education Requirement" value={form.education_req} onChange={(e) => setForm({ ...form, education_req: e.target.value })} placeholder="e.g. Bachelor's, Computer Science" />
              </div>
            </div>

            {/* ── Compensation and status ── */}
            <div className="border-t border-gray-200 pt-6">
              <p className="text-sm font-semibold text-gray-900 mb-3">Compensation and status</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Input label="Salary Min" type="number" min={0} value={form.salary_min} onChange={(e) => setForm({ ...form, salary_min: e.target.value })} placeholder="e.g. 150000" />
                <Input label="Salary Max" type="number" min={0} value={form.salary_max} onChange={(e) => setForm({ ...form, salary_max: e.target.value })} placeholder="e.g. 220000" />
                {editJob && (
                  <Select label="Status" options={JOB_STATUS_OPTS} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="flex gap-3">
          <Button onClick={handleSave} loading={saving}>{editJob ? "Update Job" : "Create Job"}</Button>
          <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {error && <div className="mb-4"><Alert type="error" message={error} onClose={() => setError(null)} /></div>}
      {success && <div className="mb-4"><Alert type="success" message={success} onClose={() => setSuccess(null)} /></div>}
      <div className="flex justify-end mb-4">
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-1.5" />New Job</Button>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Open Positions</h2>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : jobs.length === 0 ? (
            <p className="text-center text-gray-500 py-12">No jobs found. Create your first job opening.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
                    <th className="pb-3 pr-4">ID</th>
                    <th className="pb-3 pr-4">Title</th>
                    <th className="pb-3 pr-4">Department</th>
                    <th className="pb-3 pr-4 text-center">Open</th>
                    <th className="pb-3 pr-4 text-center">Filled</th>
                    <th className="pb-3 pr-4 text-center">Remaining</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {jobs.map((j) => (
                    <tr key={j.job_id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 pr-4 text-gray-400">#{j.job_id}</td>
                      <td className="py-3 pr-4 font-medium text-gray-900">{j.job_title}</td>
                      <td className="py-3 pr-4 text-gray-600">{j.dept_name || j.dept_no || "—"}</td>
                      <td className="py-3 pr-4 text-center text-gray-700">{j.open_positions}</td>
                      <td className="py-3 pr-4 text-center text-green-600">{j.filled_positions}</td>
                      <td className="py-3 pr-4 text-center text-indigo-600 font-medium">{j.remaining_positions}</td>
                      <td className="py-3 pr-4"><Badge status={j.status} /></td>
                      <td className="py-3">
                        <button onClick={() => openEdit(j)} className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// TALENT POOL (CANDIDATES) TAB
//
// One person = one permanent profile (never duplicated within a company).
// Add once, then apply the same candidate to any number of jobs. Re-uploading
// a CV replaces the current resume on the same profile. The pool is scoped to
// the selected company/branch — each company sees only its own candidates.
// ─────────────────────────────────────────────────────────────────

type CandView = "list" | "form" | "detail" | "upload";

interface CandFormState {
  candidate_name: string;
  email: string;
  mobile: string;
  location: string;
  preferred_job_title: string;
  profile_summary: string;
  education: { institution: string; degree: string; graduation_year: string }[];
  experience: { company: string; role: string; duration: string; description: string }[];
  skills: string; // comma-separated in the input; split on save
}

const EMPTY_CAND_FORM: CandFormState = {
  candidate_name: "", email: "", mobile: "", location: "",
  preferred_job_title: "", profile_summary: "",
  education: [], experience: [], skills: "",
};

function CandidatesTab({
  adminCardNo, scope, initialCandidateId, onConsumeJump, onGoToRanking,
}: {
  adminCardNo: string;
  scope?: { compc?: string; brnch?: string };
  initialCandidateId?: number | null;
  onConsumeJump?: () => void;
  onGoToRanking?: () => void;
}) {
  const [view, setView] = useState<CandView>("list");
  const [candidates, setCandidates] = useState<CandidateListItem[]>([]);
  const [sortBy, setSortBy] = useState<"newest" | "name" | "applications">("newest");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<CandFormState>(EMPTY_CAND_FORM);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  // Apply-to-job (in detail view)
  const [openJobs, setOpenJobs] = useState<Job[]>([]);
  const [applyJobId, setApplyJobId] = useState("");
  const [applying, setApplying] = useState(false);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCandidates(adminCardNo, q || undefined, scope);
      setCandidates(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load talent pool");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, scope?.compc, scope?.brnch]);

  const openDetail = useCallback(async (id: number) => {
    setError(null);
    try {
      const [cand, jobsRes] = await Promise.all([
        getCandidate(adminCardNo, id, scope),
        listJobs(adminCardNo, "OPEN", scope),
      ]);
      setDetail(cand);
      setOpenJobs(jobsRes.items);
      setApplyJobId("");
      setView("detail");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load candidate");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, scope?.compc, scope?.brnch]);

  useEffect(() => { load(); }, [load]);

  // Jump-in from another tab (e.g. clicking a candidate on Applications).
  useEffect(() => {
    if (initialCandidateId) {
      openDetail(initialCandidateId);
      onConsumeJump?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCandidateId]);

  function openEdit(c: CandidateDetail) {
    setEditId(c.candidate_id);
    setForm({
      candidate_name: c.candidate_name || "",
      email: c.email || "",
      mobile: c.mobile || "",
      location: c.location || "",
      preferred_job_title: c.preferred_job_title || "",
      profile_summary: c.profile_summary || "",
      education: c.education.map((e) => ({
        institution: e.institution || "", degree: e.degree || "",
        graduation_year: e.graduation_year || "",
      })),
      experience: c.experience.map((e) => ({
        company: e.company || "", role: e.role || "",
        duration: e.duration || "", description: e.description || "",
      })),
      skills: c.skills.join(", "),
    });
    setCvFile(null);
    setView("form");
  }

  async function handleSave() {
    if (!form.candidate_name.trim()) { setError("Candidate name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        candidate_name: form.candidate_name.trim(),
        email: form.email.trim() || undefined,
        mobile: form.mobile.trim() || undefined,
        location: form.location.trim() || undefined,
        preferred_job_title: form.preferred_job_title.trim() || undefined,
        profile_summary: form.profile_summary.trim() || undefined,
        education: form.education,
        experience: form.experience,
        skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
      };
      let candidateId = editId;
      if (editId) {
        await updateCandidate(adminCardNo, editId, payload, scope);
      } else {
        const res = await createCandidate(adminCardNo, payload, scope);
        candidateId = res.candidate_id;
      }
      if (cvFile && candidateId) {
        await uploadCandidateCv(adminCardNo, candidateId, cvFile, scope);
      }
      setSuccess(editId ? "Candidate updated" : "Candidate added to talent pool");
      setCvFile(null);
      await load(search);
      if (candidateId) await openDetail(candidateId); else setView("list");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleApply() {
    if (!detail || !applyJobId) { setError("Select a job to apply to"); return; }
    setApplying(true);
    setError(null);
    try {
      await applyCandidateToJob(adminCardNo, detail.candidate_id, {
        job_id: parseInt(applyJobId), source: "Talent Pool",
      }, scope);
      setSuccess("Application created — AI is scoring the candidate for this job. The score appears shortly.");
      setApplyJobId("");
      await openDetail(detail.candidate_id); // refresh application history
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply");
    } finally {
      setApplying(false);
    }
  }

  async function handleCvReplace(file: File) {
    if (!detail) return;
    setError(null);
    try {
      await uploadCandidateCv(adminCardNo, detail.candidate_id, file, scope);
      setSuccess("CV updated");
      await openDetail(detail.candidate_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CV upload failed");
    }
  }

  const alerts = (
    <>
      {error && <div className="mb-4"><Alert type="error" message={error} onClose={() => setError(null)} /></div>}
      {success && <div className="mb-4"><Alert type="success" message={success} onClose={() => setSuccess(null)} /></div>}
    </>
  );

  // ── UPLOAD (bulk CV → auto-extracted profiles) ──
  if (view === "upload") {
    return (
      <AddCandidatesToJobPanel
        adminCardNo={adminCardNo}
        scope={scope}
        onBack={() => setView("list")}
        onDone={() => { setView("list"); load(); }}
      />
    );
  }

  // ── FORM (add / edit) ──
  if (view === "form") {
    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setView(editId && detail ? "detail" : "list")} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h2 className="text-xl font-semibold text-gray-900">
            {editId ? "Edit Candidate" : "Add Candidate to Talent Pool"}
          </h2>
        </div>
        {alerts}

        <Card className="mb-4">
          <CardHeader><h3 className="text-sm font-semibold text-gray-700">Profile</h3></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Full Name *" value={form.candidate_name} onChange={(e) => setForm({ ...form, candidate_name: e.target.value })} placeholder="e.g. Ahmed Khan" />
              <Input label="Preferred Job Title" value={form.preferred_job_title} onChange={(e) => setForm({ ...form, preferred_job_title: e.target.value })} placeholder="e.g. Backend Engineer" />
              <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
              <Input label="Mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="03xx-xxxxxxx" />
              <Input label="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Karachi" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CV / Resume {editId ? "(replace)" : ""}</label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.rtf"
                  onChange={(e) => setCvFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:text-sm file:font-medium hover:file:bg-indigo-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Profile Summary</label>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  rows={3}
                  value={form.profile_summary}
                  onChange={(e) => setForm({ ...form, profile_summary: e.target.value })}
                  placeholder="Short professional summary..."
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Skills (comma separated)</label>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  rows={2}
                  value={form.skills}
                  onChange={(e) => setForm({ ...form, skills: e.target.value })}
                  placeholder="e.g. Python, Oracle, FastAPI, React"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Education */}
        <Card className="mb-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-indigo-600" />
                <h3 className="text-sm font-semibold text-gray-700">Education</h3>
              </div>
              <Button variant="secondary" size="sm"
                onClick={() => setForm({ ...form, education: [...form.education, { institution: "", degree: "", graduation_year: "" }] })}>
                <Plus className="h-3.5 w-3.5 mr-1" />Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {form.education.length === 0 ? (
              <p className="text-sm text-gray-400">No education entries.</p>
            ) : form.education.map((edu, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_120px_36px] gap-2 mb-2 items-end">
                <Input label={i === 0 ? "Institution" : ""} value={edu.institution}
                  onChange={(e) => setForm({ ...form, education: form.education.map((x, xi) => xi === i ? { ...x, institution: e.target.value } : x) })}
                  placeholder="University / College" />
                <Input label={i === 0 ? "Degree" : ""} value={edu.degree}
                  onChange={(e) => setForm({ ...form, education: form.education.map((x, xi) => xi === i ? { ...x, degree: e.target.value } : x) })}
                  placeholder="e.g. BS Computer Science" />
                <Input label={i === 0 ? "Year" : ""} value={edu.graduation_year}
                  onChange={(e) => setForm({ ...form, education: form.education.map((x, xi) => xi === i ? { ...x, graduation_year: e.target.value } : x) })}
                  placeholder="2022" />
                <button onClick={() => setForm({ ...form, education: form.education.filter((_, xi) => xi !== i) })}
                  className="h-9 flex items-center justify-center text-red-400 hover:text-red-600" title="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Experience */}
        <Card className="mb-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-indigo-600" />
                <h3 className="text-sm font-semibold text-gray-700">Experience</h3>
              </div>
              <Button variant="secondary" size="sm"
                onClick={() => setForm({ ...form, experience: [...form.experience, { company: "", role: "", duration: "", description: "" }] })}>
                <Plus className="h-3.5 w-3.5 mr-1" />Add
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {form.experience.length === 0 ? (
              <p className="text-sm text-gray-400">No experience entries.</p>
            ) : form.experience.map((exp, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3 mb-3">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_140px_36px] gap-2 items-end mb-2">
                  <Input label={i === 0 ? "Company" : ""} value={exp.company}
                    onChange={(e) => setForm({ ...form, experience: form.experience.map((x, xi) => xi === i ? { ...x, company: e.target.value } : x) })}
                    placeholder="Company name" />
                  <Input label={i === 0 ? "Role" : ""} value={exp.role}
                    onChange={(e) => setForm({ ...form, experience: form.experience.map((x, xi) => xi === i ? { ...x, role: e.target.value } : x) })}
                    placeholder="e.g. Software Engineer" />
                  <Input label={i === 0 ? "Duration" : ""} value={exp.duration}
                    onChange={(e) => setForm({ ...form, experience: form.experience.map((x, xi) => xi === i ? { ...x, duration: e.target.value } : x) })}
                    placeholder="e.g. 2 years" />
                  <button onClick={() => setForm({ ...form, experience: form.experience.filter((_, xi) => xi !== i) })}
                    className="h-9 flex items-center justify-center text-red-400 hover:text-red-600" title="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  rows={2}
                  value={exp.description}
                  onChange={(e) => setForm({ ...form, experience: form.experience.map((x, xi) => xi === i ? { ...x, description: e.target.value } : x) })}
                  placeholder="What did they do there?"
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button onClick={handleSave} loading={saving}>{editId ? "Update Candidate" : "Add to Talent Pool"}</Button>
          <Button variant="ghost" onClick={() => setView(editId && detail ? "detail" : "list")}>Cancel</Button>
        </div>
      </div>
    );
  }

  // ── DETAIL (profile) ──
  if (view === "detail" && detail) {
    const appliedJobIds = new Set(detail.applications.map((a) => a.job_id));
    const applyOptions = [
      { value: "", label: "Select an open job…" },
      ...openJobs.filter((j) => !appliedJobIds.has(j.job_id))
        .map((j) => ({ value: String(j.job_id), label: j.job_title })),
    ];
    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setView("list")} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h2 className="text-xl font-semibold text-gray-900">{detail.candidate_name}</h2>
          <span className="text-sm text-gray-400">#{detail.candidate_id}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => openEdit(detail)}>Edit Profile</Button>
          </div>
        </div>
        {alerts}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: profile card */}
          <div className="space-y-4">
            <Card>
              <CardHeader><h3 className="text-sm font-semibold text-gray-700">Profile</h3></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {detail.preferred_job_title && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <Briefcase className="h-4 w-4 text-gray-400" />{detail.preferred_job_title}
                  </div>
                )}
                {detail.email && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail className="h-4 w-4 text-gray-400" />{detail.email}
                  </div>
                )}
                {detail.mobile && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="h-4 w-4 text-gray-400" />{detail.mobile}
                  </div>
                )}
                {detail.location && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <MapPin className="h-4 w-4 text-gray-400" />{detail.location}
                  </div>
                )}
                {detail.profile_summary && (
                  <p className="text-gray-600 pt-2 border-t border-gray-100 mt-2">{detail.profile_summary}</p>
                )}
                <p className="text-xs text-gray-400 pt-1">In pool since {detail.created_at || "—"}</p>
              </CardContent>
            </Card>

            {/* CV */}
            <Card>
              <CardHeader><h3 className="text-sm font-semibold text-gray-700">Resume / CV</h3></CardHeader>
              <CardContent>
                {detail.cv_file_name ? (
                  <div className="flex items-center gap-2 mb-3 text-sm text-gray-700">
                    <FileText className="h-4 w-4 text-indigo-500 shrink-0" />
                    <span className="truncate">{detail.cv_file_name}</span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 mb-3">No CV uploaded yet.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {detail.cv_file_name && (
                    <a href={candidateCvUrl(adminCardNo, detail.candidate_id, false, scope)}
                      className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
                      <Download className="h-3.5 w-3.5 mr-1" />Download
                    </a>
                  )}
                  <label className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-50 text-gray-700 hover:bg-gray-100 cursor-pointer">
                    <Upload className="h-3.5 w-3.5 mr-1" />{detail.cv_file_name ? "Replace CV" : "Upload CV"}
                    <input type="file" accept=".pdf,.doc,.docx,.txt,.rtf" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCvReplace(f); e.target.value = ""; }} />
                  </label>
                </div>
              </CardContent>
            </Card>

            {/* Skills */}
            <Card>
              <CardHeader><h3 className="text-sm font-semibold text-gray-700">Skills</h3></CardHeader>
              <CardContent>
                {detail.skills.length === 0 ? (
                  <p className="text-sm text-gray-400">No skills recorded.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.skills.map((s, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">{s}</span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: education, experience, applications */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-indigo-600" />
                  <h3 className="text-sm font-semibold text-gray-700">Education</h3>
                </div>
              </CardHeader>
              <CardContent>
                {detail.education.length === 0 ? (
                  <p className="text-sm text-gray-400">No education recorded.</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.education.map((e, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium text-gray-900">{e.degree || "—"}</span>
                        <span className="text-gray-500"> — {e.institution || "—"}</span>
                        {e.graduation_year && <span className="text-gray-400"> ({e.graduation_year})</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-indigo-600" />
                  <h3 className="text-sm font-semibold text-gray-700">Experience</h3>
                </div>
              </CardHeader>
              <CardContent>
                {detail.experience.length === 0 ? (
                  <p className="text-sm text-gray-400">No experience recorded.</p>
                ) : (
                  <ul className="space-y-3">
                    {detail.experience.map((e, i) => (
                      <li key={i} className="text-sm border-l-2 border-indigo-100 pl-3">
                        <p>
                          <span className="font-medium text-gray-900">{e.role || "—"}</span>
                          <span className="text-gray-500"> at {e.company || "—"}</span>
                          {e.duration && <span className="text-gray-400"> · {e.duration}</span>}
                        </p>
                        {e.description && <p className="text-gray-500 mt-0.5">{e.description}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Applications + apply to job */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-indigo-600" />
                  <h3 className="text-sm font-semibold text-gray-700">Applications</h3>
                </div>
              </CardHeader>
              <CardContent>
                {detail.applications.length === 0 ? (
                  <p className="text-sm text-gray-400 mb-4">Not applied to any job yet.</p>
                ) : (
                  <table className="w-full text-sm mb-4">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
                        <th className="pb-2 pr-4">Job</th>
                        <th className="pb-2 pr-4">AI score</th>
                        <th className="pb-2 pr-4">Date</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {detail.applications.map((a) => (
                        <tr key={a.app_id}>
                          <td className="py-2 pr-4 font-medium text-gray-900">{a.job_title}</td>
                          <td className="py-2 pr-4">
                            {a.ai_overall_score != null ? (
                              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${scorePillClasses(
                                a.ai_overall_score >= 75 ? "strong" : a.ai_overall_score >= 40 ? "review" : "weak"
                              )}`}>{a.ai_overall_score}%</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                                <Loader2 className="h-3 w-3 animate-spin" />scoring
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-gray-600">{a.app_date || "—"}</td>
                          <td className="py-2"><Badge status={a.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="flex flex-col sm:flex-row gap-2 sm:items-end border-t border-gray-100 pt-4">
                  <div className="flex-1">
                    <Select label="Apply to Job" options={applyOptions} value={applyJobId}
                      onChange={(e) => setApplyJobId(e.target.value)} />
                  </div>
                  <Button onClick={handleApply} loading={applying} disabled={!applyJobId}>
                    <Send className="h-4 w-4 mr-1.5" />Apply
                  </Button>
                </div>
                {applyOptions.length === 1 && (
                  <p className="text-xs text-gray-400 mt-2">
                    No open jobs left to apply to (already applied, or none open in this company/branch).
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  const sortedCandidates = [...candidates].sort((a, b) => {
    if (sortBy === "name") return a.candidate_name.localeCompare(b.candidate_name);
    if (sortBy === "applications") return b.applications - a.applications;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");   // newest first
  });

  // ── LIST ──
  return (
    <div className="animate-fade-in">
      {alerts}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 w-full sm:w-80">
          <Search className="h-4 w-4 text-gray-400 shrink-0" />
          <input
            className="bg-transparent text-sm outline-none w-full placeholder:text-gray-400"
            placeholder="Search name, skill, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(search); }}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={() => load(search)}>Search</Button>
        <div className="w-full sm:w-44">
          <Select
            options={[
              { value: "newest", label: "Sort: Newest" },
              { value: "name", label: "Sort: Name (A–Z)" },
              { value: "applications", label: "Sort: Most applied" },
            ]}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          />
        </div>
        <div className="sm:ml-auto">
          <Button onClick={() => setView("upload")}>
            <UploadCloud className="h-4 w-4 mr-1.5" />Upload CVs
          </Button>
        </div>
      </div>

      {onGoToRanking && (
        <div className="flex items-center justify-between gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 mb-4">
          <p className="text-sm text-indigo-800">
            To shortlist or rank CVs for a specific position, apply a candidate to that job
            (from their profile) — the <span className="font-medium">AI Ranking</span> tab then
            sorts every applicant for that job by AI match score.
          </p>
          <Button variant="secondary" size="sm" onClick={onGoToRanking}>
            <Sparkles className="h-4 w-4 mr-1.5" />Go to AI Ranking
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Talent Pool</h2>
            <span className="text-sm text-gray-400">({candidates.length})</span>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : candidates.length === 0 ? (
            <p className="text-center text-gray-500 py-12">
              No candidates in the pool yet. Add one — their profile stays here permanently
              and can be matched to any future job.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
                    <th className="pb-3 pr-4">Candidate</th>
                    <th className="pb-3 pr-4">Contact</th>
                    <th className="pb-3 pr-4">Location</th>
                    <th className="pb-3 pr-4">Preferred Job</th>
                    <th className="pb-3 pr-4">Skills</th>
                    <th className="pb-3 pr-4 text-center">CV</th>
                    <th className="pb-3 pr-4 text-center">Apps</th>
                    <th className="pb-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {sortedCandidates.map((c) => (
                    <tr key={c.candidate_id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 pr-4">
                        <button onClick={() => openDetail(c.candidate_id)}
                          className="font-medium text-gray-900 hover:text-indigo-700">
                          {c.candidate_name}
                        </button>
                        <div className="text-xs text-gray-400">#{c.candidate_id} · added {c.created_at || "—"}</div>
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        <div>{c.mobile || "—"}</div>
                        {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
                      </td>
                      <td className="py-3 pr-4 text-gray-600">{c.location || "—"}</td>
                      <td className="py-3 pr-4 text-gray-600">{c.preferred_job_title || "—"}</td>
                      <td className="py-3 pr-4">
                        {c.skills ? (
                          <div className="flex flex-wrap gap-1 max-w-[260px]">
                            {c.skills.split(",").slice(0, 4).map((s, i) => (
                              <span key={i} className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px] font-medium">
                                {s.trim()}
                              </span>
                            ))}
                            {c.skills.split(",").length > 4 && (
                              <span className="text-[11px] text-gray-400">+{c.skills.split(",").length - 4}</span>
                            )}
                          </div>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 pr-4 text-center">
                        {c.cv_file_name ? (
                          <a href={candidateCvUrl(adminCardNo, c.candidate_id, false, scope)} title={c.cv_file_name}
                            className="inline-flex text-indigo-500 hover:text-indigo-700">
                            <Download className="h-4 w-4" />
                          </a>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 pr-4 text-center">
                        <span className={`font-medium ${c.applications > 0 ? "text-indigo-600" : "text-gray-400"}`}>
                          {c.applications}
                        </span>
                      </td>
                      <td className="py-3">
                        <button onClick={() => openDetail(c.candidate_id)}
                          className="text-indigo-600 hover:text-indigo-800 text-sm font-medium">
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ADD CANDIDATES TO A JOB — bulk CV upload → auto-extracted profiles
// ─────────────────────────────────────────────────────────────────

type StagedCv = {
  file: File;
  savedAs: string | null;      // set after upload
  state: CvFileState | "ready" | "queued" | "error";
  score: number | null;
  error?: string;
};

const MAX_CVS = 20;

function statusPill(s: StagedCv) {
  const base = "px-2.5 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1";
  switch (s.state) {
    case "ready":
      return <span className={`${base} bg-gray-100 text-gray-500`}>Ready</span>;
    case "queued":
      return <span className={`${base} bg-gray-100 text-gray-600`}>Queued</span>;
    case "processing":
      return <span className={`${base} bg-amber-100 text-amber-700`}><Loader2 className="h-3 w-3 animate-spin" />Scoring…</span>;
    case "scored":
      return <span className={`${base} bg-green-100 text-green-700`}>Scored {s.score != null ? `${s.score}%` : ""}</span>;
    case "profiled":
      return <span className={`${base} bg-green-100 text-green-700`}>Added to pool</span>;
    case "unreadable":
      return <span className={`${base} bg-red-100 text-red-600`}>Unreadable</span>;
    case "failed":
      return <span className={`${base} bg-red-100 text-red-600`}>Failed</span>;
    case "error":
      return <span className={`${base} bg-red-100 text-red-600`}>{s.error || "Rejected"}</span>;
    default:
      return <span className={`${base} bg-gray-100 text-gray-500`}>…</span>;
  }
}

function AddCandidatesToJobPanel({
  adminCardNo, scope, onBack, onDone,
}: {
  adminCardNo: string;
  scope?: { compc?: string; brnch?: string };
  onBack: () => void;
  onDone: () => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [staged, setStaged] = useState<StagedCv[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stagedRef = useRef<StagedCv[]>([]);
  useEffect(() => { stagedRef.current = staged; }, [staged]);

  useEffect(() => {
    // Job is optional; default to "no specific job" (add to pool) — the admin
    // picks a job only if they want applications + AI ranking created now.
    listJobs(adminCardNo, "OPEN", scope)
      .then((res) => setJobs(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load jobs"));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, scope?.compc, scope?.brnch]);

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    setStaged((prev) => {
      const names = new Set(prev.map((s) => s.file.name + s.file.size));
      const merged = [...prev];
      for (const f of incoming) {
        if (!names.has(f.name + f.size) && merged.length < MAX_CVS) {
          merged.push({ file: f, savedAs: null, state: "ready", score: null });
        }
      }
      return merged;
    });
  }

  function removeStaged(idx: number) {
    setStaged((prev) => prev.filter((_, i) => i !== idx));
  }

  async function uploadAndScore() {
    if (staged.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadCvsBulk(adminCardNo, jobId, staged.map((s) => s.file), scope);
      // Map upload results back onto the staged rows by original filename.
      setStaged((prev) => prev.map((s) => {
        const r = res.results.find((x) => x.filename === s.file.name && (x.saved_as || x.error));
        if (!r) return s;
        return r.queued
          ? { ...s, savedAs: r.saved_as, state: "queued" }
          : { ...s, state: "error", error: r.error };
      }));
      setUploaded(true);
      startPolling(jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function startPolling(jid: number | null) {
    if (pollRef.current) clearInterval(pollRef.current);
    const poll = async () => {
      const names = stagedRef.current.map((s) => s.savedAs).filter((n): n is string => !!n);
      if (names.length === 0) return;
      try {
        const res = await getCvStatus(adminCardNo, jid, names, scope);
        setStaged((cur) => cur.map((s) => {
          if (!s.savedAs) return s;
          const info = res.files[s.savedAs];
          if (!info) return s;
          const st: StagedCv["state"] = info.state === "unknown" ? "queued" : (info.state as StagedCv["state"]);
          return { ...s, state: st, score: info.score };
        }));
      } catch { /* keep polling; transient errors are non-fatal */ }
    };
    poll();
    pollRef.current = setInterval(poll, 4000);
  }

  // Stop polling once every uploaded file has reached a terminal state.
  const terminal = (st: StagedCv["state"]) => ["scored", "profiled", "unreadable", "failed", "error"].includes(st);
  const allDone = uploaded && staged.length > 0 && staged.every((s) => terminal(s.state));
  useEffect(() => {
    if (allDone && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, [allDone]);

  const jobOpts = [
    { value: "", label: "No specific job (add to pool)" },
    ...jobs.map((j) => ({
      value: String(j.job_id),
      label: [j.job_title, j.work_mode].filter(Boolean).join(" — "),
    })),
  ];
  const done = staged.filter((s) => s.state === "scored" || s.state === "profiled").length;

  return (
    <div className="animate-fade-in max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-700"><ArrowLeft className="h-5 w-5" /></button>
        <h2 className="text-xl font-semibold text-gray-900">Upload candidate CVs</h2>
      </div>

      {error && <div className="mb-4"><Alert type="error" message={error} onClose={() => setError(null)} /></div>}

      <Card>
        <CardContent className="py-6 space-y-5">
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">Applying for job <span className="text-gray-400">(optional)</span></label>
            <Select
              options={jobOpts}
              value={jobId != null ? String(jobId) : ""}
              onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : null)}
              disabled={uploaded}
            />
            <p className="text-xs text-gray-400 mt-1">
              {jobId != null
                ? "Each CV becomes a candidate profile and is AI-scored for this job (creates an application + ranking)."
                : "Each CV becomes a candidate profile in the talent pool. Pick a job later from the profile to create an application + AI ranking."}
            </p>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1.5">Attach CVs</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
                dragOver ? "border-indigo-400 bg-indigo-50" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <UploadCloud className="h-6 w-6 mx-auto text-gray-400 mb-2" />
              <p className="text-sm font-medium text-gray-700">Drag and drop multiple CVs, or browse</p>
              <p className="text-xs text-gray-400 mt-0.5">PDF, up to {MAX_CVS} files at once</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
              />
            </div>
          </div>

          {staged.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-gray-700">{staged.length} file{staged.length > 1 ? "s" : ""} attached</p>
                {uploaded && <p className="text-xs text-gray-400">{done}/{staged.length} processed</p>}
              </div>
              <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                {staged.map((s, i) => (
                  <div key={s.file.name + i} className="flex items-center gap-3 px-3 py-2.5">
                    <FileText className="h-4 w-4 text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-800 truncate flex-1" title={s.file.name}>{s.file.name}</span>
                    {statusPill(s)}
                    {!uploaded && (
                      <button onClick={() => removeStaged(i)} className="text-gray-300 hover:text-gray-500">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            {!uploaded ? (
              <>
                <Button onClick={uploadAndScore} loading={uploading} disabled={staged.length === 0}>
                  {jobId != null ? "Upload and score all" : "Upload all"}
                </Button>
                <Button variant="ghost" onClick={onBack}>Cancel</Button>
              </>
            ) : (
              <>
                <Button onClick={onDone}>{allDone ? "Done" : "View talent pool"}</Button>
                {!allDone && <span className="inline-flex items-center gap-2 text-sm text-gray-500 self-center"><Loader2 className="h-4 w-4 animate-spin" />Processing — profiles appear as each CV finishes.</span>}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// APPLICATIONS TAB
// ─────────────────────────────────────────────────────────────────

function ApplicationsTab({ adminCardNo, scope, onOpenCandidate }: {
  adminCardNo: string;
  scope?: { compc?: string; brnch?: string };
  onOpenCandidate?: (candidateId: number) => void;
}) {
  const [apps, setApps] = useState<Application[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pool, setPool] = useState<CandidateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filterJob, setFilterJob] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  // New-application form: pick an existing Talent Pool candidate + a job.
  const [form, setForm] = useState({ job_id: "", candidate_id: "", source: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [notifyCtx, setNotifyCtx] = useState<NotifyContext | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [appsRes, jobsRes, poolRes] = await Promise.all([
        listApplications(adminCardNo, filterJob ? parseInt(filterJob) : undefined, filterStatus || undefined, scope),
        listJobs(adminCardNo, undefined, scope),
        listCandidates(adminCardNo, undefined, scope),
      ]);
      setApps(appsRes.items);
      setJobs(jobsRes.items);
      setPool(poolRes.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, filterJob, filterStatus, scope?.compc, scope?.brnch]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!form.candidate_id || !form.job_id) { setError("Candidate and job are required"); return; }
    setSaving(true);
    setError(null);
    try {
      await createApplication(adminCardNo, {
        job_id: parseInt(form.job_id),
        candidate_id: parseInt(form.candidate_id),
        source: form.source || undefined,
        notes: form.notes || undefined,
      });
      setSuccess("Application added");
      setShowForm(false);
      setForm({ job_id: "", candidate_id: "", source: "", notes: "" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(appId: number, status: string) {
    setError(null);
    try {
      await updateApplicationStatus(adminCardNo, appId, status);
      setSuccess(`Marked as ${status.toLowerCase()}`);
      // Shortlist/Reject open the notification dialog for that event.
      const evt = status === "SHORTLISTED" ? "Shortlisted" : status === "REJECTED" ? "Rejected" : null;
      if (evt) {
        const app = apps.find((a) => a.app_id === appId);
        setNotifyCtx({
          appId, eventType: evt,
          title: app ? `${app.candidate_name} — ${app.job_title}` : `Application #${appId}`,
          interviewerEmpcodes: [],
        });
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  const jobOptions = [{ value: "", label: "All Jobs" }, ...jobs.map((j) => ({ value: String(j.job_id), label: j.job_title }))];
  const statusOptions = [
    { value: "", label: "All Status" },
    { value: "PENDING", label: "Pending" },
    { value: "SHORTLISTED", label: "Shortlisted" },
    { value: "REJECTED", label: "Rejected" },
  ];

  return (
    <div className="animate-fade-in">
      {error && <div className="mb-4"><Alert type="error" message={error} onClose={() => setError(null)} /></div>}
      {success && <div className="mb-4"><Alert type="success" message={success} onClose={() => setSuccess(null)} /></div>}

      {notifyCtx && (
        <NotificationDialog
          adminCardNo={adminCardNo}
          ctx={notifyCtx}
          onClose={(saved) => {
            setNotifyCtx(null);
            if (saved) setSuccess("Notification selections saved");
          }}
        />
      )}

      {showForm && (
        <Card className="mb-6">
          <CardHeader><h2 className="text-lg font-semibold text-gray-900">New Application</h2></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Candidate (from Talent Pool) *"
                options={[
                  { value: "", label: pool.length ? "Select candidate…" : "Talent pool is empty" },
                  ...pool.map((c) => ({
                    value: String(c.candidate_id),
                    label: `${c.candidate_name}${c.preferred_job_title ? ` — ${c.preferred_job_title}` : ""}`,
                  })),
                ]}
                value={form.candidate_id}
                onChange={(e) => setForm({ ...form, candidate_id: e.target.value })}
              />
              <Select label="Applied For *" options={jobOptions.filter(o => o.value)} value={form.job_id} onChange={(e) => setForm({ ...form, job_id: e.target.value })} />
              <Select label="Source" options={SOURCE_OPTS} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
              <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Contact details come from the candidate&apos;s permanent profile. New person?
              Add them in the <span className="font-medium text-indigo-600">Talent Pool</span> tab first — one profile, reusable for every job.
            </p>
            <div className="flex gap-3 mt-4">
              <Button onClick={handleAdd} loading={saving}>Add Application</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Select options={jobOptions} value={filterJob} onChange={(e) => setFilterJob(e.target.value)} />
        <Select options={statusOptions} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} />
        <div className="sm:ml-auto">
          <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-1.5" />New Application</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Applications Received</h2>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : apps.length === 0 ? (
            <p className="text-center text-gray-500 py-12">No applications found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
                    <th className="pb-3 pr-4">Candidate</th>
                    <th className="pb-3 pr-4">Contact</th>
                    <th className="pb-3 pr-4">Applied For</th>
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3 pr-4">Source</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {apps.map((a) => (
                    <tr key={a.app_id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 pr-4 font-medium text-gray-900">
                        {a.candidate_id && onOpenCandidate ? (
                          <button onClick={() => onOpenCandidate(a.candidate_id!)}
                            className="hover:text-indigo-700 text-left font-medium"
                            title="Open Talent Pool profile">
                            {a.candidate_name}
                          </button>
                        ) : a.candidate_name}
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        <div>{a.mobile || "—"}</div>
                        {a.email && <div className="text-xs text-gray-400">{a.email}</div>}
                      </td>
                      <td className="py-3 pr-4 text-gray-700">{a.job_title}</td>
                      <td className="py-3 pr-4 text-gray-600">{a.app_date || "—"}</td>
                      <td className="py-3 pr-4 text-gray-600">{a.source || "—"}</td>
                      <td className="py-3 pr-4"><Badge status={a.status} /></td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          {a.status !== "SHORTLISTED" && (
                            <button onClick={() => updateStatus(a.app_id, "SHORTLISTED")} title="Shortlist" className="text-green-600 hover:text-green-800">
                              <CheckCircle className="h-4 w-4" />
                            </button>
                          )}
                          {a.status !== "REJECTED" && (
                            <button onClick={() => updateStatus(a.app_id, "REJECTED")} title="Reject" className="text-red-500 hover:text-red-700">
                              <XCircle className="h-4 w-4" />
                            </button>
                          )}
                          {a.status !== "PENDING" && (
                            <button onClick={() => updateStatus(a.app_id, "PENDING")} title="Reset to Pending" className="text-gray-400 hover:text-gray-600">
                              <Clock className="h-4 w-4" />
                            </button>
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// NOTIFICATION SELECTION DIALOG
// ─────────────────────────────────────────────────────────────────
// Opens after Shortlist / Reject and after scheduling an interview. Four
// checkboxes (Email/WhatsApp x Interviewer/Candidate); each checked type
// loads its active templates for the event, defaulting to the first, with a
// raw read-only preview (placeholders intact — resolution is future-phase).
// Saving persists the choices to APPLICATION_NOTIFICATION_SELECTIONS.

const NOTIF_KINDS = [
  { key: "EMAIL|INTERVIEWER", label: "Email to Interviewer", ntype: "EMAIL", rtype: "INTERVIEWER" },
  { key: "EMAIL|CANDIDATE", label: "Email to Candidate", ntype: "EMAIL", rtype: "CANDIDATE" },
  { key: "WHATSAPP|INTERVIEWER", label: "WhatsApp to Interviewer", ntype: "WHATSAPP", rtype: "INTERVIEWER" },
  { key: "WHATSAPP|CANDIDATE", label: "WhatsApp to Candidate", ntype: "WHATSAPP", rtype: "CANDIDATE" },
] as const;

// Tailwind needs the class names statically; index = # of active previews.
const PREVIEW_GRID = ["", "sm:grid-cols-1", "sm:grid-cols-2", "sm:grid-cols-3", "sm:grid-cols-4"];

export interface NotifyContext {
  appId: number;
  eventType: string;                // Interview Scheduled / Interview Feedback / Shortlisted / Rejected / Offer Extended
  title: string;                    // dialog subtitle, e.g. candidate — job
  interviewerEmpcodes: string[];    // for INTERVIEWER selections (may be empty)
}

function NotificationDialog({
  adminCardNo, ctx, onClose,
}: {
  adminCardNo: string;
  ctx: NotifyContext;
  onClose: (saved: boolean) => void;
}) {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [chosen, setChosen] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listNotificationTemplates(adminCardNo, { event_type: ctx.eventType })
      .then((res) => setTemplates(res.items))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load templates"))
      .finally(() => setLoading(false));
  }, [adminCardNo, ctx.eventType]);

  const byKind = new Map<string, NotificationTemplate[]>();
  for (const t of templates) {
    const key = `${t.notification_type}|${t.recipient_type}`;
    byKind.set(key, [...(byKind.get(key) || []), t]);
  }

  function toggle(key: string) {
    setChecked((prev) => {
      const on = !prev[key];
      if (on && chosen[key] == null) {
        const first = (byKind.get(key) || [])[0];
        if (first) setChosen((c) => ({ ...c, [key]: first.template_id }));
      }
      return { ...prev, [key]: on };
    });
  }

  const active = NOTIF_KINDS.filter((k) => checked[k.key] && (byKind.get(k.key) || []).length > 0);

  async function save() {
    if (!active.length) { onClose(false); return; }
    setSaving(true);
    setError(null);
    try {
      await createNotificationSelections(adminCardNo, ctx.appId, active.map((k) => ({
        template_id: chosen[k.key],
        notification_type: k.ntype,
        recipient_type: k.rtype,
        ...(k.rtype === "INTERVIEWER" ? { empcodes: ctx.interviewerEmpcodes } : {}),
      })));
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save selections");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Send Notifications"
      subtitle={`${ctx.eventType} — ${ctx.title}`}
      size="xl"
      onClose={() => onClose(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>Skip</Button>
          <Button onClick={save} loading={saving} disabled={active.length === 0}>
            <Send className="h-4 w-4 mr-1.5" />Save Selections
          </Button>
        </>
      }
    >
      {error && <div className="mb-4"><Alert type="error" message={error} onClose={() => setError(null)} /></div>}
          {loading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {NOTIF_KINDS.map((k) => {
                  const available = (byKind.get(k.key) || []).length > 0;
                  const needsInterviewers = k.rtype === "INTERVIEWER" && ctx.interviewerEmpcodes.length === 0;
                  const disabled = !available || needsInterviewers;
                  return (
                    <label
                      key={k.key}
                      title={!available ? `No active ${ctx.eventType} template for this type`
                        : needsInterviewers ? "No interviewers on this application yet" : undefined}
                      className={`flex items-center gap-2 border rounded-lg px-3 py-2 text-sm ${
                        disabled ? "border-gray-100 text-gray-300 cursor-not-allowed"
                          : "border-gray-200 text-gray-800 cursor-pointer hover:border-indigo-300"
                      } ${checked[k.key] && !disabled ? "border-indigo-400 bg-indigo-50/50" : ""}`}
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={!!checked[k.key] && !disabled}
                        onChange={() => toggle(k.key)}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
                      />
                      {k.label}
                    </label>
                  );
                })}
              </div>

              {active.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8 border border-dashed border-gray-200 rounded-lg">
                  Check a notification type to preview its template.
                </p>
              ) : (
                <div className={`grid grid-cols-1 ${PREVIEW_GRID[active.length]} gap-3`}>
                  {active.map((k) => {
                    const list = byKind.get(k.key) || [];
                    const tpl = list.find((t) => t.template_id === chosen[k.key]) || list[0];
                    return (
                      <div key={k.key} className="border border-gray-200 rounded-lg overflow-hidden min-w-0">
                        <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                          <p className="text-xs font-semibold text-gray-700">{k.label}</p>
                          {list.length > 1 ? (
                            <select
                              value={chosen[k.key]}
                              onChange={(e) => setChosen((c) => ({ ...c, [k.key]: parseInt(e.target.value) }))}
                              className="mt-1 w-full border border-gray-200 rounded-md px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
                            >
                              {list.map((t) => <option key={t.template_id} value={t.template_id}>{t.template_name}</option>)}
                            </select>
                          ) : (
                            <p className="text-[11px] text-gray-400 truncate">{tpl?.template_name}</p>
                          )}
                        </div>
                        {/* Raw template preview: no forced wrapping, scrolls both ways. */}
                        <div className="overflow-auto max-h-72 bg-white">
                          <pre className="text-xs text-gray-700 p-3 whitespace-pre font-mono leading-relaxed">
{tpl?.subject ? `Subject: ${tpl.subject}\n\n` : ""}{tpl?.message_body || ""}
                          </pre>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

            </>
          )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────
// INTERVIEW PANEL POOL — shared pieces
// ─────────────────────────────────────────────────────────────────

// Merged dropdown + checkbox list: opens once, multiple selections without
// closing, searchable. The parent renders the selected values as chips.
function MultiCheckSelect({
  label, placeholder, options, selected, onToggle, disabled, emptyText,
}: {
  label?: string;
  placeholder: string;
  options: { value: string; label: string; sub?: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const term = search.trim().toLowerCase();
  const filtered = term
    ? options.filter((o) => `${o.label} ${o.value} ${o.sub || ""}`.toLowerCase().includes(term))
    : options;

  return (
    <div ref={boxRef} className="relative">
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-left focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-50 disabled:text-gray-400"
      >
        <span className={selected.length ? "text-gray-900" : "text-gray-400"}>
          {selected.length ? `${selected.length} selected` : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-gray-400">{emptyText || "No matches"}</p>
            ) : (
              filtered.map((o) => (
                <label
                  key={o.value}
                  className="flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-indigo-50/60 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(o.value)}
                    onChange={() => onToggle(o.value)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
                  />
                  <span className="text-gray-900">{o.label}</span>
                  {o.sub && <span className="text-xs text-gray-400 ml-auto">{o.sub}</span>}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Manage the interview panel pool for the selected company/branch. In the
// "All Branches" view adds/removals fan out to every branch of the company
// (server-side); a member active in every branch shows one "All Branches"
// entry (derived — one row per branch is stored underneath).
function PanelPoolModal({
  adminCardNo, scope, onClose, onChanged,
}: {
  adminCardNo: string;
  scope?: { compc?: string; brnch?: string };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pool, setPool] = useState<PanelPoolResponse | null>(null);
  const [employees, setEmployees] = useState<{ empcode: string; name?: string; location?: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [poolRes, empRes] = await Promise.all([
        getPanelPool(adminCardNo, scope),
        listHRMSEmployees(adminCardNo, "A", scope?.compc, scope?.brnch),
      ]);
      setPool(poolRes);
      setEmployees(empRes.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load panel pool");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, scope?.compc, scope?.brnch]);

  useEffect(() => { load(); }, [load]);

  // One entry per employee; the same person across several branches is merged.
  const grouped = new Map<string, { name: string | null; branches: number[]; branchNames: string[] }>();
  for (const m of pool?.items || []) {
    const g = grouped.get(m.empcode) || { name: m.name, branches: [], branchNames: [] };
    g.name = g.name || m.name;
    g.branches.push(m.brnch);
    g.branchNames.push(m.brnch_name || String(m.brnch));
    grouped.set(m.empcode, g);
  }
  const allBranchCodes = (pool?.company_branches || []).map((b) => b.lcode);
  const memberCodes = new Set(grouped.keys());

  const empOptions = employees
    .filter((e) => !memberCodes.has(e.empcode))
    .map((e) => ({
      value: e.empcode,
      label: `${e.name || e.empcode} (${e.empcode})`,
      sub: e.location ? `Branch ${e.location}` : undefined,
    }));

  function toggle(code: string) {
    setSelected((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]);
  }

  async function savePool() {
    if (!selected.length) return;
    setSaving(true);
    setError(null);
    try {
      await addPanelPoolMembers(adminCardNo, selected, scope);
      setSelected([]);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save pool");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(empcode: string) {
    setRemoving(empcode);
    setError(null);
    try {
      await deactivatePanelPoolMember(adminCardNo, empcode, scope);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setRemoving(null);
    }
  }

  const allBranchView = !scope?.brnch;
  const empByCode = new Map(employees.map((e) => [e.empcode, e]));

  return (
    <Modal
      title="Interview Panel Pool"
      subtitle={allBranchView
        ? "All Branches view — adding or removing an employee applies to every branch of the company (branches created later are not included automatically)."
        : "Only pool members can be assigned to interviews for this company/branch."}
      size="md"
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {error && <div className="mb-4"><Alert type="error" message={error} onClose={() => setError(null)} /></div>}
          {loading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : (
            <>
              <div className="mb-1">
                <MultiCheckSelect
                  label="Add active employees"
                  placeholder="Select employees…"
                  options={empOptions}
                  selected={selected}
                  onToggle={toggle}
                  emptyText="No active employees available"
                />
              </div>
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selected.map((code) => {
                    const e = empByCode.get(code);
                    return (
                      <span key={code} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-2 py-1 rounded-full">
                        {(e?.name || code)} ({code})
                        <button onClick={() => toggle(code)} className="hover:text-indigo-900"><X className="h-3 w-3" /></button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="mt-3">
                <Button onClick={savePool} loading={saving} disabled={!selected.length}>
                  <Plus className="h-4 w-4 mr-1.5" />Save Pool
                </Button>
              </div>

              <p className="text-sm font-semibold text-gray-700 mt-6 mb-2">
                Current members {grouped.size ? `(${grouped.size})` : ""}
              </p>
              {grouped.size === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-lg">
                  No pool members yet — the Schedule Interview button stays disabled until the pool is set.
                </p>
              ) : (
                <ul className="divide-y divide-gray-50 border border-gray-100 rounded-lg">
                  {[...grouped.entries()].map(([code, g]) => {
                    const coversAll = allBranchCodes.length > 0 &&
                      allBranchCodes.every((b) => g.branches.includes(b));
                    return (
                      <li key={code} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <span className="text-sm font-medium text-gray-900">{g.name || code} ({code})</span>
                          <div className="mt-0.5">
                            {coversAll && allBranchCodes.length > 1 ? (
                              <span className="text-xs bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded">All Branches</span>
                            ) : (
                              <span className="text-xs text-gray-500">{g.branchNames.join(", ")}</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => removeMember(code)}
                          disabled={removing === code}
                          className="text-red-500 hover:text-red-700 text-xs font-medium disabled:opacity-50"
                          title={allBranchView ? "Remove from every branch of the company" : "Remove from this branch"}
                        >
                          {removing === code ? "Removing…" : "Remove"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────
// INTERVIEWS TAB
// ─────────────────────────────────────────────────────────────────

function InterviewsTab({ adminCardNo, scope }: { adminCardNo: string; scope?: { compc?: string; brnch?: string } }) {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [feedbackId, setFeedbackId] = useState<number | null>(null);
  const [fb, setFb] = useState({ ...EMPTY_FEEDBACK });
  const [savingFb, setSavingFb] = useState<string | null>(null);   // which recommendation is saving
  const [rescheduleId, setRescheduleId] = useState<number | null>(null);
  const [rf, setRf] = useState({ interview_date: "", start_time: "", end_time: "", location_or_link: "", interview_mode: "" });
  const [savingReschedule, setSavingReschedule] = useState(false);
  const [form, setForm] = useState({ app_id: "", interview_date: "", interview_type: "", start_time: "", end_time: "", location_or_link: "", interview_mode: "" });
  const [saving, setSaving] = useState(false);
  const [notifyCtx, setNotifyCtx] = useState<NotifyContext | null>(null);
  // Interview panel pool: only pool members can be assigned as interviewers,
  // and scheduling is disabled entirely until a pool exists for this scope.
  const [pool, setPool] = useState<PanelPoolResponse | null>(null);
  const [showPoolModal, setShowPoolModal] = useState(false);
  const [typeOpts, setTypeOpts] = useState<{ value: string; label: string }[]>(INTERVIEW_TYPE_OPTS);
  const [panelOptions, setPanelOptions] = useState<PanelOption[]>([]);
  const [interviewers, setInterviewers] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ivRes, appsRes, poolRes] = await Promise.all([
        listInterviews(adminCardNo, undefined, undefined, scope),
        listApplications(adminCardNo, undefined, "SHORTLISTED", scope),
        getPanelPool(adminCardNo, scope).catch(() => null),
      ]);
      setInterviews(ivRes.items);
      setApps(appsRes.items);
      setPool(poolRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, scope?.compc, scope?.brnch]);

  useEffect(() => { load(); }, [load]);

  // Interview types come from the setup master (per company + global defaults).
  useEffect(() => {
    fetchInterviewTypes(scope?.compc, scope?.brnch)
      .then((res) => {
        if (res.items.length) {
          setTypeOpts([{ value: "", label: "Select type" },
            ...res.items.map((t) => ({ value: t.descr, label: t.descr }))]);
        }
      })
      .catch(() => { /* keep the built-in fallback list */ });
  }, [scope?.compc, scope?.brnch]);

  // Eligible interviewers = active pool members of the APPLICATION's
  // company/branch (fetched per selected application, enforced server-side too).
  useEffect(() => {
    setInterviewers([]);
    if (!form.app_id) { setPanelOptions([]); return; }
    getInterviewPanelOptions(adminCardNo, parseInt(form.app_id))
      .then((res) => setPanelOptions(res.items))
      .catch(() => setPanelOptions([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.app_id, adminCardNo]);

  const poolCount = new Set((pool?.items || []).map((m) => m.empcode)).size;

  async function handleSchedule() {
    if (!form.app_id) { setError("Application is required"); return; }
    if (!form.interview_type) { setError("Interview type is required"); return; }
    if (!form.interview_date) { setError("Interview date is required"); return; }
    if (!form.start_time) { setError("Start time is required"); return; }
    if (!interviewers.length) { setError("Select at least one interviewer from the panel pool"); return; }
    setSaving(true);
    setError(null);
    try {
      const appId = parseInt(form.app_id);
      await createInterviewAssignments(adminCardNo, appId, {
        empcodes: interviewers,
        interview_type: form.interview_type,
        interview_date: form.interview_date,
        start_time: form.start_time,
        end_time: form.end_time || undefined,
        location_or_link: form.location_or_link || undefined,
        interview_mode: form.interview_mode || undefined,
      });
      setSuccess("Interview scheduled");
      // Notification dialog opens for the freshly scheduled interview.
      const app = apps.find((a) => a.app_id === appId);
      setNotifyCtx({
        appId,
        eventType: "Interview Scheduled",
        title: app ? `${app.candidate_name} — ${app.job_title}` : `Application #${appId}`,
        interviewerEmpcodes: interviewers,
      });
      setShowForm(false);
      setForm({ app_id: "", interview_date: "", interview_type: "", start_time: "", end_time: "", location_or_link: "", interview_mode: "" });
      setInterviewers([]);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function markCompleted(id: number) {
    try {
      await updateInterview(adminCardNo, id, { status: "COMPLETED" });
      setSuccess("Marked as completed");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  function openReschedule(iv: Interview) {
    if (rescheduleId === iv.interview_id) { setRescheduleId(null); return; }
    setRescheduleId(iv.interview_id);
    setFeedbackId(null);
    setRf({
      interview_date: iv.interview_date || "",
      start_time: iv.start_time || "",
      end_time: iv.end_time || "",
      location_or_link: iv.location_or_link || "",
      interview_mode: iv.interview_mode || "",
    });
  }

  async function submitReschedule(interviewId: number) {
    if (!rf.start_time) { setError("Start time is required"); return; }
    setSavingReschedule(true);
    setError(null);
    try {
      await rescheduleInterview(adminCardNo, interviewId, {
        interview_date: rf.interview_date || undefined,
        start_time: rf.start_time,
        end_time: rf.end_time || undefined,
        location_or_link: rf.location_or_link || undefined,
        interview_mode: rf.interview_mode || undefined,
      });
      setSuccess("Interview rescheduled");
      setRescheduleId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reschedule");
    } finally {
      setSavingReschedule(false);
    }
  }

  function openFeedback(iv: Interview) {
    if (feedbackId === iv.interview_id) { setFeedbackId(null); return; }
    setFeedbackId(iv.interview_id);
    setRescheduleId(null);
    setFb({
      feedback_owner: iv.feedback_owner || iv.interviewer || "",
      technical_rating: iv.technical_rating || "",
      communication_rating: iv.communication_rating || "",
      culture_fit_rating: iv.culture_fit_rating || "",
      feedback: iv.feedback || "",
    });
  }

  // Submit the interview feedback with a recommendation. Reject also rejects the
  // application; Next round keeps it shortlisted for the next stage.
  async function submitFeedback(iv: Interview, recommendation: string) {
    setSavingFb(recommendation);
    setError(null);
    try {
      await updateInterview(adminCardNo, iv.interview_id, {
        ...fb, recommendation, status: "COMPLETED",
      });
      if (recommendation === "Reject") await updateApplicationStatus(adminCardNo, iv.app_id, "REJECTED");
      else if (recommendation === "Next round") await updateApplicationStatus(adminCardNo, iv.app_id, "SHORTLISTED");
      setSuccess(`Feedback saved (${recommendation})`);
      setFeedbackId(null);
      // Notify the candidate about the outcome of this round: Reject uses the
      // rejection templates, everything else the neutral feedback templates.
      setNotifyCtx({
        appId: iv.app_id,
        eventType: recommendation === "Reject" ? "Rejected" : "Interview Feedback",
        title: `${iv.candidate_name} — ${iv.job_title}`,
        interviewerEmpcodes: [],
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save feedback");
    } finally {
      setSavingFb(null);
    }
  }

  const appOptions = [{ value: "", label: "Select shortlisted candidate" }, ...apps.map((a) => ({ value: String(a.app_id), label: `${a.candidate_name} — ${a.job_title}` }))];

  return (
    <div className="animate-fade-in">
      {error && <div className="mb-4"><Alert type="error" message={error} onClose={() => setError(null)} /></div>}
      {success && <div className="mb-4"><Alert type="success" message={success} onClose={() => setSuccess(null)} /></div>}

      {showForm && (
        <Card className="mb-6">
          <CardHeader><h2 className="text-lg font-semibold text-gray-900">Schedule Interview</h2></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Select label="Candidate *" options={appOptions} value={form.app_id} onChange={(e) => setForm({ ...form, app_id: e.target.value })} />
              </div>
              <Input label="Interview Date *" type="date" value={form.interview_date} onChange={(e) => setForm({ ...form, interview_date: e.target.value })} />
              <Select label="Type *" options={typeOpts} value={form.interview_type} onChange={(e) => setForm({ ...form, interview_type: e.target.value })} />
              <Input label="Start Time *" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              <Input label="End Time" type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} placeholder="Defaults to start + 1h" />
              <Select label="Mode" options={INTERVIEW_MODE_OPTS} value={form.interview_mode} onChange={(e) => setForm({ ...form, interview_mode: e.target.value })} />
              <Input label="Location / Link" value={form.location_or_link} onChange={(e) => setForm({ ...form, location_or_link: e.target.value })} placeholder="Office address or meeting URL" />
              <div className="sm:col-span-2">
                <MultiCheckSelect
                  label="Interviewers * (panel pool only)"
                  placeholder={form.app_id ? "Select interviewers…" : "Select a candidate first"}
                  disabled={!form.app_id}
                  options={panelOptions.map((o) => ({
                    value: o.empcode,
                    label: `${o.name || o.empcode} (${o.empcode})`,
                    sub: o.branches ? `Branch ${o.branches}` : undefined,
                  }))}
                  selected={interviewers}
                  onToggle={(code) => setInterviewers((prev) =>
                    prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code])}
                  emptyText="No active pool members for this application's company/branch"
                />
                {interviewers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {interviewers.map((code) => {
                      const o = panelOptions.find((p) => p.empcode === code);
                      return (
                        <span key={code} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-2 py-1 rounded-full">
                          {(o?.name || code)} ({code}{o?.branches ? `, ${o.branches}` : ""})
                          <button onClick={() => setInterviewers((prev) => prev.filter((c) => c !== code))} className="hover:text-indigo-900">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <Button onClick={handleSchedule} loading={saving}>Schedule</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-end gap-2 mb-4">
        <Button variant="secondary" onClick={() => setShowPoolModal(true)}>
          <Users className="h-4 w-4 mr-1.5" />Panel Pool{poolCount ? ` (${poolCount})` : ""}
        </Button>
        <span title={poolCount === 0 ? "Set up the interview panel pool for this company/branch first" : undefined}>
          <Button onClick={() => setShowForm(true)} disabled={poolCount === 0}>
            <Plus className="h-4 w-4 mr-1.5" />Schedule Interview
          </Button>
        </span>
      </div>

      {showPoolModal && (
        <PanelPoolModal
          adminCardNo={adminCardNo}
          scope={scope}
          onClose={() => setShowPoolModal(false)}
          onChanged={load}
        />
      )}

      {notifyCtx && (
        <NotificationDialog
          adminCardNo={adminCardNo}
          ctx={notifyCtx}
          onClose={(saved) => {
            setNotifyCtx(null);
            if (saved) setSuccess("Notification selections saved");
          }}
        />
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Interviews</h2>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : interviews.length === 0 ? (
            <p className="text-center text-gray-500 py-12">No interviews scheduled yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
                    <th className="pb-3 pr-4">Candidate</th>
                    <th className="pb-3 pr-4">Job</th>
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3 pr-4">Type</th>
                    <th className="pb-3 pr-4">Interviewer</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {interviews.map((iv) => (
                    <>
                      <tr key={iv.interview_id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-3 pr-4 font-medium text-gray-900">{iv.candidate_name}</td>
                        <td className="py-3 pr-4 text-gray-600">{iv.job_title}</td>
                        <td className="py-3 pr-4 text-gray-600">
                          {iv.interview_date || "—"}
                          {iv.start_time && (
                            <span className="text-gray-400"> · {iv.start_time}{iv.end_time ? `–${iv.end_time}` : ""}</span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-gray-600">{iv.interview_type || "—"}</td>
                        <td className="py-3 pr-4 text-gray-600">{iv.interviewer || "—"}</td>
                        <td className="py-3 pr-4"><Badge status={iv.status} /></td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            {iv.status === "SCHEDULED" && (
                              <>
                                <button onClick={() => openReschedule(iv)} className="text-amber-600 hover:text-amber-800 text-xs font-medium">Reschedule</button>
                                <button onClick={() => markCompleted(iv.interview_id)} className="text-green-600 hover:text-green-800 text-xs font-medium">Complete</button>
                              </>
                            )}
                            <button
                              onClick={() => openFeedback(iv)}
                              className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                            >
                              {iv.recommendation ? "Feedback ✓" : "Feedback"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {rescheduleId === iv.interview_id && (
                        <tr key={`rs-${iv.interview_id}`}>
                          <td colSpan={7} className="py-4 px-3 bg-amber-50/50">
                            <div className="max-w-3xl">
                              <p className="text-base font-semibold text-gray-900">Reschedule interview</p>
                              <p className="text-sm text-gray-500 mb-4">
                                {iv.candidate_name}
                                {iv.interview_type ? ` · ${iv.interview_type} round` : ""}
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <Input label="Interview Date" type="date" value={rf.interview_date}
                                  onChange={(e) => setRf({ ...rf, interview_date: e.target.value })} />
                                <Select label="Mode" options={INTERVIEW_MODE_OPTS} value={rf.interview_mode}
                                  onChange={(e) => setRf({ ...rf, interview_mode: e.target.value })} />
                                <Input label="Start Time *" type="time" value={rf.start_time}
                                  onChange={(e) => setRf({ ...rf, start_time: e.target.value })} />
                                <Input label="End Time" type="time" value={rf.end_time}
                                  onChange={(e) => setRf({ ...rf, end_time: e.target.value })}
                                  placeholder="e.g. 15 min after start" />
                                <div className="sm:col-span-2">
                                  <Input label="Location / Link" value={rf.location_or_link}
                                    onChange={(e) => setRf({ ...rf, location_or_link: e.target.value })} />
                                </div>
                              </div>
                              <div className="flex gap-3 mt-4">
                                <Button onClick={() => submitReschedule(iv.interview_id)} loading={savingReschedule}>Save</Button>
                                <Button variant="ghost" onClick={() => setRescheduleId(null)}>Cancel</Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      {feedbackId === iv.interview_id && (
                        <tr key={`fb-${iv.interview_id}`}>
                          <td colSpan={7} className="py-4 px-3 bg-gray-50">
                            <div className="max-w-3xl">
                              <p className="text-base font-semibold text-gray-900">Interview feedback</p>
                              <p className="text-sm text-gray-500 mb-4">
                                {iv.candidate_name}
                                {iv.interview_type ? ` · ${iv.interview_type} round` : ""}
                                {iv.interview_date ? ` · ${iv.interview_date}` : ""}
                              </p>

                              <div className="flex items-center justify-between rounded-lg bg-white border border-gray-100 px-3 py-2 mb-4">
                                <span className="text-sm text-gray-500">Feedback owner</span>
                                <input
                                  className="text-sm font-medium text-gray-900 text-right bg-transparent outline-none w-56"
                                  value={fb.feedback_owner}
                                  onChange={(e) => setFb({ ...fb, feedback_owner: e.target.value })}
                                  placeholder="Your name"
                                />
                              </div>

                              <p className="text-sm font-semibold text-gray-700 mb-2">Ratings</p>
                              <div className="space-y-2 mb-4">
                                {([
                                  ["technical_rating", "Technical skills"],
                                  ["communication_rating", "Communication"],
                                  ["culture_fit_rating", "Culture fit"],
                                ] as const).map(([key, label]) => (
                                  <div key={key} className="flex items-center justify-between border-b border-gray-100 pb-2">
                                    <span className="text-sm text-gray-700">{label}</span>
                                    <div className="w-40">
                                      <Select options={RATING_OPTS} value={fb[key]}
                                        onChange={(e) => setFb({ ...fb, [key]: e.target.value })} />
                                    </div>
                                  </div>
                                ))}
                              </div>

                              <label className="block text-sm text-gray-600 mb-1">Comments</label>
                              <textarea
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 mb-4"
                                rows={3}
                                value={fb.feedback}
                                onChange={(e) => setFb({ ...fb, feedback: e.target.value })}
                                placeholder="Strengths, concerns, anything the next round should probe"
                              />

                              <p className="text-sm font-semibold text-gray-700 mb-2">Recommendation</p>
                              <div className="flex flex-wrap gap-2">
                                <Button onClick={() => submitFeedback(iv, "Next round")} loading={savingFb === "Next round"}>
                                  <CheckCircle className="h-4 w-4 mr-1.5" />Move to next round
                                </Button>
                                <Button variant="secondary" onClick={() => submitFeedback(iv, "Send offer")} loading={savingFb === "Send offer"}>
                                  Send offer
                                </Button>
                                <button
                                  onClick={() => submitFeedback(iv, "Reject")}
                                  disabled={savingFb === "Reject"}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-red-300 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                                >
                                  <XCircle className="h-4 w-4" />Reject
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// OFFERS TAB
// ─────────────────────────────────────────────────────────────────

function OffersTab({ adminCardNo, scope }: { adminCardNo: string; scope?: { compc?: string; brnch?: string } }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ app_id: "", salary_offered: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [notifyCtx, setNotifyCtx] = useState<NotifyContext | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [offRes, appsRes] = await Promise.all([
        listOffers(adminCardNo, undefined, scope),
        listApplications(adminCardNo, undefined, "SHORTLISTED", scope),
      ]);
      setOffers(offRes.items);
      setApps(appsRes.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, scope?.compc, scope?.brnch]);

  useEffect(() => { load(); }, [load]);

  async function handleSend() {
    if (!form.app_id) { setError("Candidate is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const appId = parseInt(form.app_id);
      await createOffer(adminCardNo, { app_id: appId, salary_offered: form.salary_offered ? parseFloat(form.salary_offered) : undefined, notes: form.notes || undefined });
      setSuccess("Offer sent");
      // Notify the candidate that an offer has been extended (salary/date are
      // rendered into the message from the offer row just created).
      const app = apps.find((a) => a.app_id === appId);
      setNotifyCtx({
        appId,
        eventType: "Offer Extended",
        title: app ? `${app.candidate_name} — ${app.job_title}` : `Application #${appId}`,
        interviewerEmpcodes: [],
      });
      setShowForm(false);
      setForm({ app_id: "", salary_offered: "", notes: "" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(offerId: number, status: string) {
    setError(null);
    try {
      await updateOffer(adminCardNo, offerId, { status });
      setSuccess(`Offer ${status.toLowerCase()}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const appOptions = [{ value: "", label: "Select candidate" }, ...apps.map((a) => ({ value: String(a.app_id), label: `${a.candidate_name} — ${a.job_title}` }))];

  return (
    <div className="animate-fade-in">
      {error && <div className="mb-4"><Alert type="error" message={error} onClose={() => setError(null)} /></div>}
      {success && <div className="mb-4"><Alert type="success" message={success} onClose={() => setSuccess(null)} /></div>}

      {notifyCtx && (
        <NotificationDialog
          adminCardNo={adminCardNo}
          ctx={notifyCtx}
          onClose={(saved) => {
            setNotifyCtx(null);
            if (saved) setSuccess("Notification selections saved");
          }}
        />
      )}

      {showForm && (
        <Card className="mb-6">
          <CardHeader><h2 className="text-lg font-semibold text-gray-900">Send Offer</h2></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Select label="Candidate *" options={appOptions} value={form.app_id} onChange={(e) => setForm({ ...form, app_id: e.target.value })} />
              </div>
              <Input label="Salary Offered" type="number" value={form.salary_offered} onChange={(e) => setForm({ ...form, salary_offered: e.target.value })} placeholder="e.g. 50000" />
              <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any remarks..." />
            </div>
            <div className="flex gap-3 mt-4">
              <Button onClick={handleSend} loading={saving}>Send Offer</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end mb-4">
        <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-1.5" />Send Offer</Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Offers</h2>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : offers.length === 0 ? (
            <p className="text-center text-gray-500 py-12">No offers sent yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
                    <th className="pb-3 pr-4">Candidate</th>
                    <th className="pb-3 pr-4">Job</th>
                    <th className="pb-3 pr-4">Offer Date</th>
                    <th className="pb-3 pr-4">Salary</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {offers.map((o) => (
                    <tr key={o.offer_id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 pr-4 font-medium text-gray-900">{o.candidate_name}</td>
                      <td className="py-3 pr-4 text-gray-600">{o.job_title}</td>
                      <td className="py-3 pr-4 text-gray-600">{o.offer_date || "—"}</td>
                      <td className="py-3 pr-4 text-gray-700 font-medium">
                        {o.salary_offered ? `PKR ${o.salary_offered.toLocaleString()}` : "—"}
                      </td>
                      <td className="py-3 pr-4"><Badge status={o.status} /></td>
                      <td className="py-3">
                        {o.status === "SENT" && (
                          <div className="flex gap-2">
                            <button onClick={() => updateStatus(o.offer_id, "ACCEPTED")} className="text-green-600 hover:text-green-800 text-xs font-medium">Accept</button>
                            <button onClick={() => updateStatus(o.offer_id, "REJECTED")} className="text-red-500 hover:text-red-700 text-xs font-medium">Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ANALYTICS TAB
// ─────────────────────────────────────────────────────────────────

function AnalyticsTab({ adminCardNo, scope }: { adminCardNo: string; scope?: { compc?: string; brnch?: string } }) {
  const [data, setData] = useState<RecruitmentAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchRecruitmentAnalytics(adminCardNo, scope)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load analytics"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCardNo, scope?.compc, scope?.brnch]);

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (error) return <Alert type="error" message={error} />;
  if (!data) return null;

  const kpis = [
    { label: "Open Jobs", value: data.open_jobs, icon: <Briefcase className="h-6 w-6 text-indigo-500" />, color: "indigo" },
    { label: "Total Applications", value: data.total_applications, icon: <FileText className="h-6 w-6 text-blue-500" />, color: "blue" },
    { label: "Shortlisted", value: data.shortlisted, icon: <CheckCircle className="h-6 w-6 text-green-500" />, color: "green" },
    { label: "Interviews", value: data.total_interviews, icon: <ClipboardList className="h-6 w-6 text-purple-500" />, color: "purple" },
    { label: "Hires This Month", value: data.hires_this_month, icon: <Users className="h-6 w-6 text-emerald-500" />, color: "emerald" },
    { label: "Avg Time to Hire", value: `${data.avg_time_to_hire_days} days`, icon: <Clock className="h-6 w-6 text-orange-500" />, color: "orange" },
    { label: "Avg Cost per Hire", value: data.avg_cost_per_hire ? `PKR ${data.avg_cost_per_hire.toLocaleString()}` : "—", icon: <BarChart2 className="h-6 w-6 text-red-400" />, color: "red" },
  ];

  const maxHires = Math.max(...data.monthly_hires.map((m) => m.hires), 1);

  return (
    <div className="animate-fade-in space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-gray-50 rounded-lg shrink-0">{k.icon}</div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{k.value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{k.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Monthly Hires Bar Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900">Monthly Hires (Last 6 Months)</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.monthly_hires.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No hire data yet.</p>
          ) : (
            <div className="flex items-end gap-3 h-40">
              {data.monthly_hires.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs font-medium text-gray-700">{m.hires}</span>
                  <div
                    className="w-full bg-indigo-500 rounded-t-md transition-all"
                    style={{ height: `${(m.hires / maxHires) * 120}px`, minHeight: m.hires > 0 ? "8px" : "2px" }}
                  />
                  <span className="text-xs text-gray-500 text-center">{m.month}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Application Status Breakdown */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-gray-900">Application Breakdown</h2>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Pending", value: data.pending, color: "bg-yellow-100 text-yellow-800" },
              { label: "Shortlisted", value: data.shortlisted, color: "bg-green-100 text-green-800" },
              { label: "Rejected", value: data.rejected, color: "bg-red-100 text-red-800" },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl p-4 text-center ${s.color}`}>
                <p className="text-3xl font-bold">{s.value}</p>
                <p className="text-sm font-medium mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
