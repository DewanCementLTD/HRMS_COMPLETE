"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Wallet, CalendarRange, Percent, Banknote, FileText } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PeriodOpeningPanel } from "./PeriodOpeningPanel";
import { TaxSlabPanel } from "./TaxSlabPanel";
import { LoanPanel } from "./LoanPanel";
import { SalaryPanel } from "./SalaryPanel";

type Tab = "salary" | "periods" | "tax" | "loans";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "salary", label: "Salary / Payslips", icon: FileText },
  { id: "periods", label: "Period Opening", icon: CalendarRange },
  { id: "tax", label: "Tax Slabs", icon: Percent },
  { id: "loans", label: "Loans", icon: Banknote },
];

export default function PayrollPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("salary");

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

  return (
    <div className="animate-fade-in">
      <PageHeader title="Payroll" subtitle="Period opening, tax slabs and loans" />

      <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl mb-6 w-fit">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}>
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "salary" && <SalaryPanel adminCardNo={user.card_no} />}
      {tab === "periods" && <PeriodOpeningPanel adminCardNo={user.card_no} />}
      {tab === "tax" && <TaxSlabPanel adminCardNo={user.card_no} />}
      {tab === "loans" && <LoanPanel adminCardNo={user.card_no} />}
    </div>
  );
}
