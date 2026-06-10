"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { IdCard, Search, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { listHRMSEmployees, getEmployeeCard, type EmployeeCard } from "@/services/hrmsService";
import type { HRMSSearchResult } from "@/models/hrms";
import { EmployeeIDCard } from "../hrms/EmployeeIDCard";

export default function IDCardsPage() {
  const { user, activeCompany, activeBranch } = useAuth();
  const [emps, setEmps] = useState<HRMSSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [card, setCard] = useState<EmployeeCard | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.hr_admin) return;
    setLoading(true);
    try {
      const r = await listHRMSEmployees(
        user.card_no, undefined, activeCompany || undefined, activeBranch || undefined,
      );
      setEmps(r.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.card_no, activeCompany, activeBranch]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!query.trim()) return emps;
    const q = query.toLowerCase();
    return emps.filter(
      (e) =>
        e.name?.toLowerCase().includes(q) ||
        e.empcode?.toLowerCase().includes(q) ||
        e.atdtcard?.toLowerCase().includes(q),
    );
  }, [emps, query]);

  async function openCard(empcode: string) {
    if (!user) return;
    setOpening(empcode);
    try {
      setCard(await getEmployeeCard(empcode, user.card_no));
    } catch (e) {
      console.error("Failed to load ID card", e);
    } finally {
      setOpening(null);
    }
  }

  if (!user?.hr_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <IdCard className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
          <p className="text-gray-500 mt-2">You don&apos;t have HR admin privileges.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {card && <EmployeeIDCard card={card} onClose={() => setCard(null)} />}

      <PageHeader title="Employee ID Cards" subtitle="Generate, preview and print employee ID cards" />

      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 w-full max-w-sm mb-4">
            <Search className="h-4 w-4 text-gray-400 shrink-0" />
            <input
              className="bg-transparent text-sm outline-none w-full placeholder:text-gray-400"
              placeholder="Search name / code…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="py-12 flex justify-center"><Spinner /></div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <Users className="h-8 w-8 mx-auto mb-2" />
              No employees found.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left">Empcode</th>
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">Card / ATDT</th>
                    <th className="px-4 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((e) => (
                    <tr key={e.empcode} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-gray-600">{e.empcode}</td>
                      <td className="px-4 py-2 font-medium text-gray-900">{e.name || "—"}</td>
                      <td className="px-4 py-2 text-gray-500">{e.card_no || e.atdtcard || "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="secondary" onClick={() => openCard(e.empcode)} disabled={opening === e.empcode}>
                          <IdCard className="h-3.5 w-3.5 mr-1" />
                          {opening === e.empcode ? "Loading…" : "View / Print"}
                        </Button>
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
