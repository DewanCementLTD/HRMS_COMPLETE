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
  const { leaveTypes, leaveBalances, loading, submitting, error, success, submitLeave, clearMessages } =
    useLeaveController();

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [reason, setReason] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<"first" | "second">("first");

  function resetForm() {
    setFromDate("");
    setToDate("");
    setLeaveType("");
    setReason("");
    setHalfDay(false);
    setHalfDaySession("first");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    clearMessages();
    // A half day is a single date, so "To Date" isn't collected — the server
    // takes to_date = from_date and books 0.5 days.
    if (!fromDate || !leaveType || !reason.trim()) return;
    // The checkbox is hidden for OD types, so ignore a flag left over from a
    // previous selection.
    const useHalfDay = halfDay && !selected?.is_od;
    if (!useHalfDay && !toDate) return;
    submitLeave({
      from_date: fromDate,
      to_date: useHalfDay ? fromDate : toDate,
      type: leaveType,
      reason: reason.trim(),
      ...(useHalfDay ? { half_day: true, half_day_session: halfDaySession } : {}),
    });
  }

  function handleSuccess() {
    resetForm();
    clearMessages();
  }

  if (loading) return <Spinner />;

  // OD types are unlimited (no balance restriction); other types only show
  // when they actually have balance available.
  // The PK is what gets submitted: leave codes aren't unique in LEAVE_TYPES
  // (e.g. 'CL' appears more than once), so posting the code could resolve to
  // the wrong row.
  const leaveOptions = leaveTypes
    .filter((lt) => lt.is_od || lt.balance > 0)
    .map((lt) => ({
      value: String(lt.leave_type_pk),
      label: lt.is_od
        ? `${lt.leave_desc || lt.leave_type} (No limit)`
        : `${lt.leave_desc || lt.leave_type} (Balance: ${Math.max(0, lt.balance)})`,
    }));

  const selected = leaveTypes.find((lt) => String(lt.leave_type_pk) === leaveType);
  const visibleBalances = leaveBalances.filter((b) => !b.is_od);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Apply for Leave"
        subtitle="Submit a new leave request"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <Card className="lg:col-span-2">
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

              {/* Half day is a single date booked as 0.5 days; OD types are
                  full-day only, so the option hides for them. */}
              {!selected?.is_od && (
                <label className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={halfDay}
                    onChange={(e) => { setHalfDay(e.target.checked); if (e.target.checked) setToDate(""); }}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-400"
                  />
                  Apply for a half day
                </label>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={halfDay ? "Date" : "From Date"}
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  required
                />
                {halfDay ? (
                  <Select
                    label="Session"
                    options={[
                      { value: "first", label: "First half (09:30 – 13:00)" },
                      { value: "second", label: "Second half (13:00 – 18:00)" },
                    ]}
                    value={halfDaySession}
                    onChange={(e) => setHalfDaySession(e.target.value as "first" | "second")}
                  />
                ) : (
                  <Input
                    label="To Date"
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    min={fromDate}
                    required
                  />
                )}
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
                  onClick={() => { resetForm(); clearMessages(); }}
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

        {/* Live balances — same feed the status page uses. */}
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-gray-900">Leave Balances</h2>
          </CardHeader>
          <CardContent>
            {visibleBalances.length === 0 ? (
              <p className="text-sm text-gray-400">No balances available.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {visibleBalances.map((b) => (
                  <li key={b.leave_type_pk ?? b.leave_type} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-gray-700 truncate pr-3">
                      {b.leave_desc || b.leave_type}
                    </span>
                    <span className={`text-sm font-semibold tabular-nums ${
                      b.balance > 0 ? "text-emerald-600" : "text-gray-400"
                    }`}>
                      {b.balance}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
