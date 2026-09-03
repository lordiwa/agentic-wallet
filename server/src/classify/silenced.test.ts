import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertTransaction, type NewTransaction } from "../db/repository.js";
import { migrate } from "../db/schema.js";
import { classifyQueue } from "./queue.js";
import {
  listSilencedCounterparties,
  silenceCounterparty,
  silencedPatterns,
  unsilenceCounterparty,
} from "./silenced.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

function tx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    gmail_msg_id: `tx-${Math.random()}`,
    ts: "2026-07-10T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: 10,
    ...overrides,
  };
}

describe("silenciador de contrapartes (H33, M5)", () => {
  it("escribe, lee y normaliza el patrón", () => {
    insertTransaction(db, tx({ counterparty: "Farmacía Lima" }));
    expect(silenceCounterparty(db, "  Farmacía Lima  ")).toMatchObject({ ok: true, changed: true });

    expect(silencedPatterns(db)).toEqual(new Set(["farmacia lima"]));
    expect(listSilencedCounterparties(db)[0]).toMatchObject({
      pattern: "farmacia lima",
      counterparty: "Farmacía Lima",
    });
  });

  it("es idempotente, y la grafía que guarda es la del ledger", () => {
    // Desde W22 la grafía cruda sale de la fila más reciente del ledger y no
    // del texto que llegó — igual que en `apply.ts`, y por lo mismo: es la que
    // el usuario acaba de ver.
    insertTransaction(db, tx({ gmail_msg_id: "f1", ts: "2026-07-10T12:00:00Z", counterparty: "FARMACIA LIMA" }));
    insertTransaction(db, tx({ gmail_msg_id: "f2", ts: "2026-07-11T12:00:00Z", counterparty: "Farmacia Lima" }));
    silenceCounterparty(db, "FARMACIA LIMA");
    silenceCounterparty(db, "Farmacia Lima");

    const silenced = listSilencedCounterparties(db);
    expect(silenced).toHaveLength(1);
    expect(silenced[0].counterparty).toBe("Farmacia Lima");
  });

  it("rechaza un texto que queda vacío al normalizarlo, sin escribir nada", () => {
    expect(silenceCounterparty(db, "   ")).toEqual({ ok: false, error: "empty_pattern" });
    expect(listSilencedCounterparties(db)).toEqual([]);
  });

  /** El criterio de M5: una contraparte silenciada sale de la cola y NO vuelve.
   * Sin esto la cola nunca cierra para las contrapartes con dos verdades. */
  it("una contraparte silenciada sale de la cola y no vuelve, ni con movimientos nuevos", () => {
    insertTransaction(db, tx({ gmail_msg_id: "p1", type: "transferencia", counterparty: "PERSONA UNO", amount: 100 }));
    expect(classifyQueue(db)).toHaveLength(1);

    silenceCounterparty(db, "PERSONA UNO");
    expect(classifyQueue(db)).toEqual([]);

    // Llega otro movimiento de la misma contraparte, escrito distinto.
    insertTransaction(db, tx({ gmail_msg_id: "p2", type: "transferencia", counterparty: "Persona Uno", amount: 250 }));
    expect(classifyQueue(db)).toEqual([]);
  });

  it("se puede devolver a la cola lo silenciado por error", () => {
    insertTransaction(db, tx({ gmail_msg_id: "p1", counterparty: "TIENDA AURORA", amount: 100 }));
    silenceCounterparty(db, "TIENDA AURORA");
    expect(classifyQueue(db)).toEqual([]);

    expect(unsilenceCounterparty(db, "tienda aurora")).toBe(true);
    expect(classifyQueue(db)).toHaveLength(1);
    // Nada que devolver la segunda vez.
    expect(unsilenceCounterparty(db, "tienda aurora")).toBe(false);
  });
});

/**
 * Wargaming ronda 3 (W21 y W22). El silenciador era el único escritor de
 * patrones del motor que **no valida contra el ledger**, y el único que devolvía
 * `ok` sin decir si había cambiado algo.
 *
 * - **W22.** `classifyCounterparty` deriva el patrón de la contraparte REAL
 *   —ésa es la trampa fundacional del proyecto, y `apply.ts` la cierra por
 *   construcción— y `silenceCounterparty` escribía cualquier texto. Con
 *   `toRulePattern` insensible a caja y acentos pero **no al espaciado
 *   interno**, silenciar `"CAFE  centro"` (dos espacios) guardaba el patrón
 *   `cafe  centro`, devolvía 200 `ok`, y la contraparte `CAFE CENTRO` seguía en
 *   la cola. Un agente por MCP se lleva un éxito y un contador que sube por una
 *   fila que no puede matchear nada nunca.
 * - **W21.** `POST /classify/silence` no devolvía `changed`, así que la pantalla
 *   construía el efecto con los números de la tarjeta que tenía en la mano y
 *   celebraba *"6 movimientos por 960,00 salen de la cola"* la segunda vez, con
 *   cero movimientos saliendo. Es R13 —`changed:false` no es éxito— implementado
 *   para `resolve` y nunca para `silence`, y `DELETE` sí lo devolvía: la
 *   asimetría estaba en el mismo archivo de rutas.
 */
describe("silenceCounterparty — valida contra el ledger y dice si cambió (W21/W22)", () => {
  it("una contraparte que no está en el ledger no se silencia", () => {
    insertTransaction(db, tx({ counterparty: "CAFE CENTRO" }));
    expect(silenceCounterparty(db, "COMERCIO QUE NO EXISTE")).toEqual({
      ok: false,
      error: "counterparty_not_found",
    });
    expect(silencedPatterns(db).size).toBe(0);
  });

  it("un patrón que no matchea por espaciado tampoco: es la trampa de siempre", () => {
    insertTransaction(db, tx({ counterparty: "CAFE CENTRO" }));
    expect(silenceCounterparty(db, "  CAFE  centro ")).toEqual({
      ok: false,
      error: "counterparty_not_found",
    });
  });

  it("la caja y los acentos sí se perdonan: es el mismo comercio", () => {
    insertTransaction(db, tx({ counterparty: "CAFÉ CENTRO" }));
    const salida = silenceCounterparty(db, "cafe centro");
    expect(salida).toMatchObject({ ok: true, changed: true, pattern: "cafe centro" });
    expect(silencedPatterns(db).has("cafe centro")).toBe(true);
  });

  it("silenciar dos veces la misma dice que la segunda no cambió nada", () => {
    insertTransaction(db, tx({ counterparty: "CAFE CENTRO" }));
    expect(silenceCounterparty(db, "CAFE CENTRO")).toMatchObject({ ok: true, changed: true });
    expect(silenceCounterparty(db, "CAFE CENTRO")).toMatchObject({ ok: true, changed: false });
  });

  it("un texto vacío sigue siendo un patrón vacío, no una contraparte perdida", () => {
    insertTransaction(db, tx({ counterparty: "CAFE CENTRO" }));
    expect(silenceCounterparty(db, "   ")).toEqual({ ok: false, error: "empty_pattern" });
  });
});
