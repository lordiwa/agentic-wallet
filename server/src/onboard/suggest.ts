/**
 * "What do your own transactions say your profile should be?" — the evidence
 * half of `npm run onboard`.
 *
 * Everything here is derived from the user's already-synced ledger and
 * nothing else. No shipped defaults, no invented figures: if the ledger has
 * no salary deposits, `salary` is null and the agent asks instead of
 * guessing. That is the whole contract — a suggestion is a *reading of the
 * user's data*, and the user (or the agent on their behalf) always confirms
 * it before `setStrategyConfig` writes anything.
 *
 * Pure and read-only: opens no files, writes no rows, prints nothing. cli.ts
 * owns all I/O, which is what makes these rules testable.
 */
import type Database from "better-sqlite3";
import { topUncategorizedCounterparties, type UncategorizedCounterparty } from "../category/rules-repository.js";

export interface SalarySuggestion {
  /** Where the deposits come from, as the bank writes it. */
  fuente: string;
  /** "quincenal" when deposits cluster on two days a month, else "mensual". */
  cadencia: string;
  /** Median deposit amount -- median, not mean, so one bonus doesn't skew it. */
  montoEstimado: number;
  /** Day-of-month strings, e.g. ["15", "30"]. */
  diasPago: string[];
  /** How many deposits this reading is based on -- the agent should say this out loud. */
  sampleSize: number;
}

export interface OnboardSuggestions {
  /** Most frequent account-holder spelling seen in the ledger, or null. */
  titular: string | null;
  /** Salary reading, or null when there are no income rows to read. */
  salary: SalarySuggestion | null;
  /** Merchants currently landing in 'otros', biggest spend first. */
  uncategorized: UncategorizedCounterparty[];
  /** Average monthly outgoing spend, for proposing a colchon. Null if <1 month of data. */
  gastoMensualPromedio: number | null;
  /** Months of history the ledger actually covers. */
  mesesDeHistorial: number;
}

/** Median of a non-empty numeric list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * The account holder as the bank spells it, read off the `account` column of
 * the user's own rows. Returns the most frequent non-empty value; null when
 * the ledger has none. The strategy engine uses this to recognise the user's
 * own transfers as internal, so a wrong value silently mis-classifies
 * money -- which is exactly why this is a suggestion to confirm, not an
 * automatic write.
 */
export function suggestTitular(db: Database.Database): string | null {
  const row = db
    .prepare(
      `SELECT account, COUNT(*) as c FROM transactions
        WHERE account IS NOT NULL AND TRIM(account) != ''
        GROUP BY account ORDER BY c DESC LIMIT 1`
    )
    .get() as { account: string; c: number } | undefined;
  return row?.account ?? null;
}

/**
 * Reads the salary from incoming `sueldo` rows: who pays, how much, and on
 * which days of the month.
 *
 * `cadencia` is inferred from the number of distinct paydays rather than
 * asked: two recurring days a month is "quincenal", anything else "mensual".
 * A day only counts as a payday if it shows up more than once, so a one-off
 * deposit on the 3rd never becomes a permanent payday -- unless it is all
 * the evidence there is, in which case the observed days are used as-is and
 * `sampleSize` tells the agent how thin the reading is.
 */
export function suggestSalary(db: Database.Database): SalarySuggestion | null {
  const rows = db
    .prepare(
      `SELECT ts, amount, counterparty FROM transactions
        WHERE direction = 'in' AND type = 'sueldo' AND is_reversed = 0
        ORDER BY ts ASC`
    )
    .all() as { ts: string; amount: number; counterparty: string | null }[];

  if (rows.length === 0) return null;

  const dayCounts = new Map<string, number>();
  for (const row of rows) {
    // ts is an ISO instant; the day-of-month is what payday means to a human.
    const day = String(new Date(row.ts).getUTCDate());
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  const recurring = [...dayCounts.entries()].filter(([, count]) => count > 1).map(([day]) => day);
  const diasPago = (recurring.length > 0 ? recurring : [...dayCounts.keys()]).sort(
    (a, b) => Number(a) - Number(b)
  );

  const fuenteCounts = new Map<string, number>();
  for (const row of rows) {
    const name = row.counterparty?.trim();
    if (name) fuenteCounts.set(name, (fuenteCounts.get(name) ?? 0) + 1);
  }
  const fuente = [...fuenteCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  return {
    fuente,
    cadencia: diasPago.length === 2 ? "quincenal" : "mensual",
    montoEstimado: Math.round(median(rows.map((r) => r.amount)) * 100) / 100,
    diasPago,
    sampleSize: rows.length,
  };
}

/**
 * Average monthly outgoing spend, and how many months of history back it.
 * This is the evidence behind a colchon proposal ("3x your monthly spend"),
 * but the multiplier is a decision for the user, not for this function --
 * it deliberately returns the observed figure and nothing derived from it.
 *
 * Returns a null average when the ledger covers less than a full month:
 * dividing two weeks of spending into a "monthly" figure would understate it
 * by half, and a colchon built on that number is worse than no proposal.
 */
export function suggestSpendBaseline(db: Database.Database): {
  gastoMensualPromedio: number | null;
  mesesDeHistorial: number;
} {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total, MIN(ts) as first_ts, MAX(ts) as last_ts
         FROM transactions
        WHERE direction = 'out' AND is_reversed = 0 AND is_internal = 0 AND needs_review = 0`
    )
    .get() as { total: number; first_ts: string | null; last_ts: string | null };

  if (!row.first_ts || !row.last_ts) return { gastoMensualPromedio: null, mesesDeHistorial: 0 };

  const days = (new Date(row.last_ts).getTime() - new Date(row.first_ts).getTime()) / 86_400_000;
  const months = days / 30.44;
  if (months < 1) return { gastoMensualPromedio: null, mesesDeHistorial: Math.round(months * 10) / 10 };

  return {
    gastoMensualPromedio: Math.round((row.total / months) * 100) / 100,
    mesesDeHistorial: Math.round(months * 10) / 10,
  };
}

/** Everything the onboarding agent needs to propose a profile, in one read. */
export function buildSuggestions(db: Database.Database): OnboardSuggestions {
  const baseline = suggestSpendBaseline(db);
  return {
    titular: suggestTitular(db),
    salary: suggestSalary(db),
    uncategorized: topUncategorizedCounterparties(db),
    ...baseline,
  };
}
