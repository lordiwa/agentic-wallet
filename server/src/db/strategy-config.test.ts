import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "./schema.js";
import { getStrategyConfig } from "./strategy-config.js";
import { DEFAULT_STRATEGY_CONFIG } from "../seed/default-config.js";
import { seedFixture } from "../seed/seed.fixture.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

describe("getStrategyConfig (TASK-021 AC4)", () => {
  it("returns the stored value for every field once the wallet has been configured", () => {
    seedFixture(db);

    const config = getStrategyConfig(db);

    expect(config.moneda).toBe("USD");
    expect(config.zonaHoraria).toBe("UTC-05:00");
    expect(config.colchonObjetivo).toBe(1200);
    expect(config.topeTransferenciasMensual).toBe(1200);
    expect(config.sueldo).toEqual({
      fuente: "Acme Corp S.A.",
      cadencia: "quincenal",
      montoEstimado: 2360,
      diasPago: ["<=5", "18-20"],
    });
    expect(config.titular).toBe("PEREZ GOMEZ ANA MARIA");
    // balanceSnapshot is exposed as {amount, at} per the ticket's contract.
    expect(config.balanceSnapshot).toEqual({ amount: 2409, at: "2026-07-20" });
  });

  it("parses a hand-edited strategy_config value instead of returning the default", () => {
    seedFixture(db);
    db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'colchonObjetivo'").run(JSON.stringify(2500));
    db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'balanceSnapshot'").run(
      JSON.stringify({ amount: 100, at: "2026-08-01" })
    );

    const config = getStrategyConfig(db);

    expect(config.colchonObjetivo).toBe(2500);
    expect(config.balanceSnapshot).toEqual({ amount: 100, at: "2026-08-01" });
  });

  it("returns safe defaults for every field on a completely empty strategy_config table (no seed run)", () => {
    // No seedDatabase() call: strategy_config is empty. The strategy engine
    // (F2-C) must never crash on this -- every field falls back to the
    // spec 4.6 default.
    const config = getStrategyConfig(db);

    expect(config).toEqual({
      moneda: DEFAULT_STRATEGY_CONFIG.moneda,
      zonaHoraria: DEFAULT_STRATEGY_CONFIG.zonaHoraria,
      colchonObjetivo: DEFAULT_STRATEGY_CONFIG.colchonObjetivo,
      topeTransferenciasMensual: DEFAULT_STRATEGY_CONFIG.topeTransferenciasMensual,
      sueldo: DEFAULT_STRATEGY_CONFIG.sueldo,
      titular: DEFAULT_STRATEGY_CONFIG.titular,
      balanceSnapshot: DEFAULT_STRATEGY_CONFIG.balanceSnapshot,
    });
  });

  it("defaults a single missing key without affecting the other, present keys", () => {
    seedFixture(db);
    db.prepare("DELETE FROM strategy_config WHERE key = 'titular'").run();

    const config = getStrategyConfig(db);

    expect(config.titular).toBe(DEFAULT_STRATEGY_CONFIG.titular);
    // Every other key was actually seeded/present -- untouched by the
    // missing titular key.
    expect(config.moneda).toBe("USD");
    expect(config.colchonObjetivo).toBe(1200);
  });

  it("defaults a key whose stored value is corrupt JSON instead of throwing", () => {
    seedFixture(db);
    db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'sueldo'").run("{not valid json");

    expect(() => getStrategyConfig(db)).not.toThrow();
    const config = getStrategyConfig(db);
    expect(config.sueldo).toEqual(DEFAULT_STRATEGY_CONFIG.sueldo);
  });

  describe("mistyped-but-valid-JSON values (review MEDIUM-1)", () => {
    function setRaw(key: string, value: unknown): void {
      db.prepare("UPDATE strategy_config SET value = ? WHERE key = ?").run(JSON.stringify(value), key);
    }

    it("defaults colchonObjetivo when it's null instead of a number", () => {
      seedFixture(db);
      setRaw("colchonObjetivo", null);

      const config = getStrategyConfig(db);
      expect(config.colchonObjetivo).toBe(DEFAULT_STRATEGY_CONFIG.colchonObjetivo);
    });

    it("defaults colchonObjetivo when it's a string instead of a number", () => {
      seedFixture(db);
      setRaw("colchonObjetivo", "abc");

      const config = getStrategyConfig(db);
      expect(config.colchonObjetivo).toBe(DEFAULT_STRATEGY_CONFIG.colchonObjetivo);
    });

    it("defaults topeTransferenciasMensual when it's a string instead of a number", () => {
      seedFixture(db);
      setRaw("topeTransferenciasMensual", "1200");

      const config = getStrategyConfig(db);
      expect(config.topeTransferenciasMensual).toBe(DEFAULT_STRATEGY_CONFIG.topeTransferenciasMensual);
    });

    it("defaults the whole sueldo object when montoEstimado is a string instead of a number", () => {
      seedFixture(db);
      setRaw("sueldo", { fuente: "Acme", cadencia: "mensual", montoEstimado: "x", diasPago: ["1-5"] });

      const config = getStrategyConfig(db);
      expect(config.sueldo).toEqual(DEFAULT_STRATEGY_CONFIG.sueldo);
    });

    it("defaults the whole sueldo object when diasPago is a string instead of an array", () => {
      seedFixture(db);
      setRaw("sueldo", { fuente: "Acme", cadencia: "mensual", montoEstimado: 500, diasPago: "x" });

      const config = getStrategyConfig(db);
      expect(config.sueldo).toEqual(DEFAULT_STRATEGY_CONFIG.sueldo);
    });

    it("defaults balanceSnapshot when it's a bare number instead of {amount, at}", () => {
      seedFixture(db);
      setRaw("balanceSnapshot", 42);

      const config = getStrategyConfig(db);
      expect(config.balanceSnapshot).toEqual(DEFAULT_STRATEGY_CONFIG.balanceSnapshot);
    });

    it("defaults balanceSnapshot when amount is a string instead of a number", () => {
      seedFixture(db);
      setRaw("balanceSnapshot", { amount: "100", at: "2026-08-01" });

      const config = getStrategyConfig(db);
      expect(config.balanceSnapshot).toEqual(DEFAULT_STRATEGY_CONFIG.balanceSnapshot);
    });

    it("defaults titular when it's a number instead of a string", () => {
      seedFixture(db);
      setRaw("titular", 12345);

      const config = getStrategyConfig(db);
      expect(config.titular).toBe(DEFAULT_STRATEGY_CONFIG.titular);
    });

    it("a mistyped field defaults without affecting other, correctly-typed fields", () => {
      seedFixture(db);
      setRaw("colchonObjetivo", "abc");

      const config = getStrategyConfig(db);
      expect(config.colchonObjetivo).toBe(DEFAULT_STRATEGY_CONFIG.colchonObjetivo);
      expect(config.moneda).toBe("USD");
      expect(config.titular).toBe("PEREZ GOMEZ ANA MARIA");
    });
  });
});
