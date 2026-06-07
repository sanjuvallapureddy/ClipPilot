"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950">
        <AlertTriangle size={20} className="text-amber-400" />
      </div>
      <div className="max-w-md space-y-1">
        <h1 className="text-sm font-semibold text-neutral-100">Something went wrong</h1>
        <p className="text-xs leading-relaxed text-neutral-500">
          {error.message || "An unexpected error occurred while loading this page."}
        </p>
      </div>
      <button
        type="button"
        onClick={() => reset()}
        className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs font-medium text-neutral-200 transition-colors hover:border-neutral-700 hover:bg-neutral-900"
      >
        <RotateCcw size={14} />
        Try again
      </button>
    </div>
  );
}
