"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { PiggyBank, LayoutGrid, Users, HandCoins, FileText, SlidersHorizontal, Landmark, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PfOverviewPanel } from "./PfOverviewPanel";
import { PfMembersPanel } from "./PfMembersPanel";
import { PfLoansPanel } from "./PfLoansPanel";
import { PfStatementPanel } from "./PfStatementPanel";
import { PfSetupPanel } from "./PfSetupPanel";
import { PfOpeningPanel } from "./PfOpeningPanel";
import { PfZakatPanel } from "./PfZakatPanel";

type Tab = "overview" | "members" | "loans" | "ledger" | "rates" | "openings" | "zakat";

const TABS: { id: Tab; label: string; icon: React.ElementType; desc: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid, desc: "Fund size, members and posted contributions" },
  { id: "members", label: "Members & Balances", icon: Users, desc: "Balances, statements, opening balances and enrolment" },
  { id: "loans", label: "Loans & Withdrawals", icon: HandCoins, desc: "Loans against PF and permanent withdrawals" },
  { id: "ledger", label: "Profit Statement & Settlement", icon: FileText, desc: "Yearly statement with profit and company share, and the final settlement" },
  { id: "rates", label: "Profit Rate & Posting", icon: SlidersHorizontal, desc: "Declare the yearly profit rate, post the year, PF settings" },
  { id: "openings", label: "Ledger Openings", icon: Landmark, desc: "Opening balances the profit ledger starts from" },
  { id: "zakat", label: "Zakat Exemption", icon: ShieldCheck, desc: "Who has filed the zakat exemption declaration" },
];

export default function ProvidentFundPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");

  if (!user?.hr_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <PiggyBank className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
          <p className="text-gray-500 mt-2">You don&apos;t have HR admin privileges.</p>
        </div>
      </div>
    );
  }

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="animate-fade-in">
      <PageHeader title="Provident Fund" subtitle="Employee PF balances, profit, loans, withdrawals, zakat and settlement" />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = t.id === tab;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${on ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}>
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-gray-400 ml-auto hidden md:block">{active.desc}</span>
      </div>

      {tab === "overview" && <PfOverviewPanel adminCardNo={user.card_no} onOpenMembers={() => setTab("members")} />}
      {tab === "members" && <PfMembersPanel adminCardNo={user.card_no} />}
      {tab === "loans" && <PfLoansPanel adminCardNo={user.card_no} />}
      {tab === "ledger" && <PfStatementPanel adminCardNo={user.card_no} />}
      {tab === "rates" && <PfSetupPanel adminCardNo={user.card_no} />}
      {tab === "openings" && <PfOpeningPanel adminCardNo={user.card_no} />}
      {tab === "zakat" && <PfZakatPanel adminCardNo={user.card_no} />}
    </div>
  );
}
