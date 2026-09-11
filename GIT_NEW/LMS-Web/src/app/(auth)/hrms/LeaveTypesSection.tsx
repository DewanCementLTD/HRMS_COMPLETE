"use client";

import { useState } from "react";
import { Plus, RefreshCw, Pencil, Trash2, X, Loader2, Check, Lock } from "lucide-react";

import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import {
  addLeaveType, updateLeaveType, deleteLeaveType, type LeaveTypeMaster,
} from "@/services/referenceService";

/**
 * Leave types master (LEAVE_TYPES), per company and branch.
 *
 * Two kinds of row appear together. The standard set — CL, ML, EL, OD and the
 * rest — is shared by every company and shown locked: those are what all the
 * balances in the system are built on, so renaming CL here would change it for
 * every company at once. Below them sit whatever this company added, which it
 * alone can edit or remove.
 */
export function LeaveTypesSection({
  items,
  loading,
  adminCardNo,
  compc,
  brnch,
  onRefresh,
}: {
  items: LeaveTypeMaster[];
  loading: boolean;
  adminCardNo: string;
  compc?: string;
  brnch?: string;
  onRefresh: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ leave_type: "", leave_desc: "", entitlement: "", allowed: "" });
  const [editPk, setEditPk] = useState<number | null>(null);
  const [editVals, setEditVals] = useState({ leave_desc: "", entitlement: "", allowed: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (v: number | null) => (v === null || v === undefined ? "—" : String(v));

  async function save() {
    if (!draft.leave_type.trim() || !draft.leave_desc.trim()) {
      setError("A code and a description are both required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addLeaveType(adminCardNo, draft, compc, brnch);
      setDraft({ leave_type: "", leave_desc: "", entitlement: "", allowed: "" });
      setShowAdd(false);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the leave type");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(pk: number) {
    if (!editVals.leave_desc.trim()) {
      setError("A description is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateLeaveType(adminCardNo, pk, editVals, compc);
      setEditPk(null);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the leave type");
    } finally {
      setBusy(false);
    }
  }

  async function remove(pk: number, code: string) {
    if (!confirm(`Remove the leave type ${code}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteLeaveType(adminCardNo, pk, compc);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the leave type");
    } finally {
      setBusy(false);
    }
  }

  const cell = "px-4 py-2.5 text-sm text-gray-700";
  const input =
    "w-full border border-indigo-300 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300";

  if (!compc) {
    return <p className="text-sm text-gray-400 py-6 text-center">Select a company first.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-gray-500">
          {items.length} types · {items.filter((i) => !i.shared).length} added by this company
        </span>
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

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-gray-100 shadow-sm">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {["Code", "Description", "Entitlement", "Max Allowed", "Scope"].map((c) => (
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
              <tr className="bg-indigo-50/60">
                <td className="px-4 py-2">
                  <input
                    value={draft.leave_type}
                    maxLength={20}
                    onChange={(e) => setDraft((d) => ({ ...d, leave_type: e.target.value.toUpperCase() }))}
                    placeholder="e.g. SP"
                    className={input}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    value={draft.leave_desc}
                    maxLength={50}
                    onChange={(e) => setDraft((d) => ({ ...d, leave_desc: e.target.value }))}
                    placeholder="e.g. STUDY LEAVE"
                    className={input}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    value={draft.entitlement}
                    inputMode="numeric"
                    onChange={(e) => setDraft((d) => ({ ...d, entitlement: e.target.value.replace(/[^\d.]/g, "") }))}
                    placeholder="days / year"
                    className={input}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    value={draft.allowed}
                    inputMode="numeric"
                    onChange={(e) => setDraft((d) => ({ ...d, allowed: e.target.value.replace(/[^\d.]/g, "") }))}
                    placeholder="cap"
                    className={input}
                  />
                </td>
                <td className={cell}>this company</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={save}
                      disabled={busy}
                      className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Save
                    </button>
                    <button onClick={() => setShowAdd(false)} className="p-1 text-gray-400 hover:text-gray-600">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {loading && (
              <tr>
                <td colSpan={6} className="py-10 text-center">
                  <Spinner />
                </td>
              </tr>
            )}

            {!loading &&
              items.map((t) => {
                const editing = editPk === t.leave_type_pk;
                return (
                  <tr
                    key={t.leave_type_pk}
                    className={`transition-colors ${editing ? "bg-indigo-50" : "hover:bg-gray-50"}`}
                  >
                    <td className={`${cell} font-medium`}>{t.leave_type}</td>
                    <td className={cell}>
                      {editing ? (
                        <input
                          autoFocus
                          value={editVals.leave_desc}
                          maxLength={50}
                          onChange={(e) => setEditVals((v) => ({ ...v, leave_desc: e.target.value }))}
                          className={input}
                        />
                      ) : (
                        t.leave_desc || "—"
                      )}
                    </td>
                    <td className={cell}>
                      {editing ? (
                        <input
                          value={editVals.entitlement}
                          inputMode="numeric"
                          onChange={(e) =>
                            setEditVals((v) => ({ ...v, entitlement: e.target.value.replace(/[^\d.]/g, "") }))
                          }
                          className={input}
                        />
                      ) : (
                        num(t.entitlement)
                      )}
                    </td>
                    <td className={cell}>
                      {editing ? (
                        <input
                          value={editVals.allowed}
                          inputMode="numeric"
                          onChange={(e) =>
                            setEditVals((v) => ({ ...v, allowed: e.target.value.replace(/[^\d.]/g, "") }))
                          }
                          className={input}
                        />
                      ) : (
                        num(t.allowed)
                      )}
                    </td>
                    <td className={`${cell} whitespace-nowrap`}>
                      {t.shared ? (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <Lock className="h-3 w-3" />
                          standard
                        </span>
                      ) : (
                        <span className="text-xs text-indigo-600">
                          company {t.compc}
                          {t.brnch != null && ` · branch ${t.brnch}`}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {editing ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => saveEdit(t.leave_type_pk)}
                            disabled={busy}
                            className="text-emerald-600 hover:text-emerald-800 disabled:opacity-40"
                            title="Save"
                          >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => setEditPk(null)}
                            className="text-gray-400 hover:text-gray-600"
                            title="Cancel"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : t.editable ? (
                        <div className="inline-flex items-center gap-3">
                          <button
                            onClick={() => {
                              setEditPk(t.leave_type_pk);
                              setEditVals({
                                leave_desc: t.leave_desc,
                                entitlement: t.entitlement === null ? "" : String(t.entitlement),
                                allowed: t.allowed === null ? "" : String(t.allowed),
                              });
                            }}
                            className="text-indigo-600 hover:text-indigo-800"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => remove(t.leave_type_pk, t.leave_type)}
                            disabled={busy}
                            className="text-red-500 hover:text-red-700 disabled:opacity-40"
                            title="Remove"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 leading-relaxed">
        The standard types are shared by every company and cannot be changed here — every leave
        balance in the system is built on them. A type added for this company is recorded and
        reported against, but only Casual, Medical, Earned and Out-Door Duty carry a tracked
        balance that employees can apply against; extending that is a database change to
        ALL_LEAVE_BAL_V, not a setting on this screen.
      </p>
    </div>
  );
}
