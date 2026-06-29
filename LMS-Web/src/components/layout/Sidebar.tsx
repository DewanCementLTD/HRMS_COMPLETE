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
  Menu,
  Building2,
  MapPin,
  ChevronDown,
  IdCard,
  Wallet,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { CompanyItem, BranchItem } from "@/models/auth";
import { useSidebar } from "./sidebar-context";

// Dashboard is shown to everyone who has either employee features OR hr_admin
// (SEC_USERNAME-only admins see it as the HR dashboard).
const dashboardNavItem = { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard };

const employeeNavItems = [
  { href: "/leave/apply", label: "Apply Leave", icon: CalendarPlus },
  { href: "/leave/status", label: "Leave Status", icon: ClipboardList },
  { href: "/attendance", label: "Attendance", icon: Clock },
  { href: "/profile", label: "Profile", icon: User },
];

const hrNavItems = [
  { href: "/hrms", label: "HRMS", icon: UserCog },
  { href: "/recruitment", label: "Recruitment", icon: Briefcase },
  { href: "/payroll", label: "Payroll", icon: Wallet },
  { href: "/id-cards", label: "ID Cards", icon: IdCard },
];

function SwitcherDropdown<T extends { code: string; name: string }>({
  items,
  selected,
  onSelect,
  icon: Icon,
  collapsed,
  allowAll = false,
  allLabel = "All",
}: {
  items: T[];
  selected: T | null;
  onSelect: (item: T) => void;
  icon: React.ElementType;
  collapsed: boolean;
  allowAll?: boolean;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (items.length === 0) return null;

  // Prepend a synthetic "All" entry (empty code = no filter) when allowed.
  const displayItems: T[] = allowAll
    ? ([{ code: "", name: allLabel } as T, ...items])
    : items;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => displayItems.length > 1 && setOpen(!open)}
        className={cn(
          "flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg transition-colors text-xs",
          displayItems.length > 1
            ? "hover:bg-gray-100 cursor-pointer"
            : "cursor-default",
          collapsed && "justify-center"
        )}
        title={selected?.name ?? ""}
      >
        <Icon className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        {!collapsed && (
          <>
            <span className="text-gray-600 truncate flex-1">{selected?.name ?? "—"}</span>
            {displayItems.length > 1 && (
              <ChevronDown className={cn("h-3 w-3 text-gray-400 shrink-0 transition-transform", open && "rotate-180")} />
            )}
          </>
        )}
      </button>

      {open && !collapsed && (
        <div className="absolute left-0 top-full mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
          {displayItems.map((item) => (
            <button
              key={item.code}
              onClick={() => { onSelect(item); setOpen(false); }}
              className={cn(
                "w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 hover:text-indigo-700 transition-colors",
                selected?.code === item.code && "bg-indigo-50 text-indigo-700 font-medium"
              )}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { user, switchCompany, switchBranch } = useAuth();
  const { handleLogout } = useAuthController();
  const { collapsed, setCollapsed } = useSidebar();

  const showEmployeeNav = !!user?.has_employee_features;
  const showDashboard = showEmployeeNav || !!user?.hr_admin;
  const navItems = [
    ...(showDashboard ? [dashboardNavItem] : []),
    ...(showEmployeeNav ? employeeNavItems : []),
    ...(user?.hr_admin ? hrNavItems : []),
  ];

  return (
    <>
      {/* Mobile overlay button */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-xl shadow-md"
      >
        <Menu className="h-5 w-5 text-gray-600" />
      </button>

      <aside
        className={cn(
          "fixed left-0 top-0 h-full bg-white border-r border-gray-100 z-40 transition-all duration-300 flex flex-col",
          collapsed ? "w-20" : "w-64",
          "max-lg:-translate-x-full max-lg:data-[open=true]:translate-x-0"
        )}
        data-open={!collapsed}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            <Image
              src="/LMS_Black.png"
              alt="LMS Logo"
              width={36}
              height={36}
              className="shrink-0"
            />
            {!collapsed && (
              <h1 className="text-xl font-bold bg-linear-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent truncate">
                LMS Portal
              </h1>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors hidden lg:block"
          >
            <ChevronLeft
              className={cn(
                "h-5 w-5 text-gray-400 transition-transform",
                collapsed && "rotate-180"
              )}
            />
          </button>
        </div>

        {/* User info + company/branch */}
        <div className={cn("px-4 py-3 border-b border-gray-100 space-y-1", collapsed && "px-2")}>
          {/* Avatar + name */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-linear-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-semibold text-sm shrink-0">
              {user?.emp_name?.charAt(0)?.toUpperCase() || "U"}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {user?.emp_name || "User"}
                </p>
                <p className="text-xs text-gray-400">ID: {user?.card_no}</p>
              </div>
            )}
          </div>

          {/* Company switcher */}
          {(user?.company_list?.length ?? 0) > 0 && (
            <SwitcherDropdown<CompanyItem>
              items={user!.company_list}
              selected={user!.selected_company}
              onSelect={switchCompany}
              icon={Building2}
              collapsed={collapsed}
            />
          )}

          {/* Branch switcher — only the selected company's branches.
              (Branches carry compc; older sessions without it are shown as-is.) */}
          {(() => {
            const companyCode = user?.selected_company?.code ?? "";
            const branchesForCompany = (user?.branch_list ?? []).filter(
              (b) => !companyCode || !b.compc || String(b.compc) === String(companyCode)
            );
            if (branchesForCompany.length === 0) return null;
            return (
              <SwitcherDropdown<BranchItem>
                items={branchesForCompany}
                selected={user!.selected_branch}
                onSelect={switchBranch}
                icon={MapPin}
                collapsed={collapsed}
                allowAll
                allLabel="All Branches"
              />
            );
          })()}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-indigo-50 text-indigo-700 shadow-sm"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                  collapsed && "justify-center px-2"
                )}
              >
                <Icon className={cn("h-5 w-5 shrink-0", isActive ? "text-indigo-600" : "text-gray-400")} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-all duration-200 w-full",
              collapsed && "justify-center px-2"
            )}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
