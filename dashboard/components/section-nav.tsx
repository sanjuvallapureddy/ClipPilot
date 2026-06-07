"use client";
import { createContext, useContext, useMemo, useState } from "react";

/**
 * Shared tab state for the dashboard. The sidebar lives in the persistent <AppChrome>
 * shell while the section content lives in app/page.tsx, so the "which tab is active"
 * state has to be hoisted to a context both can read. Clicking a sidebar/command item
 * flips activeSection; the home page renders exactly one section for that id.
 */
interface SectionNavValue {
  activeSection: string;
  setActiveSection: (id: string) => void;
}

const SectionNavContext = createContext<SectionNavValue | null>(null);

export function SectionNavProvider({ children }: { children: React.ReactNode }) {
  const [activeSection, setActiveSection] = useState("overview");
  const value = useMemo(() => ({ activeSection, setActiveSection }), [activeSection]);
  return <SectionNavContext.Provider value={value}>{children}</SectionNavContext.Provider>;
}

export function useSectionNav(): SectionNavValue {
  const ctx = useContext(SectionNavContext);
  // Defensive fallback: every page renders inside <AppChrome> (which provides the
  // context), so this only guards against accidental out-of-tree mounts.
  if (!ctx) return { activeSection: "overview", setActiveSection: () => {} };
  return ctx;
}
