"use client";

import { useEffect } from "react";

export default function GlobalError({
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
    <html lang="en">
      <body className="bg-black font-sans text-neutral-100 antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-sm font-semibold">ClipPilot hit an error</h1>
          <p className="max-w-md text-xs text-neutral-500">
            {error.message || "The application encountered an unexpected error."}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900"
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
