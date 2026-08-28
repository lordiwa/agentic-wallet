/**
 * Reads and writes the user's own merchant rules (`category_rules`), the
 * data behind `categorize`'s rule 6.
 *
 * Patterns are stored already normalized (see `toRulePattern`), so a lookup
 * never has to normalize both sides at query time and `pattern`'s UNIQUE
 * constraint really does mean "one rule per merchant" regardless of how the
 * bank cased or accented it in any given email.
 */
import type Database from "better-sqlite3";
import { toRulePattern, type Category, type EstablishmentRule } from "./categorize.js";

interface CategoryRuleRow {
  pattern: string;
  category: string;
}

/**
 * Every configured rule, longest pattern first. Longest-first matters:
 * "farmacia san jose" must win over a broader "farmacia" rule, and
 * `categorize` takes the first match it finds.
 */
export function listCategoryRules(db: Database.Database): EstablishmentRule[] {
  const rows = db
    .prepare("SELECT pattern, category FROM category_rules ORDER BY LENGTH(pattern) DESC, pattern ASC")
    .all() as CategoryRuleRow[];
  return rows.map((row) => ({ pattern: row.pattern, category: row.category as Category }));
}

/**
 * Adds or updates one rule, keyed on the normalized pattern. Returns false
 * (writing nothing) for a blank pattern -- an empty pattern is a substring of
 * every counterparty, so it would swallow the entire ledger into one
 * category.
 */
export function upsertCategoryRule(db: Database.Database, rawPattern: string, category: Category): boolean {
  const pattern = toRulePattern(rawPattern);
  if (pattern === "") return false;

  db.prepare(
    `INSERT INTO category_rules (pattern, category, created_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(pattern) DO UPDATE SET category = excluded.category`
  ).run(pattern, category);
  return true;
}

export interface UncategorizedCounterparty {
  counterparty: string;
  /** How many transactions share this counterparty. */
  count: number;
  /** Total amount spent with it, for ranking by what actually matters. */
  total: number;
}

/**
 * The counterparties currently landing in `'otros'`, ranked by money spent --
 * i.e. exactly the list worth asking a human about, biggest impact first.
 * Only outgoing rows are considered: income has no merchant to classify.
 */
export function topUncategorizedCounterparties(
  db: Database.Database,
  limit = 15
): UncategorizedCounterparty[] {
  return db
    .prepare(
      `SELECT counterparty, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
         FROM transactions
        WHERE direction = 'out'
          AND counterparty IS NOT NULL AND TRIM(counterparty) != ''
          AND (category IS NULL OR category = '' OR category = 'otros')
          AND is_reversed = 0
        GROUP BY counterparty
        ORDER BY total DESC, count DESC
        LIMIT ?`
    )
    .all(limit) as UncategorizedCounterparty[];
}
