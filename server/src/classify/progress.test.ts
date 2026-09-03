import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertTransaction, type NewTransaction } from "../db/repository.js";
import { migrate } from "../db/schema.js";
import { classifyCounterparty } from "./apply.js";
import { classifyProgress } from "./progress.js";
import { silenceCounterparty } from "./silenced.js";

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

/** Cuatro comercios de 100, 50, 30 y 20: 200 de plata sin clasificar. */
function ledgerDeCuatro(): void {
  insertTransaction(db, tx({ gmail_msg_id: "a", counterparty: "COMERCIO A", amount: 100 }));
  insertTransaction(db, tx({ gmail_msg_id: "b", counterparty: "COMERCIO B", amount: 50 }));
  insertTransaction(db, tx({ gmail_msg_id: "c", counterparty: "COMERCIO C", amount: 30 }));
  insertTransaction(db, tx({ gmail_msg_id: "d", counterparty: "COMERCIO D", amount: 20 }));
}

describe("classifyProgress (H35, M1) — el progreso se mide en plata", () => {
  it("arranca en cero cubierto, con la cola entera sin clasificar", () => {
    ledgerDeCuatro();

    expect(classifyProgress(db)).toMatchObject({
      spending_total: 200,
      baseline_total: 200,
      covered_total: 0,
      covered_ratio: 0,
      unclassified_total: 200,
      unclassified_ratio: 1,
      groups: 4,
      transactions: 4,
      target_ratio: 0.8,
      done: false,
    });
  });

  it("dice cuántas respuestas más faltan para el 80 % de la plata", () => {
    ledgerDeCuatro();

    // 100 + 50 + 30 = 180 = el 90 % de 200; con dos respuestas (150) todavía no
    // se llega al 80 % (160), así que hacen falta tres.
    expect(classifyProgress(db)).toMatchObject({ answers_to_target: 3, amount_to_target: 180 });
  });

  it("responder mueve el progreso, y el criterio de terminado es el 80 % de la plata, no cero filas", () => {
    ledgerDeCuatro();

    classifyCounterparty(db, { counterparty: "COMERCIO A", category: "comida" });
    classifyCounterparty(db, { counterparty: "COMERCIO B", category: "salud" });
    classifyCounterparty(db, { counterparty: "COMERCIO C", category: "mascota" });

    const progress = classifyProgress(db);

    expect(progress).toMatchObject({
      covered_total: 180,
      covered_ratio: 0.9,
      unclassified_total: 20,
      answers_to_target: 0,
      done: true,
    });
    // La cola NO está vacía y aun así está terminada: eso es exactamente M1.
    expect(progress.groups).toBe(1);
  });

  /** La plata silenciada cuenta como cubierta: la pregunta quedó cerrada. Sin
   * esto, una contraparte con dos verdades dejaría el 80 % fuera de alcance. */
  it("silenciar cubre plata igual que responder", () => {
    ledgerDeCuatro();

    silenceCounterparty(db, "COMERCIO A");

    expect(classifyProgress(db)).toMatchObject({
      covered_total: 100,
      covered_ratio: 0.5,
      unclassified_total: 100,
      groups: 3,
    });
  });

  it("una cola que nunca tuvo trabajo está terminada, no en cero por ciento", () => {
    insertTransaction(db, tx({ gmail_msg_id: "retiro", type: "retiro", counterparty: "CAJERO UNO", amount: 40 }));

    expect(classifyProgress(db)).toMatchObject({
      baseline_total: 0,
      covered_ratio: 1,
      unclassified_total: 0,
      answers_to_target: 0,
      done: true,
    });
  });

  it("no se cae con el ledger vacío", () => {
    expect(classifyProgress(db)).toMatchObject({ spending_total: 0, groups: 0, done: true });
  });
});
