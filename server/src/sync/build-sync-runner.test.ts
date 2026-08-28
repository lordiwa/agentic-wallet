import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { buildProductionSyncRunner } from "./build-sync-runner.js";
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

  it("the built runner rejects cleanly when strategy_config.titular isn't seeded (no crash)", async () => {
    const database = db(); // no strategy_config seeded
    const runner = buildProductionSyncRunner(baseConfig(), () => database);

    await expect(runner!()).rejects.toThrow("strategy_config.titular is not seeded");
  });
});
