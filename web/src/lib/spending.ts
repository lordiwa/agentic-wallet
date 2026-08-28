/**
 * Pure helpers behind the daily-spend-vs-average line chart (AC3). Kept
 * dependency-free (no chart library, see SpendingCharts.tsx's doc comment)
 * and separate from React so the aggregation logic is unit-testable without
 * jsdom.
 */
export interface DailyTotal {
  day: string;
  total: number;
}

/** UTC calendar-day key ("YYYY-MM-DD") for an ISO timestamp, or null if `ts`
 * doesn't parse -- never throws. */
export function utcDayKey(ts: string): string | null {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Sums `amount` per UTC day across `[from, to]` (both "YYYY-MM-DD",
 * inclusive), producing one entry per calendar day in the range -- days
 * with no matching transaction get `total: 0` rather than being omitted, so
 * the line chart shows a continuous trend instead of skipping gaps.
 * Transactions outside the range or with an unparseable `ts` are ignored.
 */
export function dailyTotals(transactions: { ts: string; amount: number }[], from: string, to: string): DailyTotal[] {
  const totals = new Map<string, number>();
  for (const tx of transactions) {
    const key = utcDayKey(tx.ts);
    if (key === null) continue;
    totals.set(key, (totals.get(key) ?? 0) + tx.amount);
  }

  const days: DailyTotal[] = [];
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return days;

  for (let ms = fromMs; ms <= toMs; ms += 24 * 60 * 60 * 1000) {
    const key = new Date(ms).toISOString().slice(0, 10);
    days.push({ day: key, total: totals.get(key) ?? 0 });
  }
  return days;
}

/** Arithmetic mean, or 0 for an empty list (never divides by zero). */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
