/**
 * **Paridad de los gastos fijos y del perfil.**
 *
 * Los dos son lecturas que la pantalla de alta presenta como afirmaciones
 * ("suele caer el 20", "tu día de pago está configurado"), y las dos tienen
 * guardas que existen porque la versión ingenua mentía: la mediana que cae en
 * un día donde no pasó nada, el día que ocurrió una sola vez, el `"15"` que se
 * guarda bien y deja el calendario mudo. Un puerto que se saltee una de esas
 * guardas no falla: promete de más, que es peor.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { suggestRecurringExpenses as recurrentesMotor } from "../../../server/src/onboard/recurring.js";
import { diaTipicoDe as diaTipicoMotor } from "../../../server/src/onboard/recurring.js";
import { normalizarDiasPago as normalizarMotor, readProfile as perfilMotor } from "../../../server/src/onboard/profile.js";
import { suggestSpendBaseline } from "../../../server/src/onboard/suggest.js";
import {
  configDelPuerto,
  fila,
  ledgerGrande,
  montar,
  OFFSET,
  type LedgerDePrueba,
} from "../test-support/paridad.js";
import type { EstablishmentRule } from "./categorize.js";
import { normalizarDiasPago, readProfile } from "./profile.js";
import { diaTipicoDe, mesesDeHistorialDe, suggestRecurringExpenses } from "./recurring.js";

function comparar(ledger: LedgerDePrueba): void {
  const montado = montar(ledger);
  try {
    // El span de gasto con el conjunto EXACTO del motor: `direction='out'` con
    // is_reversed/is_internal/needs_review en cero — sin is_discarded y sin
    // excluir los reversos. Se copia el conjunto, no se "arregla".
    const gastos = montado.docs.filter(
      (d) => d.direction === "out" && !d.isReversed && !d.isInternal && !d.needsReview
    );
    const ts = gastos.map((d) => d.ts).sort();
    const meses = mesesDeHistorialDe(ts[0] ?? null, ts[ts.length - 1] ?? null);

    expect(meses).toEqual(suggestSpendBaseline(montado.db).mesesDeHistorial);

    expect(
      suggestRecurringExpenses({
        clasificables: montado.clasificables,
        rules: (ledger.reglas ?? []) as EstablishmentRule[],
        silenciadas: new Set((ledger.silenciadas ?? []).map((s) => s.pattern)),
        mesesDeHistorial: meses,
        offsetHours: OFFSET,
      })
    ).toEqual(recurrentesMotor(montado.db));

    expect(readProfile(configDelPuerto(ledger.config ?? {}))).toEqual(perfilMotor(montado.db));
  } finally {
    montado.cerrar();
  }
}

/** Un gasto que cae el mismo día de N meses seguidos. */
function mensual(
  idBase: number,
  counterparty: string,
  dia: number,
  meses: number[],
  amount: number
): ReturnType<typeof fila>[] {
  return meses.map((mes, i) =>
    fila({
      id: idBase + i,
      counterparty,
      amount,
      ts: `2026-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}T14:00:00.000Z`,
    })
  );
}

describe("los gastos fijos y el perfil portados dan lo mismo que el motor", () => {
  beforeAll(() => {
    process.env.WALLET_UTC_OFFSET_HOURS = String(OFFSET);
  });

  it("un ledger vacio no propone nada y no dice que tiene historial", () => {
    comparar({ filas: [] });
  });

  /** **R33.** Con menos de tres meses de historial no se propone nada, aunque
   * la regla de recurrencia se cumpla: un patrón leído de cinco semanas es una
   * adivinanza con formato de dato. */
  it("sin historial suficiente cuenta las candidatas pero no propone", () => {
    comparar({
      filas: [
        ...mensual(1, "Servicio Luz", 15, [1, 2, 3], 40),
      ],
    });
  });

  it("con historial suficiente propone, ordenado por plata", () => {
    comparar({
      filas: [
        ...mensual(1, "Servicio Luz", 15, [1, 2, 3, 4, 5, 6], 40),
        ...mensual(20, "Gimnasio Centro", 5, [1, 2, 3, 4, 5, 6], 25),
        ...mensual(40, "Tienda A", 9, [1, 2, 3, 4, 5, 6], 90),
        // Una sola aparición: no es un gasto fijo, es un mes movido.
        fila({ id: 60, counterparty: "Compra Suelta", amount: 300, ts: "2026-03-03T14:00:00.000Z" }),
      ],
    });
  });

  /** Tres cargos en tres meses del calendario pero en 40 días: la casualidad
   * de almanaque que el freno de la candidata ataja. */
  it("una racha corta que toca tres meses no es un gasto fijo", () => {
    comparar({
      filas: [
        fila({ id: 1, counterparty: "Racha Corta", amount: 50, ts: "2026-01-31T14:00:00.000Z" }),
        fila({ id: 2, counterparty: "Racha Corta", amount: 50, ts: "2026-02-15T14:00:00.000Z" }),
        fila({ id: 3, counterparty: "Racha Corta", amount: 50, ts: "2026-03-01T14:00:00.000Z" }),
        ...mensual(10, "Servicio Luz", 15, [1, 2, 3, 4, 5, 6], 40),
      ],
    });
  });

  /** Los días dispersos no sostienen un día típico: la propuesta sigue en pie
   * porque la plata es real, pero `diaTipico` viene en `null`. */
  it("dias dispersos: la propuesta queda sin dia tipico", () => {
    comparar({
      filas: [
        fila({ id: 1, counterparty: "Persona X", type: "transferencia", amount: 60, ts: "2026-01-02T14:00:00.000Z" }),
        fila({ id: 2, counterparty: "Persona X", type: "transferencia", amount: 60, ts: "2026-02-27T14:00:00.000Z" }),
        fila({ id: 3, counterparty: "Persona X", type: "transferencia", amount: 60, ts: "2026-03-14T14:00:00.000Z" }),
        fila({ id: 4, counterparty: "Persona X", type: "transferencia", amount: 60, ts: "2026-04-08T14:00:00.000Z" }),
        ...mensual(10, "Servicio Luz", 15, [1, 2, 3, 4, 5, 6], 40),
      ],
    });
  });

  it("una contraparte con regla ya no se propone: su pregunta esta contestada", () => {
    comparar({
      filas: [
        ...mensual(1, "FARMACIA SUR", 12, [1, 2, 3, 4, 5, 6], 70),
        ...mensual(20, "Servicio Luz", 15, [1, 2, 3, 4, 5, 6], 40),
      ],
      reglas: [{ pattern: "farmacia", category: "salud" }],
    });
  });

  it("una contraparte silenciada tampoco se propone", () => {
    comparar({
      filas: [
        ...mensual(1, "Persona X", 10, [1, 2, 3, 4, 5, 6], 70),
        ...mensual(20, "Servicio Luz", 15, [1, 2, 3, 4, 5, 6], 40),
      ],
      silenciadas: [{ pattern: "persona x", counterparty: "Persona X" }],
    });
  });

  it("mas de diez candidatas: entra el top 10 y el resto queda en la cola", () => {
    const filas = [];
    for (let i = 0; i < 14; i += 1) {
      filas.push(...mensual(i * 10 + 1, `Comercio ${i}`, 10 + (i % 5), [1, 2, 3, 4, 5, 6], 20 + i * 5));
    }
    comparar({ filas });
  });

  it("un ledger grande y desordenado coincide", () => {
    comparar({
      filas: ledgerGrande(),
      reglas: [{ pattern: "farmacia", category: "salud" }],
      silenciadas: [{ pattern: "persona x", counterparty: "Persona X" }],
    });
  });

  it("el perfil: dias configurados y colchon fijado", () => {
    comparar({
      filas: [],
      config: {
        colchonObjetivo: 500,
        sueldo: { fuente: "", cadencia: "quincenal", montoEstimado: 1200, diasPago: ["15-15", "30-30"] },
      },
    });
  });
});

describe("las funciones puras del dia tipico y de los dias de pago", () => {
  const DIAS: number[][] = [
    [],
    [10],
    [10, 10, 10],
    [2, 27],
    [10, 10, 14, 14],
    [3, 20, 22, 23],
    [7, 9, 11],
    [1, 2, 3, 30, 31],
    [15, 15, 16, 14, 15],
  ];

  it("diaTipicoDe da lo mismo en las dos copias", () => {
    for (const dias of DIAS) {
      expect(diaTipicoDe(dias)).toEqual(diaTipicoMotor(dias));
    }
  });

  const ENTRADAS: string[][] = [
    [],
    ["15"],
    ["15-15"],
    ["<=5"],
    ["18-20", "3"],
    ["0"],
    ["32"],
    ["20-10"],
    ["<=99"],
    ["quincena"],
    [" 15 "],
    ["15", "15-15"],
    ["30", "1", "<=5"],
  ];

  it("normalizarDiasPago da lo mismo en las dos copias", () => {
    for (const entrada of ENTRADAS) {
      expect(normalizarDiasPago(entrada)).toEqual(normalizarMotor(entrada));
    }
  });
});
