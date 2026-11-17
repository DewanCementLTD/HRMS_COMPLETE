"use client";

import { Building2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

/** True when the top-bar company switcher is on "All Companies". */
export function useAllCompanies() {
  const { user } = useAuth();
  return !!user?.selected_company && String(user.selected_company.code ?? "") === "" && (user.company_list?.length ?? 0) > 1;
}

/**
 * Screens that work on one company at a time (payroll, appraisal, training,
 * setup, leave allocation, …) render this instead of their content while
 * "All Companies" is selected, so they never silently fall back to the first
 * company. Picking a company here is the same as picking it in the top bar.
 */
export function CompanyRequired({ children, what = "This section" }: { children: React.ReactNode; what?: string }) {
  const { user, switchCompany } = useAuth();
  const all = useAllCompanies();
  if (!all) return <>{children}</>;
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="max-w-md w-full rounded-2xl border border-gray-200 bg-white shadow-sm p-6 text-center space-y-4">
        <Building2 className="h-10 w-10 text-indigo-400 mx-auto" />
        <div>
          <h2 className="text-base font-semibold text-gray-900">Select a company</h2>
          <p className="text-sm text-gray-500 mt-1">{what} works on one company at a time. Pick the company to continue.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {(user?.company_list ?? []).map((c) => (
            <button key={c.code} onClick={() => switchCompany(c)}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-indigo-50 hover:border-indigo-300">
              {c.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
