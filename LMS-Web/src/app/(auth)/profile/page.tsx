"use client";

import { useState } from "react";
import { useProfileController } from "@/controllers/useProfileController";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { formatDate } from "@/lib/utils";
import {
  User,
  Mail,
  Phone,
  Building2,
  Briefcase,
  CalendarDays,
  CreditCard,
  Lock,
  Shield,
  Activity,
} from "lucide-react";

export default function ProfilePage() {
  const { profile, loading, changingPassword, error, success, handleChangePassword, clearMessages } =
    useProfileController();

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState("");

  function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    clearMessages();

    if (newPassword !== confirmPassword) {
      setPwError("Passwords do not match");
      return;
    }
    if (newPassword.length < 4) {
      setPwError("Password must be at least 4 characters");
      return;
    }

    handleChangePassword(oldPassword, newPassword).then(() => {
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    });
  }

  if (loading) return <Spinner />;

  const statusLabel = profile?.emp_status === "A" ? "Active" : profile?.emp_status === "D" ? "Deactive" : profile?.emp_status || "-";

  const infoFields = [
    { icon: User, label: "Full Name", value: profile?.emp_name },
    { icon: CreditCard, label: "Card No / EMP Code", value: profile?.card_no || profile?.emp_code },
    { icon: Building2, label: "Department", value: profile?.department },
    { icon: Briefcase, label: "Designation", value: profile?.designation },
    { icon: Activity, label: "Status", value: statusLabel },
    { icon: Mail, label: "Email", value: profile?.email_address },
    { icon: Phone, label: "Mobile", value: profile?.mobile_no },
    { icon: CalendarDays, label: "Date of Birth", value: formatDate(profile?.date_of_birth || "") },
    { icon: CalendarDays, label: "Date of Joining", value: formatDate(profile?.date_of_join || "") },
    { icon: User, label: "Father's Name", value: profile?.father_name },
    { icon: Shield, label: "NIC No", value: profile?.nic_no },
    { icon: Briefcase, label: "Employee Type", value: profile?.type },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader title="My Profile" subtitle="View and manage your profile" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-2xl bg-linear-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-2xl font-bold">
                  {profile?.emp_name?.charAt(0) || "U"}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{profile?.emp_name}</h2>
                  <p className="text-sm text-gray-500">{profile?.designation} - {profile?.department}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {infoFields.map((field, i) => {
                  const Icon = field.icon;
                  return (
                    <div key={i} className="flex items-center gap-3 py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                      <Icon className="h-5 w-5 text-gray-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-gray-500">{field.label}</p>
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {field.value || "-"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Change Password */}
        <Card className="h-fit">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-indigo-600" />
              <h2 className="text-lg font-semibold text-gray-900">Change Password</h2>
            </div>
          </CardHeader>
          <CardContent>
            {(error || pwError) && (
              <div className="mb-4">
                <Alert type="error" message={error || pwError} onClose={() => { clearMessages(); setPwError(""); }} />
              </div>
            )}
            {success && (
              <div className="mb-4">
                <Alert type="success" message={success} onClose={clearMessages} />
              </div>
            )}

            <form onSubmit={onChangePassword} className="space-y-4">
              <Input
                label="Current Password"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Enter current password"
                required
              />
              <Input
                label="New Password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                required
              />
              <Input
                label="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
              />
              <Button type="submit" loading={changingPassword} className="w-full">
                Update Password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
