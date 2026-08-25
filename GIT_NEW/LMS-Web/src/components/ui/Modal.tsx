"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const WIDTHS = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
} as const;

/**
 * Dialog shell for the app's popups.
 *
 * Rendered through a portal on `document.body` on purpose: page content sits
 * inside `.animate-fade-in`, whose keyframe ends on `transform: translateY(0)`
 * with `forwards`. A retained transform makes that element the containing block
 * for `position: fixed` children, so a dialog written inline is sized and
 * clipped against the panel instead of the viewport (the `<main>` wrapper's
 * `overflow-x-clip` compounds it). Portalling escapes both.
 *
 * The shell is a column capped at 90vh: header and footer stay put and only the
 * body scrolls, so a tall dialog never runs off-screen.
 */
export function Modal({
  open = true,
  title,
  subtitle,
  size = "md",
  onClose,
  footer,
  children,
  bodyClassName,
}: {
  open?: boolean;
  title: string;
  subtitle?: React.ReactNode;
  size?: keyof typeof WIDTHS;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  // Escape closes; the page behind must not scroll while a dialog is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Dialogs only ever open from a user action, so there is nothing to render
  // during SSR and no portal target either.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn(
          "bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[90vh] min-h-0",
          WIDTHS[size],
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 shrink-0 rounded-lg p-1 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={cn("flex-1 min-h-0 overflow-y-auto p-5", bodyClassName)}>{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-gray-100 bg-gray-50/70 rounded-b-2xl shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
