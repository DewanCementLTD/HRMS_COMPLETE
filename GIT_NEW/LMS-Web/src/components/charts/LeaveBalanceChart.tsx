"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { LeaveBalance } from "@/models/leave";

export const LEAVE_CHART_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ef4444"];
const COLORS = LEAVE_CHART_COLORS;

interface LeaveBalanceChartProps {
  balances: LeaveBalance[];
}

export function LeaveBalanceChart({ balances }: LeaveBalanceChartProps) {
  // Only show leaves with positive balance — negative means 0 available
  const data = balances
    .filter((b) => b.balance > 0)
    .map((b) => ({
      name: b.leave_desc || `Type ${b.leave_type}`,
      value: Math.max(0, b.balance),
    }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        No leave balance data
      </div>
    );
  }

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((_, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              borderRadius: "12px",
              border: "1px solid #e6ebf3",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
