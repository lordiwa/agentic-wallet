/**
 * spending_by_category (spec §9.8): totals GASTO only -- `direction = 'out'`
 * -- grouped by F2-B's `categorize()`.
 */
import type Database from "better-sqlite3";
import { categorize } from "../category/categorize.js";
import type { Category } from "../category/categorize.js";
import { listCategoryRules } from "../category/rules-repository.js";
import { fromCents, toCents } from "./money.js";
import { EXCLUDE_FROM_TOTALS_SQL } from "./totals.js";

export interface SpendingPeriodo {
  /** [from, to) half-open UTC-instant bounds. */
  from: Date;
  to: Date;
}

/**
 * spending_by_category (spec §9.8). `direction = 'out'` is the F2-B review's
 * critical fix -- sueldo/recibido income also lands in category='otros', so
 * without this filter paychecks would inflate the 'otros' bucket -- plus the
 * shared totals exclusions (internal/reversed/needs_review/reverso).
 *
 * Category is computed live via `categorize()` off each row's
 * type/counterparty/is_internal rather than trusting a possibly
 * unbackfilled `category` column, so this stays correct even before
 * F2-B's backfill has run over older rows.
 *
 * Only categories with at least one matching row appear in the result
 * (no zero-filled entries for the rest of the glossary).
 */
export function spendingByCategory(db: Database.Database, periodo: SpendingPeriodo): Partial<Record<Category, number>> {
  const rows = db
    .prepare(
      `SELECT type, counterparty, is_internal, amount FROM transactions
       WHERE direction = 'out' AND ts >= @from AND ts < @to AND ${EXCLUDE_FROM_TOTALS_SQL}`
    )
    .all({ from: periodo.from.toISOString(), to: periodo.to.toISOString() }) as {
    type: string;
    counterparty: string | null;
    is_internal: number;
    amount: number;
  }[];

  const rules = listCategoryRules(db);
  const totalsCents = new Map<Category, number>();
  for (const row of rows) {
    const category = categorize(
      { type: row.type, counterparty: row.counterparty, is_internal: row.is_internal === 1 },
      rules
    );
    totalsCents.set(category, (totalsCents.get(category) ?? 0) + toCents(row.amount));
  }

  const result: Partial<Record<Category, number>> = {};
  for (const [category, cents] of totalsCents) {
    result[category] = fromCents(cents);
  }
  return result;
}
