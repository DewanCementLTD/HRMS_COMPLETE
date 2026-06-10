"use client";

import { cn } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  labelClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, labelClassName, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className={cn("block text-sm font-medium text-gray-700", labelClassName)}>{label}</label>
        )}
        <input
          ref={ref}
          className={cn(
            "w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900",
            "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent",
            "placeholder:text-gray-400 transition-all duration-200",
            error && "border-red-400 focus:ring-red-500",
            className
          )}
          {...props}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
