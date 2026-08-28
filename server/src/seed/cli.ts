/**
 * `npm run seed` (TASK-020): the runnable entry point behind the setup
 * README's "sembrar la config inicial" step. Opens the database (env-
 * configured `WALLET_DB_PATH` by default, auto-migrated by `openDb`) and
 * applies F1-10's `seedDatabase` in its default idempotent mode -- safe to
 * run every time the server is set up, including on an already-seeded
 * database.
 *
 * Kept intentionally thin: all seeding logic and its test coverage already
 * live in seed.ts/seed.test.ts. `runSeedCli` only wires that logic to a
 * printable summary and takes an optional `dbPath` so cli.test.ts can point
 * it at a temp file instead of the real env-configured database -- same
 * "only boot when run directly" guard as index.ts, so importing this module
 * from a test never opens the real DB as a side effect.
 */
import { pathToFileURL } from "node:url";
import { openDb } from "../db/open.js";
import { seedDatabase, type SeedResult } from "./seed.js";

export function runSeedCli(dbPath?: string): SeedResult {
  const db = openDb(dbPath);
  try {
    const result = seedDatabase(db);
    console.log(
      `Seed OK: strategy_config=${result.strategyConfigWritten} debts=${result.debtsInserted} savings=${result.savingsWritten}`
    );
    return result;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSeedCli();
}
