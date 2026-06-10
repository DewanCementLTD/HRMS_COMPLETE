"use client";

import { cn } from "@/lib/utils";
import { getStatusColor } from "@/lib/utils";

interface BadgeProps {
  status: string;
  className?: string;
}

export function Badge({ status, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold",
        getStatusColor(status),
        className
      )}
    >
      {status}
    </span>
  );
}
