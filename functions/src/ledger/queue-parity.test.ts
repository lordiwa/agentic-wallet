/**
 * **La prueba de que el campo `queueEligible` no pierde ni inventa filas.**
 *
 * La cola de clasificación del motor (`server/src/classify/queue.ts`) hace algo
 * que Firestore no sabe hacer: lee el ledger ENTERO, recalcula la categoría de
 * cada fila con las reglas de hoy, se queda con las que caen en un fallback,
 * agrupa por contraparte normalizada y ordena por plata. Sin `GROUP BY` y sin
 * `ORDER BY` sobre un agregado, la traducción directa es "traete las mil filas
 * en cada apertura de la pantalla".
 *
 * El diseño de `derive.ts` apuesta a que esa cola se puede materializar, y la
 * apuesta descansa en un argumento que hay que verificar y no creer:
 *
 *   Para un grupo dado (una contraparte normalizada), `matchEstablishment`
 *   devuelve LO MISMO para todas sus filas — porque matchea por substring
 *   sobre esa misma cadena normalizada. Entonces "¿las reglas del usuario
 *   sacan esta fila de la cola?" no es una pregunta por fila sino por GRUPO, y
 *   se puede contestar al momento de la consulta sin releer el ledger. Lo que
 *   queda por fila es `categorize()` SIN reglas, que no cambia nunca y por eso
 *   se puede persistir: `baseCategory` / `queueEligible`.
 *
 * Este test compara, sobre ledgers sintéticos, el conjunto que produce
 * `groupUnclassified` (el motor, la verdad) contra el que produce filtrar por
 * `queueEligible` y descartar los patrones que una regla matchea (Firestore).
 * Si el argumento fuera falso, acá se ve.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  groupUnclassified,
  type ClassifiableRow,
} from "../../../server/src/classify/queue.js";
import type { EstablishmentRule } from "./categorize.js";
import { matchEstablishment } from "./categorize.js";
import { toTransactionDoc, type RawTransaction, type TransactionDoc } from "./derive.js";

function fila(overrides: Partial<RawTransaction> & { id: number }): RawTransaction & { id: number } {
  return {
    gmail_msg_id: `msg-${overrides.id}`,
    gmail_thread_id: null,
    ts: "2026-05-15T14:00:00.000Z",
    direction: "out",
    type: "debito",
    amount: 10,
    currency: "USD",
    counterparty: "Comercio",
    account: null,
    account_holder: null,
    category: null,
    raw_subject: null,
    is_reversed: 0,
    is_internal: 0,
    needs_review: 0,
    is_discarded: 0,
    source: "parser",
    created_at: "2026-05-15T14:05:00.000Z",
    ...overrides,
  };
}

/** El camino del MOTOR: `selectClassifiableRows` + `groupUnclassified`, tal
 * cual, con el filtro de `selectClassifiableRows` reproducido en JS. */
function colaDelMotor(
  filas: (RawTransaction & { id: number })[],
  reglas: readonly EstablishmentRule[],
  silenciados: ReadonlySet<string>
): { pattern: string; count: number; total: number }[] {
  const clasificables: ClassifiableRow[] = filas
    .filter(
      (f) =>
        f.direction === "out" &&
        f.counterparty !== null &&
        f.counterparty.trim() !== "" &&
        f.is_internal === 0 &&
        f.is_reversed === 0 &&
        f.needs_review === 0 &&
        f.is_discarded === 0 &&
        f.type !== "reverso"
    )
    .map((f) => ({
      id: f.id,
      ts: f.ts,
      type: f.type,
      counterparty: f.counterparty,
      is_internal: f.is_internal,
      amount: f.amount,
    }));

  return groupUnclassified(clasificables, reglas, silenciados).map((g) => ({
    pattern: g.pattern,
    count: g.count,
    total: g.total,
  }));
}

/** El camino de FIRESTORE: los documentos con `queueEligible`, agrupados por
 * `pattern`, descartando los patrones que una regla matchea o que están
 * silenciados. Esto es lo que haría la consulta sobre la materialización. */
function colaDeFirestore(
  docs: TransactionDoc[],
  reglas: readonly EstablishmentRule[],
  silenciados: ReadonlySet<string>
): { pattern: string; count: number; total: number }[] {
  const grupos = new Map<string, { count: number; cents: number }>();
  for (const doc of docs) {
    if (!doc.queueEligible || doc.pattern === null) continue;
    if (silenciados.has(doc.pattern)) continue;
    // La pregunta por GRUPO, no por fila: ¿alguna regla matchea este patrón?
    if (matchEstablishment(doc.counterparty, reglas) !== null) continue;
    const acumulado = grupos.get(doc.pattern) ?? { count: 0, cents: 0 };
    acumulado.count += 1;
    acumulado.cents += doc.amountCents;
    grupos.set(doc.pattern, acumulado);
  }
  return [...grupos.entries()]
    .map(([pattern, g]) => ({ pattern, count: g.count, total: g.cents / 100 }))
    .sort((a, b) => b.total - a.total || b.count - a.count || a.pattern.localeCompare(b.pattern));
}

function comparar(
  filas: (RawTransaction & { id: number })[],
  reglas: readonly EstablishmentRule[] = [],
  silenciados: ReadonlySet<string> = new Set()
): void {
  const motor = colaDelMotor(filas, reglas, silenciados);
  const firestore = colaDeFirestore(
    filas.map((f) => toTransactionDoc(f, -5)),
    reglas,
    silenciados
  );
  expect(firestore).toEqual(motor);
}

describe("la cola materializada da lo mismo que la del motor", () => {
  // El motor lee el huso de `process.env.WALLET_UTC_OFFSET_HOURS` (via el `.env`
  // que `config.ts` carga al importar) y esta copia lo recibe por parametro. Si
  // no se fija, el resultado del test depende del `.env` de la maquina que lo
  // corre — que es exactamente el tipo de test que miente en CI.
  beforeAll(() => {
    process.env.WALLET_UTC_OFFSET_HOURS = "-5";
  });

  it("caso base: dos contrapartes sin reglas", () => {
    comparar([
      fila({ id: 1, counterparty: "Tienda A", amount: 10 }),
      fila({ id: 2, counterparty: "Tienda A", amount: 5 }),
      fila({ id: 3, counterparty: "Tienda B", amount: 30 }),
    ]);
  });

  it("la grafia distinta de un mismo comercio cae en el mismo grupo", () => {
    comparar([
      fila({ id: 1, counterparty: "FARMACÍA SUR", amount: 10 }),
      fila({ id: 2, counterparty: "  farmacia sur ", amount: 7 }),
    ]);
  });

  it("una regla saca al grupo ENTERO, incluidas sus filas de transferencia", () => {
    comparar(
      [
        fila({ id: 1, counterparty: "Clinica Norte", type: "debito", amount: 40 }),
        fila({ id: 2, counterparty: "Clinica Norte", type: "transferencia", amount: 60 }),
        fila({ id: 3, counterparty: "Otra Cosa", amount: 5 }),
      ],
      [{ pattern: "clinica", category: "salud" }]
    );
  });

  it("un grupo con filas ya clasificadas por TIPO solo suma las que caen en un fallback", () => {
    // El mismo nombre con un `servicio` (categoria 'servicios', fuera de la
    // cola) y un `debito` ('otros', dentro). El motor suma solo el debito.
    comparar([
      fila({ id: 1, counterparty: "Empresa Mixta", type: "servicio", amount: 100 }),
      fila({ id: 2, counterparty: "Empresa Mixta", type: "debito", amount: 3 }),
    ]);
  });

  it("las exclusiones de totales sacan la fila de los dos caminos", () => {
    comparar([
      fila({ id: 1, counterparty: "Tienda A", amount: 10 }),
      fila({ id: 2, counterparty: "Tienda A", amount: 999, needs_review: 1 }),
      fila({ id: 3, counterparty: "Tienda A", amount: 999, is_reversed: 1 }),
      fila({ id: 4, counterparty: "Tienda A", amount: 999, is_internal: 1 }),
      fila({ id: 5, counterparty: "Tienda A", amount: 999, is_discarded: 1 }),
      fila({ id: 6, counterparty: "Tienda A", amount: 999, type: "reverso", direction: "in" }),
    ]);
  });

  it("los ingresos nunca entran, aunque su categoria sea 'otros'", () => {
    comparar([
      fila({ id: 1, counterparty: "Empleador", type: "sueldo", direction: "in", amount: 2000 }),
      fila({ id: 2, counterparty: "Amigo", type: "recibido", direction: "in", amount: 50 }),
      fila({ id: 3, counterparty: "Tienda A", amount: 10 }),
    ]);
  });

  it("las contrapartes silenciadas salen de los dos caminos", () => {
    comparar(
      [
        fila({ id: 1, counterparty: "Persona X", type: "transferencia", amount: 80 }),
        fila({ id: 2, counterparty: "Tienda A", amount: 10 }),
      ],
      [],
      new Set(["persona x"])
    );
  });

  it("una transferencia interna no entra ni con contraparte", () => {
    comparar([
      fila({ id: 1, counterparty: "Mi Otra Cuenta", type: "transferencia", is_internal: 1, amount: 500 }),
      fila({ id: 2, counterparty: "Tienda A", amount: 10 }),
    ]);
  });

  it("una fila sin contraparte no aparece en ninguno de los dos", () => {
    comparar([
      fila({ id: 1, counterparty: null, amount: 77 }),
      fila({ id: 2, counterparty: "   ", amount: 88 }),
      fila({ id: 3, counterparty: "Tienda A", amount: 10 }),
    ]);
  });

  it("una regla con patron vacio no matchea nada en ninguno de los dos", () => {
    comparar([fila({ id: 1, counterparty: "Tienda A", amount: 10 })], [
      { pattern: "", category: "comida" },
    ]);
  });

  it("un ledger sintetico grande y desordenado sigue coincidiendo fila por fila", () => {
    const nombres = ["Tienda A", "tienda a", "FARMACIA SUR", "Clinica Norte", "Persona X", "Servicio Luz"];
    const tipos = ["debito", "credito", "transferencia", "servicio", "recarga", "retiro"];
    const filas: (RawTransaction & { id: number })[] = [];
    for (let i = 0; i < 300; i += 1) {
      filas.push(
        fila({
          id: i + 1,
          counterparty: nombres[i % nombres.length]!,
          type: tipos[i % tipos.length]!,
          amount: ((i * 7) % 97) + 0.37,
          ts: `2026-0${(i % 4) + 5}-1${i % 9}T1${i % 9}:00:00.000Z`,
          needs_review: i % 23 === 0 ? 1 : 0,
          is_internal: i % 31 === 0 ? 1 : 0,
          is_reversed: i % 37 === 0 ? 1 : 0,
        })
      );
    }
    comparar(filas, [{ pattern: "farmacia", category: "salud" }], new Set(["persona x"]));
  });
});
