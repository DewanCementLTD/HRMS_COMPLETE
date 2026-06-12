"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, Check, Loader2, RefreshCw, Settings, Pencil, X, Trash2, Upload,
  Image as ImageIcon, Building2, BadgeCheck, Landmark, ChevronRight,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { uploadCompanyLogo } from "@/services/documentService";
import { companyLogoUrl } from "@/components/ui/CompanyLogo";
import {
  fetchDepartments, fetchGrades, fetchDesignations, fetchShifts,
  fetchBloodGroups, fetchUnits, fetchLocations,
  addDepartment, addGrade, addDesignation, addShift, addBloodGroup, addUnit,
  addLocation, updateLocation,
  fetchEmpStatuses, fetchBanks, fetchBankBranches, fetchQualifications,
  addEmpStatus, deleteEmpStatus, addBank, deleteBank,
  addBankBranch, deleteBankBranch, addQualification, deleteQualification,
  type Department, type Grade, type Designation, type Shift, type BloodGroup, type Unit, type Location,
  type EmpStatus, type Bank, type BankBranch, type Qualification,
} from "@/services/referenceService";

// ─── Types ────────────────────────────────────────────────

type Tab = "departments" | "grades" | "designations" | "shifts" | "blood_groups" | "units" | "locations"
  | "emp_statuses" | "banks" | "bank_branches" | "qualifications" | "company_logo";

const TAB_LABEL: Record<Tab, string> = {
  departments: "Departments", designations: "Designations", grades: "Grades",
  units: "Units", locations: "Locations", emp_statuses: "Employee Status",
  qualifications: "Qualifications", blood_groups: "Blood Groups", shifts: "Shifts",
  banks: "Banks", bank_branches: "Bank Branches", company_logo: "Company Logo",
};

// Master tables grouped into a few areas so Setup reads as clear sections
// instead of one long row of tabs.
interface SetupGroup { id: string; label: string; icon: React.ElementType; desc: string; tabs: Tab[] }

const GROUPS: SetupGroup[] = [
  {
    id: "organization", label: "Organization", icon: Building2,
    desc: "Company structure: units, locations, departments, designations and grades.",
    tabs: ["units", "locations", "departments", "designations", "grades"],
  },
  {
    id: "employee", label: "Employee", icon: BadgeCheck,
    desc: "Employee attributes used on the employee form.",
    tabs: ["emp_statuses", "qualifications", "blood_groups", "shifts"],
  },
  {
    id: "banking", label: "Banking", icon: Landmark,
    desc: "Banks and their branches for salary accounts.",
    tabs: ["banks", "bank_branches"],
  },
  {
    id: "branding", label: "Branding", icon: ImageIcon,
    desc: "Company logo shown on ID cards and payslips.",
    tabs: ["company_logo"],
  },
];

// ─── Inline add row ───────────────────────────────────────

function AddRow({
  fields,
  onSave,
}: {
  fields: { key: string; label: string; placeholder: string; optional?: boolean }[];
  onSave: (values: Record<string, string>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ""]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (fields.some((f) => !f.optional && !values[f.key].trim())) {
      setError("Required fields must be filled");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(values);
      setValues(Object.fromEntries(fields.map((f) => [f.key, ""])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="bg-indigo-50/60">
      {fields.map((f) => (
        <td key={f.key} className="px-4 py-2">
          <input
            type="text"
            value={values[f.key]}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder={f.placeholder}
            className="w-full border border-indigo-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </td>
      ))}
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Save
          </button>
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      </td>
    </tr>
  );
}

// ─── Table wrapper ────────────────────────────────────────

function MasterTable({
  columns,
  rows,
  loading,
  onRefresh,
  addFields,
  onAdd,
  onDelete,
}: {
  columns: string[];
  rows: (string | number | null | undefined)[][];
  loading: boolean;
  onRefresh: () => void;
  addFields: { key: string; label: string; placeholder: string }[];
  onAdd: (values: Record<string, string>) => Promise<void>;
  onDelete?: (rowIndex: number) => Promise<void>;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  async function handleDelete(i: number) {
    if (!onDelete) return;
    if (!confirm("Remove this entry?")) return;
    setDeleting(i);
    try {
      await onDelete(i);
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{rows.length} records</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
            <Plus className="h-4 w-4 mr-1" />
            Add New
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                >
                  {c}
                </th>
              ))}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-50">
            {showAdd && (
              <AddRow
                fields={addFields}
                onSave={async (vals) => {
                  await onAdd(vals);
                  setShowAdd(false);
                  onRefresh();
                }}
              />
            )}
            {loading && (
              <tr>
                <td colSpan={columns.length + 1} className="py-10 text-center">
                  <Spinner />
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="py-10 text-center text-sm text-gray-400"
                >
                  No records found.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50 transition-colors">
                  {row.map((cell, j) => (
                    <td key={j} className="px-4 py-2.5 text-sm text-gray-700">
                      {cell ?? "—"}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right">
                    {onDelete && (
                      <button
                        onClick={() => handleDelete(i)}
                        disabled={deleting === i}
                        className="text-red-500 hover:text-red-700 disabled:opacity-40"
                        title="Remove"
                      >
                        {deleting === i ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Locations table (with inline edit support) ──────────

function LocationsTable({
  locs,
  loading,
  adminCardNo,
  onRefresh,
}: {
  locs: Location[];
  loading: boolean;
  adminCardNo: string;
  onRefresh: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editLcode, setEditLcode] = useState<string | null>(null);
  const [editVals, setEditVals] = useState<{ descr: string; sname: string; regioncode: string; city: string }>({ descr: "", sname: "", regioncode: "", city: "" });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit(loc: Location) {
    setEditLcode(loc.lcode);
    setEditVals({ descr: loc.descr, sname: loc.sname, regioncode: loc.regioncode, city: loc.city });
    setEditError(null);
  }

  async function saveEdit() {
    if (!editVals.descr.trim()) { setEditError("Description is required"); return; }
    setSaving(true);
    setEditError(null);
    try {
      await updateLocation(adminCardNo, editLcode!, editVals.descr, editVals.sname || editVals.descr, editVals.regioncode, editVals.city);
      setEditLcode(null);
      onRefresh();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{locs.length} records</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setShowAdd((v) => !v); setEditLcode(null); }}>
            <Plus className="h-4 w-4 mr-1" />
            Add New
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {["Code", "Description", "Short Name", "Region", "City", ""].map((c, i) => (
                <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-50">
            {showAdd && (
              <AddRow
                fields={[
                  { key: "lcode",      label: "Code",        placeholder: "e.g. DAC" },
                  { key: "descr",      label: "Description", placeholder: "e.g. Dhaka Office" },
                  { key: "sname",      label: "Short Name",  placeholder: "Optional", optional: true },
                  { key: "regioncode", label: "Region",      placeholder: "Optional", optional: true },
                  { key: "city",       label: "City",        placeholder: "e.g. Dhaka",        optional: true },
                ]}
                onSave={async (vals) => {
                  await addLocation(adminCardNo, vals.lcode, vals.descr, vals.sname || vals.descr, vals.regioncode || "", vals.city || "");
                  setShowAdd(false);
                  onRefresh();
                }}
              />
            )}
            {loading && (
              <tr><td colSpan={6} className="py-10 text-center"><Spinner /></td></tr>
            )}
            {!loading && locs.length === 0 && (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-gray-400">No records found.</td></tr>
            )}
            {!loading && locs.map((loc) =>
              editLcode === loc.lcode ? (
                <tr key={loc.lcode} className="bg-indigo-50/60">
                  <td className="px-4 py-2 text-sm font-mono text-gray-500">{loc.lcode}</td>
                  {(["descr", "sname", "regioncode", "city"] as const).map((field) => (
                    <td key={field} className="px-4 py-2">
                      <input
                        type="text"
                        value={editVals[field]}
                        onChange={(e) => setEditVals((v) => ({ ...v, [field]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                        className="w-full border border-indigo-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      />
                    </td>
                  ))}
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={saveEdit}
                        disabled={saving}
                        className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        Save
                      </button>
                      <button onClick={() => setEditLcode(null)} className="p-1 text-gray-400 hover:text-gray-600">
                        <X className="h-4 w-4" />
                      </button>
                      {editError && <span className="text-xs text-red-500">{editError}</span>}
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={loc.lcode} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-mono text-gray-700">{loc.lcode}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-700">{loc.descr || "—"}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-500">{loc.sname || "—"}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-500">{loc.regioncode || "—"}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-500">{loc.city || "—"}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => startEdit(loc)}
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Company logo upload (per company) ───────────────────

function CompanyLogoTab({ adminCardNo, compc, companyName }: { adminCardNo: string; compc: string; companyName: string }) {
  const [bust, setBust] = useState(() => Date.now());
  const [hasLogo, setHasLogo] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Re-probe when the active company changes.
  useEffect(() => { setHasLogo(true); setError(null); setOk(false); setBust(Date.now()); }, [compc]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!f || !compc) return;
    setUploading(true); setError(null); setOk(false);
    try {
      await uploadCompanyLogo(adminCardNo, compc, f);
      setHasLogo(true);
      setBust(Date.now());
      setOk(true);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (!compc) {
    return <p className="text-sm text-gray-400 py-6 text-center">Select a company first.</p>;
  }

  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-gray-500">
        Upload the logo for <span className="font-semibold text-gray-800">{companyName || `Company ${compc}`}</span>.
        It appears on employee ID cards and payslips. Saved as
        <span className="font-mono text-gray-700"> {(companyName || "company").replace(/\s+/g, "_")}_logo</span>.
        Any colour or transparency is preserved.
      </p>

      <div className="flex items-center gap-6">
        <div className="h-28 w-44 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden p-2">
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={companyLogoUrl(compc, bust)}
              alt=""
              onError={() => setHasLogo(false)}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div className="text-center text-gray-300">
              <ImageIcon className="h-8 w-8 mx-auto mb-1" />
              <span className="text-xs">No logo</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={onPick} className="hidden" />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
            {hasLogo ? "Replace Logo" : "Upload Logo"}
          </Button>
          <p className="text-xs text-gray-400">PNG, JPG, WEBP, GIF or SVG.</p>
          {ok && <p className="text-xs text-emerald-600">Logo updated.</p>}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────

export function SetupPanel({ adminCardNo }: { adminCardNo: string }) {
  const { activeCompany, activeBranch, user } = useAuth();
  const [groupId, setGroupId] = useState<string>("organization");
  const [tab, setTab] = useState<Tab>("departments");

  // Data
  const [depts,  setDepts]  = useState<Department[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [desigs, setDesigs] = useState<Designation[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [bgs,    setBgs]    = useState<BloodGroup[]>([]);
  const [units,  setUnits]  = useState<Unit[]>([]);
  const [locs,   setLocs]   = useState<Location[]>([]);
  const [empStatuses, setEmpStatuses] = useState<EmpStatus[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankBranches, setBankBranches] = useState<BankBranch[]>([]);
  const [quals, setQuals] = useState<Qualification[]>([]);
  const [branchBank, setBranchBank] = useState("");   // selected bank for Bank Branches tab
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (t: Tab) => {
    setLoading(true);
    try {
      switch (t) {
        case "departments":  { const r = await fetchDepartments(activeCompany, activeBranch);  setDepts(r.items);  break; }
        case "grades":       { const r = await fetchGrades(activeCompany, activeBranch);       setGrades(r.items); break; }
        case "designations": { const r = await fetchDesignations(undefined, activeCompany, activeBranch); setDesigs(r.items); break; }
        case "shifts":       { const r = await fetchShifts(activeCompany, activeBranch);       setShifts(r.items); break; }
        case "blood_groups": { const r = await fetchBloodGroups(activeCompany, activeBranch);  setBgs(r.items);    break; }
        case "units":        { const r = await fetchUnits();        setUnits(r.items);  break; }
        case "locations":    { const r = await fetchLocations();    setLocs(r.items);   break; }
        case "emp_statuses": { const r = await fetchEmpStatuses(activeCompany); setEmpStatuses(r.items); break; }
        case "qualifications": { const r = await fetchQualifications(activeCompany); setQuals(r.items); break; }
        case "banks":        { const r = await fetchBanks(activeCompany); setBanks(r.items); break; }
        case "bank_branches": {
          const r = await fetchBanks(activeCompany); setBanks(r.items);
          if (branchBank) { const b = await fetchBankBranches(branchBank); setBankBranches(b.items); }
          else setBankBranches([]);
          break;
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeCompany, activeBranch, branchBank]);

  useEffect(() => { load(tab); }, [tab, load]);

  function switchTab(t: Tab) {
    setTab(t);
  }

  function selectGroup(g: SetupGroup) {
    setGroupId(g.id);
    setTab(g.tabs[0]);   // jump to the area's first master table
  }

  // ── Departments ──────────────────────────────────────────
  const deptTable = (
    <MasterTable
      columns={["Dept No", "Department Name"]}
      rows={depts.map((d) => [d.dept_no, d.dept_name])}
      loading={loading}
      onRefresh={() => load("departments")}
      addFields={[
        { key: "dept_name", label: "Department Name", placeholder: "e.g. Human Resources" },
      ]}
      onAdd={async (v) => {
        await addDepartment(adminCardNo, v.dept_name);
      }}
    />
  );

  // ── Grades ───────────────────────────────────────────────
  const gradeTable = (
    <MasterTable
      columns={["Grade Code", "Description"]}
      rows={grades.map((g) => [g.grade_cd, g.descr])}
      loading={loading}
      onRefresh={() => load("grades")}
      addFields={[
        { key: "grade_cd",  label: "Grade Code",   placeholder: "e.g. G1" },
        { key: "descr",     label: "Description",  placeholder: "e.g. Grade 1 Officer" },
      ]}
      onAdd={async (v) => {
        await addGrade(adminCardNo, v.grade_cd, v.descr);
      }}
    />
  );

  // ── Designations ─────────────────────────────────────────
  const [desigGradeFilter, setDesigGradeFilter] = useState("");
  const filteredDesigs = desigGradeFilter
    ? desigs.filter((d) => d.grade_cd === desigGradeFilter)
    : desigs;

  const desigTable = (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600">Filter by grade:</label>
        <select
          value={desigGradeFilter}
          onChange={(e) => setDesigGradeFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="">All Grades</option>
          {grades.map((g) => (
            <option key={g.grade_cd} value={g.grade_cd}>{g.grade_cd} — {g.descr}</option>
          ))}
        </select>
      </div>
      <MasterTable
        columns={["Grade", "Desig Code", "Description"]}
        rows={filteredDesigs.map((d) => [d.grade_cd, d.desg_cd, d.desg_desc])}
        loading={loading}
        onRefresh={() => load("designations")}
        addFields={[
          { key: "grade_cd",  label: "Grade Code",   placeholder: "e.g. G1" },
          { key: "desg_desc", label: "Designation",  placeholder: "e.g. Senior Officer" },
        ]}
        onAdd={async (v) => {
          await addDesignation(adminCardNo, v.grade_cd, v.desg_desc);
        }}
      />
    </div>
  );

  // ── Shifts ───────────────────────────────────────────────
  const shiftTable = (
    <MasterTable
      columns={["Shift Code", "Description", "From", "To"]}
      rows={shifts.map((s) => [s.shift, s.shift_desc, s.time_from ?? "—", s.time_to ?? "—"])}
      loading={loading}
      onRefresh={() => load("shifts")}
      addFields={[
        { key: "shift",      label: "Shift Code",   placeholder: "e.g. A" },
        { key: "shift_desc", label: "Description",  placeholder: "e.g. Morning Shift" },
        { key: "time_from",  label: "Time From",    placeholder: "e.g. 09:00" },
        { key: "time_to",    label: "Time To",      placeholder: "e.g. 17:00" },
      ]}
      onAdd={async (v) => {
        await addShift(adminCardNo, v.shift, v.shift_desc, v.time_from, v.time_to);
      }}
    />
  );

  // ── Blood Groups ─────────────────────────────────────────
  const bgTable = (
    <MasterTable
      columns={["ID", "Blood Group"]}
      rows={bgs.map((b) => [b.pk, b.blood_group])}
      loading={loading}
      onRefresh={() => load("blood_groups")}
      addFields={[
        { key: "blood_group", label: "Blood Group", placeholder: "e.g. AB+" },
      ]}
      onAdd={async (v) => {
        await addBloodGroup(adminCardNo, v.blood_group);
      }}
    />
  );

  // ── Units ────────────────────────────────────────────────
  const unitTable = (
    <MasterTable
      columns={["Unit ID", "Unit Name"]}
      rows={units.map((u) => [u.unit_id, u.unit_name])}
      loading={loading}
      onRefresh={() => load("units")}
      addFields={[
        { key: "unit_name", label: "Unit Name", placeholder: "e.g. Head Office" },
      ]}
      onAdd={async (v) => { await addUnit(adminCardNo, v.unit_name); }}
    />
  );

  // ── Locations ────────────────────────────────────────────
  const locationTable = (
    <LocationsTable
      locs={locs}
      loading={loading}
      adminCardNo={adminCardNo}
      onRefresh={() => load("locations")}
    />
  );

  // ── Employee Status (per company) ────────────────────────
  const empStatusTable = (
    <MasterTable
      columns={["Code", "Description"]}
      rows={empStatuses.map((s) => [s.emp_status, s.descr])}
      loading={loading}
      onRefresh={() => load("emp_statuses")}
      addFields={[{ key: "descr", label: "Status", placeholder: "e.g. Permanent" }]}
      onAdd={async (v) => { await addEmpStatus(adminCardNo, v.descr, activeCompany); }}
      onDelete={async (i) => { await deleteEmpStatus(adminCardNo, empStatuses[i].emp_status, activeCompany); }}
    />
  );

  // ── Qualifications (per company) ─────────────────────────
  const qualTable = (
    <MasterTable
      columns={["Qualification"]}
      rows={quals.map((q) => [q.descr])}
      loading={loading}
      onRefresh={() => load("qualifications")}
      addFields={[{ key: "descr", label: "Qualification", placeholder: "e.g. BSc Computer Science" }]}
      onAdd={async (v) => { await addQualification(adminCardNo, v.descr, activeCompany); }}
      onDelete={async (i) => { await deleteQualification(adminCardNo, quals[i].descr, activeCompany); }}
    />
  );

  // ── Banks (per company) ──────────────────────────────────
  const bankTable = (
    <MasterTable
      columns={["Code", "Bank Name"]}
      rows={banks.map((b) => [b.bnkcode, b.bnkname])}
      loading={loading}
      onRefresh={() => load("banks")}
      addFields={[{ key: "bnkname", label: "Bank Name", placeholder: "e.g. HBL" }]}
      onAdd={async (v) => { await addBank(adminCardNo, v.bnkname, activeCompany); }}
      onDelete={async (i) => { await deleteBank(adminCardNo, banks[i].bnkcode, activeCompany); }}
    />
  );

  // ── Bank Branches (per company, under a selected bank) ───
  const bankBranchTable = (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600">Bank:</label>
        <select
          value={branchBank}
          onChange={(e) => setBranchBank(e.target.value)}
          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="">Select bank</option>
          {banks.map((b) => <option key={b.bnkcode} value={b.bnkcode}>{b.bnkname}</option>)}
        </select>
      </div>
      {branchBank ? (
        <MasterTable
          columns={["Branch Code", "Branch Name"]}
          rows={bankBranches.map((b) => [b.brncode, b.brnname])}
          loading={loading}
          onRefresh={() => load("bank_branches")}
          addFields={[{ key: "brnname", label: "Branch Name", placeholder: "e.g. Main Branch" }]}
          onAdd={async (v) => { await addBankBranch(adminCardNo, branchBank, v.brnname, activeCompany); }}
          onDelete={async (i) => { await deleteBankBranch(adminCardNo, branchBank, bankBranches[i].brncode, activeCompany); }}
        />
      ) : (
        <p className="text-sm text-gray-400 py-6 text-center">Select a bank to manage its branches.</p>
      )}
    </div>
  );

  const contentMap: Record<Tab, React.ReactNode> = {
    departments:  deptTable,
    grades:       gradeTable,
    designations: desigTable,
    shifts:       shiftTable,
    blood_groups: bgTable,
    units:        unitTable,
    locations:    locationTable,
    emp_statuses: empStatusTable,
    qualifications: qualTable,
    banks:        bankTable,
    bank_branches: bankBranchTable,
    company_logo: (
      <CompanyLogoTab
        adminCardNo={adminCardNo}
        compc={activeCompany}
        companyName={user?.selected_company?.name ?? ""}
      />
    ),
  };

  const group = GROUPS.find((g) => g.id === groupId) ?? GROUPS[0];
  const activeTab = group.tabs.includes(tab) ? tab : group.tabs[0];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-indigo-500" />
        <h2 className="text-lg font-semibold text-gray-900">Setup — Master Tables</h2>
        <span className="text-xs text-gray-400 ml-2">HR Admin only</span>
      </div>

      {/* Level 1 — area cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {GROUPS.map((g) => {
          const Icon = g.icon;
          const active = g.id === groupId;
          return (
            <button key={g.id} onClick={() => selectGroup(g)}
              className={`text-left rounded-2xl border p-3.5 transition-all ${
                active
                  ? "border-indigo-300 bg-indigo-50/70 shadow-sm ring-1 ring-indigo-200"
                  : "border-gray-200 bg-white hover:border-indigo-200 hover:bg-gray-50"
              }`}>
              <div className="flex items-center gap-2">
                <span className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${active ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-500"}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold leading-tight ${active ? "text-indigo-700" : "text-gray-800"}`}>{g.label}</p>
                  <p className="text-[11px] text-gray-400">{g.tabs.length} {g.tabs.length === 1 ? "table" : "tables"}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Level 2 — master tables within the chosen area */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400 hidden sm:flex items-center gap-1">
          {group.label} <ChevronRight className="h-3 w-3" />
        </span>
        {group.tabs.length > 1 ? (
          <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl">
            {group.tabs.map((t) => (
              <button key={t} onClick={() => switchTab(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === t ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}>
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-sm font-medium text-gray-700">{TAB_LABEL[group.tabs[0]]}</span>
        )}
        <span className="text-xs text-gray-400 ml-auto hidden md:block">{group.desc}</span>
      </div>

      {/* Content */}
      <div>{contentMap[activeTab]}</div>
    </div>
  );
}
