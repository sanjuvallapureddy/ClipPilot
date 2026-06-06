"use client";

/**
 * Ultra-low-opacity drifting color blobs. Sits behind the header to add depth
 * without leaving the true-black canvas. Purely decorative + pointer-transparent.
 */
export default function Aurora() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="aurora-blob bg-blue-500/10"
        style={{ width: 240, height: 240, top: -120, left: "12%", animationDuration: "14s" }}
      />
      <div
        className="aurora-blob bg-emerald-500/10"
        style={{ width: 200, height: 200, top: -90, left: "44%", animationDuration: "18s", animationDelay: "-4s" }}
      />
      <div
        className="aurora-blob bg-violet-500/10"
        style={{ width: 220, height: 220, top: -110, right: "16%", animationDuration: "16s", animationDelay: "-8s" }}
      />
    </div>
  );
}
