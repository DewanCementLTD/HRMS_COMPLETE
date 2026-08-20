"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { searchEmployees } from "@/services/hrService";
import { EmployeeSearchResult } from "@/models/employee";

export function useHRController() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<EmployeeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(query: string) {
    if (!user || !query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await searchEmployees(query, user.card_no);
      setEmployees(res.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return { employees, loading, error, search };
}
