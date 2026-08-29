/**
 * Re-etiqueta el historial YA sincronizado: recalcula `is_internal` y
 * `category` sobre filas que ya tienen valor.
 *
 * Es el complemento de `backfillCategories`, no su reemplazo. El backfill es
 * deliberadamente conservador -- solo toca filas sin categoria, para no
 * repisar nunca lo que puso una corrida anterior o una persona. Eso lo deja
 * sin respuesta para el caso contrario: cuando la categoria guardada quedo
 * *desactualizada* porque cambio el insumo con el que se calculo (llego el
 * titular al perfil, se agrego una regla de comercio, o un backfill anterior
 * corrio antes de que el historial tuviera `counterparty`). Ahi la unica
 * salida es recalcular y repisar, que es lo que hace esta funcion.
 *
 * Tres invariantes, en ese orden de importancia:
 *
 * 1. **Una categoria especifica ya guardada solo la pisa una regla explicita
 *    del usuario.** Sobre `'otros'` (o vacio) se escribe lo que diga
 *    `categorize`: ahi no hay nada que perder. Sobre una categoria concreta
 *    solo se escribe si hay una regla de `category_rules` que matchee la
 *    contraparte -- eso es el usuario diciendo hoy "este comercio es esto".
 *    Todo lo demas se preserva.
 *
 *    El porque: una categoria especifica es conocimiento que `categorize` no
 *    sabe reproducir. La puso una persona, o vino del historial migrado, y las
 *    reglas de hoy no tienen por que contener la que la origino. Peor: los
 *    fallbacks por `type` de `categorize` son mas gruesos que ese
 *    conocimiento. Una transferencia a la clinica esta guardada como 'salud',
 *    pero la regla 5 la ve solo como "transferencia con contraparte" y
 *    responde 'transferencia_persona' -- que no es mas correcto, es menos
 *    especifico. Sin este guard una sola corrida aplana en
 *    'transferencia_persona' cada salud/mascota/comida del historial.
 *    Recalcular sirve para ganar precision, nunca para perderla.
 * 2. **Nunca desmarca una interna.** `is_internal` solo se enciende, jamas se
 *    apaga. La regla del titular ve nombres; no puede ver una etiqueta puesta
 *    a mano sobre un movimiento entre cuentas propias que el banco no nombro
 *    (el historial migrado tiene contrapartes tipo "self/<otro banco>").
 *    Apagarlas devolveria esos movimientos a los totales de gasto como si
 *    fueran plata que salio del bolsillo.
 * 3. **No toca plata.** Ni `amount`, ni `direction`, ni `type`, ni
 *    `needs_review`. El monto sale del parser y de ningun otro lado; esta capa
 *    solo reordena etiquetas.
 *
 * Idempotente: la segunda corrida seguida no cambia nada.
 */
import type Database from "better-sqlite3";
import { emitMetric, withSpan } from "../ingest/telemetry.js";
import { isInternalTransfer } from "../rules/reconcile.js";
import { categorize, matchEstablishment } from "./categorize.js";
import { listCategoryRules } from "./rules-repository.js";

interface ReclassifiableRow {
  id: number;
  type: string;
  counterparty: string | null;
  is_internal: number;
  category: string | null;
}

export interface ReclassifyResult {
  /** Filas que pasaron a `is_internal = 1` (nunca al reves). */
  markedInternal: number;
  /** Filas cuya `category` guardada cambio. */
  recategorized: number;
}

export interface ReclassifyOptions {
  /** `null`/vacio = titular sin configurar; no se marca ninguna interna. */
  titular: string | null;
}

/**
 * Recalcula `is_internal` y `category` sobre todas las filas y devuelve
 * cuantas cambio de cada cosa.
 *
 * El orden importa: `is_internal` primero, porque `categorize` lo lee (una
 * transferencia interna no es `transferencia_persona`). Se calculan ambos en
 * memoria y se escriben en una sola transaccion.
 */
export async function reclassifyTransactions(
  db: Database.Database,
  { titular }: ReclassifyOptions
): Promise<ReclassifyResult> {
  return withSpan("category.reclassify", {}, async () => {
    const rows = db
      .prepare("SELECT id, type, counterparty, is_internal, category FROM transactions")
      .all() as ReclassifiableRow[];

    // Las reglas del usuario se leen una vez, no una por fila.
    const rules = listCategoryRules(db);

    const updateInternal = db.prepare("UPDATE transactions SET is_internal = 1 WHERE id = @id");
    const updateCategory = db.prepare("UPDATE transactions SET category = @category WHERE id = @id");

    let markedInternal = 0;
    let recategorized = 0;

    const runUpdates = db.transaction((toUpdate: ReclassifiableRow[]) => {
      for (const row of toUpdate) {
        const wasInternal = row.is_internal === 1;
        // Solo se enciende: ver invariante 1 en el doc del modulo.
        const isInternal = wasInternal || isInternalTransfer(row, titular);
        if (isInternal && !wasInternal) {
          updateInternal.run({ id: row.id });
          markedInternal += 1;
        }

        // Invariante 1: sobre 'otros'/vacio manda `categorize`; sobre una
        // categoria concreta, solo una regla explicita del usuario.
        const storedIsSpecific = row.category !== null && row.category !== "" && row.category !== "otros";
        const category = storedIsSpecific
          ? matchEstablishment(row.counterparty, rules)
          : categorize({ type: row.type, counterparty: row.counterparty, is_internal: isInternal }, rules);

        if (category !== null && category !== row.category) {
          updateCategory.run({ id: row.id, category });
          recategorized += 1;
        }
      }
    });
    runUpdates(rows);

    emitMetric("category.reclassify.summary", { markedInternal, recategorized });
    return { markedInternal, recategorized };
  });
}
