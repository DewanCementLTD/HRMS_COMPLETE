"use client";

import { FormEvent, useState } from "react";
import { ShieldCheck, Lock, User } from "lucide-react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { superAdminService } from "@/services/superAdminService";

/**
 * Sign-in for the admin panel. Deliberately plain and unbranded — it is not the
 * employee login and should not look like it, so nobody arrives here expecting
 * their normal account to work.
 */
export function AdminLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [usrid, setUsrid] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!usrid.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      await superAdminService.login(usrid.trim(), password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-7 space-y-5"
      >
        <div className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-slate-900 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Administrator</h1>
          <p className="text-xs text-gray-500">
            Manage HR users, companies and branches
          </p>
        </div>

        {error && <Alert type="error" message={error} onClose={() => setError("")} />}

        <div className="space-y-3">
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={usrid}
              onChange={(e) => setUsrid(e.target.value)}
              placeholder="User ID"
              autoComplete="username"
              autoFocus
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-slate-800 focus:border-transparent"
            />
          </div>
        </div>

        <Button
          type="submit"
          loading={busy}
          className="w-full bg-slate-900 hover:bg-slate-800 active:bg-black"
        >
          Sign in
        </Button>

        <p className="text-[11px] leading-relaxed text-gray-400 text-center">
          Only accounts on the administrator list can sign in here. Everyone else
          should use the normal login.
        </p>
      </form>
    </div>
  );
}
