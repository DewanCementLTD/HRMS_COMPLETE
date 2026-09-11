"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, LogOut, Plus, Search, ShieldCheck, UserCog } from "lucide-react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { clearToken, getToken, superAdminService } from "@/services/superAdminService";
import type { AdminUser, BranchOption, ScopeOption } from "@/services/superAdminService";

import { AdminLogin } from "./AdminLogin";
import { NewUserModal } from "./NewUserModal";
import { ScopePicker } from "./ScopePicker";

/**
 * Administrator panel — reached at /admin, outside the (auth) group so it has
 * no sidebar, no employee session and no shared state with the main app.
 */
export default function AdminPage() {
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<ScopeOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");

  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editCompanies, setEditCompanies] = useState<string[]>([]);
  const [editBranches, setEditBranches] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [pwUser, setPwUser] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [u, s] = await Promise.all([
        superAdminService.listUsers(),
        superAdminService.scope(),
      ]);
      setUsers(u.items);
      setCompanies(s.companies);
      setBranches(s.branches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the panel");
      // The service clears the token on a 401, so a dropped session returns to
      // the sign-in form instead of leaving an empty table behind.
      if (!getToken()) setSignedIn(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // A token kept in sessionStorage survives a reload; check it before deciding
  // which screen to show, so a refresh does not bounce back to the login form.
  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setChecking(false);
        return;
      }
      try {
        await superAdminService.me();
        setSignedIn(true);
      } catch {
        clearToken();
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (signedIn) load();
  }, [signedIn, load]);

  const companyName = useMemo(
    () => new Map(companies.map((c) => [c.code, c.name])),
    [companies],
  );
  const branchName = useMemo(
    () => new Map(branches.map((b) => [b.code, b.name])),
    [branches],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.usrid.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        u.mobile.includes(q),
    );
  }, [users, query]);

  function openScope(user: AdminUser) {
    setEditing(user);
    setEditCompanies(user.companies);
    setEditBranches(user.branches);
  }

  async function saveScope() {
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      // Two calls because companies and branches live in separate tables; each
      // replaces its whole set, so a half-failure leaves the other intact
      // rather than a merged mess.
      await superAdminService.setCompanies(editing.usrid, editCompanies);
      await superAdminService.setBranches(editing.usrid, editBranches);
      setNotice(`Access updated for ${editing.usrid}`);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the access rights");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(user: AdminUser) {
    setError("");
    try {
      await superAdminService.setStatus(user.usrid, !user.enabled);
      setNotice(`${user.usrid} ${user.enabled ? "disabled" : "enabled"}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the status");
    }
  }

  async function savePassword() {
    if (!pwUser) return;
    if (newPassword.length < 6) {
      setError("The password must be at least 6 characters");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await superAdminService.setPassword(pwUser.usrid, newPassword);
      setNotice(`Password reset for ${pwUser.usrid}`);
      setPwUser(null);
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password");
    } finally {
      setSaving(false);
    }
  }

  function signOut() {
    clearToken();
    setSignedIn(false);
    setUsers([]);
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Spinner />
      </div>
    );
  }

  if (!signedIn) return <AdminLogin onSignedIn={() => setSignedIn(true)} />;

  const chip = (text: string, key: string) => (
    <span
      key={key}
      className="inline-block px-1.5 py-0.5 rounded-md bg-gray-100 text-[11px] text-gray-600"
    >
      {text}
    </span>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 shrink-0" />
          <div className="min-w-0">
            <h1 className="font-semibold leading-tight">Administrator</h1>
            <p className="text-xs text-slate-300">HR users, companies and branches</p>
          </div>
          <button
            onClick={signOut}
            className="ml-auto inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {error && <Alert type="error" message={error} onClose={() => setError("")} />}
        {notice && <Alert type="success" message={notice} onClose={() => setNotice("")} />}

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by id, name or mobile"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New HR user
          </Button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left font-medium px-4 py-3">User</th>
                  <th className="text-left font-medium px-4 py-3">Mobile</th>
                  <th className="text-left font-medium px-4 py-3">Companies</th>
                  <th className="text-left font-medium px-4 py-3">Branches</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-right font-medium px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center">
                      <Spinner />
                    </td>
                  </tr>
                )}
                {!loading && visible.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                      No users match that search.
                    </td>
                  </tr>
                )}
                {!loading &&
                  visible.map((u) => (
                    <tr key={u.usrid} className="hover:bg-gray-50/70 align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{u.name || u.usrid}</div>
                        <div className="text-xs text-gray-400">
                          {u.usrid}
                          {u.ecode && ` · ${u.ecode}`}
                          {u.is_super_admin && (
                            <span className="ml-1.5 text-indigo-600">administrator</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {u.mobile || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {u.companies.length === 0 ? (
                            <span className="text-gray-400">none</span>
                          ) : (
                            u.companies.map((c) =>
                              chip(companyName.get(c) ?? `#${c}`, `${u.usrid}-c-${c}`),
                            )
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[300px]">
                          {u.branches.length === 0 ? (
                            <span className="text-gray-400">none</span>
                          ) : (
                            u.branches.map((b) =>
                              chip(branchName.get(b) ?? `#${b}`, `${u.usrid}-b-${b}`),
                            )
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            u.enabled
                              ? "px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs"
                              : "px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs"
                          }
                        >
                          {u.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                          <Button size="sm" variant="secondary" onClick={() => openScope(u)}>
                            <UserCog className="h-3.5 w-3.5 mr-1" />
                            Access
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setPwUser(u)}>
                            <KeyRound className="h-3.5 w-3.5 mr-1" />
                            Password
                          </Button>
                          <Button
                            size="sm"
                            variant={u.enabled ? "danger" : "secondary"}
                            onClick={() => toggleStatus(u)}
                          >
                            {u.enabled ? "Disable" : "Enable"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {editing && (
        <Modal
          title={`Access for ${editing.name || editing.usrid}`}
          subtitle="Companies and branches this user can work in"
          size="lg"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={saveScope} loading={saving}>
                Save access
              </Button>
            </>
          }
        >
          <ScopePicker
            companies={companies}
            branches={branches}
            selectedCompanies={editCompanies}
            selectedBranches={editBranches}
            onCompaniesChange={setEditCompanies}
            onBranchesChange={setEditBranches}
          />
        </Modal>
      )}

      {pwUser && (
        <Modal
          title={`Reset password — ${pwUser.name || pwUser.usrid}`}
          subtitle="The user signs in with this immediately"
          size="sm"
          onClose={() => {
            setPwUser(null);
            setNewPassword("");
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setPwUser(null);
                  setNewPassword("");
                }}
              >
                Cancel
              </Button>
              <Button onClick={savePassword} loading={saving}>
                Set password
              </Button>
            </>
          }
        >
          <Input
            label="New password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 6 characters"
            autoFocus
          />
        </Modal>
      )}

      {creating && (
        <NewUserModal
          companies={companies}
          branches={branches}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setNotice("User created");
            load();
          }}
        />
      )}
    </div>
  );
}
