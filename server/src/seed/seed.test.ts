import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/open.js";
import { migrate } from "../db/schema.js";
import { DEFAULT_DEBTS, DEFAULT_SAVINGS_GOAL, DEFAULT_STRATEGY_CONFIG } from "./default-config.js";
import { FIXTURE_DEBTS } from "./seed.fixture.js";
import { seedDatabase, type SeedOptions } from "./seed.js";

interface StrategyConfigRow {
  key: string;
  value: string;
}
interface DebtRow {
  id: number;
  person: string;
  amount: number;
  kind: string;
  status: string;
}
interface SavingsRow {
  id: number;
  label: string;
  target: number;
  reserved: number;
}

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  // Exercise the real F1-02 migration path (used with an in-memory db so
  // seed tests don't need temp files), same shape as repository.test.ts.
  migrate(db);
});

afterEach(() => {
  db.close();
});

/**
 * The shipped debt set is EMPTY on purpose (see default-config.ts), so the
 * person-keyed idempotency rules below would have nothing to act on. These
 * tests therefore seed a fixture debt set explicitly -- which is exactly how
 * the onboarding CLI calls `seedDatabase`, so the covered path is the real
 * one and not a test-only branch.
 */
function seed(options: SeedOptions = {}) {
  return seedDatabase(db, { debts: FIXTURE_DEBTS, ...options });
}

describe("seedDatabase", () => {
  it("writes every strategy_config key, with the shipped (neutral) values", () => {
    seed();
    const rows = db.prepare("SELECT key, value FROM strategy_config").all() as StrategyConfigRow[];
    const byKey = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));

    for (const key of Object.keys(DEFAULT_STRATEGY_CONFIG)) {
      expect(byKey).toHaveProperty(key);
      expect(byKey[key]).toEqual(DEFAULT_STRATEGY_CONFIG[key]);
    }
    expect(byKey.moneda).toBe("USD");
  });

  /**
   * The guarantee this boilerplate has to keep: a fresh clone shows nobody's
   * money. Every figure the shipped seed writes is zero or empty, so an
   * un-onboarded dashboard cannot display a plausible-looking number that
   * was really inherited from whoever the engine was first built for.
   */
  it("ships zeros and empties, never someone else's real figures", () => {
    seedDatabase(db); // no fixture: exactly what a fresh clone gets
    const rows = db.prepare("SELECT key, value FROM strategy_config").all() as StrategyConfigRow[];
    const byKey = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));

    expect(byKey.colchonObjetivo).toBe(0);
    expect(byKey.topeTransferenciasMensual).toBe(0);
    expect(byKey.titular).toBe("");
    expect(byKey.sueldo).toEqual({ fuente: "", cadencia: "quincenal", montoEstimado: 0, diasPago: [] });
    expect(byKey.balanceSnapshot).toEqual({ amount: 0, at: "1970-01-01" });

    // ...and no debts belonging to anyone.
    const debts = db.prepare("SELECT COUNT(*) as c FROM debts").get() as { c: number };
    expect(debts.c).toBe(0);
    expect(DEFAULT_DEBTS).toEqual([]);

    const savings = db.prepare("SELECT target FROM savings WHERE label = ?").get(DEFAULT_SAVINGS_GOAL.label) as
      | SavingsRow
      | undefined;
    expect(savings!.target).toBe(0);
  });

  it("seeds a caller-supplied debt set (5 debts totalling 375, all pending)", () => {
    seed();
    const rows = db.prepare("SELECT person, amount, kind, status FROM debts ORDER BY person").all() as DebtRow[];

    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(375);

    const byPerson = Object.fromEntries(rows.map((r) => [r.person, r.amount]));
    expect(byPerson).toEqual({
      "Persona Uno": 140,
      "Persona Dos": 100,
      "Persona Tres": 50,
      "Persona Cuatro": 50,
      "Persona Cinco": 35,
    });
  });

  it("seeds the 'colchon' savings goal row (target 0 until onboarding sets one)", () => {
    seed();
    const rows = db.prepare("SELECT label, target, reserved FROM savings").all() as SavingsRow[];

    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe(DEFAULT_SAVINGS_GOAL.label);
    expect(rows[0].target).toBe(DEFAULT_SAVINGS_GOAL.target);
    expect(rows[0].reserved).toBe(0);
  });

  it("returns a summary of what was written on first run", () => {
    const result = seed();
    expect(result.strategyConfigWritten).toBe(Object.keys(DEFAULT_STRATEGY_CONFIG).length);
    expect(result.debtsInserted).toBe(FIXTURE_DEBTS.length);
    expect(result.savingsWritten).toBe(1);
  });

  describe("idempotency (AC5)", () => {
    it("running twice does not duplicate any rows", () => {
      seed();
      seed();

      const configCount = db.prepare("SELECT COUNT(*) as c FROM strategy_config").get() as { c: number };
      const debtsCount = db.prepare("SELECT COUNT(*) as c FROM debts").get() as { c: number };
      const savingsCount = db.prepare("SELECT COUNT(*) as c FROM savings").get() as { c: number };

      expect(configCount.c).toBe(Object.keys(DEFAULT_STRATEGY_CONFIG).length);
      expect(debtsCount.c).toBe(FIXTURE_DEBTS.length);
      expect(savingsCount.c).toBe(1);
    });

    it("the second run reports nothing new written", () => {
      seed();
      const second = seed();

      expect(second.strategyConfigWritten).toBe(0);
      expect(second.debtsInserted).toBe(0);
      expect(second.savingsWritten).toBe(0);
    });

    it("does not overwrite a manually-edited strategy_config value on reseed", () => {
      seed();
      db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'colchonObjetivo'").run(JSON.stringify(5000));

      seed();

      const row = db.prepare("SELECT value FROM strategy_config WHERE key = 'colchonObjetivo'").get() as
        | StrategyConfigRow
        | undefined;
      expect(JSON.parse(row!.value)).toBe(5000);
    });

    it("does not overwrite a manually-edited debt status on reseed", () => {
      seed();
      db.prepare("UPDATE debts SET status = 'paid' WHERE person = 'Persona Uno'").run();

      seed();

      const row = db.prepare("SELECT status FROM debts WHERE person = 'Persona Uno'").get() as
        | DebtRow
        | undefined;
      expect(row!.status).toBe("paid");
      const count = db.prepare("SELECT COUNT(*) as c FROM debts").get() as { c: number };
      expect(count.c).toBe(5);
    });

    it("does not overwrite a manually-edited savings target on reseed", () => {
      seed();
      db.prepare("UPDATE savings SET target = 2000 WHERE label = 'colchon'").run();

      seed();

      const row = db.prepare("SELECT target FROM savings WHERE label = 'colchon'").get() as SavingsRow | undefined;
      expect(row!.target).toBe(2000);
      const count = db.prepare("SELECT COUNT(*) as c FROM savings").get() as { c: number };
      expect(count.c).toBe(1);
    });

    it("force: true resets manually-edited values back to defaults", () => {
      seed();
      db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'colchonObjetivo'").run(JSON.stringify(5000));
      db.prepare("UPDATE debts SET status = 'paid' WHERE person = 'Persona Uno'").run();
      db.prepare("UPDATE savings SET target = 2000 WHERE label = 'colchon'").run();

      seed({ force: true });

      const config = db.prepare("SELECT value FROM strategy_config WHERE key = 'colchonObjetivo'").get() as
        | StrategyConfigRow
        | undefined;
      expect(JSON.parse(config!.value)).toBe(DEFAULT_STRATEGY_CONFIG.colchonObjetivo);

      const debt = db.prepare("SELECT status FROM debts WHERE person = 'Persona Uno'").get() as
        | DebtRow
        | undefined;
      expect(debt!.status).toBe("pending");

      const savings = db.prepare("SELECT target FROM savings WHERE label = 'colchon'").get() as
        | SavingsRow
        | undefined;
      expect(savings!.target).toBe(DEFAULT_SAVINGS_GOAL.target);

      // force never duplicates rows either.
      const debtsCount = db.prepare("SELECT COUNT(*) as c FROM debts").get() as { c: number };
      const savingsCount = db.prepare("SELECT COUNT(*) as c FROM savings").get() as { c: number };
      expect(debtsCount.c).toBe(5);
      expect(savingsCount.c).toBe(1);
    });

    it("editing a default debt's amount then reseeding does not duplicate it (TASK-021 AC1)", () => {
      seed();
      db.prepare("UPDATE debts SET amount = 999 WHERE person = 'Persona Tres'").run();

      seed();

      const rows = db.prepare("SELECT amount FROM debts WHERE person = 'Persona Tres'").all() as { amount: number }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe(999);

      const count = db.prepare("SELECT COUNT(*) as c FROM debts").get() as { c: number };
      expect(count.c).toBe(5);
    });

    it("force: true also resets a manually-edited amount back to the default (person-keyed)", () => {
      seed();
      db.prepare("UPDATE debts SET amount = 999 WHERE person = 'Persona Tres'").run();

      seed({ force: true });

      const row = db.prepare("SELECT amount FROM debts WHERE person = 'Persona Tres'").get() as
        | { amount: number }
        | undefined;
      expect(row!.amount).toBe(50);
      const count = db.prepare("SELECT COUNT(*) as c FROM debts").get() as { c: number };
      expect(count.c).toBe(5);
    });
  });

  it("rolls back every write if any part of the seed fails (db.transaction, AC3)", () => {
    // strategy_config and debts are seeded (successfully) before savings;
    // dropping the savings table makes seedSavingsGoal's INSERT throw. If
    // seedDatabase's three writes weren't wrapped in a single
    // db.transaction(...), the earlier strategy_config/debts writes would
    // already be committed by the time savings fails -- this proves they
    // aren't: the whole seed rolls back atomically.
    db.exec("DROP TABLE savings");

    expect(() => seed()).toThrow();

    const configCount = db.prepare("SELECT COUNT(*) as c FROM strategy_config").get() as { c: number };
    const debtsCount = db.prepare("SELECT COUNT(*) as c FROM debts").get() as { c: number };
    expect(configCount.c).toBe(0);
    expect(debtsCount.c).toBe(0);
  });

  it("works against a real openDb-managed database file (integration smoke test)", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "agentic-wallet-seed-test-"));
    const dbPath = path.join(tmpDir, "wallet.sqlite");
    try {
      const realDb = openDb(dbPath);
      expect(existsSync(dbPath)).toBe(true);

      const first = seedDatabase(realDb, { debts: FIXTURE_DEBTS });
      expect(first.debtsInserted).toBe(5);

      const second = seedDatabase(realDb, { debts: FIXTURE_DEBTS });
      expect(second.debtsInserted).toBe(0);

      const count = realDb.prepare("SELECT COUNT(*) as c FROM debts").get() as { c: number };
      expect(count.c).toBe(5);

      realDb.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
