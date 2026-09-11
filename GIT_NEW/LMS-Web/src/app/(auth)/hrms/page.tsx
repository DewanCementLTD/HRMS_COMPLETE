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
import { printTablePdf } from "@/lib/printTable";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { formatDate, toLocalYmd } from "@/lib/utils";
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
  CalendarPlus,
  MapPin,
  Settings,
  Navigation,
  FileText,
  IdCard,
  KeyRound,
} from "lucide-react";
import { updateLocationTracking, getEmployeeCard, resetEmployeePassword, type EmployeeCard } from "@/services/hrmsService";
import { fetchHodOptions } from "@/services/leaveService";
import type { HodOption } from "@/models/leave";
import { LocationPanel } from "./LocationPanel";
import { SetupPanel } from "./SetupPanel";
import { DynamicSelect } from "@/components/ui/DynamicSelect";
import { EmployeeDocuments } from "./EmployeeDocuments";
import { EmployeePhoto } from "./EmployeePhoto";
import { EmployeeIDCard } from "./EmployeeIDCard";
import { AttendancePanel } from "./AttendancePanel";
import { LeaveAllocationPanel } from "./LeaveAllocationPanel";
import { DutyRosterPanel, type RosterEmployee } from "./DutyRosterPanel";
import {
  fetchDepartments, fetchDesignations,
  fetchBloodGroups, fetchCadre, fetchUnits, fetchReligions, fetchReportingOfficers,
  fetchEmpStatuses, fetchBanks, fetchBankBranches, fetchQualifications, fetchLocations,
  addDepartment, addBloodGroup, addCadre,
  type Department, type Designation, type BloodGroup, type Cadre, type Unit,
  type Religion, type ReportingOfficer, type Location,
  type EmpStatus, type Bank, type BankBranch, type Qualification,
} from "@/services/referenceService";

// ──────────────────────────────────────────────
// Types & constants
// ──────────────────────────────────────────────

type View = "list" | "register" | "edit" | "report" | "roster";

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
  transfer_date: "",
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

// Codes come back from Oracle in whatever shape the column holds (blank-padded,
// zero-padded, numeric). The LOVs match option values by exact string, so map a
// saved code onto the matching option before it goes into the form — otherwise
// the field just renders blank when HR reopens the employee.
function matchCode(
  raw: string | number | undefined | null,
  options: { value: string }[],
): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  const exact = options.find((o) => o.value === v);
  if (exact) return exact.value;
  const loose = options.find(
    (o) => o.value.trim().replace(/^0+(?=\d)/, "") === v.replace(/^0+(?=\d)/, ""),
  );
  return loose ? loose.value : v;
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
  return toLocalYmd(new Date());
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
      return { from: toLocalYmd(mon), to: todayStr() };
    }
    case "month":
      return {
        from: toLocalYmd(new Date(yyyy, mm, 1)),
        to: todayStr(),
      };
    case "paycycle": {
      // 26th of previous month → 25th of current month
      const from = new Date(yyyy, mm - 1, 26);
      const to = new Date(yyyy, mm, 25);
      return {
        from: toLocalYmd(from),
        to: toLocalYmd(to),
      };
    }
    default:
      return {
        from: toLocalYmd(new Date(yyyy, mm, 1)),
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
    "Half Day",
    "Status",
    "Remarks",
  ];
  const rows = records.map((r) => [
    r.roster_date,
    r.day_name || "",
    r.in_time || "",
    r.out_time || "",
    `${r.w_hrs ?? 0}h ${r.w_mnt ?? 0}m`,
    r.is_late ? "Late" : "",
    r.is_half_day ? "Half Day" : "",
    r.status || "",
    r.remarks || r.roster_remarks || "",
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
// Employee directory CSV export
// ──────────────────────────────────────────────

function downloadEmployeesCSV(
  employees: HRMSSearchResult[],
  depts: Department[],
  desigs: Designation[],
) {
  const deptName = (no?: string) =>
    depts.find((d) => d.dept_no === Number(no))?.dept_name || no || "";
  const desigName = (cd?: string) =>
    desigs.find((d) => String(d.desg_cd) === String(cd))?.desg_desc || cd || "";
  const sexLabel = (s?: string) => (s === "M" ? "Male" : s === "F" ? "Female" : s || "");
  const statusText = (s?: string) =>
    ({ A: "Active", I: "Inactive", D: "Inactive", L: "Left" }[s || ""] || s || "");

  const headers = [
    "Employee Code", "Name", "Father/Husband Name", "Card No", "Attendance Card",
    "Department", "Designation", "Mobile", "Email", "Gender", "Status",
  ];
  const rows = employees.map((e) => [
    e.empcode, e.name || "", e.fhname || "", e.card_no || "", e.atdtcard || "",
    deptName(e.dept_no), desigName(e.desg_cd), e.mobile || "", e.email || "",
    sexLabel(e.sex), statusText(e.status),
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `employees_${todayStr()}.csv`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 150);
}

function downloadEmployeesPDF(
  employees: HRMSSearchResult[],
  depts: Department[],
  desigs: Designation[],
  companyName?: string,
) {
  const deptName = (no?: string) =>
    depts.find((d) => d.dept_no === Number(no))?.dept_name || no || "";
  const desigName = (cd?: string) =>
    desigs.find((d) => String(d.desg_cd) === String(cd))?.desg_desc || cd || "";
  const sexLabel = (s?: string) => (s === "M" ? "Male" : s === "F" ? "Female" : s || "");
  const statusText = (s?: string) =>
    ({ A: "Active", I: "Inactive", D: "Inactive", L: "Left" }[s || ""] || s || "");

  printTablePdf({
    companyName,
    title: "Employee Directory",
    meta: `${employees.length} employee${employees.length === 1 ? "" : "s"}`,
    landscape: true,
    columns: ["Code", "Name", "Father/Husband", "Card No", "Att. Card", "Department", "Designation", "Mobile", "Email", "Gender", "Status"],
    rows: employees.map((e) => [
      e.empcode, e.name || "", e.fhname || "", e.card_no || "", e.atdtcard || "",
      deptName(e.dept_no), desigName(e.desg_cd), e.mobile || "", e.email || "",
      sexLabel(e.sex), statusText(e.status),
    ]),
  });
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

  const [section, setSection] = useState<"employees" | "locations" | "setup" | "attendance" | "leave">("employees");

  // Honor a ?section= query param (e.g. from the HR dashboard's Quick Actions)
  // so links can land directly on the right tab instead of always the employee list.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const s = new URLSearchParams(window.location.search).get("section");
    if (s === "attendance" || s === "locations" || s === "setup" || s === "employees" || s === "leave") {
      setSection(s);
    }
  }, []);

  const [locationFocusCard, setLocationFocusCard] = useState<string | undefined>();
  const [view, setView] = useState<View>("list");
  const [activeTab, setActiveTab] = useState<StatusTab>("");
  const [localQuery, setLocalQuery] = useState("");
  const [form, setForm] = useState<HRMSEmployeeCreate>({ ...EMPTY_FORM });
  const [reportRange, setReportRange] = useState<AttendanceDateRange>(getPreset("month"));
  const [empFilter, setEmpFilter] = useState<EmpFilter>({ dept: "", gender: "", status: "", location: "" });
  const [cardData, setCardData] = useState<EmployeeCard | null>(null);
  const [rosterEmp, setRosterEmp] = useState<RosterEmployee | null>(null);

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
  const [refLocations,  setRefLocations]  = useState<Location[]>([]);
  // HOD 1 / HOD 2 pick an employee of the selected company; the stored value
  // is that person's mobile number (what EMPLOYEE.HOD1/HOD2 hold).
  const [refHods, setRefHods] = useState<HodOption[]>([]);
  // Which employee the edit form currently holds, so it is filled exactly once
  // per employee instead of whenever a field happens to be empty.
  const [populatedFor, setPopulatedFor] = useState<string | null>(null);
  // The branch the employee was loaded with. Comparing against it is what tells
  // us HR is transferring them, rather than just re-saving the same record.
  const [originalLocation, setOriginalLocation] = useState<string>("");
  const [resettingPw, setResettingPw] = useState(false);
  const [pwMessage, setPwMessage] = useState<string | null>(null);

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
      fetchEmpStatuses(c), fetchBanks(c), fetchQualifications(c),
      fetchLocations(c),
      user?.card_no
        ? fetchHodOptions(user.card_no, c, b).catch(() => ({ items: [] as HodOption[] }))
        : Promise.resolve({ items: [] as HodOption[] }),
    ]).then(([d, des, bg, ca, u, rel, rpt, est, bk, ql, loc, hods]) => {
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
      setRefLocations(loc.items);
      setRefHods(hods.items);
    }).catch(console.error);
  }, [activeCompany, activeBranch]);

  // ---- Populate the edit form once per employee ----
  //
  // This used to run during render whenever `form.name === ""`, which caused two
  // bugs: clearing the Name box re-triggered it and the old values sprang back,
  // and opening a second employee left the first one's data in the form (the
  // guard was false because the name was still filled), so a save wrote one
  // employee's details onto another. Keying on the loaded empcode fixes both.
  useEffect(() => {
    const e = ctrl.selectedEmployee;
    if (view !== "edit" || !e?.empcode) return;
    if (populatedFor === e.empcode) return;
    setPopulatedFor(e.empcode);
    setOriginalLocation(e.location != null ? String(e.location) : "");
    setForm({
      name: e.name || "",
      fhname: e.fhname || "",
      atdtcard: e.atdtcard || "",
      sex: e.sex || "",
      dtofbrth: e.dtofbrth || "",
      nicno: e.nicno || "",
      dtofappt: e.dtofappt || "",
      dept_no: e.dept_no != null ? String(e.dept_no) : "",
      desg_cd: e.desg_cd != null ? String(e.desg_cd) : "",
      mobile: e.mobile || "",
      email: e.email || "",
      address: e.address || "",
      unit_id: e.unit_id ?? 1,
      // LOCATION/DEPT_NO/DESG_CD are numeric columns in Oracle, so the API can
      // return them as numbers; the form and the API contract both want strings.
      location: e.location != null ? String(e.location) : "",
      // TRANSFER_DATE is a DATE column; an <input type="date"> silently blanks
      // on anything but YYYY-MM-DD, so trim a time component if one comes back.
      transfer_date: String(e.transfer_date || "").slice(0, 10),
      status: e.status || "A",
      user_paswd: e.user_paswd || "",
      hr_admin: e.hr_admin || "N",
      rpt_officer: e.rpt_officer || "",
      marstat: e.marstat || "",
      religion: e.religion || "",
      basic: e.basic ?? undefined,
      gross: e.gross ?? undefined,
      w_hour: e.w_hour ?? undefined,
      bldgrp: e.bldgrp || "",
      grade_cd: e.grade_cd || "",
      shift: e.shift || "",
      hod1: e.hod1 ?? undefined,
      hod2: e.hod2 ?? undefined,
      hod3: e.hod3 ?? undefined,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ctrl.selectedEmployee, populatedFor]);

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
      { id: "attendance" as const,  icon: Clock,     label: "Attendance" },
      { id: "leave" as const,       icon: CalendarPlus, label: "Leave Allocation" },
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
  if (section === "leave") {
    return (
      <div className="animate-fade-in">
        <SectionNav />
        <LeaveAllocationPanel adminCardNo={user.card_no} />
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

  if (section === "attendance") {
    return (
      <div className="animate-fade-in">
        <SectionNav />
        <AttendancePanel adminCardNo={user.card_no} />
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
    // Drop the loaded employee entirely — leaving it behind is what used to
    // carry one employee's details into the next one's form.
    setForm({ ...EMPTY_FORM });
    setPopulatedFor(null);
    setOriginalLocation("");
    setPwMessage(null);
    setView("list");
  }

  function startRegister() {
    // Default Company/Unit to the active company, and Branch to the active
    // branch. When "All Branches" is selected (activeBranch empty), the branch
    // is left blank so HR picks it from the LOV.
    setForm({
      ...EMPTY_FORM,
      unit_id: activeCompany ? (parseInt(activeCompany) || 1) : 1,
      location: activeBranch || "",
    });
    setPopulatedFor(null);
    ctrl.clearMessages();
    setView("register");
  }

  function startEdit(empcode: string) {
    ctrl.clearMessages();
    setPwMessage(null);
    // Blank the form first: the effect below refills it from the employee that
    // finishes loading, and this guarantees nothing of the previous one shows
    // in the meantime.
    setForm({ ...EMPTY_FORM });
    setPopulatedFor(null);
    setOriginalLocation("");
    ctrl.loadEmployee(empcode).then(() => setView("edit"));
  }

  async function openCard(empcode: string) {
    if (!user) return;
    try {
      const card = await getEmployeeCard(empcode, user.card_no);
      setCardData(card);
    } catch (e) {
      console.error("Failed to load ID card", e);
    }
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

  function startRoster(emp: HRMSSearchResult) {
    setRosterEmp({
      cardNo: emp.card_no || emp.atdtcard || emp.empcode,
      name: emp.name,
      designation: refDesigs.find((d) => String(d.desg_cd) === String(emp.desg_cd))?.desg_desc,
      department: refDepts.find((d) => d.dept_no === Number(emp.dept_no))?.dept_name,
      status: emp.status,
    });
    setView("roster");
  }


  async function resetPassword() {
    if (!ctrl.selectedEmployee) return;
    const typed = (form.user_paswd || "").trim();
    const label = typed
      ? "Set this employee's login password to the Initial Password shown here?"
      : "Reset this employee's login password to the initial one on file?";
    if (!window.confirm(label)) return;
    setResettingPw(true);
    ctrl.clearMessages();
    try {
      const res = await resetEmployeePassword(
        ctrl.selectedEmployee.empcode,
        user!.card_no,
        typed || undefined,
      );
      setPwMessage(res.message);
    } catch (e) {
      setPwMessage(e instanceof Error ? e.message : "Failed to reset the password");
    } finally {
      setResettingPw(false);
    }
  }

  function updateField(
    field: keyof HRMSEmployeeCreate,
    // null is meaningful for the HOD pickers: it clears the approver, where
    // undefined would just leave the stored value alone.
    value: string | number | undefined | null,
  ) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  /** Fields HR must fill in before an employee can be saved. Branch/Location is
   *  required because without it the employee won't appear under any branch
   *  (and won't be counted in that branch's attendance); the rest are needed
   *  downstream by payroll, ID cards and statutory reports. Gross is only
   *  checked when this admin is allowed to edit salary — it's read-only
   *  otherwise, so they'd have no way to supply it. */
  function missingRequired(): string | null {
    if (!form.name.trim()) return "Full Name";
    if (!(form.mobile || "").trim()) return "Mobile Number";
    {
      const digits = (form.mobile || "").replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 11) {
        return "a valid Mobile Number (10 or 11 digits)";
      }
    }
    if (!form.dtofbrth) return "Date of Birth";
    if (!form.nicno?.trim()) return "NIC Number";
    if (!form.dtofappt) return "Date of Appointment";
    if (!form.dept_no) return "Department";
    if (!form.desg_cd) return "Designation";
    if (!form.location) return "Branch / Location";
    // Same condition the Transfer Date field renders on, computed here rather
    // than read from render scope so the validator stands on its own.
    const movingBranch =
      view === "edit" && !!originalLocation && String(form.location ?? "") !== originalLocation;
    if (movingBranch && !form.transfer_date) return "Transfer Date (the branch has changed)";
    // Without HOD 1 the employee's leave has no first approver and would sit
    // unapproved forever.
    if (!form.hod1) return "HOD 1";
    if (user?.can_edit_salary && (form.gross == null || Number.isNaN(form.gross)))
      return "Gross Salary";
    return null;
  }

  async function onSubmitRegister(e: { preventDefault(): void }) {
    e.preventDefault();
    ctrl.clearMessages();
    const missing = missingRequired();
    if (missing) {
      alert(`Please fill in ${missing} before registering the employee.`);
      return;
    }
    const res = await ctrl.registerEmployee(form);
    if (res?.status === "success") {
      setForm({ ...EMPTY_FORM });
    }
  }

  async function onSubmitEdit(e: { preventDefault(): void }) {
    e.preventDefault();
    ctrl.clearMessages();
    if (!ctrl.selectedEmployee) return;
    const missing = missingRequired();
    if (missing) {
      alert(`Please fill in ${missing} before saving the employee.`);
      return;
    }
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
    if (reportRange.from && reportRange.to && reportRange.to < reportRange.from) {
      alert("“To Date” cannot be earlier than “From Date”.");
      return;
    }
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
        {cardData && <EmployeeIDCard card={cardData} adminCardNo={user.card_no} onClose={() => setCardData(null)} />}
        {/* Section toggle */}
        <SectionNav />

        <PageHeader
          title="HRMS — Employee Management"
          subtitle="Manage employees and view attendance reports"
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => downloadEmployeesCSV(visibleEmployees, refDepts, refDesigs)}
                disabled={visibleEmployees.length === 0}
              >
                <Download className="h-4 w-4 mr-1.5" />
                CSV ({visibleEmployees.length})
              </Button>
              <Button
                variant="secondary"
                onClick={() => downloadEmployeesPDF(visibleEmployees, refDepts, refDesigs, user?.selected_company?.name)}
                disabled={visibleEmployees.length === 0}
              >
                <FileText className="h-4 w-4 mr-1.5" />
                PDF
              </Button>
              <Button onClick={startRegister}>
                <UserPlus className="h-4 w-4 mr-1.5" />
                Register Employee
              </Button>
            </div>
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
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
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
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => startRoster(emp)}
                            >
                              <Calendar className="h-3.5 w-3.5 mr-1" />
                              Roster
                            </Button>
                            {/* "ID Card" and "Location" per-row actions removed (QA):
                                ID cards have a dedicated page, and the per-row
                                Location button only re-opened the shared Locations
                                tab regardless of the employee. */}
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
  // VIEW: MONTHLY DUTY ROSTER (read-only, from DUTY_ROSTER)
  // ════════════════════════════════════════════
  if (view === "roster" && rosterEmp) {
    return (
      <div className="animate-fade-in">
        <DutyRosterPanel emp={rosterEmp} adminCardNo={user.card_no} onBack={goList} />
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
                  max={reportRange.to || undefined}
                  onChange={(e) =>
                    // Keep To >= From: if the new From is after To, push To along.
                    setReportRange((r) => ({
                      ...r,
                      from: e.target.value,
                      to: r.to && e.target.value > r.to ? e.target.value : r.to,
                    }))
                  }
                />
              </div>
              <div className="flex-1 w-full">
                <Input
                  label="To Date"
                  type="date"
                  value={reportRange.to}
                  min={reportRange.from || undefined}
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
                value: summary.late_days ?? 0,
                cls: "text-yellow-600",
              },
              {
                label: "Half Day",
                value: summary.half_days ?? 0,
                cls: "text-orange-600",
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
                user?.selected_company?.name,
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
                user?.selected_company?.name,
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
                        "Half Day",
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
                      const isLate = !!rec.is_late;
                      const isHalf = !!rec.is_half_day;
                      const isAbsent = !!rec.is_absent;
                      const isIncomplete = rec.in_time && !rec.out_time;
                      const rowCls = isAbsent
                        ? "bg-red-50/60"
                        : isLate
                          ? "bg-yellow-50/70"
                          : isHalf
                            ? "bg-orange-50/60"
                            : isIncomplete
                              ? "bg-amber-50/60"
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
                              className={`flex items-center gap-1 ${isLate ? "text-yellow-700 font-semibold" : "text-gray-600"}`}
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
                              <span className="flex items-center gap-1 text-yellow-700 font-medium">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Late
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {isHalf ? (
                              <span className="text-orange-600 font-medium">Half Day</span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              status={rec.status || "—"}
                              className={rec.is_leave ? "bg-indigo-100 text-indigo-800" : undefined}
                            />
                          </td>
                          {/* Same derived line the HRMS Attendance screen shows:
                              leave type + the employee's reason, "Absent", or the
                              roster's own remark. */}
                          <td className={`px-4 py-3 text-sm ${
                            rec.is_leave ? "text-indigo-700" : "text-gray-500 italic"
                          }`}>
                            {rec.remarks || rec.roster_remarks || ""}
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

  const deptOptions = refDepts.map((d) => ({ value: String(d.dept_no), label: d.dept_name }));
  const desigOptions = refDesigs.map((d) => ({ value: d.desg_cd, label: d.desg_desc }));
  const locationOptions = refLocations.map((l) => ({ value: l.lcode, label: l.descr }));
  // Value = mobile number, which is what HOD1/HOD2 hold on the employee row.
  // HR is moving this employee to another branch, so the transfer date is asked
  // for. Only on edit: on register the branch is the initial placement, not a
  // transfer.
  const isTransfer =
    isEdit && !!originalLocation && String(form.location ?? "") !== originalLocation;

  const hodOptions = refHods.map((h) => ({
    value: h.mobile,
    label: h.department ? `${h.name} — ${h.department} (${h.mobile})` : `${h.name} (${h.mobile})`,
  }));

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
      {pwMessage && (
        <div className="mb-4">
          <Alert type="success" message={pwMessage} onClose={() => setPwMessage(null)} />
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
                label="Date of Birth *"
                type="date"
                value={form.dtofbrth || ""}
                onChange={(e) => updateField("dtofbrth", e.target.value)}
                required
              />
              <Input
                label="NIC Number *"
                value={form.nicno || ""}
                onChange={(e) => updateField("nicno", formatNIC(e.target.value))}
                placeholder="4XXXX-XXXXXXX-X"
                maxLength={15}
                required
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
                  // Drop junk reference rows whose label is just a number (e.g. "1", "11").
                  ...refReligions
                    .filter((r) => r.label && !/^\d+$/.test(r.label.trim()))
                    .map((r) => ({ value: r.code, label: r.label })),
                ]}
              />
              <Select
                label="Blood Group"
                value={form.bldgrp || ""}
                onChange={(e) => updateField("bldgrp", e.target.value)}
                options={[
                  { value: "", label: refBG.length ? "Select blood group" : "Add in Setup → Blood Groups" },
                  ...refBG.map((b) => ({ value: b.blood_group, label: b.blood_group })),
                ]}
              />
              {/* Digits only, 10 or 11 (0300 1234567 with or without the
                  leading zero). Anything longer is rejected as it is typed. */}
              <Input
                label="Mobile Number *"
                type="tel"
                inputMode="numeric"
                value={form.mobile || ""}
                onChange={(e) => updateField("mobile", e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="03001234567"
                maxLength={11}
                required
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
                label="Date of Appointment *"
                type="date"
                value={form.dtofappt || ""}
                onChange={(e) => updateField("dtofappt", e.target.value)}
                required
              />
              <SearchableSelect
                label="Department *"
                value={matchCode(form.dept_no, deptOptions)}
                onChange={(v) => updateField("dept_no", v)}
                placeholder="Search department…"
                options={deptOptions}
              />
              <SearchableSelect
                label="Designation *"
                value={matchCode(form.desg_cd, desigOptions)}
                onChange={(v) => updateField("desg_cd", v)}
                placeholder="Search designation…"
                options={desigOptions}
              />
              <SearchableSelect
                label="Employee Status"
                value={form.emp_status || ""}
                onChange={(v) => updateField("emp_status", v)}
                placeholder="Search status…"
                options={refEmpStatuses.map((s) => ({ value: s.emp_status, label: s.descr }))}
              />
              <Input
                label="Date of Confirmation"
                type="date"
                value={form.dtofconfirm || ""}
                onChange={(e) => updateField("dtofconfirm", e.target.value)}
              />
              <SearchableSelect
                label="Qualification"
                value={form.qfication || ""}
                onChange={(v) => updateField("qfication", v)}
                placeholder="Search qualification…"
                options={refQuals.map((q) => ({ value: q.descr, label: q.descr }))}
              />
              <Input
                label="Qualification Detail"
                value={form.qual_detail || ""}
                onChange={(e) => updateField("qual_detail", e.target.value)}
                placeholder="e.g. BSc Computer Science, Punjab University"
              />
              <SearchableSelect
                label="Reporting Officer"
                value={form.rpt_officer || ""}
                onChange={(v) => updateField("rpt_officer", v)}
                placeholder="Type a name or code…"
                options={refRptOfficers.map((o) => ({ value: o.empcode, label: `${o.name} (${o.empcode})` }))}
              />
              <Select
                label="Status"
                options={statusOptions}
                value={form.status || "A"}
                onChange={(e) => updateField("status", e.target.value)}
              />
              {/* Company is not selectable: an employee belongs to the HR user's
                  own company, which comes from the sidebar selection. Shown
                  read-only so it is still visible on the record. */}
              <Input
                label="Company / Unit"
                value={
                  refUnits.find((u) => String(u.unit_id) === String(form.unit_id))?.unit_name
                  || (form.unit_id != null ? String(form.unit_id) : "—")
                }
                readOnly
                disabled
              />
              <SearchableSelect
                label="Branch / Location *"
                value={matchCode(form.location, locationOptions)}
                onChange={(v) => updateField("location", v)}
                placeholder="Select branch…"
                options={locationOptions}
              />
              {/* Appears only once the branch actually changes; stored in
                  HR_EMP_MASTER.TRANSFER_DATE. */}
              {isTransfer && (
                <Input
                  label="Transfer Date *"
                  type="date"
                  value={form.transfer_date || ""}
                  onChange={(e) => updateField("transfer_date", e.target.value)}
                  required
                />
              )}
              <Input
                label="Working Hours"
                type="number"
                min={0}
                value={form.w_hour?.toString() || ""}
                onChange={(e) =>
                  updateField(
                    "w_hour",
                    e.target.value ? Math.max(0, parseFloat(e.target.value)) : undefined,
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
              {/* Basic is derived by the database (TRG_HR_EMP_MASTER_BIU sets it to
                  gross / 1.55 whenever gross changes), so it is shown but never
                  edited — typing a value here would only diverge from payroll. */}
              <Input
                label="Basic Salary (auto — from gross)"
                value={form.basic != null ? String(form.basic) : "—"}
                readOnly
                disabled
              />
              {user?.can_edit_salary ? (
                <Input
                  label="Gross Salary *"
                  type="number"
                  min={0}
                  value={form.gross?.toString() ?? ""}
                  onChange={(e) => updateField("gross", e.target.value ? Math.max(0, parseFloat(e.target.value)) : undefined)}
                  required
                />
              ) : (
                <Input
                  label="Gross Salary (view-only)"
                  value={ctrl.selectedEmployee?.sal_gross != null ? String(ctrl.selectedEmployee.sal_gross) : "—"}
                  readOnly
                  disabled
                />
              )}
              <SearchableSelect
                label="Bank"
                value={form.bnkcode || ""}
                onChange={(v) => { updateField("bnkcode", v); updateField("brncode", ""); }}
                placeholder="Search bank…"
                options={refBanks.map((b) => ({ value: b.bnkcode, label: b.bnkname }))}
              />
              <SearchableSelect
                label="Bank Branch"
                value={form.brncode || ""}
                onChange={(v) => updateField("brncode", v)}
                placeholder={form.bnkcode ? "Search branch…" : "Select a bank first"}
                disabled={!form.bnkcode}
                options={refBankBranches.map((b) => ({ value: b.brncode, label: b.brnname }))}
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
              {/* This is the INITIAL password, stored on the HRMS record. The
                  employee's own password changes are written to their login
                  account instead, so nothing they choose ever shows up here.
                  Reset copies this value back over their live password. */}
              <div className="space-y-1.5">
                <Input
                  label="Initial Password"
                  value={form.user_paswd || ""}
                  onChange={(e) => updateField("user_paswd", e.target.value)}
                  placeholder="Set employee password"
                />
                {isEdit && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={resetPassword}
                      loading={resettingPw}
                    >
                      <KeyRound className="h-4 w-4 mr-1.5" /> Reset to initial password
                    </Button>
                    <span className="text-xs text-gray-400">
                      Overrides whatever the employee set.
                    </span>
                  </div>
                )}
              </div>
              {/* HOD 1 / HOD 2 approve this employee's leave. The column stores
                  the approver's mobile number (HOD1_MNO on the application), and
                  the list is limited to the selected company's employees. */}
              <SearchableSelect
                label="HOD 1 (approves leave) *"
                value={form.hod1?.toString() || ""}
                onChange={(v) => updateField("hod1", v || null)}
                placeholder="Search employee…"
                options={hodOptions}
              />
              <SearchableSelect
                label="HOD 2 (second approval)"
                value={form.hod2?.toString() || ""}
                onChange={(v) => updateField("hod2", v || null)}
                placeholder="Search employee…"
                options={hodOptions}
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

        {/* Profile photo + Documents — only for an existing employee (needs an empcode) */}
        {isEdit && ctrl.selectedEmployee?.empcode && (
          <>
            <EmployeePhoto empcode={ctrl.selectedEmployee.empcode} adminCardNo={user!.card_no} />
            <EmployeeDocuments empcode={ctrl.selectedEmployee.empcode} adminCardNo={user!.card_no} />
          </>
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
