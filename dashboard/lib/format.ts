// Score formatting — contract values are often 0–1 floats; mock data may be 0–100.
// Display-only rounding; underlying data is never mutated.

export function formatScore(n: number | null | undefined): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const scaled = Math.abs(x) <= 1 ? x * 100 : x;
  return Math.min(100, Math.max(0, Math.round(scaled)));
}

export function formatPercent(n: number | null | undefined): string {
  return `${formatScore(n)}%`;
}
