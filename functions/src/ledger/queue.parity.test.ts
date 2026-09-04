/**
 * **Paridad de la cola de clasificación y su progreso.**
 *
 * `queue-parity.test.ts` ya probó lo más difícil: que el campo materializado
 * `queueEligible` no pierde ni inventa filas respecto de lo que el motor
 * calcula leyendo el ledger entero. Acá se prueba lo otro, que es lo que hace
 * que el panel muestre los mismos números: que la copia de `groupUnclassified`
 * y la copia de `classifyProgress` devuelvan, campo por campo, **lo mismo** que
 * las del motor sobre el mismo ledger.
 *
 * No es una comparación de "parecido": se compara el objeto entero con
 * `toEqual`, incluidos el orden de los grupos y los ratios de cuatro decimales.
 * Un redondeo que se corra un centavo acá se ve.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { classifyProgress } from "../../../server/src/classify/progress.js";
import { classifyQueue } from "../../../server/src/classify/queue.js";
import { configDelPuerto, fila, ledgerGrande, montar, OFFSET } from "../test-support/paridad.js";
import type { EstablishmentRule } from "./categorize.js";
import { computeProgress, groupUnclassified } from "./queue.js";
import type { LedgerDePrueba } from "../test-support/paridad.js";

function comparar(ledger: LedgerDePrueba): void {
  const montado = montar(ledger);
  try {
    const reglas = (ledger.reglas ?? []) as EstablishmentRule[];
    const silenciadas = new Set((ledger.silenciadas ?? []).map((s) => s.pattern));

    // La cola: grupos, orden y todo.
    expect(groupUnclassified(montado.elegibles, reglas, silenciadas, OFFSET)).toEqual(
      classifyQueue(montado.db)
    );

    // El progreso: los trece campos.
    expect(computeProgress(montado.clasificables, reglas, silenciadas, OFFSET)).toEqual(
      classifyProgress(montado.db)
    );
  } finally {
    montado.cerrar();
  }
}

describe("la cola y el progreso portados dan lo mismo que el motor", () => {
  beforeAll(() => {
    process.env.WALLET_UTC_OFFSET_HOURS = String(OFFSET);
  });

  it("un ledger vacio: la cola vacia esta TERMINADA, no en cero por ciento", () => {
    comparar({ filas: [] });
  });

  it("caso base: dos contrapartes sin reglas", () => {
    comparar({
      filas: [
        fila({ id: 1, counterparty: "Tienda A", amount: 10 }),
        fila({ id: 2, counterparty: "Tienda A", amount: 5 }),
        fila({ id: 3, counterparty: "Tienda B", amount: 30 }),
      ],
    });
  });

  it("la grafia mas reciente es la que se muestra", () => {
    comparar({
      filas: [
        fila({ id: 1, counterparty: "FARMACIA SUR", amount: 10, ts: "2026-05-01T12:00:00.000Z" }),
        fila({ id: 2, counterparty: "Farmacia Sur", amount: 7, ts: "2026-06-01T12:00:00.000Z" }),
      ],
    });
  });

  it("con reglas y silencios: la plata cubierta sale de la diferencia, no de un historico", () => {
    comparar({
      filas: [
        fila({ id: 1, counterparty: "Clinica Norte", amount: 40 }),
        fila({ id: 2, counterparty: "Clinica Norte", type: "transferencia", amount: 60 }),
        fila({ id: 3, counterparty: "Persona X", type: "transferencia", amount: 80 }),
        fila({ id: 4, counterparty: "Tienda A", amount: 5 }),
      ],
      reglas: [{ pattern: "clinica", category: "salud" }],
      silenciadas: [{ pattern: "persona x", counterparty: "Persona X" }],
    });
  });

  /**
   * Dos reglas anidadas. El orden importa: `matchEstablishment` devuelve la
   * PRIMERA que matchea, y el motor las ordena de patrón más largo a más corto
   * para que la específica le gane a la general.
   */
  it("una regla especifica le gana a una general que la contiene", () => {
    comparar({
      filas: [
        fila({ id: 1, counterparty: "FARMACIA SUR", amount: 40 }),
        fila({ id: 2, counterparty: "Farmacia Centro", amount: 25 }),
        fila({ id: 3, counterparty: "Tienda A", amount: 5 }),
      ],
      reglas: [
        { pattern: "farmacia", category: "salud" },
        { pattern: "farmacia sur", category: "comida" },
      ],
    });
  });

  it("los meses son LOCALES: un cargo de la madrugada UTC es del dia anterior", () => {
    comparar({
      filas: [
        // 02:00 UTC del 1 de junio = 21:00 del 31 de mayo con offset -5.
        fila({ id: 1, counterparty: "Tienda A", amount: 10, ts: "2026-06-01T02:00:00.000Z" }),
        fila({ id: 2, counterparty: "Tienda A", amount: 10, ts: "2026-06-15T12:00:00.000Z" }),
      ],
    });
  });

  it("todas las exclusiones sacan la fila del numerador y del denominador", () => {
    comparar({
      filas: [
        fila({ id: 1, counterparty: "Tienda A", amount: 10 }),
        fila({ id: 2, counterparty: "Tienda A", amount: 999, needs_review: 1 }),
        fila({ id: 3, counterparty: "Tienda A", amount: 999, is_reversed: 1 }),
        fila({ id: 4, counterparty: "Tienda A", amount: 999, is_internal: 1 }),
        fila({ id: 5, counterparty: "Tienda A", amount: 999, is_discarded: 1 }),
        fila({ id: 6, counterparty: "Tienda A", amount: 999, type: "reverso", direction: "in" }),
      ],
    });
  });

  it("una fila sin contraparte no entra: no hay pregunta que hacer", () => {
    comparar({
      filas: [
        fila({ id: 1, counterparty: null, amount: 77 }),
        fila({ id: 2, counterparty: "   ", amount: 88 }),
        fila({ id: 3, counterparty: "Tienda A", amount: 10 }),
      ],
    });
  });

  it("con TODO respondido el progreso esta terminado y la cola vacia", () => {
    comparar({
      filas: [
        fila({ id: 1, counterparty: "Tienda A", amount: 10 }),
        fila({ id: 2, counterparty: "Tienda B", amount: 20 }),
      ],
      reglas: [
        { pattern: "tienda a", category: "comida" },
        { pattern: "tienda b", category: "transporte" },
      ],
    });
  });

  it("un ledger grande y desordenado sigue coincidiendo campo por campo", () => {
    comparar({
      filas: ledgerGrande(),
      reglas: [{ pattern: "farmacia", category: "salud" }],
      silenciadas: [{ pattern: "persona x", counterparty: "Persona X" }],
      config: configDelPuerto(),
    });
  });
});
