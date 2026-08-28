import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { migrate } from "./db/schema.js";
import { DEFAULT_DEBTS, DEFAULT_STRATEGY_CONFIG } from "./seed/default-config.js";

// `db/open.js`'s `openDb` is mocked to an in-memory, migrated db (a stand-in
// for "the real env-configured file db") so these tests exercise createApp's
// actual startup-seeding wiring (TASK-021 AC2) without ever touching disk --
// avoiding the Windows file-lock/EBUSY cleanup issues a real sqlite file
// held open by createApp's un-closeable lazy db handle would hit in
// afterEach. `openDb.js`/`schema.ts`'s own real-file behavior is already
// covered by db/open.test.ts and seed/seed.test.ts's integration smoke test.
let sharedDb: Database.Database | undefined;
const openDbMock = vi.fn(() => {
  if (!sharedDb) {
    sharedDb = new Database(":memory:");
    migrate(sharedDb);
  }
  return sharedDb;
});

vi.mock("./db/open.js", () => ({
  openDb: () => openDbMock(),
}));

const { createApp } = await import("./index.js");

beforeEach(() => {
  sharedDb = undefined;
  openDbMock.mockClear();
});

afterEach(() => {
  sharedDb?.close();
  sharedDb = undefined;
});

describe("createApp startup seeding (TASK-021 AC2)", () => {
  it("never opens (or seeds) the db just from construction", () => {
    createApp();
    expect(openDbMock).not.toHaveBeenCalled();
  });

  it("seeds the lazily-opened db once a route that needs it is hit", async () => {
    const app = createApp();
    await request(app).get("/api/transactions").expect(200);

    expect(openDbMock).toHaveBeenCalledTimes(1);
    const debts = sharedDb!.prepare("SELECT COUNT(*) as c FROM debts").get() as { c: number };
    const config = sharedDb!.prepare("SELECT COUNT(*) as c FROM strategy_config").get() as { c: number };
    expect(debts.c).toBe(DEFAULT_DEBTS.length);
    expect(config.c).toBe(Object.keys(DEFAULT_STRATEGY_CONFIG).length);
  });

  it("re-seeding the same underlying db (a second request) never duplicates rows", async () => {
    const app = createApp();
    await request(app).get("/api/transactions").expect(200);
    await request(app).get("/api/transactions").expect(200);

    // getDb() caches lazyDb after the first call, so openDb (and therefore
    // seedDatabase) only actually runs once per app instance -- asserted so
    // this test would fail (not silently pass) if that caching regressed.
    expect(openDbMock).toHaveBeenCalledTimes(1);
    const debts = sharedDb!.prepare("SELECT COUNT(*) as c FROM debts").get() as { c: number };
    expect(debts.c).toBe(DEFAULT_DEBTS.length);
  });

  it("is idempotent across separate app instances pointed at the same db (simulated restart)", async () => {
    const firstStart = createApp();
    await request(firstStart).get("/api/transactions").expect(200);

    // A fresh `createApp()` re-runs the lazy-open + seed path from scratch;
    // pointed at the same underlying db (the mock's shared singleton), this
    // simulates the server being restarted against an already-seeded DB.
    const secondStart = createApp();
    await request(secondStart).get("/api/transactions").expect(200);

    const debts = sharedDb!.prepare("SELECT COUNT(*) as c FROM debts").get() as { c: number };
    const config = sharedDb!.prepare("SELECT COUNT(*) as c FROM strategy_config").get() as { c: number };
    const savings = sharedDb!.prepare("SELECT COUNT(*) as c FROM savings").get() as { c: number };
    expect(debts.c).toBe(DEFAULT_DEBTS.length);
    expect(config.c).toBe(Object.keys(DEFAULT_STRATEGY_CONFIG).length);
    expect(savings.c).toBe(1);
  });

  it("never seeds a db injected by a caller (test fixtures keep full control)", async () => {
    const injectedDb = new Database(":memory:");
    migrate(injectedDb);
    const app = createApp(injectedDb);

    await request(app).get("/api/transactions").expect(200);

    expect(openDbMock).not.toHaveBeenCalled();
    const config = injectedDb.prepare("SELECT COUNT(*) as c FROM strategy_config").get() as { c: number };
    expect(config.c).toBe(0);
    injectedDb.close();
  });
});
