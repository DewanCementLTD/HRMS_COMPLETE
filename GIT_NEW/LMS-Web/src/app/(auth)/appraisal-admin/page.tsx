"use client";

import { useMemo, useState } from "react";
import { Target, LayoutGrid, CalendarRange, Users, BadgeDollarSign, ListChecks, FileBarChart, Award, Sheet } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs } from "@/components/training/TrainingUi";
import type { Hr } from "@/services/appraisalService";
import { DashboardPanel } from "./DashboardPanel";
import { CyclesPanel } from "./CyclesPanel";
import { AppraisalsPanel } from "./AppraisalsPanel";
import { PromotionsPanel } from "./PromotionsPanel";
import { SummaryPanel } from "./SummaryPanel";
import { RecommendationsPanel } from "./RecommendationsPanel";
import { MastersPanel } from "./MastersPanel";
import { ReportsPanel } from "./ReportsPanel";

type Tab = "dashboard" | "cycles" | "appraisals" | "promotions" | "summary" | "recommendations" | "masters" | "reports";

const DESC: Record<Tab, string> = {
  dashboard: "Progress, grades, bell curve, department ranking",
  cycles: "Create a cycle, push corporate objectives, launch, open mid-year / year-end",
  appraisals: "Every task sheet — HR review, grade normalisation, finalise",
  promotions: "Promotion evaluation sheets 1–5 — eligibility, history, scorecard, sign-off",
  summary: "Performance Appraisal Summary Sheet per department",
  recommendations: "Apply approved increments and promotions to the employee master",
  masters: "Competencies, grade scale, promotion scorecard, CEO approvers",
  reports: "Appraisal reports — print or export",
};

export default function AppraisalAdminPage() {
  const { user, activeCompany } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [cycleFilter, setCycleFilter] = useState<number | null>(null);
  const h = useMemo<Hr>(() => ({ card: user?.card_no ?? "", compc: activeCompany || undefined }), [user?.card_no, activeCompany]);

  if (!user?.hr_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Target className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
          <p className="text-gray-500 mt-2">You don&apos;t have HR admin privileges.</p>
        </div>
      </div>
    );
  }

  const openAppraisals = (cycleId?: number) => { setCycleFilter(cycleId ?? null); setTab("appraisals"); };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Performance Appraisal" subtitle={`Appraisal & promotion evaluation for ${user.selected_company?.name ?? "the selected company"}`} />
      <Tabs<Tab> value={tab} onChange={setTab} desc={DESC[tab]} tabs={[
        { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
        { id: "cycles", label: "Cycles", icon: CalendarRange },
        { id: "appraisals", label: "Appraisals", icon: Users },
        { id: "promotions", label: "Promotions", icon: Award },
        { id: "summary", label: "Summary Sheet", icon: Sheet },
        { id: "recommendations", label: "Apply", icon: BadgeDollarSign },
        { id: "masters", label: "Setup", icon: ListChecks },
        { id: "reports", label: "Reports", icon: FileBarChart },
      ]} />
      {tab === "dashboard" && <DashboardPanel h={h} onOpenAppraisals={openAppraisals} />}
      {tab === "cycles" && <CyclesPanel h={h} onOpenAppraisals={openAppraisals} />}
      {tab === "appraisals" && <AppraisalsPanel h={h} initialCycle={cycleFilter} />}
      {tab === "promotions" && <PromotionsPanel h={h} />}
      {tab === "summary" && <SummaryPanel h={h} />}
      {tab === "recommendations" && <RecommendationsPanel h={h} />}
      {tab === "masters" && <MastersPanel h={h} />}
      {tab === "reports" && <ReportsPanel h={h} />}
    </div>
  );
}
