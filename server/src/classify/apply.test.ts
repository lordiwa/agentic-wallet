import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listCategoryRules } from "../category/rules-repository.js";
import { insertTransaction, type NewTransaction } from "../db/repository.js";
import { migrate } from "../db/schema.js";
import { classifyCounterparty } from "./apply.js";
import { classifyQueue } from "./queue.js";

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

/** Un "ahora" fijo: julio de 2026 es el mes en curso de estos tests. */
const AHORA = new Date("2026-07-15T12:00:00Z");

describe("classifyCounterparty (H28, M4) — responder escribe UNA regla", () => {
  it("escribe una sola regla con el patrón derivado de la contraparte real", () => {
    insertTransaction(db, tx({ gmail_msg_id: "f1", counterparty: "FARMACIA LIMA", amount: 60 }));

    const result = classifyCounterparty(db, { counterparty: "FARMACIA LIMA", category: "salud" }, AHORA);

    expect(result).toMatchObject({ ok: true, pattern: "farmacia lima", category: "salud" });
    expect(listCategoryRules(db)).toEqual([{ pattern: "farmacia lima", category: "salud" }]);
  });

  /**
   * La trampa conocida del proyecto, y la razón por la que M4 puede eliminar el
   * editor de reglas: `matchEstablishment` busca el patrón DENTRO de la
   * contraparte, así que un patrón más largo no matchea nunca. Escrito a mano se
   * guardaba igual y no clasificaba una sola fila; acá no hay forma de escribirlo.
   */
  it("NUNCA toma el patrón de una entrada libre más larga que la contraparte", () => {
    insertTransaction(db, tx({ gmail_msg_id: "f1", counterparty: "FARMACIA LIMA", amount: 60 }));

    const result = classifyCounterparty(
      db,
      { counterparty: "FARMACIA LIMA SUCURSAL 3 DEL CENTRO", category: "salud" },
      AHORA
    );

    expect(result).toEqual({ ok: false, error: "counterparty_not_found" });
    // Y no quedó una regla muerta escrita.
    expect(listCategoryRules(db)).toEqual([]);
    expect(classifyQueue(db)).toHaveLength(1);
  });

  it("tampoco acepta un fragmento: la contraparte tiene que existir tal cual en el ledger", () => {
    insertTransaction(db, tx({ gmail_msg_id: "f1", counterparty: "FARMACIA LIMA", amount: 60 }));

    expect(classifyCounterparty(db, { counterparty: "farmacia", category: "salud" }, AHORA)).toEqual({
      ok: false,
      error: "counterparty_not_found",
    });
    expect(listCategoryRules(db)).toEqual([]);
  });

  it("resuelve la contraparte sin importar caja ni acentos, y guarda el patrón normalizado", () => {
    insertTransaction(db, tx({ gmail_msg_id: "f1", counterparty: "Farmacía Lima", amount: 60 }));

    const result = classifyCounterparty(db, { counterparty: "FARMACIA LIMA", category: "salud" }, AHORA);

    expect(result).toMatchObject({ ok: true, pattern: "farmacia lima", counterparty: "Farmacía Lima" });
  });

  it("rechaza un texto vacío sin escribir nada", () => {
    expect(classifyCounterparty(db, { counterparty: "   ", category: "salud" }, AHORA)).toEqual({
      ok: false,
      error: "empty_pattern",
    });
  });

  it("baja de la cola todas las filas de esa contraparte", () => {
    insertTransaction(db, tx({ gmail_msg_id: "f1", counterparty: "FARMACIA LIMA", amount: 60 }));
    insertTransaction(db, tx({ gmail_msg_id: "f2", counterparty: "Farmacia Lima", amount: 15 }));
    insertTransaction(db, tx({ gmail_msg_id: "otra", counterparty: "TIENDA AURORA", amount: 5 }));

    classifyCounterparty(db, { counterparty: "FARMACIA LIMA", category: "salud" }, AHORA);

    expect(classifyQueue(db).map((group) => group.pattern)).toEqual(["tienda aurora"]);
  });

  /** R19: el gráfico del Resumen es sólo del mes en curso. Sin el segundo número
   * la pantalla promete un efecto que a veces es cero. */
  it("devuelve cuántos movimientos reclasificó y cuántos son del mes en curso", () => {
    insertTransaction(db, tx({ gmail_msg_id: "j1", counterparty: "FARMACIA LIMA", amount: 60, ts: "2026-07-02T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "j2", counterparty: "FARMACIA LIMA", amount: 20, ts: "2026-07-28T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "m1", counterparty: "FARMACIA LIMA", amount: 30, ts: "2026-05-11T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "m2", counterparty: "FARMACIA LIMA", amount: 30, ts: "2026-06-11T12:00:00Z" }));

    const result = classifyCounterparty(db, { counterparty: "FARMACIA LIMA", category: "salud" }, AHORA);

    expect(result).toMatchObject({ ok: true, reclassified: 4, reclassified_this_month: 2 });
  });

  it("puede reclasificar cero de este mes, y lo dice", () => {
    insertTransaction(db, tx({ gmail_msg_id: "m1", counterparty: "FARMACIA LIMA", amount: 30, ts: "2026-03-11T12:00:00Z" }));

    expect(classifyCounterparty(db, { counterparty: "FARMACIA LIMA", category: "salud" }, AHORA)).toMatchObject({
      reclassified: 1,
      reclassified_this_month: 0,
    });
  });

  it("deja la columna `category` de acuerdo con lo que el usuario acaba de afirmar", () => {
    insertTransaction(db, tx({ gmail_msg_id: "f1", counterparty: "FARMACIA LIMA", amount: 60, category: "otros" }));

    classifyCounterparty(db, { counterparty: "FARMACIA LIMA", category: "salud" }, AHORA);

    const row = db.prepare("SELECT category FROM transactions WHERE gmail_msg_id = 'f1'").get() as {
      category: string;
    };
    expect(row.category).toBe("salud");
  });

  it("no toca la plata ni las banderas de revisión", () => {
    insertTransaction(db, tx({ gmail_msg_id: "f1", counterparty: "FARMACIA LIMA", amount: 60 }));
    const antes = db.prepare("SELECT amount, direction, type, needs_review FROM transactions").get();

    classifyCounterparty(db, { counterparty: "FARMACIA LIMA", category: "salud" }, AHORA);

    expect(db.prepare("SELECT amount, direction, type, needs_review FROM transactions").get()).toEqual(antes);
  });

  it("clasifica también las transferencias a un comercio, que es el caso del Escenario 1", () => {
    insertTransaction(
      db,
      tx({ gmail_msg_id: "t1", type: "transferencia", counterparty: "CENTRO MEDICO NORTE", amount: 200 })
    );

    const result = classifyCounterparty(db, { counterparty: "CENTRO MEDICO NORTE", category: "salud" }, AHORA);

    expect(result).toMatchObject({ ok: true, reclassified: 1 });
    expect(classifyQueue(db)).toEqual([]);
  });

  it("responder dos veces la misma contraparte cambia la regla y no duplica nada", () => {
    insertTransaction(db, tx({ gmail_msg_id: "f1", counterparty: "FARMACIA LIMA", amount: 60 }));

    classifyCounterparty(db, { counterparty: "FARMACIA LIMA", category: "salud" }, AHORA);
    const segunda = classifyCounterparty(db, { counterparty: "FARMACIA LIMA", category: "comida" }, AHORA);

    expect(segunda).toMatchObject({ ok: true, reclassified: 1 });
    expect(listCategoryRules(db)).toEqual([{ pattern: "farmacia lima", category: "comida" }]);
  });
});
