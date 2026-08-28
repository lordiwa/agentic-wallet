/**
 * transferenciasMes (spec §9.6): outgoing person-to-person transfers in the
 * current local calendar month against `topeTransferenciasMensual`.
 */
import type Database from "better-sqlite3";
import { getStrategyConfig } from "../db/strategy-config.js";
import { localMonthRange } from "./dates.js";
import { fromCents, toCents } from "./money.js";
import { EXCLUDE_FROM_TOTALS_SQL } from "./totals.js";

export interface CounterpartyTotal {
  counterparty: string;
  total: number;
}

export interface TransferenciasMesStatus {
  total: number;
  tope: number;
  restante: number;
  sobrepasado: boolean;
  topContrapartes: CounterpartyTotal[];
}

/** How many counterparties `topContrapartes` reports -- the spec names no
 * N, so this is a documented cap rather than an unbounded list. */
const TOP_COUNTERPARTIES_LIMIT = 5;

/**
 * transferenciasMes (spec §9.6): `type = 'transferencia'`, `is_internal = 0`
 * (spec-named), `direction = 'out'` (a cap on money sent, not received),
 * within the current local calendar month, plus the shared totals
 * exclusions (is_reversed/needs_review/reverso). `restante` can be negative
 * once `sobrepasado` is true. `topContrapartes` is sorted descending by
 * total, capped at `TOP_COUNTERPARTIES_LIMIT`.
 */
export function transferenciasMes(db: Database.Database, now: Date = new Date()): TransferenciasMesStatus {
  const config = getStrategyConfig(db);
  const { from, to } = localMonthRange(now);

  const rows = db
    .prepare(
      `SELECT counterparty, amount FROM transactions
       WHERE type = 'transferencia' AND is_internal = 0 AND direction = 'out'
         AND ts >= @from AND ts < @to AND ${EXCLUDE_FROM_TOTALS_SQL}`
    )
    .all({ from: from.toISOString(), to: to.toISOString() }) as { counterparty: string | null; amount: number }[];

  let totalCents = 0;
  const byCounterparty = new Map<string, number>();
  for (const row of rows) {
    const cents = toCents(row.amount);
    totalCents += cents;
    const key = row.counterparty ?? "otros";
    byCounterparty.set(key, (byCounterparty.get(key) ?? 0) + cents);
  }

  const topContrapartes: CounterpartyTotal[] = Array.from(byCounterparty.entries())
    .map(([counterparty, cents]) => ({ counterparty, total: fromCents(cents) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_COUNTERPARTIES_LIMIT);

  const topeCents = toCents(config.topeTransferenciasMensual);

  return {
    total: fromCents(totalCents),
    tope: fromCents(topeCents),
    restante: fromCents(topeCents - totalCents),
    sobrepasado: totalCents > topeCents,
    topContrapartes,
  };
}
