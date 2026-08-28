/**
 * Backfills `category` on existing `transactions` rows (spec F2-B, AC4).
 * Idempotent: only ever touches rows whose `category` is NULL/empty — a
 * category set by a prior backfill run, or set manually by a human, is
 * never repisada (overwritten). Safe to run repeatedly (e.g. after a
 * migration, or on every server start) with no effect once every row has a
 * category.
 */
import type Database from "better-sqlite3";
import { emitMetric, withSpan } from "../ingest/telemetry.js";
import { categorize } from "./categorize.js";
import { listCategoryRules } from "./rules-repository.js";

interface UncategorizedRow {
  id: number;
  type: string;
  counterparty: string | null;
  is_internal: number;
}

/** Categorizes every row with a NULL or empty `category`, in place. Returns
 * the number of rows updated. Never touches a row that already has a
 * non-empty `category` — that is what makes a second run a no-op. */
export async function backfillCategories(db: Database.Database): Promise<number> {
  return withSpan("category.backfill", {}, async () => {
    const rows = db
      .prepare("SELECT id, type, counterparty, is_internal FROM transactions WHERE category IS NULL OR category = ''")
      .all() as UncategorizedRow[];

    // Read the user's merchant rules once, not once per row.
    const rules = listCategoryRules(db);

    const update = db.prepare("UPDATE transactions SET category = @category WHERE id = @id");
    const runUpdates = db.transaction((toUpdate: UncategorizedRow[]) => {
      for (const row of toUpdate) {
        const category = categorize(
          {
            type: row.type,
            counterparty: row.counterparty,
            is_internal: Boolean(row.is_internal),
          },
          rules
        );
        update.run({ id: row.id, category });
      }
    });
    runUpdates(rows);

    emitMetric("category.backfill.summary", { updated: rows.length });
    return rows.length;
  });
}
