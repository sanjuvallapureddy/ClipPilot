"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { MessagesSquare, ArrowLeft } from "lucide-react";
import TeamChat from "@/components/TeamChat";
import Aurora from "@/components/Aurora";

export default function ChatPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden"
    >
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-neutral-900 bg-black/50 px-6 backdrop-blur-md">
        <Aurora />
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950">
            <MessagesSquare size={15} className="text-indigo-400" />
          </span>
          <div className="flex flex-col leading-tight">
            <h1 className="text-sm font-semibold tracking-tight text-neutral-100">Slack</h1>
            <span className="text-[11px] text-neutral-500">
              four peer agents collaborating — no orchestrator
            </span>
          </div>
        </div>

        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-100"
        >
          <ArrowLeft size={13} />
          Dashboard
        </Link>
      </header>

      <TeamChat />
    </motion.div>
  );
}
