import type Database from "better-sqlite3";
import { emitMetric, withSpanSync } from "../db/telemetry.js";
import {
  DEFAULT_DEBTS,
  DEFAULT_SAVINGS_GOAL,
  DEFAULT_STRATEGY_CONFIG,
  type DefaultDebt,
} from "./default-config.js";

export interface SeedOptions {
  /**
   * When true, overwrites existing strategy_config values and resets the
   * default debts/savings goal back to their seed values, even if a user has
   * edited them since. Defaults to false, which is the safe/idempotent mode:
   * a row that already exists (by its natural key) is never touched.
   */
  force?: boolean;
  /**
   * The debt set to seed. Defaults to `DEFAULT_DEBTS`, which ships EMPTY --
   * a boilerplate has no business inventing who owes the user money. The
   * onboarding CLI passes the debts it collected from the user here, and
   * tests pass fixtures, so the person-keyed idempotency rules below are
   * exercised without any personal data living in the repo.
   */
  debts?: readonly DefaultDebt[];
}

export interface SeedResult {
  /** Number of strategy_config keys written (inserted, or updated when force is set). */
  strategyConfigWritten: number;
  /** Number of debts rows inserted (default debts already present are skipped unless force). */
  debtsInserted: number;
  /** 1 if the 'colchon' savings row was inserted or (force) updated, 0 if it was already present and left alone. */
  savingsWritten: number;
}

/**
 * Seeds strategy_config, debts, and savings with the neutral defaults from
 * default-config.ts (currency/timezone/salary/titular config, the debt set,
 * the "colchon" savings goal, and the initial balance snapshot).
 *
 * Idempotent by default: running this twice never duplicates rows, and never
 * overwrites a value that already exists (whether seeded before or edited
 * manually by a user) -- pass `{ force: true }` to intentionally reset rows
 * back to their default values.
 *
 * Runs as a single `db.transaction(...)` (TASK-021 AC3) so the three writes
 * (strategy_config, debts, savings) commit or roll back atomically -- a
 * mid-seed failure (e.g. a constraint violation) never leaves a partially
 * seeded database.
 */
export function seedDatabase(db: Database.Database, options: SeedOptions = {}): SeedResult {
  const force = options.force ?? false;
  const debts = options.debts ?? DEFAULT_DEBTS;

  return withSpanSync("seed.run", { force }, () => {
    const runInTransaction = db.transaction((): SeedResult => ({
      strategyConfigWritten: seedStrategyConfig(db, force),
      debtsInserted: seedDebts(db, force, debts),
      savingsWritten: seedSavingsGoal(db, force),
    }));

    const result = runInTransaction();
    emitMetric("seed.written", { ...result, force });
    return result;
  });
}

function seedStrategyConfig(db: Database.Database, force: boolean): number {
  const stmt = force
    ? db.prepare(
        `INSERT INTO strategy_config (key, value) VALUES (@key, @value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
    : db.prepare(
        `INSERT INTO strategy_config (key, value) VALUES (@key, @value)
         ON CONFLICT(key) DO NOTHING`
      );

  let written = 0;
  for (const [key, value] of Object.entries(DEFAULT_STRATEGY_CONFIG)) {
    const result = stmt.run({ key, value: JSON.stringify(value) });
    if (result.changes === 1) written += 1;
  }
  return written;
}

/**
 * debts has no natural unique constraint at the schema level, so idempotency
 * here is enforced in application code using `person` as the natural key for
 * the seed set (which must therefore have unique persons): a seed debt is
 * only (re)inserted when no existing row matches its person. This means a
 * user-added debt for a person outside the seed set never blocks reseeding,
 * and a manually-edited amount/status (editing an amount, or marking it as
 * paid) is preserved across reseeds unless `force` is passed -- editing a
 * seeded debt's amount and reseeding never re-inserts a duplicate row for
 * that person.
 *
 * (Was previously keyed on (person, amount): editing a debt's amount made it
 * invisible to the dedup lookup, so a reseed re-inserted a second row for the
 * same person.)
 */
function seedDebts(db: Database.Database, force: boolean, debtsToSeed: readonly DefaultDebt[]): number {
  const findStmt = db.prepare("SELECT id FROM debts WHERE person = @person");
  const insertStmt = db.prepare(
    "INSERT INTO debts (person, amount, kind, status) VALUES (@person, @amount, @kind, @status)"
  );
  const resetStmt = db.prepare(
    "UPDATE debts SET amount = @amount, kind = @kind, status = @status WHERE person = @person"
  );

  let inserted = 0;
  for (const debt of debtsToSeed) {
    const existing = findStmt.get(debt) as { id: number } | undefined;
    if (existing) {
      if (force) resetStmt.run(debt);
      continue;
    }
    insertStmt.run(debt);
    inserted += 1;
  }
  return inserted;
}

/** savings has no unique constraint either; 'label' is used as the natural key for the 'colchon' goal. */
function seedSavingsGoal(db: Database.Database, force: boolean): number {
  const findStmt = db.prepare("SELECT id FROM savings WHERE label = @label");
  const existing = findStmt.get(DEFAULT_SAVINGS_GOAL) as { id: number } | undefined;

  if (existing) {
    if (!force) return 0;
    db.prepare(
      "UPDATE savings SET target = @target, reserved = @reserved, updated_at = datetime('now') WHERE label = @label"
    ).run(DEFAULT_SAVINGS_GOAL);
    return 1;
  }

  db.prepare(
    "INSERT INTO savings (label, target, reserved, updated_at) VALUES (@label, @target, @reserved, datetime('now'))"
  ).run(DEFAULT_SAVINGS_GOAL);
  return 1;
}
