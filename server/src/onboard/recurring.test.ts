import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { insertTransaction, type NewTransaction } from "../db/repository.js";
import { upsertCategoryRule } from "../category/rules-repository.js";
import { silenceCounterparty } from "../classify/silenced.js";
import {
  MESES_MINIMOS_DE_HISTORIAL,
  MESES_PARA_SER_FIJO,
  TOPE_DE_PROPUESTAS,
  diaTipicoDe,
  suggestRecurringExpenses,
} from "./recurring.js";

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
  seq += 1;
  return {
    gmail_msg_id: `tx-${seq}`,
    ts: "2026-07-10T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: 10,
    ...overrides,
  };
}

/** Un gasto de `counterparty` el día `dia` del mes `mes` de 2026. Mediodía UTC
 * para que el corrimiento a hora local no cambie el día. */
function gasto(counterparty: string, mes: number, dia: number, amount: number): NewTransaction {
  const mm = String(mes).padStart(2, "0");
  const dd = String(dia).padStart(2, "0");
  return tx({ ts: `2026-${mm}-${dd}T12:00:00Z`, counterparty, amount });
}

/**
 * Un histórico largo de fondo, para que el freno de los 3 meses (R33) no se
 * active en los tests que no lo están probando. Cada mes con una contraparte
 * distinta a propósito: ninguna llega a tres meses, así que el fondo alarga el
 * historial sin agregar una candidata que después haya que descontar.
 */
function historialDeSeisMeses(): void {
  for (const mes of [1, 2, 3, 4, 5, 6]) {
    insertTransaction(db, gasto(`FONDO FICTICIO DE MES ${mes}`, mes, 2, 1));
  }
}

describe("suggestRecurringExpenses — la mediana (criterio 1)", () => {
  it("propone la MEDIANA de los totales mensuales, no el promedio", () => {
    historialDeSeisMeses();
    // Cinco meses de 20, y un mes con DOS cargos del mismo servicio (40).
    // Promedio de los totales mensuales: (20*5 + 40) / 6 = 23,33.
    // Mediana: 20. El mes doble no infla la propuesta.
    for (const mes of [1, 2, 3, 4, 5]) {
      insertTransaction(db, gasto("SERVICIO FICTICIO UNO", mes, 8, 20));
    }
    insertTransaction(db, gasto("SERVICIO FICTICIO UNO", 6, 8, 20));
    insertTransaction(db, gasto("SERVICIO FICTICIO UNO", 6, 22, 20));

    const propuesta = suggestRecurringExpenses(db).propuestas.find(
      (p) => p.counterparty === "SERVICIO FICTICIO UNO"
    );

    expect(propuesta?.montoEstimado).toBe(20);
  });

  it("con un número par de meses promedia los dos del medio, como suggestSalary", () => {
    historialDeSeisMeses();
    for (const [mes, monto] of [
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 40],
    ] as const) {
      insertTransaction(db, gasto("SERVICIO FICTICIO DOS", mes, 5, monto));
    }

    const propuesta = suggestRecurringExpenses(db).propuestas.find(
      (p) => p.counterparty === "SERVICIO FICTICIO DOS"
    );

    expect(propuesta?.montoEstimado).toBe(25);
  });

  it("un mes carísimo no arrastra la propuesta: la mediana lo ignora", () => {
    historialDeSeisMeses();
    for (const mes of [1, 2, 3, 4]) {
      insertTransaction(db, gasto("SERVICIO FICTICIO TRES", mes, 5, 15));
    }
    insertTransaction(db, gasto("SERVICIO FICTICIO TRES", 5, 5, 1500));

    const propuesta = suggestRecurringExpenses(db).propuestas.find(
      (p) => p.counterparty === "SERVICIO FICTICIO TRES"
    );

    expect(propuesta?.montoEstimado).toBe(15);
    // El promedio habría dado 312 — treinta veces la cuota real.
    expect(propuesta?.montoEstimado).toBeLessThan(20);
  });
});

describe("suggestRecurringExpenses — qué entra y qué no", () => {
  it("una contraparte con menos de tres meses distintos no es un gasto fijo", () => {
    historialDeSeisMeses();
    insertTransaction(db, gasto("COMERCIO FICTICIO OCASIONAL", 1, 3, 90));
    insertTransaction(db, gasto("COMERCIO FICTICIO OCASIONAL", 2, 3, 90));

    const salida = suggestRecurringExpenses(db);

    expect(MESES_PARA_SER_FIJO).toBe(3);
    expect(salida.propuestas.map((p) => p.counterparty)).not.toContain("COMERCIO FICTICIO OCASIONAL");
  });

  it("tres cargos en el MISMO mes tampoco son un gasto fijo", () => {
    historialDeSeisMeses();
    for (const dia of [3, 12, 27]) {
      insertTransaction(db, gasto("COMERCIO FICTICIO DE UN MES", 4, dia, 60));
    }

    const salida = suggestRecurringExpenses(db);

    expect(salida.propuestas.map((p) => p.counterparty)).not.toContain("COMERCIO FICTICIO DE UN MES");
  });

  it("no propone una contraparte que ya tiene regla: eso ya está contestado", () => {
    historialDeSeisMeses();
    for (const mes of [1, 2, 3, 4]) {
      insertTransaction(db, gasto("GIMNASIO FICTICIO", mes, 6, 35));
    }
    upsertCategoryRule(db, "GIMNASIO FICTICIO", "salud");

    const salida = suggestRecurringExpenses(db);

    expect(salida.propuestas.map((p) => p.counterparty)).not.toContain("GIMNASIO FICTICIO");
  });

  it("no propone una contraparte silenciada (M5): salió de la cola y no vuelve", () => {
    historialDeSeisMeses();
    for (const mes of [1, 2, 3, 4]) {
      insertTransaction(db, gasto("CONTACTO FICTICIO SILENCIADO", mes, 6, 55));
    }
    silenceCounterparty(db, "CONTACTO FICTICIO SILENCIADO");

    const salida = suggestRecurringExpenses(db);

    expect(salida.propuestas.map((p) => p.counterparty)).not.toContain("CONTACTO FICTICIO SILENCIADO");
  });

  it("una fila sin monto afirmado (needs_review) no entra: su plata no está en ningún total", () => {
    historialDeSeisMeses();
    for (const mes of [1, 2, 3]) {
      insertTransaction(db, gasto("COMERCIO FICTICIO EN REVISION", mes, 9, 70));
    }
    db.prepare("UPDATE transactions SET needs_review = 1 WHERE counterparty = ?").run(
      "COMERCIO FICTICIO EN REVISION"
    );

    const salida = suggestRecurringExpenses(db);

    expect(salida.propuestas.map((p) => p.counterparty)).not.toContain("COMERCIO FICTICIO EN REVISION");
  });

  it("un ingreso no es un gasto fijo", () => {
    historialDeSeisMeses();
    for (const mes of [1, 2, 3, 4]) {
      insertTransaction(
        db,
        tx({
          ts: `2026-0${mes}-15T12:00:00Z`,
          counterparty: "EMPRESA FICTICIA SA",
          amount: 1200,
          direction: "in",
          type: "sueldo",
        })
      );
    }

    const salida = suggestRecurringExpenses(db);

    expect(salida.propuestas.map((p) => p.counterparty)).not.toContain("EMPRESA FICTICIA SA");
  });
});

describe("suggestRecurringExpenses — el top 10 por plata (criterio 2)", () => {
  it("devuelve como mucho diez propuestas, las que más plata mueven", () => {
    historialDeSeisMeses();
    // Doce candidatas, cada una con tres meses; la número N mueve N*3 de plata.
    for (let n = 1; n <= 12; n += 1) {
      for (const mes of [1, 2, 3]) {
        insertTransaction(db, gasto(`COMERCIO FICTICIO ${String(n).padStart(2, "0")}`, mes, 4, n));
      }
    }

    const salida = suggestRecurringExpenses(db);

    expect(TOPE_DE_PROPUESTAS).toBe(10);
    expect(salida.propuestas).toHaveLength(10);
    expect(salida.propuestas[0].counterparty).toBe("COMERCIO FICTICIO 12");
    // Las dos más chicas quedan afuera y caen en la cola de clasificación.
    const nombres = salida.propuestas.map((p) => p.counterparty);
    expect(nombres).not.toContain("COMERCIO FICTICIO 01");
    expect(nombres).not.toContain("COMERCIO FICTICIO 02");
  });

  it("dice cuántas candidatas había y cuántas quedaron en la cola", () => {
    historialDeSeisMeses();
    for (let n = 1; n <= 12; n += 1) {
      for (const mes of [1, 2, 3]) {
        insertTransaction(db, gasto(`COMERCIO FICTICIO ${String(n).padStart(2, "0")}`, mes, 4, n));
      }
    }

    const salida = suggestRecurringExpenses(db);

    expect(salida.candidatas).toBe(12);
    expect(salida.enLaCola).toBe(2);
  });

  it("con menos de diez candidatas no inventa filas para llegar al tope", () => {
    historialDeSeisMeses();
    for (let n = 1; n <= 3; n += 1) {
      for (const mes of [1, 2, 3]) {
        insertTransaction(db, gasto(`COMERCIO FICTICIO ${n}`, mes, 4, n * 10));
      }
    }

    const salida = suggestRecurringExpenses(db);

    expect(salida.propuestas).toHaveLength(3);
    expect(salida.enLaCola).toBe(0);
  });
});

describe("suggestRecurringExpenses — el día típico y el tamaño de la muestra (criterio 3)", () => {
  it("dice en cuántos meses apareció, y cuántos movimientos lo respaldan", () => {
    historialDeSeisMeses();
    for (const mes of [1, 2, 3, 4]) {
      insertTransaction(db, gasto("SERVICIO FICTICIO CUATRO", mes, 12, 25));
    }
    // Un quinto movimiento en un mes que ya estaba: sube `count`, no `sampleSize`.
    insertTransaction(db, gasto("SERVICIO FICTICIO CUATRO", 4, 26, 25));

    const propuesta = suggestRecurringExpenses(db).propuestas.find(
      (p) => p.counterparty === "SERVICIO FICTICIO CUATRO"
    );

    expect(propuesta?.sampleSize).toBe(4);
    expect(propuesta?.count).toBe(5);
  });

  it("el día típico es la mediana de los días observados, no el primero ni el último", () => {
    historialDeSeisMeses();
    for (const [mes, dia] of [
      [1, 3],
      [2, 5],
      [3, 5],
      [4, 28],
    ] as const) {
      insertTransaction(db, gasto("SERVICIO FICTICIO CINCO", mes, dia, 30));
    }

    const propuesta = suggestRecurringExpenses(db).propuestas.find(
      (p) => p.counterparty === "SERVICIO FICTICIO CINCO"
    );

    expect(propuesta?.diaTipico).toBe(5);
  });

  /**
   * El wargaming del MVP (`docs/wargaming-mvp.md`, hallazgo W2). La mediana de
   * unos días que no se parecen entre sí no es un día típico: es un número que
   * cae en el medio de la dispersión. Con cargos el 2 y el 27 la mediana da
   * ~15, y la pantalla dice *"suele caer el 15 de cada mes"* sobre un día en el
   * que no pasó nada, nunca. Es una frase inventada con formato de lectura, y
   * la regla 3 del CLAUDE.md la prohíbe tanto como a un valor precargado.
   *
   * Sobre el ledger real le pasa a 5 de las 10 propuestas: son contrapartes con
   * 4 movimientos por mes repartidos por todo el calendario —transferencias a
   * una persona, no un débito automático—, y ahí no hay día que decir.
   */
  it("no inventa un día típico cuando los días no se parecen entre sí", () => {
    historialDeSeisMeses();
    for (const [mes, dia] of [
      [1, 2],
      [2, 27],
      [3, 3],
      [4, 26],
    ] as const) {
      insertTransaction(db, gasto("SERVICIO FICTICIO DISPERSO", mes, dia, 30));
    }

    const propuesta = suggestRecurringExpenses(db).propuestas.find(
      (p) => p.counterparty === "SERVICIO FICTICIO DISPERSO"
    );

    // Sigue siendo una propuesta —la plata es real y el usuario puede
    // clasificarla— pero sin un día que prometer.
    expect(propuesta).toBeDefined();
    expect(propuesta?.diaTipico).toBeNull();
  });

  it("muestra la grafía del movimiento más reciente y su fecha", () => {
    historialDeSeisMeses();
    insertTransaction(db, gasto("SERVICIO FICTICIO SEIS", 1, 4, 40));
    insertTransaction(db, gasto("SERVICIO FICTICIO SEIS", 2, 4, 40));
    insertTransaction(db, gasto("Servicio Ficticio Seis", 3, 4, 40));

    const propuesta = suggestRecurringExpenses(db).propuestas.find(
      (p) => p.pattern === "servicio ficticio seis"
    );

    expect(propuesta?.counterparty).toBe("Servicio Ficticio Seis");
    expect(propuesta?.lastTs).toBe("2026-03-04T12:00:00Z");
  });

  it("el total es la suma de todo lo que movió, y es el orden de la lista", () => {
    historialDeSeisMeses();
    for (const mes of [1, 2, 3]) {
      insertTransaction(db, gasto("SERVICIO FICTICIO SIETE", mes, 4, 10.05));
    }

    const propuesta = suggestRecurringExpenses(db).propuestas.find(
      (p) => p.counterparty === "SERVICIO FICTICIO SIETE"
    );

    // Sumado en centavos: 10,05 * 3 en coma flotante da 30,150000000000002.
    expect(propuesta?.total).toBe(30.15);
  });
});

describe("suggestRecurringExpenses — el freno de los 3 meses (R33, criterio 5)", () => {
  it("con menos de tres meses de historial no propone nada, y lo dice", () => {
    // Cinco semanas de historial que igual tocan tres meses del calendario.
    insertTransaction(db, gasto("SERVICIO FICTICIO OCHO", 1, 31, 20));
    insertTransaction(db, gasto("SERVICIO FICTICIO OCHO", 2, 15, 20));
    insertTransaction(db, gasto("SERVICIO FICTICIO OCHO", 3, 1, 20));

    const salida = suggestRecurringExpenses(db);

    expect(MESES_MINIMOS_DE_HISTORIAL).toBe(3);
    expect(salida.suficienteHistorial).toBe(false);
    expect(salida.propuestas).toEqual([]);
    expect(salida.mesesDeHistorial).toBeLessThan(3);
  });

  it("las candidatas del historial corto quedan en la cola, no desaparecen", () => {
    insertTransaction(db, gasto("SERVICIO FICTICIO NUEVE", 1, 31, 20));
    insertTransaction(db, gasto("SERVICIO FICTICIO NUEVE", 2, 15, 20));
    insertTransaction(db, gasto("SERVICIO FICTICIO NUEVE", 3, 1, 20));

    const salida = suggestRecurringExpenses(db);

    expect(salida.candidatas).toBe(1);
    expect(salida.enLaCola).toBe(1);
  });

  it("un ledger vacío no rompe y no promete nada", () => {
    const salida = suggestRecurringExpenses(db);

    expect(salida).toMatchObject({
      propuestas: [],
      candidatas: 0,
      enLaCola: 0,
      mesesDeHistorial: 0,
      suficienteHistorial: false,
    });
  });

  it("con tres meses cumplidos el análisis se activa", () => {
    historialDeSeisMeses();
    for (const mes of [1, 2, 3]) {
      insertTransaction(db, gasto("SERVICIO FICTICIO DIEZ", mes, 7, 45));
    }

    const salida = suggestRecurringExpenses(db);

    expect(salida.suficienteHistorial).toBe(true);
    expect(salida.propuestas.map((p) => p.counterparty)).toContain("SERVICIO FICTICIO DIEZ");
  });
});

describe("suggestRecurringExpenses — nada se guarda (criterio 4)", () => {
  it("es una lectura pura: no escribe una regla ni toca strategy_config", () => {
    historialDeSeisMeses();
    for (const mes of [1, 2, 3]) {
      insertTransaction(db, gasto("SERVICIO FICTICIO ONCE", mes, 7, 45));
    }
    const antesReglas = db.prepare("SELECT COUNT(*) as c FROM category_rules").get() as { c: number };
    const antesConfig = db.prepare("SELECT COUNT(*) as c FROM strategy_config").get() as { c: number };
    const antesCategorias = db
      .prepare("SELECT COUNT(*) as c FROM transactions WHERE category IS NOT NULL")
      .get() as { c: number };

    suggestRecurringExpenses(db);

    expect(db.prepare("SELECT COUNT(*) as c FROM category_rules").get()).toEqual(antesReglas);
    expect(db.prepare("SELECT COUNT(*) as c FROM strategy_config").get()).toEqual(antesConfig);
    expect(db.prepare("SELECT COUNT(*) as c FROM transactions WHERE category IS NOT NULL").get()).toEqual(
      antesCategorias
    );
  });
});

/**
 * Wargaming ronda 2 (W9). El guarda de la desviación absoluta mediana acota
 * cuánto se dispersan los días, pero no dice nada sobre el día que se nombra:
 * con los cargos repartidos 10/10/14/14 la mediana cae en 12, un día en el que
 * no hubo un solo movimiento. Es exactamente la afirmación que W2 vino a
 * eliminar, entrando por otra puerta.
 */
describe("diaTipicoDe — el día que se dice es un día en el que pasó algo (W9)", () => {
  it("una distribución bimodal no inventa el hueco del medio", () => {
    expect([10, 10, 14, 14]).toContain(diaTipicoDe([10, 10, 14, 14]));
  });

  it("dos días seguidos no producen el día de al lado", () => {
    expect([28, 31]).toContain(diaTipicoDe([28, 28, 31, 31]));
  });

  it("nunca devuelve un día que no está entre los observados", () => {
    const casos = [
      [10, 10, 14, 14],
      [13, 14, 16, 17],
      [5, 5, 5, 9, 9, 9],
      [3, 20, 22, 23],
      [28, 28, 31, 31],
    ];
    for (const dias of casos) {
      const dia = diaTipicoDe(dias);
      if (dia !== null) expect(dias).toContain(dia);
    }
  });

  it("no se afloja el guarda: una dispersión ancha sigue sin día", () => {
    expect(diaTipicoDe([2, 27, 3, 26])).toBeNull();
    expect(diaTipicoDe([1, 1, 29, 29])).toBeNull();
  });

  it("lo que ya leía bien sigue leyéndose igual", () => {
    expect(diaTipicoDe([3, 4, 5])).toBe(4);
    expect(diaTipicoDe([7, 9, 11])).toBe(9);
    expect(diaTipicoDe([15, 15, 15])).toBe(15);
  });
});
