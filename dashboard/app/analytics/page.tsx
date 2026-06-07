"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, ArrowLeft } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";
import Aurora from "@/components/Aurora";

export default function AnalyticsPage() {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/control");
        setOnline(r.ok);
      } catch {
        setOnline(false);
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex min-h-screen bg-black">
      <Sidebar online={online} />

      <div className="flex h-screen min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-neutral-900 bg-black/50 px-6 backdrop-blur-md">
          <Aurora />
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950">
              <BarChart3 size={15} className="text-blue-400" />
            </span>
            <div className="flex flex-col leading-tight">
              <h1 className="text-sm font-semibold tracking-tight text-neutral-100">
                Analytics
              </h1>
              <span className="text-[11px] text-neutral-500">
                research → visual intelligence
              </span>
            </div>
          </div>

          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-100"
          >
            <ArrowLeft size={13} />
            Mission control
          </Link>
        </header>

        <AnalyticsDashboard />
      </div>
    </div>
  );
}
