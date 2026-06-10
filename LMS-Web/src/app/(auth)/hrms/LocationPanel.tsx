"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MapPin, RefreshCw, ChevronRight, Clock, Navigation, Settings, Save, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { apiRequest } from "@/services/api";
import { updateLocationTracking } from "@/services/hrmsService";
import type { HRMSSearchResult } from "@/models/hrms";
import { LocationReportsPanel } from "./LocationReportsPanel";

// ─── Types ────────────────────────────────────────────────

interface EmployeeLocationSummary {
  card_no: string;
  employee_name: string;
  empcode: string | null;
  point_count: number;
  last_seen: string | null;
  last_latitude: number | null;
  last_longitude: number | null;
  last_accuracy: number;
}

interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  recorded_at: string;
}

type LocTab = "live" | "settings" | "locations" | "reports";

// ─── Reverse geocoding ────────────────────────────────────

const _geoCache: Record<string, string> = {};

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (_geoCache[key]) return _geoCache[key];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16`
    );
    const d = await res.json();
    const a = d.address || {};
    const parts = [
      a.road || a.pedestrian || a.footway,
      a.suburb || a.neighbourhood || a.city_district,
      a.city || a.town || a.village,
    ].filter(Boolean);
    const label = parts.join(", ") || d.display_name?.split(",").slice(0, 3).join(",").trim() || "";
    _geoCache[key] = label;
    return label;
  } catch {
    return "";
  }
}

// ─── Helpers ──────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function formatTime(isoStr: string | null): string {
  if (!isoStr) return "—";
  try {
    // Timestamps are stored as UTC in the DB. Append "Z" so JavaScript
    // treats them as UTC and auto-converts to the browser's local timezone.
    const utcStr = isoStr.replace(" ", "T") + (isoStr.endsWith("Z") ? "" : "Z");
    const d = new Date(utcStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return isoStr;
  }
}

function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

// ─── Toggle switch ────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        checked ? "bg-emerald-500" : "bg-gray-300"
      }`}
      aria-checked={checked}
      role="switch"
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

// ─── Interval options ─────────────────────────────────────

const INTERVAL_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24];

function IntervalSelect({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(parseInt(e.target.value))}
      className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-40 disabled:bg-gray-50 disabled:cursor-not-allowed"
    >
      {INTERVAL_OPTIONS.map((h) => (
        <option key={h} value={h}>
          Every {h} hr{h > 1 ? "s" : ""}
        </option>
      ))}
    </select>
  );
}

// ─── Detail drawer ────────────────────────────────────────

function PointsDrawer({
  emp,
  date,
  adminCardNo,
  onClose,
}: {
  emp: EmployeeLocationSummary;
  date: string;
  adminCardNo: string;
  onClose: () => void;
}) {
  const [points, setPoints] = useState<LocationPoint[]>([]);
  const [addresses, setAddresses] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchingRef = useRef(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setAddresses({});
    fetchingRef.current = false;

    apiRequest<{ body: { points: LocationPoint[] } }>(
      `/auth/location/history/${emp.card_no}?date=${date}&admin_card_no=${adminCardNo}`
    )
      .then(async (r) => {
        const pts = r.body.points;
        setPoints(pts);
        fetchingRef.current = true;
        for (let i = 0; i < pts.length; i++) {
          if (!fetchingRef.current) break;
          const pt = pts[i];
          const addr = await reverseGeocode(pt.latitude, pt.longitude);
          if (addr) setAddresses((prev) => ({ ...prev, [i]: addr }));
          if (i < pts.length - 1) await new Promise((r) => setTimeout(r, 400));
        }
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load")
      )
      .finally(() => setLoading(false));

    return () => { fetchingRef.current = false; };
  }, [emp.card_no, date, adminCardNo]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-indigo-50 shrink-0">
          <div>
            <p className="font-semibold text-gray-900">{emp.employee_name}</p>
            <p className="text-xs text-gray-500">
              Card {emp.card_no} · {date} · {emp.point_count} point{emp.point_count !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white border border-gray-200 hover:bg-red-50 hover:border-red-300 text-gray-500 hover:text-red-600 transition-all shadow-sm"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-2">
          {loading && (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          )}
          {error && (
            <p className="text-sm text-red-500 text-center py-6">{error}</p>
          )}
          {!loading && !error && points.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No points found.</p>
          )}
          {!loading &&
            points.map((pt, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 hover:bg-indigo-50 transition-colors"
              >
                <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-800">
                      {formatTime(pt.recorded_at)}
                    </span>
                    {pt.accuracy > 0 && (
                      <span className="text-xs text-gray-400">±{Math.round(pt.accuracy)}m accuracy</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 font-mono">
                    {pt.latitude.toFixed(6)}, {pt.longitude.toFixed(6)}
                  </p>
                  {addresses[i] ? (
                    <p className="text-xs text-indigo-700 mt-0.5 flex items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {addresses[i]}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-300 mt-0.5 italic">Fetching location name…</p>
                  )}
                </div>
                <a
                  href={mapsUrl(pt.latitude, pt.longitude)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 p-1.5 rounded-lg hover:bg-indigo-100 text-indigo-500 transition-colors"
                  title="Open in Google Maps"
                >
                  <Navigation className="h-4 w-4" />
                </a>
              </div>
            ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t bg-gray-50 flex justify-end shrink-0">
          <Button variant="secondary" size="sm" onClick={onClose}>
            <X className="h-3.5 w-3.5 mr-1.5" />
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Track Settings tab ───────────────────────────────────

interface TrackRow {
  empcode: string;
  name: string;
  card_no: string;
  dept_no: string;
  track_location: string;
  track_location_hr: number;
}

function TrackSettingsTab({ adminCardNo }: { adminCardNo: string }) {
  const [employees, setEmployees] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [localSettings, setLocalSettings] = useState<
    Record<string, { track: "Y" | "N"; hr: number }>
  >({});

  useEffect(() => {
    setLoading(true);
    apiRequest<{ items: HRMSSearchResult[] }>(
      `/hrms/employees?admin_card_no=${adminCardNo}`
    )
      .then((r) => {
        const rows: TrackRow[] = r.items.map((e) => ({
          empcode: e.empcode,
          name: e.name || e.empcode,
          card_no: e.card_no || e.atdtcard || "",
          dept_no: e.dept_no || "",
          track_location: e.track_location || "N",
          track_location_hr: e.track_location_hr ?? 2,
        }));
        setEmployees(rows);
        const init: Record<string, { track: "Y" | "N"; hr: number }> = {};
        rows.forEach((r) => {
          init[r.empcode] = {
            track: (r.track_location as "Y" | "N") || "N",
            hr: r.track_location_hr ?? 2,
          };
        });
        setLocalSettings(init);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [adminCardNo]);

  async function saveRow(empcode: string) {
    const s = localSettings[empcode];
    if (!s) return;
    setSaving(empcode);
    try {
      await updateLocationTracking(empcode, s.track, s.hr, adminCardNo);
      setEmployees((prev) =>
        prev.map((e) =>
          e.empcode === empcode
            ? { ...e, track_location: s.track, track_location_hr: s.hr }
            : e
        )
      );
      setSaved(empcode);
      setTimeout(() => setSaved((prev) => (prev === empcode ? null : prev)), 2500);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(null);
    }
  }

  function setLocal(empcode: string, patch: Partial<{ track: "Y" | "N"; hr: number }>) {
    setLocalSettings((prev) => ({
      ...prev,
      [empcode]: { ...prev[empcode], ...patch },
    }));
  }

  const filtered = employees.filter(
    (e) =>
      !query ||
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      e.empcode.includes(query)
  );

  // Count from localSettings so it updates immediately as the user toggles
  const enabledCount = Object.values(localSettings).filter((s) => s.track === "Y").length;
  const disabledCount = Object.values(localSettings).filter((s) => s.track === "N").length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex flex-wrap gap-3">
        <div className="px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-100 text-sm">
          <span className="font-semibold text-emerald-700">{enabledCount}</span>
          <span className="text-gray-500 ml-1">tracking enabled</span>
        </div>
        <div className="px-4 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm">
          <span className="font-semibold text-gray-600">{disabledCount}</span>
          <span className="text-gray-500 ml-1">tracking disabled</span>
        </div>
        <div className="px-3 py-2 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-600 flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          Interval = how often the app captures the employee's GPS location
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Filter by name or employee code…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <>
          {/* ── Desktop table ── */}
          <div className="hidden sm:block overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Code</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Track Location</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Capture Interval
                    <span className="block text-[10px] normal-case font-normal text-gray-400">How often GPS is recorded</span>
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-50">
                {filtered.map((emp) => {
                  const s = localSettings[emp.empcode] || {
                    track: emp.track_location as "Y" | "N",
                    hr: emp.track_location_hr,
                  };
                  const isDirty =
                    s.track !== emp.track_location || s.hr !== emp.track_location_hr;
                  const isSaving = saving === emp.empcode;
                  const wasSaved = saved === emp.empcode;

                  return (
                    <tr key={emp.empcode} className="hover:bg-gray-50/80 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{emp.name}</p>
                        {emp.card_no && (
                          <p className="text-xs text-gray-400">Card: {emp.card_no}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{emp.empcode}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ToggleSwitch
                            checked={s.track === "Y"}
                            onChange={(v) => setLocal(emp.empcode, { track: v ? "Y" : "N" })}
                          />
                          <span
                            className={`text-xs font-semibold ${
                              s.track === "Y" ? "text-emerald-600" : "text-gray-400"
                            }`}
                          >
                            {s.track === "Y" ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <IntervalSelect
                          value={s.hr}
                          disabled={s.track === "N"}
                          onChange={(v) => setLocal(emp.empcode, { hr: v })}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {wasSaved ? (
                          <span className="text-xs text-emerald-600 font-semibold">Saved ✓</span>
                        ) : (
                          <Button
                            size="sm"
                            variant={isDirty ? "primary" : "secondary"}
                            onClick={() => saveRow(emp.empcode)}
                            loading={isSaving}
                            disabled={!isDirty || isSaving}
                          >
                            <Save className="h-3.5 w-3.5 mr-1" />
                            Save
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                      No employees match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ── */}
          <div className="block sm:hidden space-y-3">
            {filtered.map((emp) => {
              const s = localSettings[emp.empcode] || {
                track: emp.track_location as "Y" | "N",
                hr: emp.track_location_hr,
              };
              const isDirty =
                s.track !== emp.track_location || s.hr !== emp.track_location_hr;
              const isSaving = saving === emp.empcode;
              const wasSaved = saved === emp.empcode;

              return (
                <div key={emp.empcode} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{emp.name}</p>
                      <p className="text-xs text-gray-400">Code: {emp.empcode}{emp.card_no ? ` · Card: ${emp.card_no}` : ""}</p>
                    </div>
                    {wasSaved ? (
                      <span className="text-xs text-emerald-600 font-semibold shrink-0">Saved ✓</span>
                    ) : (
                      <Button
                        size="sm"
                        variant={isDirty ? "primary" : "secondary"}
                        onClick={() => saveRow(emp.empcode)}
                        loading={isSaving}
                        disabled={!isDirty || isSaving}
                      >
                        <Save className="h-3.5 w-3.5 mr-1" />
                        Save
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <ToggleSwitch
                        checked={s.track === "Y"}
                        onChange={(v) => setLocal(emp.empcode, { track: v ? "Y" : "N" })}
                      />
                      <span className={`text-xs font-semibold ${s.track === "Y" ? "text-emerald-600" : "text-gray-400"}`}>
                        {s.track === "Y" ? "Tracking On" : "Tracking Off"}
                      </span>
                    </div>
                    <IntervalSelect
                      value={s.hr}
                      disabled={s.track === "N"}
                      onChange={(v) => setLocal(emp.empcode, { hr: v })}
                    />
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-8">No employees match your search.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Locations Master tab ─────────────────────────────────

interface LocationRow {
  lcode: string;
  descr: string;
  sname: string;
  regioncode: string;
  city: string;
}

const EMPTY_LOC: LocationRow = { lcode: "", descr: "", sname: "", regioncode: "", city: "" };

function LocationsMasterTab({ adminCardNo }: { adminCardNo: string }) {
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editRow, setEditRow] = useState<LocationRow | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState<LocationRow>(EMPTY_LOC);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setLoading(true);
    apiRequest<{ items: LocationRow[] }>("/reference/locations")
      .then((r) => setRows(r.items))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function openAdd() {
    setForm(EMPTY_LOC);
    setEditRow(null);
    setIsAdding(true);
    setSaveError(null);
  }

  function openEdit(row: LocationRow) {
    setForm({ ...row });
    setEditRow(row);
    setIsAdding(false);
    setSaveError(null);
  }

  function closeForm() {
    setIsAdding(false);
    setEditRow(null);
    setSaveError(null);
  }

  async function saveForm() {
    if (!form.lcode.trim() || !form.descr.trim()) {
      setSaveError("Location code and name are required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (isAdding) {
        await apiRequest(`/reference/locations?admin_card_no=${adminCardNo}`, {
          method: "POST",
          body: JSON.stringify(form),
        });
        setRows((prev) => [...prev, { ...form }].sort((a, b) => a.lcode.localeCompare(b.lcode)));
      } else {
        await apiRequest(`/reference/locations/${form.lcode}?admin_card_no=${adminCardNo}`, {
          method: "PUT",
          body: JSON.stringify(form),
        });
        setRows((prev) => prev.map((r) => (r.lcode === form.lcode ? { ...form } : r)));
      }
      closeForm();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const filtered = rows.filter(
    (r) =>
      !query ||
      r.lcode.toLowerCase().includes(query.toLowerCase()) ||
      r.descr.toLowerCase().includes(query.toLowerCase()) ||
      r.city.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-800">Locations Master</p>
          <p className="text-xs text-gray-400">{rows.length} locations · COM_LOCATION table</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <span className="text-lg leading-none">+</span> Add Location
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Filter by code, name or city…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />

      {/* Add / Edit form */}
      {(isAdding || editRow) && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-indigo-800">{isAdding ? "Add New Location" : `Edit — ${editRow?.lcode}`}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Location Code *</label>
              <input
                value={form.lcode}
                onChange={(e) => setForm((f) => ({ ...f, lcode: e.target.value }))}
                disabled={!isAdding}
                placeholder="e.g. 10"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-100 disabled:text-gray-400"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="text-xs font-medium text-gray-600 block mb-1">Name / Description *</label>
              <input
                value={form.descr}
                onChange={(e) => setForm((f) => ({ ...f, descr: e.target.value }))}
                placeholder="e.g. TANK YARD SITE"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Region</label>
              <input
                value={form.regioncode}
                onChange={(e) => setForm((f) => ({ ...f, regioncode: e.target.value }))}
                placeholder="e.g. HEAD OFFICE"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">City</label>
              <input
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                placeholder="e.g. Karachi"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>
          {saveError && <p className="text-xs text-red-600">{saveError}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={saveForm}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving…" : isAdding ? "Add Location" : "Save Changes"}
            </button>
            <button
              onClick={closeForm}
              className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {["Code", "Name / Description", "Region", "City", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-50">
                {filtered.map((row) => (
                  <tr key={row.lcode} className="hover:bg-gray-50/80 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono font-semibold text-indigo-700">{row.lcode}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{row.descr}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{row.regioncode || "—"}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{row.city || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEdit(row)}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold transition-colors"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">No locations match your search.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="block sm:hidden space-y-2">
            {filtered.map((row) => (
              <div key={row.lcode} className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-mono font-bold text-indigo-700">{row.lcode}</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">{row.descr}</p>
                    {(row.city || row.regioncode) && (
                      <p className="text-xs text-gray-400 mt-0.5">{[row.city, row.regioncode].filter(Boolean).join(" · ")}</p>
                    )}
                  </div>
                  <button onClick={() => openEdit(row)} className="text-xs text-indigo-600 font-semibold shrink-0 ml-2">Edit</button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-8">No locations match your search.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────

export function LocationPanel({
  adminCardNo,
  focusCardNo,
}: {
  adminCardNo: string;
  focusCardNo?: string;
}) {
  const [locTab, setLocTab] = useState<LocTab>("live");
  const [date, setDate] = useState(todayStr());
  const [summary, setSummary] = useState<EmployeeLocationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<EmployeeLocationSummary | null>(null);
  const focusApplied = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiRequest<{ body: { employees: EmployeeLocationSummary[] } }>(
      `/auth/location/summary?date=${date}&admin_card_no=${adminCardNo}`
    )
      .then((r) => {
        const employees = r.body.employees;
        setSummary(employees);
        if (focusCardNo && !focusApplied.current) {
          focusApplied.current = true;
          const match = employees.find((e) => e.card_no === focusCardNo);
          if (match) setSelected(match);
        }
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load locations")
      )
      .finally(() => setLoading(false));
  }, [date, adminCardNo, focusCardNo]);

  useEffect(() => {
    if (focusCardNo) { setLocTab("live"); focusApplied.current = false; }
  }, [focusCardNo]);

  useEffect(() => {
    if (locTab === "live") load();
  }, [load, locTab]);

  return (
    <div className="flex flex-col min-h-[calc(100vh-13rem)]">
      {/* Sub-tab nav */}
      <div className="flex items-center gap-4 border-b border-white/20 pb-0 mb-5">
        <button
          onClick={() => setLocTab("live")}
          className={`flex items-center gap-1.5 px-1 pb-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
            locTab === "live"
              ? "border-indigo-400 text-white"
              : "border-transparent text-white/60 hover:text-white/90"
          }`}
        >
          <MapPin className="h-4 w-4" />
          Live Tracking
        </button>
        <button
          onClick={() => setLocTab("settings")}
          className={`flex items-center gap-1.5 px-1 pb-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
            locTab === "settings"
              ? "border-indigo-400 text-white"
              : "border-transparent text-white/60 hover:text-white/90"
          }`}
        >
          <Settings className="h-4 w-4" />
          Track Settings
        </button>
        <button
          onClick={() => setLocTab("locations")}
          className={`flex items-center gap-1.5 px-1 pb-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
            locTab === "locations"
              ? "border-indigo-400 text-white"
              : "border-transparent text-white/60 hover:text-white/90"
          }`}
        >
          <MapPin className="h-4 w-4" />
          Locations
        </button>
        <button
          onClick={() => setLocTab("reports")}
          className={`flex items-center gap-1.5 px-1 pb-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
            locTab === "reports"
              ? "border-indigo-400 text-white"
              : "border-transparent text-white/60 hover:text-white/90"
          }`}
        >
          <Navigation className="h-4 w-4" />
          Reports
        </button>
      </div>

      {/* ── Settings tab ── */}
      {locTab === "settings" && (
        <div className="bg-white/95 rounded-2xl p-4 sm:p-6 shadow-lg">
          <TrackSettingsTab adminCardNo={adminCardNo} />
        </div>
      )}

      {/* ── Locations master tab ── */}
      {locTab === "locations" && (
        <div className="bg-white/95 rounded-2xl p-4 sm:p-6 shadow-lg">
          <LocationsMasterTab adminCardNo={adminCardNo} />
        </div>
      )}

      {/* ── Reports tab (Features 1 & 2) ── */}
      {locTab === "reports" && (
        <div className="bg-white/95 rounded-2xl p-4 sm:p-6 shadow-lg">
          <LocationReportsPanel adminCardNo={adminCardNo} />
        </div>
      )}

      {/* ── Live tab ── */}
      {locTab === "live" && (
        <div className="flex flex-col flex-1">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-white/80" />
              {/* ← White heading as requested */}
              <h2 className="text-lg font-semibold text-white">Employee Locations</h2>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <input
                type="date"
                value={date}
                max={todayStr()}
                onChange={(e) => setDate(e.target.value)}
                className="border border-white/30 bg-white/10 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-white/40 placeholder:text-white/50"
              />
              <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-600 mb-4">
              {error}
            </div>
          )}

          {loading && (
            <div className="flex flex-1 items-center justify-center py-20">
              <Spinner />
            </div>
          )}

          {!loading && !error && summary.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-white/60">
              <MapPin className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-sm font-medium">No location data recorded for {date}</p>
              <p className="text-xs mt-1 opacity-70">
                Enable tracking for employees in the Track Settings tab.
              </p>
            </div>
          )}

          {!loading && summary.length > 0 && (
            <>
              {/* ── Desktop table ── */}
              <div className="hidden sm:block overflow-x-auto rounded-2xl border border-white/20 shadow-sm bg-white/95">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      {["Employee", "Card No", "Last Seen", "Coordinates", "Points", ""].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-50">
                    {summary.map((emp) => (
                      <tr
                        key={emp.card_no}
                        className="hover:bg-indigo-50/50 cursor-pointer transition-colors"
                        onClick={() => setSelected(emp)}
                      >
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900">{emp.employee_name}</p>
                          {emp.empcode && <p className="text-xs text-gray-400">{emp.empcode}</p>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 font-mono">{emp.card_no}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-sm text-gray-700">
                            <Clock className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                            {formatTime(emp.last_seen)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {emp.last_latitude != null ? (
                            <a
                              href={mapsUrl(emp.last_latitude, emp.last_longitude!)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline font-mono"
                            >
                              <Navigation className="h-3 w-3" />
                              {emp.last_latitude.toFixed(5)}, {emp.last_longitude!.toFixed(5)}
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                            {emp.point_count}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight className="h-4 w-4 text-gray-400" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ── Mobile cards ── */}
              <div className="block sm:hidden space-y-3">
                {summary.map((emp) => (
                  <div
                    key={emp.card_no}
                    onClick={() => setSelected(emp)}
                    className="bg-white/95 rounded-xl border border-white/20 shadow-sm p-4 cursor-pointer hover:border-indigo-300 transition-all active:scale-[0.98]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{emp.employee_name}</p>
                        <p className="text-xs text-gray-400">Card: {emp.card_no}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                          {emp.point_count} pts
                        </span>
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Last seen: {formatTime(emp.last_seen)}
                      </span>
                      {emp.last_latitude != null && (
                        <a
                          href={mapsUrl(emp.last_latitude, emp.last_longitude!)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-indigo-600"
                        >
                          <Navigation className="h-3 w-3" />
                          Open in Maps
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {selected && (
            <PointsDrawer
              emp={selected}
              date={date}
              adminCardNo={adminCardNo}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
