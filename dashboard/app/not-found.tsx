import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 text-center">
      <p className="text-4xl font-semibold tabular-nums text-neutral-800">404</p>
      <div className="space-y-1">
        <h1 className="text-sm font-semibold text-neutral-100">Page not found</h1>
        <p className="text-xs text-neutral-500">This route doesn&apos;t exist in ClipPilot.</p>
      </div>
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-700 hover:bg-neutral-900"
      >
        <ArrowLeft size={14} />
        Back to dashboard
      </Link>
    </div>
  );
}
