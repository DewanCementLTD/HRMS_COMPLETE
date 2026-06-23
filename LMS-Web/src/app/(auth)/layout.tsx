"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Spinner } from "@/components/ui/Spinner";

// Pages that require an employee record in HR_EMP_MASTER.
// Note: /dashboard is intentionally NOT in this list — SEC_USERNAME-only HR
// admins should still be able to view the HR dashboard there.
const EMPLOYEE_ONLY_ROUTES = ["/leave", "/attendance", "/profile"];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.push("/");
      return;
    }
    // SEC_USERNAME users without an employee profile can't access employee pages
    // Use !user.has_employee_features to also catch undefined (old localStorage entries)
    if (!user.has_employee_features) {
      const isEmployeePage = EMPLOYEE_ONLY_ROUTES.some((r) => pathname.startsWith(r));
      if (isEmployeePage) router.push("/hrms");
    }
  }, [user, isLoading, router, pathname]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen relative">
      {/* Background image with dark overlay */}
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/background.png')" }}
      />
      <div className="fixed inset-0 bg-gray-900/80 backdrop-blur-sm" />

      {/* Content */}
      <div className="relative z-10">
        <Sidebar />
        {/* min-w-0 + overflow-x-clip stop any over-wide child (long location rows,
            action button groups, wide tables) from pushing the whole shell
            sideways and misaligning the page. Tables keep their own
            overflow-x-auto wrappers, so they still scroll internally. */}
        <main className="lg:pl-64 transition-all duration-300 min-w-0 overflow-x-clip">
          <div className="p-6 lg:p-8 max-w-7xl mx-auto min-w-0">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
