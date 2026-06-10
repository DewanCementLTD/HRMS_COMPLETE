"use client";

import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div
        className={cn(
          "h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600",
          className
        )}
      />
    </div>
  );
}
