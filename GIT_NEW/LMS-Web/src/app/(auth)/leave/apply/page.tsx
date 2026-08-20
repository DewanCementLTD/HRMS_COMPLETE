"use client";

import { useState, FormEvent } from "react";
import { useLeaveController } from "@/controllers/useLeaveController";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { CalendarPlus } from "lucide-react";

export default function ApplyLeavePage() {
  const { leaveTypes, loading, submitting, error, success, submitLeave, clearMessages } =
    useLeaveController();

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [reason, setReason] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearMessages();
    if (!fromDate || !toDate || !leaveType || !reason.trim()) return;
    submitLeave({
      from_date: fromDate,
      to_date: toDate,
      type: leaveType,
      reason: reason.trim(),
    });
  }

  function handleSuccess() {
    setFromDate("");
    setToDate("");
    setLeaveType("");
    setReason("");
    clearMessages();
  }

  if (loading) return <Spinner />;

  // OD types are unlimited (no balance restriction); other types only show
  // when they actually have balance available.
  const leaveOptions = leaveTypes
    .filter((lt) => lt.is_od || lt.balance > 0)
    .map((lt) => ({
      value: lt.leave_type,
      label: lt.is_od
        ? `${lt.leave_desc || lt.leave_type} (No limit)`
        : `${lt.leave_desc || lt.leave_type} (Balance: ${Math.max(0, lt.balance)})`,
    }));

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Apply for Leave"
        subtitle="Submit a new leave request"
      />

      <div className="max-w-2xl">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarPlus className="h-5 w-5 text-indigo-600" />
              <h2 className="text-lg font-semibold text-gray-900">Leave Application Form</h2>
            </div>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4">
                <Alert type="error" message={error} onClose={clearMessages} />
              </div>
            )}
            {success && (
              <div className="mb-4">
                <Alert type="success" message={success} onClose={handleSuccess} />
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-5">
              <Select
                label="Leave Type"
                options={leaveOptions}
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value)}
                required
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="From Date"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  required
                />
                <Input
                  label="To Date"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  min={fromDate}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">Reason</label>
                <textarea
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-gray-400 transition-all duration-200 min-h-[100px] resize-y"
                  placeholder="Enter your reason for leave..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                    setLeaveType("");
                    setReason("");
                    clearMessages();
                  }}
                >
                  Reset
                </Button>
                <Button type="submit" loading={submitting}>
                  Submit Application
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
