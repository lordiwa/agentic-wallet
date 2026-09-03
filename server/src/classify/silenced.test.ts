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
    expect(silenceCounterparty(db, "  Farmacía Lima  ")).toBe(true);

    expect(silencedPatterns(db)).toEqual(new Set(["farmacia lima"]));
    expect(listSilencedCounterparties(db)[0]).toMatchObject({
      pattern: "farmacia lima",
      counterparty: "Farmacía Lima",
    });
  });

  it("es idempotente y refresca la grafía", () => {
    silenceCounterparty(db, "FARMACIA LIMA");
    silenceCounterparty(db, "Farmacia Lima");

    const silenced = listSilencedCounterparties(db);
    expect(silenced).toHaveLength(1);
    expect(silenced[0].counterparty).toBe("Farmacia Lima");
  });

  it("rechaza un texto que queda vacío al normalizarlo, sin escribir nada", () => {
    expect(silenceCounterparty(db, "   ")).toBe(false);
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
