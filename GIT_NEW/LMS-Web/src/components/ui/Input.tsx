"use client";

import { cn, groupDigits } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef, useLayoutEffect, useRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  labelClassName?: string;
  /**
   * Amount field: shows thousands separators while typing (50,000) but hands
   * the parent the plain number string ("50000") in onChange. Needs a
   * controlled `value`.
   */
  amount?: boolean;
}

const AMOUNT_RE = /^-?\d*\.?\d*$/;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, labelClassName, amount, ...props }, ref) => {
    const innerRef = useRef<HTMLInputElement | null>(null);
    // Digits before the caret at the last keystroke, so re-adding commas
    // doesn't throw the caret to the end when editing mid-number.
    const caretDigits = useRef<number | null>(null);

    const setRefs = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    };

    const shown = amount && props.value !== undefined && props.value !== null ? groupDigits(String(props.value)) : undefined;

    useLayoutEffect(() => {
      const el = innerRef.current;
      const want = caretDigits.current;
      if (!amount || !el || want === null || document.activeElement !== el) return;
      caretDigits.current = null;
      let pos = 0;
      for (let seen = 0; pos < el.value.length && seen < want; pos++) if (el.value[pos] !== ",") seen++;
      el.setSelectionRange(pos, pos);
    }, [amount, shown]);

    const amountProps: InputHTMLAttributes<HTMLInputElement> = amount
      ? {
          type: "text",
          inputMode: "decimal",
          autoComplete: "off",
          ...(shown !== undefined ? { value: shown } : {}),
          onChange: (e) => {
            const typed = e.target.value;
            const raw = typed.replace(/,/g, "");
            if (!AMOUNT_RE.test(raw)) return;
            const caret = e.target.selectionStart ?? typed.length;
            caretDigits.current = typed.slice(0, caret).replace(/,/g, "").length;
            e.target.value = raw;
            props.onChange?.(e);
          },
        }
      : {};

    return (
      <div className="space-y-1.5">
        {label && (
          <label className={cn("block text-sm font-medium text-gray-700", labelClassName)}>{label}</label>
        )}
        <input
          ref={setRefs}
          className={cn(
            "w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900",
            "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent",
            "placeholder:text-gray-400 transition-all duration-200",
            amount && "tabular-nums",
            error && "border-red-400 focus:ring-red-500",
            className
          )}
          {...props}
          {...amountProps}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
