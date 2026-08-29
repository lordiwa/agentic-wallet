/**
 * Builds the production `SyncRunner` (F1-08) from env config: a real
 * `GmailClient` (googleapis + OAuth refresh token) and a real Claude Agent
 * SDK `EmailExtractor`. Returns `null` -- and never throws -- when required
 * credentials aren't configured, so `POST /api/sync` can report a clean
 * "gmail_not_configured" error (see api/sync-route.ts) instead of the route
 * crashing while constructing a client it can't actually authenticate. This
 * environment has no Gmail/Claude credentials configured, so this always
 * returns `null` here -- exercised for real once those are set.
 *
 * The Claude credential gate accepts either a metered `ANTHROPIC_API_KEY` or
 * a Pro/Max subscription `CLAUDE_CODE_OAUTH_TOKEN` (from `claude
 * setup-token`) -- either is sufficient. Neither is passed into the SDK
 * explicitly; `createClaudeEmailExtractor`'s `query()` call reads ambient
 * auth from `process.env` (see ingest/claude-email-extractor.ts).
 */
import type Database from "better-sqlite3";
import type { Config } from "../config.js";
import type { SyncRunner } from "../api/sync-route.js";
import { createClaudeEmailExtractor, createGoogleapisGmailClient } from "../ingest/index.js";
import { runSync } from "./run-sync.js";

/**
 * `strategy_config.titular` is stored JSON-encoded (see seed.ts's
 * `seedStrategyConfig`, which `JSON.stringify`s every value it writes).
 * Missing/malformed is treated the same as "not configured": `ingestOnce`
 * acepta `null` y en ese caso omite el marcado de internas (F1-04), en vez de
 * bloquear el sync entero. Bloquearlo era un deadlock de onboarding — el
 * titular se propone leyendo el ledger, y el ledger se llena sincronizando.
 */
function readTitular(db: Database.Database): string | null {
  const row = db.prepare("SELECT value FROM strategy_config WHERE key = 'titular'").get() as
    | { value: string }
    | undefined;
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Las dos fabricas que salen del proceso (Gmail y Claude), inyectables solo
 * para que el test pueda ejercitar el runner sin red ni credenciales reales.
 * En produccion nadie pasa este argumento.
 */
export interface SyncRunnerFactories {
  createGmailClient: typeof createGoogleapisGmailClient;
  createExtractor: typeof createClaudeEmailExtractor;
}

const productionFactories: SyncRunnerFactories = {
  createGmailClient: createGoogleapisGmailClient,
  createExtractor: createClaudeEmailExtractor,
};

/**
 * `getDb` (not a live handle) is called only once the runner actually runs,
 * matching index.ts's lazy-db pattern -- constructing the runner itself
 * never opens the database.
 */
export function buildProductionSyncRunner(
  config: Config,
  getDb: () => Database.Database,
  factories: SyncRunnerFactories = productionFactories
): SyncRunner | null {
  if (!config.ANTHROPIC_API_KEY && !config.CLAUDE_CODE_OAUTH_TOKEN) return null;
  if (!config.GMAIL_OAUTH_CLIENT_ID || !config.GMAIL_OAUTH_CLIENT_SECRET || !config.GMAIL_OAUTH_REFRESH_TOKEN) {
    return null;
  }
  const clientId = config.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = config.GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = config.GMAIL_OAUTH_REFRESH_TOKEN;

  return async (options = {}) => {
    const db = getDb();
    const titular = readTitular(db);
    const gmailClient = await factories.createGmailClient({ clientId, clientSecret, refreshToken });
    const extractor = factories.createExtractor();
    // Los topes del lote se pasan tal cual (undefined incluido): quien
    // define el default es `runSync`, no esta capa ni el `.env`.
    return runSync(
      { db, gmailClient, extractor, titular },
      {
        batchSize: options.batchSize ?? config.WALLET_SYNC_BATCH_SIZE,
        maxMs: config.WALLET_SYNC_MAX_MS,
      }
    );
  };
}
