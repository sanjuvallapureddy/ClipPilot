"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { SectionNavProvider } from "@/components/section-nav";

/**
 * Persistent app shell. Rendered once in the root layout so the sidebar stays mounted
 * across route changes (Dashboard ↔ Analytics) — that's what makes navigation smooth
 * instead of remounting/flashing the sidebar on every click.
 */
export default function AppChrome({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const r = await fetch("/api/control", { cache: "no-store" });
        if (alive) setOnline(r.ok);
      } catch {
        if (alive) setOnline(false);
      }
    };
    ping();
    const t = setInterval(ping, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <SectionNavProvider>
      <div className="flex min-h-screen bg-black">
        <Sidebar online={online} />
        {children}
      </div>
    </SectionNavProvider>
  );
}
