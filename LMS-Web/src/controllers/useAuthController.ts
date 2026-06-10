"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/services/authService";
import { useAuth } from "@/context/AuthContext";
import { User } from "@/models/auth";

export function useAuthController() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setUser } = useAuth();
  const router = useRouter();

  async function handleLogin(username: string, password: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await login({ username, password });
      if (response.status === "SUCCESS") {
        const user: User = {
          card_no: response.card_no,
          emp_name: response.emp_name,
          face_registered: response.face_registered,
          hr_admin: response.hr_admin,
          has_employee_features: response.has_employee_features ?? true,
          allowed_companies: response.allowed_companies ?? [],
          allowed_branches: response.allowed_branches ?? [],
          company_list: response.company_list ?? [],
          branch_list: response.branch_list ?? [],
          selected_company: response.company_list?.[0] ?? null,
          selected_branch: response.branch_list?.[0] ?? null,
        };
        setUser(user);
        localStorage.setItem("lms_user", JSON.stringify(user));
        // SEC_USERNAME users without employee profile go straight to HRMS
        router.push(user.has_employee_features ? "/dashboard" : "/hrms");
      } else {
        setError("Invalid credentials. Please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    setUser(null);
    localStorage.removeItem("lms_user");
    router.push("/");
  }

  return { handleLogin, handleLogout, loading, error };
}
