"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  Wallet, CalendarRange, Percent, Banknote, FileText, HandCoins, Coins,
  MinusCircle, CalendarX, Settings, ChevronRight, FileSpreadsheet,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PeriodOpeningPanel } from "./PeriodOpeningPanel";
import { TaxSlabPanel } from "./TaxSlabPanel";
import { LoanPanel } from "./LoanPanel";
import { SalaryPanel } from "./SalaryPanel";
import { LoanRecoveryPanel } from "./LoanRecoveryPanel";
import { MonthlyAllowancePanel } from "./MonthlyAllowancePanel";
import { MonthlyDeductionPanel } from "./MonthlyDeductionPanel";
import { AbsentDaysPanel } from "./AbsentDaysPanel";
import { PayRegisterPanel } from "./PayRegisterPanel";

type Tab = "salary" | "periods" | "tax" | "loans" | "recovery" | "allowances" | "deductions" | "absent" | "pay_register";

interface TabDef { id: Tab; label: string; icon: React.ElementType }
interface GroupDef { id: string; label: string; icon: React.ElementType; desc: string; tabs: TabDef[] }

// Screens grouped by what an admin is actually doing, so the page reads as a few
// clear areas instead of one long row of tabs. Order = typical monthly workflow.
const GROUPS: GroupDef[] = [
  {
    id: "salary", label: "Salary", icon: FileText,
    desc: "Review processed salaries and print payslips.",
    tabs: [{ id: "salary", label: "Salary / Payslips", icon: FileText }],
  },
  {
    id: "inputs", label: "Monthly Inputs", icon: Coins,
    desc: "Allowances, deductions and absences for the current open period.",
    tabs: [
      { id: "allowances", label: "Allowances", icon: Coins },
      { id: "deductions", label: "Deductions", icon: MinusCircle },
      { id: "absent", label: "Absent Days", icon: CalendarX },
    ],
  },
  {
    id: "loans", label: "Loans", icon: Banknote,
    desc: "Issue loans and record recoveries / adjustments.",
    tabs: [
      { id: "loans", label: "Loans", icon: Banknote },
      { id: "recovery", label: "Loan Recovery", icon: HandCoins },
    ],
  },
  {
    id: "config", label: "Configuration", icon: Settings,
    desc: "Open financial years / periods and maintain tax slabs.",
    tabs: [
      { id: "periods", label: "Period Opening", icon: CalendarRange },
      { id: "tax", label: "Tax Slabs", icon: Percent },
    ],
  },
  {
    id: "reports", label: "Reports", icon: FileSpreadsheet,
    desc: "Payroll reports — pay register for a processed period.",
    tabs: [{ id: "pay_register", label: "Pay Register", icon: FileSpreadsheet }],
  },
];

const PANELS: Record<Tab, (card: string) => React.ReactNode> = {
  salary: (c) => <SalaryPanel adminCardNo={c} />,
  allowances: (c) => <MonthlyAllowancePanel adminCardNo={c} />,
  deductions: (c) => <MonthlyDeductionPanel adminCardNo={c} />,
  absent: (c) => <AbsentDaysPanel adminCardNo={c} />,
  loans: (c) => <LoanPanel adminCardNo={c} />,
  recovery: (c) => <LoanRecoveryPanel adminCardNo={c} />,
  periods: (c) => <PeriodOpeningPanel adminCardNo={c} />,
  tax: (c) => <TaxSlabPanel adminCardNo={c} />,
  pay_register: (c) => <PayRegisterPanel adminCardNo={c} />,
};

export default function PayrollPage() {
  const { user } = useAuth();
  const [groupId, setGroupId] = useState<string>("salary");
  const [tab, setTab] = useState<Tab>("salary");
  const [reportPeriod, setReportPeriod] = useState<number | null>(null);

  function goToPayRegister(period: number) {
    setReportPeriod(period);
    setGroupId("reports");
    setTab("pay_register");
  }

  if (!user?.hr_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Wallet className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
          <p className="text-gray-500 mt-2">You don&apos;t have HR admin privileges.</p>
        </div>
      </div>
    );
  }

  const group = GROUPS.find((g) => g.id === groupId) ?? GROUPS[0];
  const activeTab = group.tabs.find((t) => t.id === tab) ?? group.tabs[0];

  function selectGroup(g: GroupDef) {
    setGroupId(g.id);
    setTab(g.tabs[0].id);   // jump to the group's first screen
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Payroll" subtitle="Salary, monthly inputs, loans and configuration" />

      {/* Level 1 — area cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
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
                  <p className="text-[11px] text-gray-400">{g.tabs.length} {g.tabs.length === 1 ? "screen" : "screens"}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Level 2 — screens within the chosen area (only when there's more than one) */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <span className="text-xs text-gray-400 hidden sm:flex items-center gap-1">
          {group.label} <ChevronRight className="h-3 w-3" />
        </span>
        {group.tabs.length > 1 ? (
          <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl">
            {group.tabs.map((t) => {
              const Icon = t.icon;
              const active = t.id === activeTab.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${active ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}>
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-sm font-medium text-gray-700">{activeTab.label}</span>
        )}
        <span className="text-xs text-gray-400 ml-auto hidden md:block">{group.desc}</span>
      </div>

      {activeTab.id === "salary" ? (
        <SalaryPanel adminCardNo={user.card_no} onViewPayRegister={goToPayRegister} />
      ) : activeTab.id === "pay_register" ? (
        <PayRegisterPanel adminCardNo={user.card_no} initialPeriod={reportPeriod} />
      ) : (
        PANELS[activeTab.id](user.card_no)
      )}
    </div>
  );
}
