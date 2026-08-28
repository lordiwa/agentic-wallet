/**
 * "Hasta" end-of-day fix (AC4). The server's `to` filter is a plain string
 * comparison (`ts <= @to`, server/src/api/queries.ts) against the raw ISO
 * timestamp column. A bare calendar-day string like "2026-07-15" sorts
 * BEFORE any same-day timestamp that carries a time component (e.g.
 * "2026-07-15T10:00:00Z" -- a string that starts with the same 10
 * characters is lexicographically *greater* than the 10-character prefix
 * alone), so sending the raw `<input type="date">` value as `to` silently
 * excludes that whole day's transactions. Pushing the bound to the last
 * instant of the day makes the filter inclusive of it, as AC4 requires.
 */
export function endOfDayIso(dateOnly: string): string {
  return `${dateOnly}T23:59:59.999Z`;
}

/** Today's date and the first day of its UTC calendar month, as
 * "YYYY-MM-DD" strings -- a plain-JS approximation of the server's
 * local month range (server/src/strategy/dates.ts localMonthRange
 * is not reachable from web/-only code per this ticket's file boundary).
 * Good enough for a client-side trend chart, not a headline strategy
 * figure. */
export function currentUtcMonthRange(now: Date = new Date()): { from: string; to: string } {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return { from: `${year}-${month}-01`, to: now.toISOString().slice(0, 10) };
}
