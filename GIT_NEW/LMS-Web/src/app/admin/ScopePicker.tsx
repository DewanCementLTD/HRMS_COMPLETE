"use client";

import { Building2, MapPin } from "lucide-react";

import type { BranchOption, ScopeOption } from "@/services/superAdminService";

/**
 * Company and branch pickers for one user.
 *
 * Branches are grouped under the company that owns them, because the mismatch
 * this panel exists to prevent — holding company 1 while holding company 3's
 * branches — is invisible in a flat list. Branches of an unselected company are
 * shown but locked until that company is assigned.
 *
 * SEC_USERBRCH stores only the branch code, and codes repeat across companies
 * (D-Tech has LOC_ID 1-5 in every company). A stored code is therefore shown
 * ticked only under the companies the user actually holds — access is always
 * company AND branch, so a branch of an unassigned company grants nothing.
 */

/** True when the branch row belongs to no listed company (the "Other" group). */
const isOrphan = (b: BranchOption, companies: ScopeOption[]) =>
  !companies.some((c) => c.code === b.compc);

/**
 * The branch codes that still mean something for the chosen companies: a code
 * is kept only if some assigned company (or the "Other" group) has it. Used on
 * save so un-assigning a company does not leave its branch codes behind.
 */
export function effectiveBranches(
  companies: ScopeOption[],
  branches: BranchOption[],
  selectedCompanies: string[],
  selectedBranches: string[],
): string[] {
  return selectedBranches.filter((code) =>
    branches.some(
      (b) => b.code === code && (selectedCompanies.includes(b.compc) || isOrphan(b, companies)),
    ),
  );
}

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
  const orphans = branches.filter((b) => isOrphan(b, companies));

  // A row is usable (and can show ticked) only when its company is assigned.
  const usable = (b: BranchOption) => selectedCompanies.includes(b.compc) || isOrphan(b, companies);
  const isOn = (b: BranchOption) => usable(b) && selectedBranches.includes(b.code);
  const tickedCount = branches.filter(isOn).length;

  // Un-assigning a company drops the branch codes no other assigned company uses.
  const changeCompanies = (next: string[]) => {
    onCompaniesChange(next);
    const pruned = effectiveBranches(companies, branches, next, selectedBranches);
    if (pruned.length !== selectedBranches.length) onBranchesChange(pruned);
  };

  const branchRow = (b: BranchOption) => (
    <label
      key={`${b.compc}-${b.code}`}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${usable(b) ? "hover:bg-gray-50 cursor-pointer" : "opacity-50 cursor-not-allowed"}`}
      title={usable(b) ? undefined : "Assign this company first"}
    >
      <input
        type="checkbox"
        checked={isOn(b)}
        disabled={!usable(b)}
        onChange={() => onBranchesChange(toggle(selectedBranches, b.code))}
        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
      />
      <span className="text-sm text-gray-700 truncate">{b.name}</span>
      {/* SEC_USERBRCH stores only the code, so a code shared by several
          companies is granted for each of the user's companies that has it. */}
      {branches.filter((x) => x.code === b.code && usable(x)).length > 1 && (
        <span className="text-[10px] text-amber-600 whitespace-nowrap" title="This branch code exists in more than one assigned company; ticking it grants it in each of them.">
          shared code
        </span>
      )}
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
                onChange={() => changeCompanies(toggle(selectedCompanies, c.code))}
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
            {tickedCount} selected
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
                      company not assigned — assign it to pick its branches
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
