"use client";

import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

interface AlertProps {
  type: "success" | "error";
  message: string;
  onClose?: () => void;
}

export function Alert({ type, message, onClose }: AlertProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-xl text-sm",
        type === "success" && "bg-emerald-50 text-emerald-800 border border-emerald-200",
        type === "error" && "bg-red-50 text-red-800 border border-red-200"
      )}
    >
      {type === "success" ? (
        <CheckCircle2 className="h-5 w-5 shrink-0" />
      ) : (
        <AlertCircle className="h-5 w-5 shrink-0" />
      )}
      <span className="flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} className="shrink-0 hover:opacity-70">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
