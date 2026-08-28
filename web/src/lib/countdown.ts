/**
 * Client-side day countdowns for the F2-E dashboard (AC2): days remaining
 * until next_payday and a card's fechaMaxima. Both server dates are plain
 * local calendar days ("YYYY-MM-DD", no time component) -- parsed
 * here as UTC midnight (not browser-local midnight) so the count is stable
 * regardless of the browser's own timezone, then compared against a
 * UTC-midnight "today" for a whole-day difference. Returns null when there
 * is no date to count down to (never invents a number) or the date doesn't
 * parse as YYYY-MM-DD.
 */
export function daysUntil(isoDay: string | null | undefined, now: Date = new Date()): number | null {
  if (!isoDay) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const target = Date.UTC(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(target)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / (24 * 60 * 60 * 1000));
}
