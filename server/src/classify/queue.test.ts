import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertCategoryRule } from "../category/rules-repository.js";
import { insertTransaction, type NewTransaction } from "../db/repository.js";
import { migrate } from "../db/schema.js";
import { classifyQueue } from "./queue.js";
import { silenceCounterparty } from "./silenced.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

/** Nombres ficticios, siempre: ningún dato personal entra al repo (CLAUDE.md). */
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

describe("classifyQueue (H32) — grupos, no filas", () => {
  it("agrupa por contraparte y trae movimientos, plata y meses distintos", () => {
    insertTransaction(db, tx({ gmail_msg_id: "a1", counterparty: "TIENDA AURORA", amount: 100, ts: "2026-05-02T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "a2", counterparty: "Tienda Aurora", amount: 50, ts: "2026-06-02T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "a3", counterparty: "TIENDA AURORA", amount: 25, ts: "2026-06-20T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "b1", counterparty: "KIOSCO BELEN", amount: 40 }));

    const queue = classifyQueue(db);

    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({
      pattern: "tienda aurora",
      count: 3,
      total: 175,
      // mayo y junio: dos meses distintos, tres movimientos.
      months: 2,
      category: "otros",
    });
    // La grafía que se muestra es la del movimiento más reciente.
    expect(queue[0].counterparty).toBe("TIENDA AURORA");
    expect(queue[1]).toMatchObject({ pattern: "kiosco belen", count: 1, total: 40, months: 1 });
  });

  it("ordena por plata descendente por defecto", () => {
    insertTransaction(db, tx({ gmail_msg_id: "c1", counterparty: "Comercio Chico", amount: 5 }));
    insertTransaction(db, tx({ gmail_msg_id: "g1", counterparty: "Comercio Grande", amount: 500 }));
    insertTransaction(db, tx({ gmail_msg_id: "m1", counterparty: "Comercio Medio", amount: 80 }));

    expect(classifyQueue(db).map((group) => group.total)).toEqual([500, 80, 5]);
  });

  /**
   * La corrección que da sentido a toda la fase: la cola es la de la categoría
   * RECALCULADA. Sobre el ledger real la columna da 130 filas y el recálculo
   * 334 — preguntar sobre la columna es preguntar por filas que el gráfico ya
   * tiene clasificadas.
   */
  it("usa la categoría recalculada, no la columna: una fila con category='otros' pero con regla NO aparece", () => {
    upsertCategoryRule(db, "farmacia lima", "salud");
    insertTransaction(
      db,
      tx({ gmail_msg_id: "col1", counterparty: "FARMACIA LIMA", amount: 60, category: "otros" })
    );
    insertTransaction(db, tx({ gmail_msg_id: "col2", counterparty: "TIENDA AURORA", amount: 10 }));

    expect(classifyQueue(db).map((group) => group.pattern)).toEqual(["tienda aurora"]);
  });

  it("incluye las transferencias a comercios: transferencia_persona también es un fallback", () => {
    insertTransaction(
      db,
      tx({ gmail_msg_id: "t1", type: "transferencia", counterparty: "CENTRO MEDICO NORTE", amount: 200 })
    );

    expect(classifyQueue(db)[0]).toMatchObject({
      pattern: "centro medico norte",
      category: "transferencia_persona",
    });
  });

  it("deja fuera lo que ya tiene categoría por tipo, el ingreso y lo que ningún total cuenta", () => {
    insertTransaction(db, tx({ gmail_msg_id: "retiro", type: "retiro", counterparty: "CAJERO UNO", amount: 40 }));
    insertTransaction(db, tx({ gmail_msg_id: "servicio", type: "servicio", counterparty: "LUZ SUR", amount: 30 }));
    insertTransaction(
      db,
      tx({ gmail_msg_id: "sueldo", direction: "in", type: "sueldo", counterparty: "EMPRESA UNO", amount: 1000 })
    );
    insertTransaction(db, tx({ gmail_msg_id: "interna", type: "transferencia", counterparty: "Cuenta Propia", is_internal: true, amount: 300 }));
    insertTransaction(db, tx({ gmail_msg_id: "reversada", counterparty: "TIENDA AURORA", is_reversed: true, amount: 70 }));
    insertTransaction(db, tx({ gmail_msg_id: "revision", counterparty: "KIOSCO BELEN", needs_review: true, amount: 90 }));
    insertTransaction(db, tx({ gmail_msg_id: "sin-nombre", counterparty: null, amount: 15 }));

    expect(classifyQueue(db)).toEqual([]);
  });

  it("acepta filtrarse por un lote de transacciones, para el aviso post-sync (D7-b)", () => {
    const lote = insertTransaction(db, tx({ gmail_msg_id: "lote1", counterparty: "TIENDA AURORA", amount: 20 }));
    insertTransaction(db, tx({ gmail_msg_id: "viejo", counterparty: "KIOSCO BELEN", amount: 900 }));

    const queue = classifyQueue(db, { transactionIds: [lote.row.id] });

    expect(queue.map((group) => group.pattern)).toEqual(["tienda aurora"]);
    // Una lista vacía es una cola vacía, no "sin filtro".
    expect(classifyQueue(db, { transactionIds: [] })).toEqual([]);
  });

  it("recorta con limit sin cambiar el orden por plata", () => {
    insertTransaction(db, tx({ gmail_msg_id: "x1", counterparty: "Comercio Grande", amount: 500 }));
    insertTransaction(db, tx({ gmail_msg_id: "x2", counterparty: "Comercio Medio", amount: 80 }));
    insertTransaction(db, tx({ gmail_msg_id: "x3", counterparty: "Comercio Chico", amount: 5 }));

    expect(classifyQueue(db, { limit: 2 }).map((group) => group.pattern)).toEqual([
      "comercio grande",
      "comercio medio",
    ]);
  });

  it("una contraparte silenciada sale de la cola (H33)", () => {
    insertTransaction(db, tx({ gmail_msg_id: "s1", counterparty: "PERSONA UNO", type: "transferencia", amount: 300 }));
    insertTransaction(db, tx({ gmail_msg_id: "s2", counterparty: "TIENDA AURORA", amount: 10 }));

    silenceCounterparty(db, "Persona Uno");

    expect(classifyQueue(db).map((group) => group.pattern)).toEqual(["tienda aurora"]);
  });

  it("no se cae con el ledger vacío", () => {
    expect(classifyQueue(db)).toEqual([]);
  });
});
