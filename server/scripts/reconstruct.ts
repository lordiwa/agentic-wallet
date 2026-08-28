/**
 * `npm run reconstruct -- <path-to-emails.json>` (TASK-040): the runnable
 * entry point for the finance-copilot-via-Claude-Code reconstruction path.
 * Reads a batch of already-fetched Gmail messages (GmailMessage[] JSON --
 * see server/src/ingest/types.ts) from a file the assistant wrote after
 * reading them via its own session's Gmail MCP tools, and replays them
 * through `reconstructFromMessages` (server/src/ingest/reconstruct.ts): the
 * same deterministic parse -> reconcile -> categorize -> statement ->
 * persist pipeline as the live sync job, but with NO Claude cross-check and
 * NO Gmail OAuth of its own.
 *
 * Opens the real, env-configured database (WALLET_DB_PATH via openDb) and
 * the seeded titular (strategy_config, via getStrategyConfig) -- same "only
 * boot when run directly" guard as gmail-auth.ts/seed/cli.ts, so importing
 * this module from a test never opens the real DB as a side effect.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openDb } from "../src/db/open.js";
import { getStrategyConfig } from "../src/db/strategy-config.js";
import { reconstructFromMessages } from "../src/ingest/reconstruct.js";
import type { IngestSummary } from "../src/ingest/pipeline.js";
import type { GmailMessage } from "../src/ingest/types.js";

/**
 * Runs the CLI. Takes an optional `dbPath` (used by tests to point at a
 * temp file instead of the real env-configured database) -- the sanity-run
 * itself is expected to set WALLET_DB_PATH instead, mirroring how
 * gmail-auth.ts/seed/cli.ts's real callers are configured via env, not a
 * function argument.
 */
export function runReconstructCli(filePath: string | undefined, dbPath?: string): IngestSummary | undefined {
  if (!filePath) {
    console.error("Falta la ruta al archivo de correos.\nUso: npm run reconstruct -- <path-to-emails.json>");
    process.exitCode = 1;
    return undefined;
  }

  let messages: GmailMessage[];
  try {
    const raw = readFileSync(filePath, "utf-8");
    messages = JSON.parse(raw) as GmailMessage[];
  } catch (err) {
    console.error(`No se pudo leer/parsear ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return undefined;
  }

  const db = openDb(dbPath);
  try {
    const titular = getStrategyConfig(db).titular;
    const summary = reconstructFromMessages(db, messages, titular);
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReconstructCli(process.argv[2]);
}
