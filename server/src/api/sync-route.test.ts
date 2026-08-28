import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { migrate } from "../db/schema.js";
import { createApp } from "../index.js";
import type { IngestSummary } from "../ingest/index.js";
import type { SyncRunner } from "./sync-route.js";

function summary(overrides: Partial<IngestSummary> = {}): IngestSummary {
  return {
    seen: 2,
    inserted: 1,
    duplicates: 1,
    needsReview: 0,
    skipped: 0,
    statementsPersisted: 0,
    statementsNeedReview: 0,
    reversalsApplied: 0,
    ...overrides,
  };
}

function makeApp(syncRunner: SyncRunner | null) {
  const db = new Database(":memory:");
  migrate(db);
  return createApp(db, { syncRunner });
}

describe("POST /api/sync", () => {
  it("triggers the injected sync runner and returns its summary", async () => {
    const fakeSummary = summary({ seen: 5, inserted: 3, needsReview: 1 });
    const runner: SyncRunner = async () => fakeSummary;
    const app = makeApp(runner);

    const res = await request(app).post("/api/sync").expect(200);

    expect(res.body.summary).toEqual(fakeSummary);
  });

  it("returns a clean 503 (not a crash) when Gmail/Claude aren't configured", async () => {
    const app = makeApp(null);

    const res = await request(app).post("/api/sync").expect(503);

    expect(res.body).toEqual({ error: "gmail_not_configured" });
  });

  it("returns a clean 500 (not a crash) when the runner itself throws", async () => {
    const runner: SyncRunner = async () => {
      throw new Error("gmail search failed");
    };
    const app = makeApp(runner);

    const res = await request(app).post("/api/sync").expect(500);

    expect(res.body.error).toBe("sync_failed");
    expect(res.body.message).toContain("gmail search failed");
  });

  it("returns 409 busy on a concurrent call while a sync is already running", async () => {
    let resolveFirst!: () => void;
    const firstRunStarted = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let releaseFirst!: () => void;
    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const runner: SyncRunner = async () => {
      resolveFirst();
      await firstRunGate;
      return summary();
    };
    const app = makeApp(runner);

    // A supertest `Test` only actually sends once something calls `.then`
    // on it (that's what triggers its internal `.end()`); chain `.then`
    // immediately to dispatch it now, without awaiting completion yet.
    const firstResultPromise = request(app)
      .post("/api/sync")
      .then((res) => res);
    await firstRunStarted;

    const secondRes = await request(app).post("/api/sync").expect(409);
    expect(secondRes.body).toEqual({ error: "sync_already_running" });

    releaseFirst();
    const firstRes = await firstResultPromise;
    expect(firstRes.status).toBe(200);
  });

  it("allows a new sync after the previous one finished", async () => {
    let calls = 0;
    const runner: SyncRunner = async () => {
      calls += 1;
      return summary();
    };
    const app = makeApp(runner);

    await request(app).post("/api/sync").expect(200);
    await request(app).post("/api/sync").expect(200);

    expect(calls).toBe(2);
  });
});
