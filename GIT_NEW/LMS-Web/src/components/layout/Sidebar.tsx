"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useAuthController } from "@/controllers/useAuthController";
import Image from "next/image";
import {
  LayoutDashboard,
  CalendarPlus,
  ClipboardList,
  Clock,
  User,
  UserCog,
  Briefcase,
  LogOut,
  ChevronLeft,
  IdCard,
  Wallet,
  FileText,
  ClipboardCheck,
  Network,
  PiggyBank,
  GraduationCap,
  BookOpenCheck,
  Presentation,
  Target,
  ClipboardPen,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useSidebar } from "./sidebar-context";
import { CompanyLogo } from "@/components/ui/CompanyLogo";
import { fetchHodApprovals } from "@/services/leaveService";
import { hodApi, trainerApi } from "@/services/trainingService";
import { apprReviewApi } from "@/services/appraisalService";

// Dashboard is shown to everyone who has either employee features OR hr_admin
// (SEC_USERNAME-only admins see it as the HR dashboard).
const dashboardNavItem = { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard };
// Shown to everyone who can see the dashboard — HR admins get the company-wide
// view, other employees get their own branch's chart.
const orgChartNavItem = { href: "/org-chart", label: "Organogram", icon: Network };

const employeeNavItems = [
  { href: "/leave/apply", label: "Apply Leave", icon: CalendarPlus },
  { href: "/leave/status", label: "Leave Status", icon: ClipboardList },
  { href: "/attendance", label: "Attendance", icon: Clock },
  { href: "/my-pf", label: "My PF", icon: PiggyBank },
  { href: "/training", label: "My Training", icon: GraduationCap },
  { href: "/appraisal", label: "My Appraisal", icon: Target },
  { href: "/profile", label: "Profile", icon: User },
];

// Shown only to HODs (see the lookup in Sidebar below).
const hodNavItem = { href: "/leave/approvals", label: "Leave Approvals", icon: ClipboardCheck };
const trainingHodNavItem = { href: "/training-approvals", label: "Training Approvals", icon: BookOpenCheck };
// Reporting officers, HODs and management approvers of at least one appraisal.
const appraisalReviewNavItem = { href: "/appraisal-review", label: "Appraisal Reviews", icon: ClipboardPen };
// Shown only to employees HR has set up as internal trainers.
const trainerNavItem = { href: "/trainer", label: "Trainer Portal", icon: Presentation };

const hrNavItems = [
  { href: "/hrms", label: "HRMS", icon: UserCog },
  { href: "/recruitment", label: "Recruitment", icon: Briefcase },
  { href: "/payroll", label: "Payroll", icon: Wallet },
  { href: "/provident-fund", label: "Provident Fund", icon: PiggyBank },
  { href: "/training-admin", label: "Training", icon: GraduationCap },
  { href: "/appraisal-admin", label: "Appraisal", icon: Target },
  { href: "/id-cards", label: "ID Cards", icon: IdCard },
  { href: "/reports", label: "Reports", icon: FileText },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { handleLogout } = useAuthController();
  const { collapsed, setCollapsed, resetView } = useSidebar();

  const showEmployeeNav = !!user?.has_employee_features;
  const showDashboard = showEmployeeNav || !!user?.hr_admin;
  // "Leave Approvals" only exists for people actually named as HOD 1 / HOD 2 on
  // someone's employee record — that includes HR staff who head a department,
  // and excludes HR staff who don't.
  const [hodPending, setHodPending] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const card = user?.card_no;
    if (!card) return;
    fetchHodApprovals(card)
      .then((res) => {
        if (cancelled) return;
        setHodPending(res.is_hod ? res.items.filter((a) => a.my_turn).length : null);
      })
      .catch(() => { if (!cancelled) setHodPending(null); });
    return () => { cancelled = true; };
  }, [user?.card_no]);

  // Same rule for training requests. The call needs the signed session token;
  // without one (an older login) the item simply stays hidden.
  const [trainingPending, setTrainingPending] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const card = user?.card_no;
    const token = user?.session_token;
    if (!card || !token) return;
    hodApi.requests(card, token)
      .then((res) => { if (!cancelled) setTrainingPending(res.is_hod ? res.pending : null); })
      .catch(() => { if (!cancelled) setTrainingPending(null); });
    return () => { cancelled = true; };
  }, [user?.card_no, user?.session_token]);

  const [appraisalPending, setAppraisalPending] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const card = user?.card_no;
    const token = user?.session_token;
    if (!card || !token) return;
    apprReviewApi.inbox(card, token)
      .then((res) => { if (!cancelled) setAppraisalPending(res.is_reviewer ? res.pending : null); })
      .catch(() => { if (!cancelled) setAppraisalPending(null); });
    return () => { cancelled = true; };
  }, [user?.card_no, user?.session_token]);

  const [isTrainer, setIsTrainer] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const card = user?.card_no;
    const token = user?.session_token;
    if (!card || !token) return;
    trainerApi.profile(card, token)
      .then((res) => { if (!cancelled) setIsTrainer(res.is_trainer); })
      .catch(() => { if (!cancelled) setIsTrainer(false); });
    return () => { cancelled = true; };
  }, [user?.card_no, user?.session_token]);

  const navItems = [
    ...(showDashboard ? [dashboardNavItem] : []),
    ...(showDashboard ? [orgChartNavItem] : []),
    ...(showEmployeeNav ? employeeNavItems : []),
    ...(hodPending !== null ? [hodNavItem] : []),
    ...(trainingPending !== null ? [trainingHodNavItem] : []),
    ...(appraisalPending !== null ? [appraisalReviewNavItem] : []),
    ...(isTrainer ? [trainerNavItem] : []),
    ...(user?.hr_admin ? hrNavItems : []),
  ];

  const companyCompc = user?.selected_company?.code ?? "";

  // On mobile the sidebar is an overlay (collapsed === hidden), so picking a
  // nav item should close it. On desktop it must stay open.
  const closeOnMobile = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) setCollapsed(true);
  };

  return (
    <>
      {/* Mobile backdrop — tapping outside closes the drawer */}
      {!collapsed && (
        <div
          onClick={() => setCollapsed(true)}
          className="lg:hidden fixed inset-0 bg-slate-900/30 z-40"
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 h-full bg-white border-r border-line z-50 transition-all duration-300 flex flex-col",
          collapsed ? "w-20" : "w-64",
          "max-lg:w-64 max-lg:-translate-x-full max-lg:data-[open=true]:translate-x-0 max-lg:shadow-xl"
        )}
        data-open={!collapsed}
      >
        {/* Brand */}
        <div className={cn("h-20 flex items-center gap-3 px-5 shrink-0", collapsed && "lg:px-3 lg:justify-center")}>
          {/* Company logo once uploaded, otherwise the default LMS mark. */}
          <div className="h-11 w-11 shrink-0 rounded-xl bg-brand-soft flex items-center justify-center overflow-hidden">
            <CompanyLogo
              compc={companyCompc}
              className="h-9 w-9"
              fallback={
                <Image src="/LMS_Black.png" alt="LMS Logo" width={30} height={30} className="shrink-0" />
              }
            />
          </div>
          <div className={cn("min-w-0 flex-1", collapsed && "lg:hidden")}>
            <p className="text-lg font-extrabold text-ink leading-none tracking-tight">HRMS</p>
            <p className="text-[11px] text-slate-500 leading-tight mt-1">
              Human Resource<br />Management System
            </p>
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              "p-1.5 rounded-lg hover:bg-slate-100 transition-colors shrink-0",
              collapsed && "lg:hidden"
            )}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
        </div>
        {/* Expand handle when collapsed on desktop */}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            className="hidden lg:flex mx-auto mb-2 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Expand sidebar"
          >
            <ChevronLeft className="h-5 w-5 text-slate-400 rotate-180" />
          </button>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                onClick={() => {
                  closeOnMobile();
                  // Already inside this section: send it back to its home view.
                  if (isActive) resetView();
                }}
                className={cn(
                  "relative flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-brand-soft text-brand font-semibold"
                    : "text-slate-600 hover:bg-slate-50 hover:text-ink",
                  collapsed && "lg:justify-center lg:px-2"
                )}
              >
                {isActive && (
                  <span className="absolute -left-3 top-1.5 bottom-1.5 w-1 rounded-r-full bg-brand" />
                )}
                <Icon className={cn("h-5 w-5 shrink-0", isActive ? "text-brand" : "text-slate-400")} />
                <span className={cn("flex-1", collapsed && "lg:hidden")}>{item.label}</span>
                {((item.href === hodNavItem.href && !!hodPending) || (item.href === trainingHodNavItem.href && !!trainingPending)
                  || (item.href === appraisalReviewNavItem.href && !!appraisalPending)) && (
                  <span className={cn(
                    "bg-brand text-white text-[11px] font-bold rounded-full px-1.5 min-w-[20px] text-center",
                    collapsed && "lg:absolute lg:top-1 lg:right-1 lg:min-w-[16px] lg:text-[9px]"
                  )}>
                    {item.href === hodNavItem.href ? hodPending : item.href === trainingHodNavItem.href ? trainingPending : appraisalPending}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 mx-2 border-t border-line">
          <button
            onClick={handleLogout}
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-red-600 hover:bg-red-50 transition-all duration-200 w-full",
              collapsed && "lg:justify-center lg:px-2"
            )}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            <span className={cn(collapsed && "lg:hidden")}>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}
