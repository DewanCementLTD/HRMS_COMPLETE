"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
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
} from "lucide-react";
import {
  listJobs,
  createJob,
  updateJob,
  listApplications,
  createApplication,
  updateApplicationStatus,
  listInterviews,
  createInterview,
  updateInterview,
  listOffers,
  createOffer,
  updateOffer,
  fetchRecruitmentAnalytics,
} from "@/services/recruitmentService";
import type { Job, Application, Interview, Offer, RecruitmentAnalytics } from "@/models/recruitment";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

type RecTab = "jobs" | "applications" | "interviews" | "offers" | "analytics";

const REC_TABS: { value: RecTab; label: string; icon: React.ReactNode }[] = [
  { value: "jobs", label: "Jobs", icon: <Briefcase className="h-4 w-4" /> },
  { value: "applications", label: "Applications", icon: <FileText className="h-4 w-4" /> },
  { value: "interviews", label: "Interviews", icon: <ClipboardList className="h-4 w-4" /> },
  { value: "offers", label: "Offers", icon: <Gift className="h-4 w-4" /> },
  { value: "analytics", label: "Analytics", icon: <TrendingUp className="h-4 w-4" /> },
];

const JOB_STATUS_OPTS = [
  { value: "OPEN", label: "Open" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "CLOSED", label: "Closed" },
];

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

// ─────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────

export function RecruitmentPanel({ adminCardNo }: { adminCardNo: string }) {
  const [tab, setTab] = useState<RecTab>("jobs");
  const { activeCompany, activeBranch } = useAuth();
  // Jobs are filtered to the currently selected company/branch (backend-enforced).
  const scope = { compc: activeCompany || undefined, brnch: activeBranch || undefined };

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

      {tab === "jobs" && <JobsTab key={`${activeCompany}|${activeBranch}`} adminCardNo={adminCardNo} scope={scope} />}
      {tab === "applications" && <ApplicationsTab adminCardNo={adminCardNo} />}
      {tab === "interviews" && <InterviewsTab adminCardNo={adminCardNo} />}
      {tab === "offers" && <OffersTab adminCardNo={adminCardNo} />}
      {tab === "analytics" && <AnalyticsTab adminCardNo={adminCardNo} />}
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
  const [form, setForm] = useState({ job_title: "", dept_no: "", open_positions: "1", job_desc: "", skills_req: "", status: "OPEN" });
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
    setForm({ job_title: "", dept_no: "", open_positions: "1", job_desc: "", skills_req: "", status: "OPEN" });
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
          <CardContent className="py-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Input label="Job Title *" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="e.g. Senior Software Engineer" />
              </div>
              <Input label="Department No" type="number" value={form.dept_no} onChange={(e) => setForm({ ...form, dept_no: e.target.value })} placeholder="e.g. 11" />
              <Input label="Open Positions" type="number" value={form.open_positions} onChange={(e) => setForm({ ...form, open_positions: e.target.value })} min={1} />
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Skills Required</label>
                <textarea
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  rows={2}
                  value={form.skills_req}
                  onChange={(e) => setForm({ ...form, skills_req: e.target.value })}
                  placeholder="e.g. Python, Oracle, 3+ years experience..."
                />
              </div>
              {editJob && (
                <Select label="Status" options={JOB_STATUS_OPTS} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} />
              )}
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
// APPLICATIONS TAB
// ─────────────────────────────────────────────────────────────────

function ApplicationsTab({ adminCardNo }: { adminCardNo: string }) {
  const [apps, setApps] = useState<Application[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filterJob, setFilterJob] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [form, setForm] = useState({ job_id: "", candidate_name: "", mobile: "", email: "", source: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [appsRes, jobsRes] = await Promise.all([
        listApplications(adminCardNo, filterJob ? parseInt(filterJob) : undefined, filterStatus || undefined),
        listJobs(adminCardNo),
      ]);
      setApps(appsRes.items);
      setJobs(jobsRes.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [adminCardNo, filterJob, filterStatus]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!form.candidate_name.trim() || !form.job_id) { setError("Candidate name and job are required"); return; }
    setSaving(true);
    setError(null);
    try {
      await createApplication(adminCardNo, { ...form, job_id: parseInt(form.job_id) });
      setSuccess("Application added");
      setShowForm(false);
      setForm({ job_id: "", candidate_name: "", mobile: "", email: "", source: "", notes: "" });
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

      {showForm && (
        <Card className="mb-6">
          <CardHeader><h2 className="text-lg font-semibold text-gray-900">Add Candidate</h2></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select label="Applied For *" options={jobOptions.filter(o => o.value)} value={form.job_id} onChange={(e) => setForm({ ...form, job_id: e.target.value })} />
              <Input label="Candidate Name *" value={form.candidate_name} onChange={(e) => setForm({ ...form, candidate_name: e.target.value })} />
              <Input label="Mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
              <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <Select label="Source" options={SOURCE_OPTS} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
              <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
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
          <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-1.5" />Add Candidate</Button>
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
                      <td className="py-3 pr-4 font-medium text-gray-900">{a.candidate_name}</td>
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
// INTERVIEWS TAB
// ─────────────────────────────────────────────────────────────────

function InterviewsTab({ adminCardNo }: { adminCardNo: string }) {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [feedbackId, setFeedbackId] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [form, setForm] = useState({ app_id: "", interview_date: "", interview_type: "", interviewer: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ivRes, appsRes] = await Promise.all([
        listInterviews(adminCardNo),
        listApplications(adminCardNo, undefined, "SHORTLISTED"),
      ]);
      setInterviews(ivRes.items);
      setApps(appsRes.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [adminCardNo]);

  useEffect(() => { load(); }, [load]);

  async function handleSchedule() {
    if (!form.app_id) { setError("Application is required"); return; }
    setSaving(true);
    setError(null);
    try {
      await createInterview(adminCardNo, { app_id: parseInt(form.app_id), interview_date: form.interview_date || undefined, interview_type: form.interview_type || undefined, interviewer: form.interviewer || undefined });
      setSuccess("Interview scheduled");
      setShowForm(false);
      setForm({ app_id: "", interview_date: "", interview_type: "", interviewer: "" });
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

  async function saveFeedback(id: number) {
    try {
      await updateInterview(adminCardNo, id, { feedback: feedbackText });
      setSuccess("Feedback saved");
      setFeedbackId(null);
      setFeedbackText("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
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
              <Input label="Interview Date" type="date" value={form.interview_date} onChange={(e) => setForm({ ...form, interview_date: e.target.value })} />
              <Select label="Type" options={INTERVIEW_TYPE_OPTS} value={form.interview_type} onChange={(e) => setForm({ ...form, interview_type: e.target.value })} />
              <Input label="Interviewer" value={form.interviewer} onChange={(e) => setForm({ ...form, interviewer: e.target.value })} placeholder="Name of interviewer" />
            </div>
            <div className="flex gap-3 mt-4">
              <Button onClick={handleSchedule} loading={saving}>Schedule</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end mb-4">
        <Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4 mr-1.5" />Schedule Interview</Button>
      </div>

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
                        <td className="py-3 pr-4 text-gray-600">{iv.interview_date || "—"}</td>
                        <td className="py-3 pr-4 text-gray-600">{iv.interview_type || "—"}</td>
                        <td className="py-3 pr-4 text-gray-600">{iv.interviewer || "—"}</td>
                        <td className="py-3 pr-4"><Badge status={iv.status} /></td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            {iv.status === "SCHEDULED" && (
                              <button onClick={() => markCompleted(iv.interview_id)} className="text-green-600 hover:text-green-800 text-xs font-medium">Complete</button>
                            )}
                            <button
                              onClick={() => { setFeedbackId(feedbackId === iv.interview_id ? null : iv.interview_id); setFeedbackText(iv.feedback || ""); }}
                              className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                            >
                              Feedback
                            </button>
                          </div>
                        </td>
                      </tr>
                      {feedbackId === iv.interview_id && (
                        <tr key={`fb-${iv.interview_id}`}>
                          <td colSpan={7} className="py-3 px-2 bg-indigo-50/50">
                            <div className="flex gap-2">
                              <textarea
                                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                rows={2}
                                value={feedbackText}
                                onChange={(e) => setFeedbackText(e.target.value)}
                                placeholder="Enter interview feedback..."
                              />
                              <Button size="sm" onClick={() => saveFeedback(iv.interview_id)}>Save</Button>
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

function OffersTab({ adminCardNo }: { adminCardNo: string }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ app_id: "", salary_offered: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [offRes, appsRes] = await Promise.all([
        listOffers(adminCardNo),
        listApplications(adminCardNo, undefined, "SHORTLISTED"),
      ]);
      setOffers(offRes.items);
      setApps(appsRes.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [adminCardNo]);

  useEffect(() => { load(); }, [load]);

  async function handleSend() {
    if (!form.app_id) { setError("Candidate is required"); return; }
    setSaving(true);
    setError(null);
    try {
      await createOffer(adminCardNo, { app_id: parseInt(form.app_id), salary_offered: form.salary_offered ? parseFloat(form.salary_offered) : undefined, notes: form.notes || undefined });
      setSuccess("Offer sent");
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

function AnalyticsTab({ adminCardNo }: { adminCardNo: string }) {
  const [data, setData] = useState<RecruitmentAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchRecruitmentAnalytics(adminCardNo)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load analytics"))
      .finally(() => setLoading(false));
  }, [adminCardNo]);

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
