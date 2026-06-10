"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  useHRMSController,
  AttendanceDateRange,
} from "@/controllers/useHRMSController";
import { HRMSEmployeeCreate, HRMSSearchResult } from "@/models/hrms";
import { AttendanceRecord } from "@/models/attendance";
import { printTimesheetWindow } from "@/lib/printTimesheet";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/utils";
import {
  Users,
  Search,
  UserPlus,
  Edit3,
  ArrowLeft,
  Save,
  X,
  Clock,
  BarChart2,
  Download,
  Printer,
  Timer,
  AlertTriangle,
  Calendar,
  MapPin,
  Settings,
  Navigation,
  FileText,
} from "lucide-react";
import { updateLocationTracking } from "@/services/hrmsService";
import { LocationPanel } from "./LocationPanel";
import { SetupPanel } from "./SetupPanel";
import { DynamicSelect } from "@/components/ui/DynamicSelect";
import { EmployeeDocuments } from "./EmployeeDocuments";
import {
  fetchDepartments, fetchDesignations,
  fetchBloodGroups, fetchCadre, fetchUnits, fetchReligions, fetchReportingOfficers,
  fetchEmpStatuses, fetchBanks, fetchBankBranches, fetchQualifications,
  addDepartment, addBloodGroup, addCadre,
  type Department, type Designation, type BloodGroup, type Cadre, type Unit,
  type Religion, type ReportingOfficer,
  type EmpStatus, type Bank, type BankBranch, type Qualification,
} from "@/services/referenceService";

// ──────────────────────────────────────────────
// Types & constants
// ──────────────────────────────────────────────

type View = "list" | "register" | "edit" | "report";

type StatusTab = "" | "A" | "I" | "L";

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "", label: "All" },
  { value: "A", label: "Active" },
  { value: "I", label: "Inactive" },
  { value: "L", label: "Left" },
];

const EMPTY_FORM: HRMSEmployeeCreate = {
  name: "",
  fhname: "",
  atdtcard: "",
  sex: "",
  dtofbrth: "",
  nicno: "",
  dtofappt: "",
  dept_no: "",
  desg_cd: "",
  mobile: "",
  email: "",
  address: "",
  unit_id: 1,
  status: "A",
  user_paswd: "",
  hr_admin: "N",
  rpt_officer: "",
  marstat: "",
  religion: "",
  basic: undefined,
  gross: undefined,
  w_hour: undefined,
  bldgrp: "",
  location: "",
  // Extended profile fields
  emp_status: "",
  ntn: "",
  bnkcode: "",
  brncode: "",
  bnkacct: "",
  qfication: "",
  qual_detail: "",
  dtofconfirm: "",
};

// Format an NIC as 4XXXX-XXXXXXX-X (5 digits - 7 digits - 1 digit).
function formatNIC(v: string): string {
  const d = (v || "").replace(/\D/g, "").slice(0, 13);
  const p1 = d.slice(0, 5), p2 = d.slice(5, 12), p3 = d.slice(12, 13);
  let out = p1;
  if (p2) out += "-" + p2;
  if (p3) out += "-" + p3;
  return out;
}

// ── Filter state for employee list ──────────────────────────────
type EmpFilter = { dept: string; gender: string; status: string; location: string };

const sexOptions = [
  { value: "", label: "Select" },
  { value: "M", label: "Male" },
  { value: "F", label: "Female" },
];

const statusOptions = [
  { value: "A", label: "Active" },
  { value: "I", label: "Inactive" },
  { value: "L", label: "Left" },
];

const hrAdminOptions = [
  { value: "N", label: "No" },
  { value: "Y", label: "Yes" },
];

const marstatOptions = [
  { value: "", label: "Select" },
  { value: "S", label: "Single" },
  { value: "M", label: "Married" },
  { value: "W", label: "Widowed" },
  { value: "D", label: "Divorced" },
];

// ──────────────────────────────────────────────
// Date range presets
// ──────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function getPreset(preset: string): AttendanceDateRange {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = today.getMonth();
  const dd = today.getDate();

  switch (preset) {
    case "today":
      return { from: todayStr(), to: todayStr() };
    case "week": {
      const day = today.getDay();
      const mon = new Date(today);
      mon.setDate(dd - ((day + 6) % 7));
      return { from: mon.toISOString().split("T")[0], to: todayStr() };
    }
    case "month":
      return {
        from: new Date(yyyy, mm, 1).toISOString().split("T")[0],
        to: todayStr(),
      };
    case "paycycle": {
      // 26th of previous month → 25th of current month
      const from = new Date(yyyy, mm - 1, 26);
      const to = new Date(yyyy, mm, 25);
      return {
        from: from.toISOString().split("T")[0],
        to: to.toISOString().split("T")[0],
      };
    }
    default:
      return {
        from: new Date(yyyy, mm, 1).toISOString().split("T")[0],
        to: todayStr(),
      };
  }
}

// ──────────────────────────────────────────────
// Download helpers
// ──────────────────────────────────────────────

function downloadCSV(
  records: AttendanceRecord[],
  empName: string,
  from: string,
  to: string,
) {
  const headers = [
    "Date",
    "Day",
    "In Time",
    "Out Time",
    "Working Hrs",
    "Late",
    "OT",
    "Status",
  ];
  const rows = records.map((r) => [
    r.roster_date,
    r.day_name || "",
    r.in_time || "",
    r.out_time || "",
    `${r.w_hrs ?? 0}h ${r.w_mnt ?? 0}m`,
    `${r.late_hrs ?? 0}h ${r.late_mnt ?? 0}m`,
    `${r.ot_hrs ?? 0}h ${r.ot_mnt ?? 0}m`,
    r.status || "",
  ]);

  const csv = [headers, ...rows]
    .map((row) =>
      row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance_${empName.replace(/\s+/g, "_")}_${from}_${to}.csv`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 150);
}

function printReport() {
  window.print();
}

// ──────────────────────────────────────────────
// Status badge
// ──────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  const map: Record<string, string> = {
    A: "bg-emerald-50 text-emerald-700",
    I: "bg-gray-100 text-gray-600",
    D: "bg-gray-100 text-gray-600",
    L: "bg-red-50 text-red-600",
  };
  const label: Record<string, string> = {
    A: "Active",
    I: "Inactive",
    D: "Inactive",
    L: "Left",
  };
  const cls = map[status || ""] || "bg-gray-100 text-gray-500";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}
    >
      {label[status || ""] || status || "-"}
    </span>
  );
}

// ──────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────

export default function HRMSPage() {
  const { user, activeCompany, activeBranch } = useAuth();
  const ctrl = useHRMSController();

  const [section, setSection] = useState<"employees" | "locations" | "setup">("employees");
  const [locationFocusCard, setLocationFocusCard] = useState<string | undefined>();
  const [view, setView] = useState<View>("list");
  const [activeTab, setActiveTab] = useState<StatusTab>("");
  const [localQuery, setLocalQuery] = useState("");
  const [form, setForm] = useState<HRMSEmployeeCreate>({ ...EMPTY_FORM });
  const [reportRange, setReportRange] = useState<AttendanceDateRange>(getPreset("month"));
  const [empFilter, setEmpFilter] = useState<EmpFilter>({ dept: "", gender: "", status: "", location: "" });

  // Reference data
  const [refDepts,  setRefDepts]  = useState<Department[]>([]);
  const [refDesigs, setRefDesigs] = useState<Designation[]>([]);
  const [refBG,     setRefBG]     = useState<BloodGroup[]>([]);
  const [refCadre,  setRefCadre]  = useState<Cadre[]>([]);
  const [refUnits,      setRefUnits]      = useState<Unit[]>([]);
  const [refReligions,  setRefReligions]  = useState<Religion[]>([]);
  const [refRptOfficers,setRefRptOfficers]= useState<ReportingOfficer[]>([]);
  const [refEmpStatuses,setRefEmpStatuses]= useState<EmpStatus[]>([]);
  const [refBanks,      setRefBanks]      = useState<Bank[]>([]);
  const [refBankBranches,setRefBankBranches]= useState<BankBranch[]>([]);
  const [refQuals,      setRefQuals]      = useState<Qualification[]>([]);

  // Reference data — refetched when the selected company/branch changes so
  // employee-register/edit dropdowns only show options for the active scope.
  // Units, locations, religions, reporting-officers stay global on purpose.
  useEffect(() => {
    const c = activeCompany || undefined;
    const b = activeBranch || undefined;
    Promise.all([
      fetchDepartments(c, b), fetchDesignations(undefined, c, b),
      fetchBloodGroups(c, b), fetchCadre(c, b), fetchUnits(),
      fetchReligions(), fetchReportingOfficers(),
      fetchEmpStatuses(), fetchBanks(c), fetchQualifications(),
    ]).then(([d, des, bg, ca, u, rel, rpt, est, bk, ql]) => {
      setRefDepts(d.items);
      setRefDesigs(des.items);
      setRefBG(bg.items);
      setRefCadre(ca.items);
      setRefUnits(u.items);
      setRefReligions(rel.items);
      setRefRptOfficers(rpt.items);
      setRefEmpStatuses(est.items);
      setRefBanks(bk.items);
      setRefQuals(ql.items);
    }).catch(console.error);
  }, [activeCompany, activeBranch]);

  // Bank branches depend on the selected bank.
  useEffect(() => {
    if (!form.bnkcode) { setRefBankBranches([]); return; }
    fetchBankBranches(form.bnkcode).then((r) => setRefBankBranches(r.items)).catch(console.error);
  }, [form.bnkcode]);

  // Load employees on mount and when tab changes
  useEffect(() => {
    if (user?.hr_admin) {
      ctrl.loadEmployees(activeTab || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, user?.hr_admin]);

  // Access check
  if (!user?.hr_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Users className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
          <p className="text-gray-500 mt-2">
            You don&apos;t have HR admin privileges.
          </p>
        </div>
      </div>
    );
  }

  // ── Shared section nav ──────────────────────────────────
  const SectionNav = () => {
    const tabs = [
      { id: "employees" as const,   icon: Users,     label: "Employees" },
      { id: "locations" as const,   icon: MapPin,    label: "Locations" },
      { id: "setup" as const,       icon: Settings,  label: "Setup" },
    ];
    return (
      <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl mb-6 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSection(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              section === t.id
                ? "bg-white text-indigo-700 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <t.icon className="h-4 w-4 inline mr-1.5 -mt-0.5" />
            {t.label}
          </button>
        ))}
      </div>
    );
  };

  // ---- Non-employee sections early return ----
  if (section === "locations") {
    return (
      <div className="animate-fade-in">
        <SectionNav />
        <LocationPanel adminCardNo={user.card_no} focusCardNo={locationFocusCard} />
      </div>
    );
  }
  if (section === "setup") {
    return (
      <div className="animate-fade-in">
        <SectionNav />
        <SetupPanel adminCardNo={user.card_no} />
      </div>
    );
  }

  // ---- Navigation helpers ----

  function viewLocation(cardNo: string) {
    setLocationFocusCard(cardNo || undefined);
    setSection("locations");
  }

  function goList() {
    ctrl.clearSelection();
    ctrl.clearReportEmployee();
    ctrl.clearMessages();
    setLocalQuery("");
    ctrl.filterByQuery("");
    setView("list");
  }

  function startRegister() {
    setForm({ ...EMPTY_FORM });
    ctrl.clearMessages();
    setView("register");
  }

  function startEdit(empcode: string) {
    ctrl.clearMessages();
    ctrl.loadEmployee(empcode).then(() => setView("edit"));
  }

  function startReport(emp: HRMSSearchResult) {
    ctrl.clearMessages();
    setReportRange(getPreset("month"));
    setView("report");
    ctrl.loadAttendanceReport(
      emp,
      ...(Object.values(getPreset("month")) as [string, string]),
    );
  }

  // ---- Populate edit form when selectedEmployee is ready ----
  if (
    view === "edit" &&
    ctrl.selectedEmployee &&
    form.name === "" &&
    ctrl.selectedEmployee.name
  ) {
    const e = ctrl.selectedEmployee;
    setForm({
      name: e.name || "",
      fhname: e.fhname || "",
      atdtcard: e.atdtcard || "",
      sex: e.sex || "",
      dtofbrth: e.dtofbrth || "",
      nicno: e.nicno || "",
      dtofappt: e.dtofappt || "",
      dept_no: e.dept_no || "",
      desg_cd: e.desg_cd || "",
      mobile: e.mobile || "",
      email: e.email || "",
      address: e.address || "",
      unit_id: e.unit_id ?? 1,
      status: e.status || "A",
      user_paswd: e.user_paswd || "",
      hr_admin: e.hr_admin || "N",
      rpt_officer: e.rpt_officer || "",
      marstat: e.marstat || "",
      religion: e.religion || "",
      basic: e.basic ?? undefined,
      gross: e.gross ?? undefined,
      w_hour: e.w_hour ?? undefined,
      track_location: e.track_location || "N",
      track_location_hr: e.track_location_hr ?? 2,
      // Extended profile fields
      emp_status: e.emp_status || "",
      ntn: e.ntn || "",
      bnkcode: e.bnkcode || "",
      brncode: e.brncode || "",
      bnkacct: e.bnkacct || "",
      qfication: e.qfication || "",
      qual_detail: e.qual_detail || "",
      dtofconfirm: e.dtofconfirm || "",
    });
  }

  function updateField(
    field: keyof HRMSEmployeeCreate,
    value: string | number | undefined,
  ) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function onSubmitRegister(e: { preventDefault(): void }) {
    e.preventDefault();
    ctrl.clearMessages();
    if (!form.name.trim()) return;
    const res = await ctrl.registerEmployee(form);
    if (res?.status === "success") {
      setForm({ ...EMPTY_FORM });
    }
  }

  async function onSubmitEdit(e: { preventDefault(): void }) {
    e.preventDefault();
    ctrl.clearMessages();
    if (!ctrl.selectedEmployee) return;
    await ctrl.editEmployee(ctrl.selectedEmployee.empcode, form);
  }

  function applyPreset(preset: string) {
    const range = getPreset(preset);
    setReportRange(range);
    if (ctrl.reportEmployee) {
      ctrl.loadAttendanceReport(ctrl.reportEmployee, range.from, range.to);
    }
  }

  function runReport() {
    if (ctrl.reportEmployee) {
      ctrl.loadAttendanceReport(
        ctrl.reportEmployee,
        reportRange.from,
        reportRange.to,
      );
    }
  }

  // ════════════════════════════════════════════
  // VIEW: LIST
  // ════════════════════════════════════════════
  if (view === "list") {
    const visibleEmployees = ctrl.employees.filter((emp) => {
      if (empFilter.dept && String(emp.dept_no) !== empFilter.dept) return false;
      if (empFilter.gender && emp.sex !== empFilter.gender) return false;
      if (empFilter.location && emp.location !== empFilter.location) return false;
      return true;
    });

    return (
      <div className="animate-fade-in">
        {/* Section toggle */}
        <SectionNav />

        <PageHeader
          title="HRMS — Employee Management"
          subtitle="Manage employees and view attendance reports"
          actions={
            <Button onClick={startRegister}>
              <UserPlus className="h-4 w-4 mr-1.5" />
              Register Employee
            </Button>
          }
        />

        {ctrl.error && (
          <div className="mb-4">
            <Alert
              type="error"
              message={ctrl.error}
              onClose={ctrl.clearMessages}
            />
          </div>
        )}

        {/* Filter + Search bar */}
        <Card className="mb-4">
          <CardContent className="py-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Status tabs */}
                <div className="flex gap-1 p-1 bg-gray-100 rounded-lg shrink-0">
                  {STATUS_TABS.map((tab) => (
                    <button
                      key={tab.value}
                      onClick={() => setActiveTab(tab.value)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        activeTab === tab.value
                          ? "bg-white text-indigo-700 shadow-sm"
                          : "text-gray-600 hover:text-gray-900"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    placeholder="Filter by name, code, mobile, card#..."
                    value={localQuery}
                    onChange={(e) => {
                      setLocalQuery(e.target.value);
                      ctrl.filterByQuery(e.target.value);
                    }}
                  />
                </div>
              </div>
              {/* Advanced filters */}
              <div className="flex flex-wrap gap-2">
                <select
                  value={empFilter.dept}
                  onChange={(e) => setEmpFilter((f) => ({ ...f, dept: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                >
                  <option value="">All Departments</option>
                  {refDepts.map((d) => (
                    <option key={d.dept_no} value={String(d.dept_no)}>{d.dept_name}</option>
                  ))}
                </select>
                <select
                  value={empFilter.gender}
                  onChange={(e) => setEmpFilter((f) => ({ ...f, gender: e.target.value }))}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                >
                  <option value="">All Genders</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
                {(empFilter.dept || empFilter.gender) && (
                  <button
                    onClick={() => setEmpFilter({ dept: "", gender: "", status: "", location: "" })}
                    className="px-3 py-1.5 text-xs text-gray-500 hover:text-red-500 border border-gray-200 rounded-lg transition-colors"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Employee table */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                Employee Directory
              </h2>
              {!ctrl.loading && (
                <span className="text-sm text-gray-400">
                  ({visibleEmployees.length})
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {ctrl.loading ? (
              <Spinner />
            ) : visibleEmployees.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No employees found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      {[
                        "Employee",
                        "Code",
                        "Card#",
                        "Dept",
                        "Mobile",
                        "Status",
                        "Tracking",
                        "Actions",
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {visibleEmployees.map((emp, i) => (
                      <tr
                        key={i}
                        className="hover:bg-gray-50/50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-linear-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                              {emp.name?.charAt(0) || "?"}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {emp.name}
                              </p>
                              {emp.email && (
                                <p className="text-xs text-gray-400">
                                  {emp.email}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {emp.empcode}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {emp.card_no || emp.atdtcard || "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {refDepts.find((d) => d.dept_no === Number(emp.dept_no))?.dept_name || emp.dept_no || "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {emp.mobile || "-"}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={emp.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium w-fit ${
                              emp.track_location === "Y"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-gray-100 text-gray-500"
                            }`}>
                              {emp.track_location === "Y" ? "Enabled" : "Disabled"}
                            </span>
                            {emp.track_location === "Y" && emp.track_location_hr && (
                              <span className="text-xs text-gray-400">
                                every {emp.track_location_hr}h
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => startEdit(emp.empcode)}
                            >
                              <Edit3 className="h-3.5 w-3.5 mr-1" />
                              Edit
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => startReport(emp)}
                            >
                              <BarChart2 className="h-3.5 w-3.5 mr-1" />
                              Report
                            </Button>
                            {(emp.card_no || emp.atdtcard) && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => viewLocation(emp.card_no || emp.atdtcard || "")}
                              >
                                <Navigation className="h-3.5 w-3.5 mr-1" />
                                Location
                              </Button>
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

  // ════════════════════════════════════════════
  // VIEW: ATTENDANCE REPORT
  // ════════════════════════════════════════════
  if (view === "report") {
    const emp = ctrl.reportEmployee;
    const summary = ctrl.attendanceSummary;
    const records = ctrl.attendanceRecords;

    return (
      <div className="animate-fade-in">
        <PageHeader
          title={`Attendance — ${emp?.name || ""}`}
          subtitle={`${emp?.empcode} | Card: ${emp?.card_no || emp?.atdtcard || "N/A"}`}
          actions={
            <Button variant="secondary" onClick={goList}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to List
            </Button>
          }
        />

        {ctrl.error && (
          <div className="mb-4">
            <Alert
              type="error"
              message={ctrl.error}
              onClose={ctrl.clearMessages}
            />
          </div>
        )}

        {/* Date range + presets */}
        <Card className="mb-6">
          <CardContent className="py-4">
            <div className="flex flex-wrap gap-2 mb-4">
              {[
                { label: "Today", preset: "today" },
                { label: "This Week", preset: "week" },
                { label: "This Month", preset: "month" },
                { label: "Pay Cycle (26–25)", preset: "paycycle" },
              ].map(({ label, preset }) => (
                <button
                  key={preset}
                  onClick={() => applyPreset(preset)}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:border-indigo-400 hover:text-indigo-700 transition-colors"
                >
                  <Calendar className="h-3.5 w-3.5 inline mr-1" />
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row items-end gap-3">
              <div className="flex-1 w-full">
                <Input
                  label="From Date"
                  type="date"
                  value={reportRange.from}
                  onChange={(e) =>
                    setReportRange((r) => ({ ...r, from: e.target.value }))
                  }
                />
              </div>
              <div className="flex-1 w-full">
                <Input
                  label="To Date"
                  type="date"
                  value={reportRange.to}
                  onChange={(e) =>
                    setReportRange((r) => ({ ...r, to: e.target.value }))
                  }
                />
              </div>
              <Button
                onClick={runReport}
                loading={ctrl.reportLoading}
                className="w-full sm:w-auto"
              >
                <Search className="h-4 w-4 mr-1.5" />
                Load Report
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {[
              {
                label: "Total Days",
                value: summary.total_days,
                cls: "text-gray-900",
              },
              {
                label: "Present",
                value: summary.present,
                cls: "text-emerald-600",
              },
              {
                label: "Absent",
                value: summary.absent_days,
                cls: "text-red-600",
              },
              {
                label: "Incomplete",
                value: summary.incomplete,
                cls: "text-amber-600",
              },
              {
                label: "Late",
                value: `${Math.floor(summary.late_minutes / 60)}h ${summary.late_minutes % 60}m`,
                cls: "text-orange-600",
              },
              {
                label: "Overtime",
                value: `${Math.floor(summary.overtime_minutes / 60)}h ${summary.overtime_minutes % 60}m`,
                cls: "text-indigo-600",
              },
            ].map(({ label, value, cls }) => (
              <Card key={label}>
                <CardContent className="py-4 text-center">
                  <p className={`text-xl font-bold ${cls}`}>{value}</p>
                  <p className="text-xs text-gray-500 mt-1">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Download buttons */}
        <div className="flex gap-3 mb-6">
          <Button
            variant="secondary"
            onClick={() =>
              downloadCSV(
                records,
                emp?.name || "employee",
                reportRange.from,
                reportRange.to,
              )
            }
            disabled={records.length === 0}
          >
            <Download className="h-4 w-4 mr-1.5" />
            Download Excel (CSV)
          </Button>
          <Button
            variant="secondary"
            disabled={records.length === 0}
            onClick={() =>
              printTimesheetWindow(
                emp ?? {},
                records,
                summary,
                reportRange.from,
                reportRange.to,
                "view",
              )
            }
          >
            <FileText className="h-4 w-4 mr-1.5" />
            View as PDF
          </Button>
          <Button
            variant="secondary"
            disabled={records.length === 0}
            onClick={() =>
              printTimesheetWindow(
                emp ?? {},
                records,
                summary,
                reportRange.from,
                reportRange.to,
                "print",
              )
            }
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Print / Save PDF
          </Button>
        </div>

        {/* Records table */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-indigo-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                Attendance Records
              </h2>
              <span className="text-sm text-gray-400">({records.length})</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {ctrl.reportLoading ? (
              <Spinner />
            ) : records.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No records found for selected period</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      {[
                        "Date",
                        "Day",
                        "Shift",
                        "In Time",
                        "Out Time",
                        "Working Hrs",
                        "Late",
                        "OT",
                        "Status",
                        "Remarks",
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {records.map((rec, i) => {
                      const isLate =
                        (rec.late_hrs ?? 0) > 0 || (rec.late_mnt ?? 0) > 0;
                      const isAbsent =
                        !rec.in_time &&
                        !["SATURDAY", "SUNDAY"].includes(
                          (rec.day_name || "").toUpperCase(),
                        );
                      const isIncomplete = rec.in_time && !rec.out_time;
                      const rowCls = isAbsent
                        ? "bg-red-50/60"
                        : isIncomplete
                          ? "bg-amber-50/60"
                          : isLate
                            ? "bg-orange-50/60"
                            : "hover:bg-gray-50/50";
                      return (
                        <tr key={i} className={`transition-colors ${rowCls}`}>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {formatDate(rec.roster_date)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {rec.day_name || "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {rec.roster_shift || "G"}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span
                              className={`flex items-center gap-1 ${isLate ? "text-red-600 font-semibold" : "text-gray-600"}`}
                            >
                              <Timer className="h-3.5 w-3.5 shrink-0" />
                              {rec.in_time || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            <span className="flex items-center gap-1">
                              <Timer className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                              {rec.out_time ||
                                (isIncomplete ? (
                                  <span className="text-amber-600 font-medium">
                                    Waiting
                                  </span>
                                ) : (
                                  "—"
                                ))}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {rec.in_time
                              ? `${rec.w_hrs ?? 0}h ${rec.w_mnt ?? 0}m`
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {isLate ? (
                              <span className="flex items-center gap-1 text-amber-700 font-medium">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                {rec.late_hrs ?? 0}h {rec.late_mnt ?? 0}m
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {(rec.ot_hrs ?? 0) > 0 || (rec.ot_mnt ?? 0) > 0
                              ? `${rec.ot_hrs ?? 0}h ${rec.ot_mnt ?? 0}m`
                              : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <Badge status={rec.status || "—"} />
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 italic">
                            {isIncomplete
                              ? "WH Waiting"
                              : rec.roster_remarks || ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ════════════════════════════════════════════
  // VIEW: REGISTER / EDIT FORM
  // ════════════════════════════════════════════
  const isEdit = view === "edit";
  if (isEdit && ctrl.loading) return <Spinner />;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={
          isEdit
            ? `Edit Employee — ${ctrl.selectedEmployee?.empcode}`
            : "Register New Employee"
        }
        subtitle={
          isEdit
            ? "Modify employee details"
            : "Fill in the details to register a new employee"
        }
        actions={
          <Button variant="secondary" onClick={goList}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to List
          </Button>
        }
      />

      {ctrl.error && (
        <div className="mb-4">
          <Alert
            type="error"
            message={ctrl.error}
            onClose={ctrl.clearMessages}
          />
        </div>
      )}
      {ctrl.success && (
        <div className="mb-4">
          <Alert
            type="success"
            message={ctrl.success}
            onClose={ctrl.clearMessages}
          />
        </div>
      )}

      <form onSubmit={isEdit ? onSubmitEdit : onSubmitRegister}>
        {/* Personal */}
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-lg font-semibold text-gray-900">
              Personal Information
            </h2>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input
                label="Full Name *"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="Employee full name"
                required
              />
              <Input
                label="Father / Husband Name"
                value={form.fhname || ""}
                onChange={(e) => updateField("fhname", e.target.value)}
                placeholder="Father or husband name"
              />
              <Select
                label="Gender"
                options={sexOptions}
                value={form.sex || ""}
                onChange={(e) => updateField("sex", e.target.value)}
              />
              <Input
                label="Date of Birth"
                type="date"
                value={form.dtofbrth || ""}
                onChange={(e) => updateField("dtofbrth", e.target.value)}
              />
              <Input
                label="NIC Number"
                value={form.nicno || ""}
                onChange={(e) => updateField("nicno", formatNIC(e.target.value))}
                placeholder="4XXXX-XXXXXXX-X"
                maxLength={15}
              />
              <Select
                label="Marital Status"
                options={marstatOptions}
                value={form.marstat || ""}
                onChange={(e) => updateField("marstat", e.target.value)}
              />
              <Select
                label="Religion"
                value={form.religion || ""}
                onChange={(e) => updateField("religion", e.target.value)}
                options={[
                  { value: "", label: "Select religion" },
                  ...refReligions.map((r) => ({ value: r.code, label: r.label })),
                ]}
              />
              <DynamicSelect
                label="Blood Group"
                value={form.bldgrp || ""}
                onChange={(v) => updateField("bldgrp", v)}
                options={refBG.map((b) => ({ value: b.blood_group, label: b.blood_group }))}
                onAdd={async (val) => {
                  const res = await addBloodGroup(user!.card_no, val);
                  setRefBG((prev) => [...prev, res]);
                  return { value: res.blood_group, label: res.blood_group };
                }}
                addLabel="Add blood group"
                addPlaceholder="e.g. A+"
              />
              <Input
                label="Mobile Number"
                value={form.mobile || ""}
                onChange={(e) => updateField("mobile", e.target.value)}
                placeholder="03001234567"
              />
              <Input
                label="Email Address"
                type="email"
                value={form.email || ""}
                onChange={(e) => updateField("email", e.target.value)}
                placeholder="email@example.com"
              />
              <div className="sm:col-span-2 lg:col-span-3">
                <Input
                  label="Address"
                  value={form.address || ""}
                  onChange={(e) => updateField("address", e.target.value)}
                  placeholder="Full address"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Employment */}
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-lg font-semibold text-gray-900">
              Employment Information
            </h2>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input
                label="Attendance Card #"
                value={form.atdtcard || ""}
                onChange={(e) => updateField("atdtcard", e.target.value)}
                placeholder="Card number"
              />
              <Input
                label="Date of Appointment"
                type="date"
                value={form.dtofappt || ""}
                onChange={(e) => updateField("dtofappt", e.target.value)}
              />
              <DynamicSelect
                label="Department"
                value={form.dept_no?.toString() || ""}
                onChange={(v) => updateField("dept_no", v)}
                options={refDepts.map((d) => ({ value: String(d.dept_no), label: d.dept_name }))}
                onAdd={async (val) => {
                  const res = await addDepartment(user!.card_no, val);
                  setRefDepts((prev) => [...prev, res]);
                  return { value: String(res.dept_no), label: res.dept_name };
                }}
                addLabel="Add department"
                addPlaceholder="e.g. IT Department"
              />
              <Select
                label="Designation"
                value={form.desg_cd?.toString() || ""}
                onChange={(e) => updateField("desg_cd", e.target.value)}
                options={[
                  { value: "", label: "Select designation" },
                  ...refDesigs.map((d) => ({ value: d.desg_cd, label: d.desg_desc })),
                ]}
              />
              <Select
                label="Employee Status"
                value={form.emp_status || ""}
                onChange={(e) => updateField("emp_status", e.target.value)}
                options={[
                  { value: "", label: "Select status" },
                  ...refEmpStatuses.map((s) => ({ value: s.emp_status, label: s.descr })),
                ]}
              />
              <Input
                label="Date of Confirmation"
                type="date"
                value={form.dtofconfirm || ""}
                onChange={(e) => updateField("dtofconfirm", e.target.value)}
              />
              <Select
                label="Qualification"
                value={form.qfication || ""}
                onChange={(e) => updateField("qfication", e.target.value)}
                options={[
                  { value: "", label: "Select qualification" },
                  ...refQuals.map((q) => ({ value: q.descr, label: q.descr })),
                ]}
              />
              <Input
                label="Qualification Detail"
                value={form.qual_detail || ""}
                onChange={(e) => updateField("qual_detail", e.target.value)}
                placeholder="e.g. BSc Computer Science, Punjab University"
              />
              <Select
                label="Reporting Officer"
                value={form.rpt_officer || ""}
                onChange={(e) => updateField("rpt_officer", e.target.value)}
                options={[
                  { value: "", label: "Select reporting officer" },
                  ...refRptOfficers.map((o) => ({ value: o.empcode, label: `${o.name} (${o.empcode})` })),
                ]}
              />
              <Select
                label="Status"
                options={statusOptions}
                value={form.status || "A"}
                onChange={(e) => updateField("status", e.target.value)}
              />
              <DynamicSelect
                label="Company / Unit"
                value={form.unit_id?.toString() || ""}
                onChange={(v) => updateField("unit_id", v ? parseInt(v) : 1)}
                options={refUnits.map((u) => ({ value: String(u.unit_id), label: u.unit_name }))}
              />
              <Input
                label="Working Hours"
                type="number"
                value={form.w_hour?.toString() || ""}
                onChange={(e) =>
                  updateField(
                    "w_hour",
                    e.target.value ? parseFloat(e.target.value) : undefined,
                  )
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Salary & Admin */}
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-lg font-semibold text-gray-900">
              Salary & Access
            </h2>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input
                label="Salary Basic (view-only)"
                value={ctrl.selectedEmployee?.sal_basic != null ? String(ctrl.selectedEmployee.sal_basic) : "—"}
                readOnly
                disabled
              />
              <Input
                label="Salary Gross (view-only)"
                value={ctrl.selectedEmployee?.sal_gross != null ? String(ctrl.selectedEmployee.sal_gross) : "—"}
                readOnly
                disabled
              />
              <Select
                label="Bank"
                value={form.bnkcode || ""}
                onChange={(e) => { updateField("bnkcode", e.target.value); updateField("brncode", ""); }}
                options={[
                  { value: "", label: "Select bank" },
                  ...refBanks.map((b) => ({ value: b.bnkcode, label: b.bnkname })),
                ]}
              />
              <Select
                label="Bank Branch"
                value={form.brncode || ""}
                onChange={(e) => updateField("brncode", e.target.value)}
                options={[
                  { value: "", label: form.bnkcode ? "Select branch" : "Select a bank first" },
                  ...refBankBranches.map((b) => ({ value: b.brncode, label: b.brnname })),
                ]}
              />
              <Input
                label="Bank Account Number"
                value={form.bnkacct || ""}
                onChange={(e) => updateField("bnkacct", e.target.value)}
                placeholder="Account number"
              />
              <Input
                label="N.T.N #"
                value={form.ntn || ""}
                onChange={(e) => updateField("ntn", e.target.value)}
                placeholder="National Tax Number"
              />
              <Select
                label="HR Admin"
                options={hrAdminOptions}
                value={form.hr_admin || "N"}
                onChange={(e) => updateField("hr_admin", e.target.value)}
              />
              <Input
                label="Initial Password"
                value={form.user_paswd || ""}
                onChange={(e) => updateField("user_paswd", e.target.value)}
                placeholder="Set employee password"
              />
              <Input
                label="HOD 1 (Employee PK)"
                type="number"
                value={form.hod1?.toString() || ""}
                onChange={(e) =>
                  updateField(
                    "hod1",
                    e.target.value ? parseInt(e.target.value) : undefined,
                  )
                }
              />
              <Input
                label="HOD 2 (Employee PK)"
                type="number"
                value={form.hod2?.toString() || ""}
                onChange={(e) =>
                  updateField(
                    "hod2",
                    e.target.value ? parseInt(e.target.value) : undefined,
                  )
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Location Tracking */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-indigo-500" />
              <h2 className="text-lg font-semibold text-gray-900">Location Tracking</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Select
                label="Track Location"
                options={[
                  { value: "N", label: "Disabled" },
                  { value: "Y", label: "Enabled" },
                ]}
                value={form.track_location || "N"}
                onChange={(e) => updateField("track_location", e.target.value)}
              />
              <Input
                label="Tracking Interval (hours)"
                type="number"
                value={form.track_location_hr?.toString() || "2"}
                onChange={(e) =>
                  updateField(
                    "track_location_hr",
                    e.target.value ? parseInt(e.target.value) : 2,
                  )
                }
                placeholder="1–24 hours"
              />
              {isEdit && ctrl.selectedEmployee?.atdtcard && (
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => viewLocation(ctrl.selectedEmployee?.atdtcard ?? "")}
                  >
                    <Navigation className="h-4 w-4 mr-1.5" />
                    View Location History
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Documents — only for an existing employee (needs an empcode) */}
        {isEdit && ctrl.selectedEmployee?.empcode && (
          <EmployeeDocuments empcode={ctrl.selectedEmployee.empcode} adminCardNo={user!.card_no} />
        )}

        <div className="flex justify-end gap-3 mb-8">
          <Button type="button" variant="secondary" onClick={goList}>
            <X className="h-4 w-4 mr-1.5" />
            Cancel
          </Button>
          <Button type="submit" loading={ctrl.saving}>
            <Save className="h-4 w-4 mr-1.5" />
            {isEdit ? "Update Employee" : "Register Employee"}
          </Button>
        </div>
      </form>
    </div>
  );
}
