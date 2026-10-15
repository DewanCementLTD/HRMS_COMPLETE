"use client";

import { useCallback, useMemo, useState } from "react";
import { GraduationCap, LayoutGrid, Inbox, CalendarDays, BookOpen, UserSquare2, Wallet, FileBarChart } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs } from "@/components/training/TrainingUi";
import type { Hr } from "@/services/trainingService";
import { DashboardPanel } from "./DashboardPanel";
import { RequestsPanel } from "./RequestsPanel";
import { SessionsPanel } from "./SessionsPanel";
import { CoursesPanel } from "./CoursesPanel";
import { TrainersPanel } from "./TrainersPanel";
import { BudgetPanel } from "./BudgetPanel";
import { ReportsPanel } from "./ReportsPanel";

type Tab = "dashboard" | "requests" | "sessions" | "courses" | "trainers" | "budget" | "reports";

const DESC: Record<Tab, string> = {
  dashboard: "Requests, sessions, hours, cost and outcomes at a glance",
  requests: "Approve training requests and book them into sessions",
  sessions: "Schedule sessions, assign people, take attendance, complete & certify",
  courses: "Course catalog, categories and online tests",
  trainers: "Internal and external trainers",
  budget: "Training budget per fiscal year",
  reports: "Training reports — print or export",
};

export default function TrainingAdminPage() {
  const { user, activeCompany } = useAuth();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [openSession, setOpenSession] = useState<number | null>(null);

  // Stable object so panels only reload when the admin or company changes.
  const h = useMemo<Hr>(() => ({ card: user?.card_no ?? "", compc: activeCompany || undefined }), [user?.card_no, activeCompany]);
  const clearOpen = useCallback(() => setOpenSession(null), []);

  if (!user?.hr_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <GraduationCap className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
          <p className="text-gray-500 mt-2">You don&apos;t have HR admin privileges.</p>
        </div>
      </div>
    );
  }

  const go = (t: "requests" | "sessions" | "budget", sessionId?: number) => {
    if (sessionId) setOpenSession(sessionId);
    setTab(t);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader title="Training & Development" subtitle={`Training management for ${user.selected_company?.name ?? "the selected company"}`} />
      <Tabs<Tab> value={tab} onChange={setTab} desc={DESC[tab]} tabs={[
        { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
        { id: "requests", label: "Requests", icon: Inbox },
        { id: "sessions", label: "Sessions", icon: CalendarDays },
        { id: "courses", label: "Courses & Tests", icon: BookOpen },
        { id: "trainers", label: "Trainers", icon: UserSquare2 },
        { id: "budget", label: "Budget", icon: Wallet },
        { id: "reports", label: "Reports", icon: FileBarChart },
      ]} />
      {tab === "dashboard" && <DashboardPanel h={h} onGo={go} />}
      {tab === "requests" && <RequestsPanel h={h} onOpenSession={(id) => go("sessions", id)} />}
      {tab === "sessions" && <SessionsPanel h={h} openSessionId={openSession} onOpened={clearOpen} />}
      {tab === "courses" && <CoursesPanel h={h} />}
      {tab === "trainers" && <TrainersPanel h={h} />}
      {tab === "budget" && <BudgetPanel h={h} />}
      {tab === "reports" && <ReportsPanel h={h} />}
    </div>
  );
}
