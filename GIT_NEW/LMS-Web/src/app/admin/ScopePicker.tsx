"use client";

import { Building2, MapPin } from "lucide-react";

import type { BranchOption, ScopeOption } from "@/services/superAdminService";

/**
 * Company and branch pickers for one user.
 *
 * Branches are grouped under the company that owns them, because the mismatch
 * this panel exists to prevent — holding company 1 while holding company 3's
 * branches — is invisible in a flat list. Branches of an unselected company are
 * still selectable, but the group is marked so the mismatch is at least
 * deliberate rather than accidental.
 */
export function ScopePicker({
  companies,
  branches,
  selectedCompanies,
  selectedBranches,
  onCompaniesChange,
  onBranchesChange,
}: {
  companies: ScopeOption[];
  branches: BranchOption[];
  selectedCompanies: string[];
  selectedBranches: string[];
  onCompaniesChange: (next: string[]) => void;
  onBranchesChange: (next: string[]) => void;
}) {
  const toggle = (list: string[], code: string) =>
    list.includes(code) ? list.filter((c) => c !== code) : [...list, code];

  const byCompany = companies.map((c) => ({
    company: c,
    items: branches.filter((b) => b.compc === c.code),
  }));
  const orphans = branches.filter((b) => !companies.some((c) => c.code === b.compc));

  const branchRow = (b: BranchOption) => (
    <label
      key={b.code}
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer"
    >
      <input
        type="checkbox"
        checked={selectedBranches.includes(b.code)}
        onChange={() => onBranchesChange(toggle(selectedBranches, b.code))}
        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
      />
      <span className="text-sm text-gray-700 truncate">{b.name}</span>
      <span className="ml-auto text-[11px] text-gray-400">#{b.code}</span>
    </label>
  );

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <section className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Building2 className="h-4 w-4 text-gray-400" />
          Companies
          <span className="text-xs font-normal text-gray-400">
            {selectedCompanies.length} selected
          </span>
        </h4>
        <div className="border border-gray-200 rounded-xl p-1.5 max-h-64 overflow-y-auto">
          {companies.map((c) => (
            <label
              key={c.code}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedCompanies.includes(c.code)}
                onChange={() => onCompaniesChange(toggle(selectedCompanies, c.code))}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700 truncate">{c.name}</span>
              <span className="ml-auto text-[11px] text-gray-400">#{c.code}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <MapPin className="h-4 w-4 text-gray-400" />
          Branches
          <span className="text-xs font-normal text-gray-400">
            {selectedBranches.length} selected
          </span>
        </h4>
        <div className="border border-gray-200 rounded-xl p-1.5 max-h-64 overflow-y-auto space-y-2">
          {byCompany.map(({ company, items }) =>
            items.length === 0 ? null : (
              <div key={company.code}>
                <p className="px-2 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {company.name}
                  {!selectedCompanies.includes(company.code) && (
                    <span className="ml-1.5 font-normal normal-case text-amber-600">
                      company not assigned
                    </span>
                  )}
                </p>
                {items.map(branchRow)}
              </div>
            ),
          )}
          {orphans.length > 0 && (
            <div>
              <p className="px-2 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Other
              </p>
              {orphans.map(branchRow)}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
