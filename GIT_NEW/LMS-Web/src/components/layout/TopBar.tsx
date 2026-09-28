"use client";

import { useState, useRef, useEffect } from "react";
import { Menu, Building2, MapPin, ChevronDown, LogOut, User } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useAuthController } from "@/controllers/useAuthController";
import { CompanyItem, BranchItem } from "@/models/auth";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { SwitcherDropdown } from "./SwitcherDropdown";

/** Sticky header above every signed-in page: mobile menu toggle, the
 * company/branch switchers and the signed-in user's menu. */
export function TopBar() {
  const { user, switchCompany, switchBranch } = useAuth();
  const { handleLogout } = useAuthController();
  const { collapsed, setCollapsed } = useSidebar();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const companies = user?.company_list ?? [];
  // Only the selected company's branches. (Branches carry compc; older
  // sessions without it are shown as-is.)
  const companyCode = user?.selected_company?.code ?? "";
  const branches = (user?.branch_list ?? []).filter(
    (b) => !companyCode || !b.compc || String(b.compc) === String(companyCode)
  );

  const switchers = (variant: "pill" | "block") => (
    <>
      {companies.length > 0 && (
        <SwitcherDropdown<CompanyItem>
          items={companies}
          selected={user!.selected_company}
          onSelect={(c) => switchCompany(c)}
          icon={Building2}
          caption="Company"
          variant={variant}
        />
      )}
      {branches.length > 0 && (
        <SwitcherDropdown<BranchItem>
          items={branches}
          selected={user!.selected_branch}
          onSelect={(b) => switchBranch(b)}
          icon={MapPin}
          caption="Branch"
          variant={variant}
          allowAll
          allLabel="All Branches"
        />
      )}
    </>
  );

  const initial = user?.emp_name?.charAt(0)?.toUpperCase() || "U";

  return (
    <header className="sticky top-0 z-30 h-16 bg-white/85 backdrop-blur-md border-b border-line">
      <div className="h-full px-4 sm:px-6 lg:px-8 flex items-center gap-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="lg:hidden p-2 -ml-1 rounded-xl hover:bg-slate-100 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5 text-slate-600" />
        </button>

        {/* Company / branch — inline on larger screens, inside the user menu on phones */}
        <div className="hidden md:flex items-center gap-2 min-w-0">{switchers("pill")}</div>

        <div className="flex-1" />

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-3 pl-1 pr-2 py-1 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <span className="h-10 w-10 rounded-full bg-brand text-white flex items-center justify-center font-semibold shrink-0">
              {initial}
            </span>
            <span className="hidden sm:block text-left min-w-0 max-w-[180px]">
              <span className="block text-sm font-semibold text-ink truncate">{user?.emp_name || "User"}</span>
              <span className="block text-xs text-slate-500 truncate">ID: {user?.card_no}</span>
            </span>
            <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", menuOpen && "rotate-180")} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white border border-line rounded-2xl shadow-xl z-50 p-3 space-y-2">
              <div className="sm:hidden px-1 pb-2 border-b border-line">
                <p className="text-sm font-semibold text-ink truncate">{user?.emp_name || "User"}</p>
                <p className="text-xs text-slate-500">ID: {user?.card_no}</p>
              </div>
              <div className="md:hidden space-y-2">{switchers("block")}</div>
              {user?.has_employee_features && (
                <Link
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50"
                >
                  <User className="h-4 w-4 text-slate-400" /> My Profile
                </Link>
              )}
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
