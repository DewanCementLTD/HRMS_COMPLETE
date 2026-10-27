"use client";

import { useCallback, useEffect, useState } from "react";
import { Vault, RefreshCw, LogIn } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { useAuthController } from "@/controllers/useAuthController";
import { PfStatementView } from "@/components/pf/PfStatementView";
import { fetchMyPf, type MyPf } from "@/services/pfService";

// The employee's own PF. The API takes the signed session token from login and
// only ever returns the token holder's data, so nobody can read a colleague's
// balance by changing the card number.
export default function MyPfPage() {
  const { user } = useAuth();
  const { handleLogout } = useAuthController();
  const [data, setData] = useState<MyPf | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const token = user?.session_token || "";

  const load = useCallback(async () => {
    if (!user?.card_no || !token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchMyPf(user.card_no, token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [user?.card_no, token]);

  useEffect(() => { load(); }, [load]);

  if (!user) return null;

  const accounts = data?.accounts ?? [];
  const current = accounts[Math.min(active, Math.max(accounts.length - 1, 0))];

  return (
    <div className="animate-fade-in">
      <PageHeader title="My Provident Fund" subtitle="Your PF balance, contributions and loans"
        actions={token ? (
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        ) : undefined} />

      {!token ? (
        <Card>
          <CardContent className="py-10 text-center">
            <LogIn className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="font-semibold text-ink">Please sign in again</p>
            <p className="text-sm text-slate-500 mt-1 mb-4">For your privacy, PF details need a fresh sign-in on this device.</p>
            <Button onClick={handleLogout}>Sign out and sign in</Button>
          </CardContent>
        </Card>
      ) : loading && !data ? (
        <Spinner />
      ) : error ? (
        <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
          {/SESSION_REQUIRED|Sign in again/i.test(error) ? "Your session has expired. Please sign out and sign in again." : error}
        </div>
      ) : !current ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Vault className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="font-semibold text-ink">No Provident Fund account</p>
            <p className="text-sm text-slate-500 mt-1">You are not enrolled in PF and have no PF balance. Contact HR for details.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {accounts.length > 1 && (
            <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl w-fit">
              {accounts.map((a, i) => (
                <button key={`${a.unit_id}-${a.member.old_empcode}`} onClick={() => setActive(i)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${i === active ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600"}`}>
                  {a.unit_name || `Company ${a.unit_id}`}
                </button>
              ))}
            </div>
          )}
          <Card>
            <CardContent className="py-5">
              <div className="mb-4">
                <p className="font-semibold text-ink">{current.member.name}</p>
                <p className="text-xs text-slate-500">
                  {current.member.empcode}
                  {current.member.dept_name ? ` · ${current.member.dept_name}` : ""}
                  {current.unit_name ? ` · ${current.unit_name}` : ""}
                  {current.member.pf_ind === "Y"
                    ? ` · PF member${current.member.pf_mem_dt ? ` since ${current.member.pf_mem_dt}` : ""}`
                    : " · PF deduction currently stopped"}
                </p>
              </div>
              <PfStatementView data={current} companyName={current.unit_name} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
