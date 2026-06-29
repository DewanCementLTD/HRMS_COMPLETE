"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface SidebarCtx {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
}

const Ctx = createContext<SidebarCtx>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
});

/** Shares the sidebar collapsed state so the main content can reclaim the space. */
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

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
    <Ctx.Provider value={{ collapsed, setCollapsed, toggle: () => setCollapsed((c) => !c) }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSidebar = () => useContext(Ctx);
