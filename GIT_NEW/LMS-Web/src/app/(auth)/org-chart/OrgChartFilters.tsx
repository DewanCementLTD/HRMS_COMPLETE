"use client";

import { Building2, Layers, MapPin, Printer, Search, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { CompanyItem, BranchItem } from "@/models/auth";

const SELECT = "appearance-none text-sm bg-transparent outline-none pr-2 max-w-[220px] truncate cursor-pointer";

function Field({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
      <Icon className="h-4 w-4 text-gray-400 shrink-0" />
      {children}
    </label>
  );
}

export function OrgChartFilters({
  isHrAdmin, companies, branches, activeCompany, activeBranch,
  onCompanyChange, onBranchChange,
  departments, selectedDept, onDeptChange,
  search, onSearchChange, onPrint, printDisabled,
}: {
  isHrAdmin: boolean;
  companies: CompanyItem[];
  branches: BranchItem[];
  activeCompany: string;
  activeBranch: string;
  onCompanyChange: (code: string) => void;
  onBranchChange: (code: string) => void;
  departments: { code: string; name: string }[];
  selectedDept: string;
  onDeptChange: (code: string) => void;
  search: string;
  onSearchChange: (q: string) => void;
  onPrint: () => void;
  printDisabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {isHrAdmin && companies.length > 0 && (
        <Field icon={Building2}>
          <select className={SELECT} value={activeCompany} onChange={(e) => onCompanyChange(e.target.value)}>
            {companies.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {isHrAdmin && (
        <Field icon={MapPin}>
          <select className={SELECT} value={activeBranch} onChange={(e) => onBranchChange(e.target.value)}>
            <option value="">All Branches</option>
            {branches.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
        </Field>
      )}
      <Field icon={Layers}>
        <select className={SELECT} value={selectedDept} onChange={(e) => onDeptChange(e.target.value)}>
          <option value="">All Departments</option>
          {departments.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
        </select>
      </Field>
      <Field icon={Search}>
        <input
          className="text-sm bg-transparent outline-none w-48 placeholder:text-gray-400"
          placeholder="Find employee…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button type="button" onClick={() => onSearchChange("")} className="text-gray-400 hover:text-gray-600">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </Field>

      <Button className="ml-auto" onClick={onPrint} disabled={printDisabled}>
        <Printer className="h-4 w-4 mr-2" /> Print Organogram
      </Button>
    </div>
  );
}
