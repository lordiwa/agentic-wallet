import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertCategoryRule } from "../category/rules-repository.js";
import { insertTransaction, type NewTransaction } from "../db/repository.js";
import { migrate } from "../db/schema.js";
import { spendingByCategory } from "../strategy/spending.js";
import { movementsByCategory } from "./movements.js";

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

const JULIO = { from: new Date("2026-07-01T05:00:00.000Z"), to: new Date("2026-08-01T05:00:00.000Z") };

describe("movementsByCategory (H21 bien planteado)", () => {
  /**
   * El test que fija el cabo: la lista tiene que devolver exactamente lo que la
   * barra contó. Con un `WHERE category = ?` sobre la columna, este ledger
   * devolvería cero filas de 'salud' — la columna dice 'otros' y la barra dice
   * 180, porque la barra recalcula.
   */
  it("el conteo de la lista coincide con el de la barra, aunque la columna diga otra cosa", () => {
    upsertCategoryRule(db, "farmacia lima", "salud");
    insertTransaction(db, tx({ gmail_msg_id: "s1", counterparty: "FARMACIA LIMA", amount: 100, category: "otros" }));
    insertTransaction(db, tx({ gmail_msg_id: "s2", counterparty: "Farmacia Lima", amount: 80, category: null }));
    insertTransaction(db, tx({ gmail_msg_id: "otra", counterparty: "TIENDA AURORA", amount: 25 }));

    const barra = spendingByCategory(db, JULIO);
    const lista = movementsByCategory(db, { from: JULIO.from, to: JULIO.to, category: "salud" });

    expect(barra.salud).toBe(180);
    expect(lista.total).toBe(2);
    expect(lista.amount).toBe(barra.salud);
    expect(lista.transactions).toHaveLength(2);

    // Y el filtro por columna, que era la propuesta original de H21, no.
    const porColumna = db
      .prepare("SELECT COUNT(*) as c FROM transactions WHERE category = 'salud'")
      .get() as { c: number };
    expect(porColumna.c).toBe(0);
  });

  it("aplica las mismas exclusiones que la barra", () => {
    insertTransaction(db, tx({ gmail_msg_id: "ok", type: "retiro", amount: 40 }));
    insertTransaction(db, tx({ gmail_msg_id: "revision", type: "retiro", amount: 90, needs_review: true }));
    insertTransaction(db, tx({ gmail_msg_id: "interna", type: "retiro", amount: 70, is_internal: true }));
    insertTransaction(db, tx({ gmail_msg_id: "fuera", type: "retiro", amount: 55, ts: "2026-06-10T12:00:00Z" }));

    const lista = movementsByCategory(db, { from: JULIO.from, to: JULIO.to, category: "efectivo" });

    expect(lista.total).toBe(1);
    expect(lista.amount).toBe(spendingByCategory(db, JULIO).efectivo);
  });

  it("devuelve las filas completas, más recientes primero, y pagina con limit/offset", () => {
    insertTransaction(db, tx({ gmail_msg_id: "v1", type: "retiro", amount: 10, ts: "2026-07-02T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "v2", type: "retiro", amount: 20, ts: "2026-07-12T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "v3", type: "retiro", amount: 30, ts: "2026-07-22T12:00:00Z" }));

    const primera = movementsByCategory(db, { from: JULIO.from, to: JULIO.to, category: "efectivo", limit: 2 });
    expect(primera.transactions.map((row) => row.gmail_msg_id)).toEqual(["v3", "v2"]);
    // `total` es el de la barra, no el de la página: sin él "cargar más" no sabe
    // si queda algo.
    expect(primera.total).toBe(3);

    const segunda = movementsByCategory(db, { from: JULIO.from, to: JULIO.to, category: "efectivo", limit: 2, offset: 2 });
    expect(segunda.transactions.map((row) => row.gmail_msg_id)).toEqual(["v1"]);
  });

  /** Sin fechas, una barra significa el mes local en curso — el mismo período
   * que dibuja el gráfico del Resumen. Lo decide el motor, no la ruta. */
  it("sin fechas usa el mes local en curso", () => {
    insertTransaction(db, tx({ gmail_msg_id: "julio", type: "retiro", amount: 10, ts: "2026-07-20T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "junio", type: "retiro", amount: 99, ts: "2026-06-20T12:00:00Z" }));

    const lista = movementsByCategory(db, { category: "efectivo", now: new Date("2026-07-15T12:00:00Z") });

    expect(lista.transactions.map((row) => row.gmail_msg_id)).toEqual(["julio"]);
    expect(lista.amount).toBe(10);
  });

  it("una categoría sin movimientos devuelve una lista vacía, no un error", () => {
    insertTransaction(db, tx({ gmail_msg_id: "v1", type: "retiro", amount: 10 }));

    expect(movementsByCategory(db, { from: JULIO.from, to: JULIO.to, category: "mascota" })).toEqual({
      transactions: [],
      total: 0,
      amount: 0,
    });
  });
});
