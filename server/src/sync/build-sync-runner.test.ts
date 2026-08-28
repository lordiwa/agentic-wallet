import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { buildProductionSyncRunner, type SyncRunnerFactories } from "./build-sync-runner.js";
import type { Config } from "../config.js";

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    PORT: 3000,
    WALLET_DB_PATH: ":memory:",
    ANTHROPIC_API_KEY: "sk-test",
    CLAUDE_CODE_OAUTH_TOKEN: undefined,
    GMAIL_OAUTH_CLIENT_ID: "client-id",
    GMAIL_OAUTH_CLIENT_SECRET: "client-secret",
    GMAIL_OAUTH_REFRESH_TOKEN: "refresh-token",
    ...overrides,
  };
}

function db() {
  const database = new Database(":memory:");
  migrate(database);
  return database;
}

/** Gmail y Claude reemplazados por fakes vacios: el runner corre entero sin
 * red ni credenciales, que es lo unico que hace falta para probar el gate. */
function offlineFactories(): SyncRunnerFactories {
  return {
    createGmailClient: async () => ({
      searchMessageIds: async () => [],
      getMessage: async () => {
        throw new Error("sin mensajes");
      },
    }),
    createExtractor: () => ({ extract: async () => ({ amount_text_raw: null, counterparty: null }) }),
  };
}

describe("buildProductionSyncRunner", () => {
  it("returns null (never throws) when neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set", () => {
    const runner = buildProductionSyncRunner(baseConfig({ ANTHROPIC_API_KEY: undefined }), () => db());
    expect(runner).toBeNull();
  });

  it("returns a runner when only CLAUDE_CODE_OAUTH_TOKEN is set (subscription auth, no API key)", () => {
    const runner = buildProductionSyncRunner(
      baseConfig({ ANTHROPIC_API_KEY: undefined, CLAUDE_CODE_OAUTH_TOKEN: "oauth-token" }),
      () => db(),
    );
    expect(runner).not.toBeNull();
  });

  it("returns a runner when only ANTHROPIC_API_KEY is set (existing metered-key behavior preserved)", () => {
    const runner = buildProductionSyncRunner(baseConfig(), () => db());
    expect(runner).not.toBeNull();
  });

  it("returns null when a Claude credential is set but a Gmail OAuth credential is missing", () => {
    expect(
      buildProductionSyncRunner(
        baseConfig({ CLAUDE_CODE_OAUTH_TOKEN: "oauth-token", GMAIL_OAUTH_CLIENT_ID: undefined }),
        () => db(),
      ),
    ).toBeNull();
    expect(buildProductionSyncRunner(baseConfig({ GMAIL_OAUTH_CLIENT_ID: undefined }), () => db())).toBeNull();
    expect(buildProductionSyncRunner(baseConfig({ GMAIL_OAUTH_CLIENT_SECRET: undefined }), () => db())).toBeNull();
    expect(buildProductionSyncRunner(baseConfig({ GMAIL_OAUTH_REFRESH_TOKEN: undefined }), () => db())).toBeNull();
  });

  it("returns a runner when all credentials are present, without touching the db or network yet", () => {
    let dbOpened = false;
    const runner = buildProductionSyncRunner(baseConfig(), () => {
      dbOpened = true;
      return db();
    });

    expect(runner).not.toBeNull();
    expect(dbOpened).toBe(false);
  });

  // Exigir titular para sincronizar era un deadlock de onboarding: el titular
  // se propone leyendo el ledger, y el ledger solo se llena sincronizando.
  it("sincroniza aunque strategy_config.titular no este seedeado (no rechaza)", async () => {
    const database = db(); // sin strategy_config
    const runner = buildProductionSyncRunner(baseConfig(), () => database, offlineFactories());

    await expect(runner!()).resolves.toMatchObject({ seen: 0, inserted: 0 });
  });
});
