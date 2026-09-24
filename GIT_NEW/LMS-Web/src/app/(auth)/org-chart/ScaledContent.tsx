"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type Size = { w: number; h: number };

/**
 * Renders children at their natural size, scaled by `scale`. Unlike a bare
 * `transform: scale()`, the outer box is resized to the scaled dimensions,
 * so the unscaled layout box can't overflow the page or scroll area.
 */
export function ScaledContent({
  scale, onMeasure, children,
}: {
  scale: number;
  onMeasure?: (s: Size) => void;
  children: ReactNode;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const s = { w: el.offsetWidth, h: el.offsetHeight };
      setSize((prev) => (prev && prev.w === s.w && prev.h === s.h ? prev : s));
      onMeasure?.(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure]);

  return (
    <div style={{ position: "relative", width: size ? size.w * scale : 0, height: size ? size.h * scale : 0 }}>
      <div
        ref={innerRef}
        style={{
          position: "absolute", left: 0, top: 0, width: "max-content",
          transform: `scale(${scale})`, transformOrigin: "top left",
          visibility: size ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
