/** Compact whole-number count: 284000 → "284K", 1_250_000 → "1.3M". */
export function compact(n: number | null | undefined): string {
  const x = Number(n);
  if (!Number.isFinite(x) || x === 0) return "0";
  const sign = x < 0 ? "-" : "";
  const abs = Math.abs(x);
  if (abs >= 1_000_000_000) return `${sign}${trim1(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}${trim1(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${trim1(abs / 1_000)}K`;
  return `${sign}${Math.round(abs)}`;
}

function trim1(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}
