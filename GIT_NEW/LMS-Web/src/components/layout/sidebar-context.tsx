"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface SidebarCtx {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
  /** Bumped by resetView(); the shell keys the page on it. */
  resetKey: number;
  /**
   * Re-press of the nav item you are already on. Clicking a <Link> to the
   * current route is a no-op in the App Router, so a page sitting in an inner
   * view (HRMS editing an employee, a report drilled into) would just stay
   * there. Bumping the key remounts the page subtree, which drops that local
   * state and lands back on the section's own home view.
   */
  resetView: () => void;
}

const Ctx = createContext<SidebarCtx>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
  resetKey: 0,
  resetView: () => {},
});

/** Shares the sidebar collapsed state so the main content can reclaim the space. */
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("sidebar-collapsed") === "1") {
      setCollapsed(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
    }
  }, [collapsed]);

  return (
    <Ctx.Provider
      value={{
        collapsed,
        setCollapsed,
        toggle: () => setCollapsed((c) => !c),
        resetKey,
        resetView: () => setResetKey((k) => k + 1),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useSidebar = () => useContext(Ctx);
