"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { IdCard, Search, Users, Printer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { listHRMSEmployees, getEmployeeCard, type EmployeeCard } from "@/services/hrmsService";
import type { HRMSSearchResult } from "@/models/hrms";
import { EmployeeIDCard } from "../hrms/EmployeeIDCard";
import { BulkCardSheet } from "../hrms/BulkCardSheet";

export default function IDCardsPage() {
  const { user, activeCompany, activeBranch } = useAuth();
  const [emps, setEmps] = useState<HRMSSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [card, setCard] = useState<EmployeeCard | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCards, setBulkCards] = useState<EmployeeCard[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

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

  function toggleSelect(empcode: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(empcode)) next.delete(empcode);
      else next.add(empcode);
      return next;
    });
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.empcode));
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((e) => next.delete(e.empcode));
      else filtered.forEach((e) => next.add(e.empcode));
      return next;
    });
  }

  async function buildAndPrint(codes: string[]) {
    if (!user || codes.length === 0) return;
    setBulkBusy(true);
    try {
      // Fetch in small batches so a few hundred employees don't hammer the API at once.
      const cards: EmployeeCard[] = [];
      const BATCH = 12;
      for (let i = 0; i < codes.length; i += BATCH) {
        const slice = codes.slice(i, i + BATCH);
        const res = await Promise.all(
          slice.map((code) => getEmployeeCard(code, user.card_no).catch(() => null)),
        );
        res.forEach((c) => { if (c) cards.push(c); });
      }
      if (cards.length) setBulkCards(cards);
    } catch (e) {
      console.error("Failed to build bulk cards", e);
    } finally {
      setBulkBusy(false);
    }
  }

  function printSelected() {
    buildAndPrint(filtered.filter((e) => selected.has(e.empcode)).map((e) => e.empcode));
  }

  function printAll() {
    if (filtered.length > 150 &&
        !confirm(`Generate ID cards for all ${filtered.length} employees? This may take a moment.`)) return;
    buildAndPrint(filtered.map((e) => e.empcode));
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
      {card && <EmployeeIDCard card={card} adminCardNo={user.card_no} onClose={() => setCard(null)} />}
      {bulkCards && <BulkCardSheet cards={bulkCards} adminCardNo={user.card_no} onClose={() => setBulkCards(null)} />}

      <PageHeader title="Employee ID Cards" subtitle="Generate, preview and print employee ID cards" />

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 w-full max-w-sm">
              <Search className="h-4 w-4 text-gray-400 shrink-0" />
              <input
                className="bg-transparent text-sm outline-none w-full placeholder:text-gray-400"
                placeholder="Search name / code…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={printAll} disabled={filtered.length === 0 || bulkBusy}>
                <Printer className="h-4 w-4 mr-1.5" />
                {bulkBusy ? "Preparing…" : `Print All (${filtered.length})`}
              </Button>
              <Button size="sm" onClick={printSelected} disabled={selected.size === 0 || bulkBusy}>
                <Printer className="h-4 w-4 mr-1.5" />
                Print Selected ({selected.size})
              </Button>
            </div>
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
                    <th className="px-4 py-2 w-8">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll}
                        className="accent-indigo-600 cursor-pointer" title="Select all" />
                    </th>
                    <th className="px-4 py-2 text-left">Empcode</th>
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">Card / ATDT</th>
                    <th className="px-4 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((e) => (
                    <tr key={e.empcode} className={`hover:bg-gray-50 ${selected.has(e.empcode) ? "bg-indigo-50/50" : ""}`}>
                      <td className="px-4 py-2">
                        <input type="checkbox" checked={selected.has(e.empcode)} onChange={() => toggleSelect(e.empcode)}
                          className="accent-indigo-600 cursor-pointer" />
                      </td>
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
