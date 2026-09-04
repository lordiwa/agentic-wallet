import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { insertTransaction } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { upsertCategoryRule } from "../category/rules-repository.js";
import { CATEGORIES } from "../category/categorize.js";
import { categorizedSpendingRows, spendingByCategory } from "./spending.js";

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

const JULY = { from: new Date("2026-07-01T05:00:00.000Z"), to: new Date("2026-08-01T05:00:00.000Z") };

describe("spendingByCategory (spec §9.8)", () => {
  it("aggregates only direction='out' gasto rows, categorized via F2-B's categorize()", () => {
    // income must NEVER inflate a category bucket (F2-B review critical fix)
    insertTransaction(db, tx({ gmail_msg_id: "income", direction: "in", type: "sueldo", amount: 1000 }));

    // Establishment categories come from the user's own category_rules, never
    // from a shipped merchant list -- so the rule is part of the fixture.
    upsertCategoryRule(db, "veterinaria", "mascota");
    insertTransaction(db, tx({ gmail_msg_id: "g1", type: "debito", counterparty: "VETERINARIA CENTRAL", amount: 25 }));
    insertTransaction(db, tx({ gmail_msg_id: "g2", type: "retiro", amount: 40 }));
    insertTransaction(db, tx({ gmail_msg_id: "g3", type: "transferencia", counterparty: "Persona Dos", amount: 60 }));

    // exclusions
    insertTransaction(db, tx({ gmail_msg_id: "internal", type: "transferencia", is_internal: true, amount: 200 }));
    insertTransaction(db, tx({ gmail_msg_id: "reversed", is_reversed: true, amount: 15 }));
    insertTransaction(db, tx({ gmail_msg_id: "review", type: "servicio", needs_review: true, amount: 12 }));
    insertTransaction(db, tx({ gmail_msg_id: "reverso", type: "reverso", amount: 9 }));
    insertTransaction(db, tx({ gmail_msg_id: "out-of-range", amount: 999, ts: "2026-06-15T12:00:00Z" }));

    const result = spendingByCategory(db, JULY);

    expect(result).toEqual({
      mascota: 25,
      efectivo: 40,
      transferencia_persona: 60,
    });
  });

  /**
   * El caso que rompia el dashboard: cuando el comercio cobra por
   * transferencia, el gasto real vive en filas `type: 'transferencia'`. Sin la
   * prioridad de las reglas, las tres filas de abajo sumaban 300 en
   * 'transferencia_persona' y comida/servicios/salud no aparecian.
   */
  it("clasifica por regla las transferencias a comercios, dejando solo las personas en transferencia_persona", () => {
    upsertCategoryRule(db, "restaurante", "comida");
    upsertCategoryRule(db, "electrica", "servicios");
    upsertCategoryRule(db, "centro medico", "salud");

    insertTransaction(db, tx({ gmail_msg_id: "t1", type: "transferencia", counterparty: "RESTAURANTE EL FOGON", amount: 100 }));
    insertTransaction(db, tx({ gmail_msg_id: "t2", type: "transferencia", counterparty: "EMPRESA ELECTRICA REGIONAL", amount: 120 }));
    insertTransaction(db, tx({ gmail_msg_id: "t3", type: "transferencia", counterparty: "CENTRO MEDICO SUR", amount: 80 }));
    insertTransaction(db, tx({ gmail_msg_id: "t4", type: "transferencia", counterparty: "Maria Lopez", amount: 45 }));

    expect(spendingByCategory(db, JULY)).toEqual({
      comida: 100,
      servicios: 120,
      salud: 80,
      transferencia_persona: 45,
    });
  });

  it("returns an empty object for a period with only income, no gasto", () => {
    insertTransaction(db, tx({ gmail_msg_id: "income", direction: "in", type: "sueldo", amount: 1000 }));

    expect(spendingByCategory(db, JULY)).toEqual({});
  });

  it("returns an empty object without crashing on an empty ledger", () => {
    expect(() => spendingByCategory(db, JULY)).not.toThrow();
    expect(spendingByCategory(db, JULY)).toEqual({});
  });

  it("sums multiple transactions in the same category", () => {
    insertTransaction(db, tx({ gmail_msg_id: "r1", type: "retiro", amount: 20 }));
    insertTransaction(db, tx({ gmail_msg_id: "r2", type: "retiro", amount: 30 }));

    expect(spendingByCategory(db, JULY)).toEqual({ efectivo: 50 });
  });
});

/**
 * La pregunta que dispara estos casos fue *"¿las categorías nuevas se
 * contabilizan en el Resumen?"*, y merece una respuesta ejecutable y no una
 * lectura del código: la sospecha razonable es que en algún lado hubiera una
 * lista fija de "categorías que suman", y que sumar una al glosario la dejara
 * visible en la cola de preguntas pero invisible en el gráfico.
 *
 * **No la hay, y esto lo fija.** `spendingByCategory` agrupa por lo que
 * `categorize()` devuelva; su universo es el glosario entero. El test recorre
 * `CATEGORIES` completo en vez de nombrar las nuevas a mano, así que la
 * próxima categoría que alguien agregue queda cubierta el día que la agrega,
 * sin tocar este archivo.
 */
describe("cualquier categoria del glosario se contabiliza, no solo las del MVP", () => {
  /** Las que una regla de comercio puede alcanzar: el glosario menos los
   * fallbacks —que no se responden— y menos las que `categorize()` decide por
   * `type` antes de mirar las reglas (`efectivo`, `servicios`, `recarga`). */
  const ALCANZABLES = CATEGORIES.filter(
    (c) => !["otros", "transferencia_persona", "efectivo", "servicios", "recarga"].includes(c)
  );

  it("una regla a cualquiera de ellas mueve el gasto a esa barra del grafico", () => {
    for (const [i, categoria] of ALCANZABLES.entries()) {
      const patron = `comercio ficticio ${i}`;
      upsertCategoryRule(db, patron, categoria);
      insertTransaction(
        db,
        tx({ gmail_msg_id: `g-${categoria}`, type: "debito", counterparty: `Comercio Ficticio ${i}`, amount: 10 + i })
      );
    }

    const gasto = spendingByCategory(db, JULY);
    for (const [i, categoria] of ALCANZABLES.entries()) {
      expect({ categoria, total: gasto[categoria] }).toEqual({ categoria, total: 10 + i });
    }
  });

  /**
   * La barra y la lista tienen que contar lo mismo: tocar "Implementos de
   * trabajo 45" en el Resumen y aterrizar en una lista que suma otra cosa es
   * exactamente la incoherencia que `categorizedSpendingRows` existe para
   * hacer imposible (H21).
   */
  it("la lista de movimientos de la categoria nueva suma lo mismo que su barra", () => {
    upsertCategoryRule(db, "libreria tecnica", "implementos_trabajo");
    insertTransaction(db, tx({ gmail_msg_id: "h1", counterparty: "LIBRERIA TECNICA NORTE", amount: 30 }));
    insertTransaction(db, tx({ gmail_msg_id: "h2", counterparty: "Librería Técnica Sur", amount: 15 }));

    expect(spendingByCategory(db, JULY)).toEqual({ implementos_trabajo: 45 });

    const enLaLista = categorizedSpendingRows(db, JULY).filter((r) => r.category === "implementos_trabajo");
    expect(enLaLista).toHaveLength(2);
    expect(enLaLista.reduce((suma, r) => suma + r.amount, 0)).toBe(45);
  });
});
