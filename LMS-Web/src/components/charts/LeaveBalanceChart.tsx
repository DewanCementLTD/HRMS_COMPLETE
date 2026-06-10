"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { LeaveBalance } from "@/models/leave";

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#818cf8", "#6d28d9"];

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
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
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
              border: "1px solid #e5e7eb",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
