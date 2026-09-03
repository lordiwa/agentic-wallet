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

  /**
   * El wargaming del MVP (`docs/wargaming-mvp.md`, hallazgo W1). Los dos conteos
   * existen para que la pantalla pueda ser honesta (AC5 de TASK-055): la tarjeta
   * dice "2 movimientos · 120" y la respuesta dice "reclasificaste N". Si N
   * cuenta filas que **ningún total del motor cuenta** —un reverso, una interna,
   * una descartada, una que todavía espera confirmación de monto, un ingreso—
   * los dos números se contradicen en la misma pantalla, y peor:
   * `reclassified_this_month` es literalmente la promesa *"el gráfico se va a
   * mover"*, y el gráfico no cuenta ninguna de esas filas.
   *
   * Sobre el ledger real pasa en 2 de 147 grupos de la cola: la tarjeta dice 2 y
   * la respuesta contestaba 6.
   */
  it("los conteos cuentan sólo lo que el gráfico y los totales cuentan", () => {
    // La única fila que la cola ve y el gráfico suma.
    insertTransaction(db, tx({ gmail_msg_id: "v1", counterparty: "GIMNASIO SUR", amount: 40, ts: "2026-07-02T12:00:00Z" }));
    // Y cinco de la MISMA contraparte, del mismo mes, que ningún total cuenta.
    insertTransaction(
      db,
      tx({ gmail_msg_id: "x1", counterparty: "GIMNASIO SUR", amount: 40, ts: "2026-07-03T12:00:00Z", is_reversed: true })
    );
    insertTransaction(
      db,
      tx({ gmail_msg_id: "x2", counterparty: "GIMNASIO SUR", amount: 40, ts: "2026-07-04T12:00:00Z", is_internal: true })
    );
    insertTransaction(
      db,
      tx({ gmail_msg_id: "x3", counterparty: "GIMNASIO SUR", amount: 40, ts: "2026-07-05T12:00:00Z", needs_review: true })
    );
    // `is_discarded` no es campo de `NewTransaction`: lo escribe `review/resolve.ts`.
    insertTransaction(db, tx({ gmail_msg_id: "x4", counterparty: "GIMNASIO SUR", amount: 40, ts: "2026-07-06T12:00:00Z" }));
    db.prepare("UPDATE transactions SET is_discarded = 1 WHERE gmail_msg_id = 'x4'").run();
    // Un ingreso: el gráfico es `direction = 'out'` y nunca lo dibuja.
    insertTransaction(
      db,
      tx({
        gmail_msg_id: "x5",
        counterparty: "GIMNASIO SUR",
        amount: 40,
        ts: "2026-07-07T12:00:00Z",
        direction: "in",
        type: "recibido",
      })
    );

    // Lo que la tarjeta de la cola le prometió al usuario: un movimiento.
    expect(classifyQueue(db)).toMatchObject([{ counterparty: "GIMNASIO SUR", count: 1 }]);

    const result = classifyCounterparty(db, { counterparty: "GIMNASIO SUR", category: "salud" }, AHORA);

    // Y lo que la respuesta le dice: el mismo movimiento, no seis.
    expect(result).toMatchObject({ ok: true, reclassified: 1, reclassified_this_month: 1 });
  });

  /**
   * El otro lado del mismo hallazgo: que los conteos no las cuenten no significa
   * que el ledger quede a medias. La columna `category` se sigue escribiendo en
   * todas las filas que la regla mueve, que es lo que el doc del módulo promete
   * ("deja el ledger consistente con lo que el gráfico muestra").
   */
  it("aunque no las cuente, deja la columna `category` consistente en todas las filas", () => {
    insertTransaction(db, tx({ gmail_msg_id: "v1", counterparty: "GIMNASIO SUR", amount: 40 }));
    insertTransaction(db, tx({ gmail_msg_id: "x1", counterparty: "GIMNASIO SUR", amount: 40, is_reversed: true }));

    classifyCounterparty(db, { counterparty: "GIMNASIO SUR", category: "salud" }, AHORA);

    const categorias = db
      .prepare("SELECT category FROM transactions WHERE counterparty = 'GIMNASIO SUR' ORDER BY gmail_msg_id")
      .all() as { category: string | null }[];
    expect(categorias).toEqual([{ category: "salud" }, { category: "salud" }]);
  });
});

/**
 * Wargaming ronda 2 (W12) — el alcance por substring vuelve a hacer que la
 * respuesta contradiga a la tarjeta.
 *
 * W1 arregló *qué filas* se cuentan, pero no la otra mitad de la misma frase:
 * una regla matchea con `includes`, así que responder por un nombre corto
 * mueve también los movimientos de las contrapartes que lo contienen, y ésas
 * salen de la cola **sin haber sido preguntadas**. Sobre el ledger real le pasa
 * a 10 de los 147 grupos, y en el peor la tarjeta prometía **1 movimiento** y
 * la respuesta contestaba **"reclasificaste 7"** — el mismo síntoma que W1, por
 * otra puerta.
 *
 * El conteo no se recorta: los 7 se movieron de verdad y el gráfico se mueve
 * por los 7. Lo que faltaba era **decir que hubo más de una contraparte**.
 */
describe("classifyCounterparty — el alcance se dice, no se descubre (W12)", () => {
  function ledgerConSolapamiento(): void {
    insertTransaction(db, tx({ gmail_msg_id: "s1", counterparty: "TIENDA FICTICIA", amount: 10 }));
    for (const n of [1, 2, 3]) {
      insertTransaction(db, tx({ gmail_msg_id: `s2-${n}`, counterparty: "TIENDA FICTICIA NORTE", amount: 5 }));
    }
  }

  it("informa cuántas OTRAS contrapartes arrastró la regla", () => {
    ledgerConSolapamiento();

    const result = classifyCounterparty(db, { counterparty: "TIENDA FICTICIA", category: "comida" }, AHORA);

    expect(result).toMatchObject({ ok: true, reclassified: 4, otras_contrapartes: 1 });
  });

  it("sin solapamiento no arrastra a nadie y lo dice con un cero", () => {
    insertTransaction(db, tx({ gmail_msg_id: "u1", counterparty: "TIENDA UNICA", amount: 10 }));

    const result = classifyCounterparty(db, { counterparty: "TIENDA UNICA", category: "comida" }, AHORA);

    expect(result).toMatchObject({ ok: true, reclassified: 1, otras_contrapartes: 0 });
  });

  it("el número que se informa es el de los grupos que desaparecen de la cola", () => {
    ledgerConSolapamiento();
    expect(classifyQueue(db)).toHaveLength(2);

    const result = classifyCounterparty(db, { counterparty: "TIENDA FICTICIA", category: "comida" }, AHORA);

    expect(classifyQueue(db)).toHaveLength(0);
    expect(result).toMatchObject({ otras_contrapartes: 1 });
  });

  it("una contraparte arrastrada que ningún total cuenta no infla el número", () => {
    insertTransaction(db, tx({ gmail_msg_id: "v1", counterparty: "TIENDA FICTICIA", amount: 10 }));
    insertTransaction(
      db,
      tx({ gmail_msg_id: "v2", counterparty: "TIENDA FICTICIA SUR", amount: 40, is_internal: 1 })
    );

    const result = classifyCounterparty(db, { counterparty: "TIENDA FICTICIA", category: "comida" }, AHORA);

    expect(result).toMatchObject({ reclassified: 1, otras_contrapartes: 0 });
  });
});
