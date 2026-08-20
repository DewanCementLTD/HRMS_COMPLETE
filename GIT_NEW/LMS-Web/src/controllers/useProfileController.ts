"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { fetchProfile, changePassword } from "@/services/authService";
import { EmployeeProfile } from "@/models/employee";

export function useProfileController() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [changingPassword, setChangingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await fetchProfile(user.card_no);
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function handleChangePassword(oldPassword: string, newPassword: string) {
    if (!user) return;
    setChangingPassword(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await changePassword(user.card_no, oldPassword, newPassword);
      setSuccess(res.message || "Password changed successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setChangingPassword(false);
    }
  }

  return {
    profile,
    loading,
    changingPassword,
    error,
    success,
    handleChangePassword,
    clearMessages: () => { setError(null); setSuccess(null); },
  };
}
