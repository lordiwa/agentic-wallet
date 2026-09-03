import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "./schema.js";
import { getStrategyConfig, setStrategyConfig } from "./strategy-config.js";
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

/**
 * Wargaming ronda 4, W30.
 *
 * `setStrategyConfig` es el borde que comparten **las tres** superficies de
 * escritura: el panel (por `writeProfile`), la tool MCP `set_profile` y
 * `npm run onboard -- --set`. La regla de qué día de pago es válido vivía sólo
 * en `writeProfile`, así que las otras dos escribían lo que quisieran:
 *
 * - `--set '{"sueldo":{…,"diasPago":["15"]}}'` guardaba un día suelto que
 *   `parseDiasPago` descarta en silencio. El perfil quedaba "configurado", el
 *   panel mostraba *"Día de pago: 15"*, `nextPayday` era `null` y el
 *   safe-to-spend valía `0` para siempre — el guarda de R7 dibujado como cifra.
 * - `set_profile` con `["0-0"]` o `["99-99"]` pasaba el regex de la tool y
 *   `localCalendarDate` lo clampeaba al 1 o al último día del mes.
 * - Un `colchonObjetivo` negativo entraba por las dos, y `colchonStatus`
 *   contestaba `financiado: true, faltante: 0` — R25 por la puerta de atrás.
 *
 * La validación de forma se queda donde estaba; lo que se agrega es que un
 * valor que el motor no sabe leer no se pueda escribir por ninguna puerta.
 */
describe("setStrategyConfig — lo que ninguna superficie puede escribir (W30)", () => {
  it("rechaza un día de pago que el calendario no sabe leer", () => {
    seedFixture(db);
    const sueldo = getStrategyConfig(db).sueldo;

    // El día suelto: lo más natural que alguien escribe, y lo que deja mudo al
    // calendario. El mensaje tiene que decir qué escribir en su lugar.
    expect(() => setStrategyConfig(db, { sueldo: { ...sueldo, diasPago: ["15"] } })).toThrow(/15-15/);
    expect(() => setStrategyConfig(db, { sueldo: { ...sueldo, diasPago: ["banana"] } })).toThrow(/diasPago/);
    expect(() => setStrategyConfig(db, { sueldo: { ...sueldo, diasPago: ["0-0"] } })).toThrow(/diasPago/);
    expect(() => setStrategyConfig(db, { sueldo: { ...sueldo, diasPago: ["99-99"] } })).toThrow(/diasPago/);
    expect(() => setStrategyConfig(db, { sueldo: { ...sueldo, diasPago: ["30-20"] } })).toThrow(/diasPago/);

    // Y nada de eso quedó escrito: la validación corre antes de la transacción.
    expect(getStrategyConfig(db).sueldo.diasPago).toEqual(["<=5", "18-20"]);
  });

  it("deja pasar las ventanas que el calendario sí lee, y la lista vacía", () => {
    seedFixture(db);
    const sueldo = getStrategyConfig(db).sueldo;

    setStrategyConfig(db, { sueldo: { ...sueldo, diasPago: ["<=5", "18-20"] } });
    expect(getStrategyConfig(db).sueldo.diasPago).toEqual(["<=5", "18-20"]);

    // Vacío es "todavía no lo configuré", que es el estado del seed y un valor
    // legítimo: no se puede rechazar sin romper la instalación nueva.
    setStrategyConfig(db, { sueldo: { ...sueldo, diasPago: [] } });
    expect(getStrategyConfig(db).sueldo.diasPago).toEqual([]);
  });

  it("rechaza un colchón objetivo negativo", () => {
    seedFixture(db);

    expect(() => setStrategyConfig(db, { colchonObjetivo: -500 })).toThrow(/colchonObjetivo/);
    expect(getStrategyConfig(db).colchonObjetivo).toBe(1200);

    // Cero sí: es "no fijé objetivo", y lo distingue `colchonStatus.fijado`.
    setStrategyConfig(db, { colchonObjetivo: 0 });
    expect(getStrategyConfig(db).colchonObjetivo).toBe(0);
  });
});
