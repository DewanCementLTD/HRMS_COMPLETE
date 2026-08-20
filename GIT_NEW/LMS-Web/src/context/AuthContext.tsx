"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { User, CompanyItem, BranchItem } from "@/models/auth";

interface AuthContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  switchCompany: (company: CompanyItem) => void;
  switchBranch: (branch: BranchItem) => void;
  isLoading: boolean;
  activeCompany: string;
  activeBranch: string;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  setUser: () => {},
  switchCompany: () => {},
  switchBranch: () => {},
  isLoading: true,
  activeCompany: "",
  activeBranch: "",
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("lms_user");
    if (stored) {
      try {
        setUserState(JSON.parse(stored));
      } catch {
        localStorage.removeItem("lms_user");
      }
    }
    setIsLoading(false);
  }, []);

  function setUser(u: User | null) {
    setUserState(u);
    if (u) {
      localStorage.setItem("lms_user", JSON.stringify(u));
    }
  }

  function switchCompany(company: CompanyItem) {
    if (!user) return;
    // Branches belong to a company, so switching company resets the branch to
    // "All" — the branch switcher then only offers this company's branches.
    const updated = { ...user, selected_company: company, selected_branch: null };
    setUserState(updated);
    localStorage.setItem("lms_user", JSON.stringify(updated));
  }

  function switchBranch(branch: BranchItem) {
    if (!user) return;
    const updated = { ...user, selected_branch: branch };
    setUserState(updated);
    localStorage.setItem("lms_user", JSON.stringify(updated));
  }

  const activeCompany = user?.selected_company?.code ?? "";
  const activeBranch = user?.selected_branch?.code ?? "";

  return (
    <AuthContext.Provider value={{ user, setUser, switchCompany, switchBranch, isLoading, activeCompany, activeBranch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
