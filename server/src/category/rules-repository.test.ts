import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertTransaction, type NewTransaction } from "../db/repository.js";
import { migrate } from "../db/schema.js";
import { learnRulesFromHistory, listCategoryRules, upsertCategoryRule } from "./rules-repository.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

let seq = 0;
function tx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    gmail_msg_id: `tx-${++seq}`,
    ts: "2026-07-10T12:00:00Z",
    direction: "out",
    type: "transferencia",
    amount: 10,
    ...overrides,
  };
}

describe("learnRulesFromHistory", () => {
  it("convierte en regla cada contraparte que el usuario ya clasifico a mano", () => {
    insertTransaction(db, tx({ counterparty: "CENTRO MEDICO SUR", category: "salud" }));
    insertTransaction(db, tx({ counterparty: "RESTAURANTE EL FOGON", category: "comida" }));

    const result = learnRulesFromHistory(db);

    expect(result.learned).toBe(2);
    expect(listCategoryRules(db)).toEqual(
      expect.arrayContaining([
        { pattern: "centro medico sur", category: "salud" },
        { pattern: "restaurante el fogon", category: "comida" },
      ])
    );
  });

  it("es idempotente: la segunda corrida no aprende nada nuevo", () => {
    insertTransaction(db, tx({ counterparty: "CENTRO MEDICO SUR", category: "salud" }));

    expect(learnRulesFromHistory(db).learned).toBe(1);
    const second = learnRulesFromHistory(db);
    expect(second.learned).toBe(0);
    expect(second.skippedExisting).toBe(1);
    expect(listCategoryRules(db)).toHaveLength(1);
  });

  /** Una regla escrita por el usuario es una afirmacion; el historial es una
   * inferencia. La inferencia nunca pisa la afirmacion. */
  it("nunca pisa una regla que el usuario ya escribio", () => {
    upsertCategoryRule(db, "Farmacia Central", "salud");
    insertTransaction(db, tx({ counterparty: "FARMACIA CENTRAL", category: "comida" }));

    expect(learnRulesFromHistory(db).learned).toBe(0);
    expect(listCategoryRules(db)).toEqual([{ pattern: "farmacia central", category: "salud" }]);
  });

  it("no adivina cuando la misma contraparte tiene categorias contradictorias", () => {
    insertTransaction(db, tx({ counterparty: "TIENDA MIXTA", category: "comida" }));
    insertTransaction(db, tx({ counterparty: "Tienda Mixta", category: "servicios" }));

    const result = learnRulesFromHistory(db);

    expect(result.learned).toBe(0);
    expect(result.skippedAmbiguous).toBe(1);
    expect(listCategoryRules(db)).toEqual([]);
  });

  /**
   * `otros` y `transferencia_persona` no son afirmaciones sobre un comercio:
   * son justamente los fallbacks que `categorize` produce cuando NO sabe. Y
   * `efectivo`/`recarga` los deriva del `type`, sin mirar la contraparte.
   * Aprenderlos como reglas convertiria un fallback en dato y ademas
   * cristalizaria el nombre de una persona en un patron de comercio.
   */
  it("ignora las categorias que son fallback estructural o derivadas del type", () => {
    insertTransaction(db, tx({ counterparty: "Maria Lopez", category: "transferencia_persona" }));
    insertTransaction(db, tx({ counterparty: "COMISARIATO X", category: "otros" }));
    insertTransaction(db, tx({ counterparty: "Cajero 12", type: "retiro", category: "efectivo" }));
    insertTransaction(db, tx({ counterparty: "Operadora", type: "recarga", category: "recarga" }));

    expect(learnRulesFromHistory(db).learned).toBe(0);
    expect(listCategoryRules(db)).toEqual([]);
  });

  /** Una etiqueta fuera del glosario no la sabe devolver `categorize`: la
   * regla seria letra muerta que ademas tapa a las que si matchean. */
  it("ignora una categoria que no existe en el glosario", () => {
    insertTransaction(db, tx({ counterparty: "COMERCIO RARO", category: "categoria_inventada" }));

    expect(learnRulesFromHistory(db).learned).toBe(0);
    expect(listCategoryRules(db)).toEqual([]);
  });

  it("ignora ingresos, internas, reversadas y filas en revision", () => {
    insertTransaction(db, tx({ counterparty: "Empleador SA", direction: "in", type: "sueldo", category: "comida" }));
    insertTransaction(db, tx({ counterparty: "Cuenta Propia", is_internal: true, category: "comida" }));
    insertTransaction(db, tx({ counterparty: "Comercio Reversado", is_reversed: true, category: "comida" }));
    insertTransaction(db, tx({ counterparty: "Comercio Dudoso", needs_review: true, category: "comida" }));

    expect(learnRulesFromHistory(db).learned).toBe(0);
    expect(listCategoryRules(db)).toEqual([]);
  });

  it("ignora contrapartes vacias, que matchearian todo el ledger", () => {
    insertTransaction(db, tx({ counterparty: "   ", category: "comida" }));
    insertTransaction(db, tx({ counterparty: null, category: "comida" }));

    expect(learnRulesFromHistory(db).learned).toBe(0);
    expect(listCategoryRules(db)).toEqual([]);
  });

  it("no escribe nada en una base sin historial clasificado", () => {
    expect(learnRulesFromHistory(db)).toEqual({ learned: 0, skippedAmbiguous: 0, skippedExisting: 0 });
  });
});
