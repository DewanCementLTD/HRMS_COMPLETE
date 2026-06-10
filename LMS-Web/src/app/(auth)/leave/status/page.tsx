"use client";

import { useState } from "react";
import { useLeaveController } from "@/controllers/useLeaveController";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/utils";
import { ClipboardList, RefreshCw, Filter } from "lucide-react";

export default function LeaveStatusPage() {
  const { leaveHistory, leaveBalances, loading, refresh } = useLeaveController();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filtered =
    statusFilter === "ALL"
      ? leaveHistory
      : leaveHistory.filter(
          (l) => l.status?.toUpperCase() === statusFilter
        );

  if (loading) return <Spinner />;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Leave Status"
        subtitle="Track your leave applications"
        actions={
          <Button variant="secondary" size="sm" onClick={refresh}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
        }
      />

      {/* Leave Balance Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {leaveBalances.map((lb, i) => (
          <Card key={i}>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-indigo-600">{lb.balance}</p>
              <p className="text-xs text-gray-500 mt-1">
                {lb.leave_desc || `Type ${lb.leave_type}`}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter & Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-indigo-600" />
              <h2 className="text-lg font-semibold text-gray-900">Leave Applications</h2>
              <span className="text-sm text-gray-400">({filtered.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">All Status</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No leave applications found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Type</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">From</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">To</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Days</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Reason</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-6 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((leave, i) => (
                    <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {leave.leave_desc || leave.leave_type}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatDate(leave.from_date)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {formatDate(leave.to_date)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {leave.leave_days}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 max-w-[200px] truncate">
                        {leave.reason}
                      </td>
                      <td className="px-6 py-4">
                        <Badge status={leave.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
