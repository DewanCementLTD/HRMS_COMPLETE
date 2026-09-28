"use client";

import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { AttendanceSummary } from "@/models/attendance";

interface AttendanceChartProps {
  summary: AttendanceSummary;
}

export function AttendanceChart({ summary }: AttendanceChartProps) {
  const data = [
    { name: "Present", value: summary.present, fill: "#10b981" },
    { name: "Absent", value: summary.absent_days, fill: "#ef4444" },
    { name: "Incomplete", value: summary.incomplete, fill: "#2563eb" },
  ];

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barSize={44} margin={{ top: 20, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={{ stroke: "#e6ebf3" }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              borderRadius: "12px",
              border: "1px solid #e6ebf3",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
            }}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            <LabelList dataKey="value" position="top" style={{ fontSize: 12, fontWeight: 700, fill: "#0f1e46" }} />
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
