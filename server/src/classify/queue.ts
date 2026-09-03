/**
 * La cola de clasificación, **agrupada por contraparte** (H32, decisión M5).
 *
 * Dos cosas la definen, y las dos vienen del forense del ledger real
 * (`docs/wargaming-simplificacion.md` §0):
 *
 * 1. **La categoría es la RECALCULADA, no la columna `category`.** Es la misma
 *    que lee el gráfico del Resumen (`strategy/spending.ts`): `categorize()` +
 *    las reglas del usuario, en vivo. La columna da 130 filas; el recálculo da
 *    334. Preguntar sobre la columna sería preguntar por filas que el gráfico ya
 *    tiene clasificadas — y callar sobre las que no.
 * 2. **La unidad es la contraparte, no la fila.** 334 filas son 151
 *    contrapartes: preguntar por fila son 334 preguntas y preguntar por
 *    contraparte son 151, de las cuales 30 cubren el 80 % de la plata. Ese
 *    desajuste es lo que hacía impagable la pantalla.
 *
 * **Qué cuenta como "sin clasificar":** que `categorize()` devuelva uno de sus
 * dos fallbacks. `otros` es literalmente "no sé", y `transferencia_persona` es
 * "es una transferencia con contraparte", que es estrictamente menos información
 * que la que el usuario puede dar — donde el comercio cobra por transferencia
 * inmediata, la clínica y el restaurante llegan ahí (ver el doc de
 * `category/categorize.ts`). Son los dos que `rules-repository.ts` tampoco
 * aprende del historial, y por el mismo motivo: no son conocimiento, son la
 * ausencia de conocimiento. En el ledger real, 118 + 216 = las 334.
 *
 * **Filas sin contraparte quedan fuera.** No es que estén clasificadas: es que
 * no hay pregunta que hacer, porque no hay nombre contra el que escribir una
 * regla. Incluirlas metería en la cola un grupo sin nombre que nadie puede
 * responder, y —peor— dejaría el criterio de terminado por plata (M1) fuera de
 * alcance para siempre. Ese historial se recupera con `heal_counterparties`,
 * que es otro problema.
 */
import type Database from "better-sqlite3";
import { CATEGORIES, categorize, toRulePattern, type Category, type EstablishmentRule } from "../category/categorize.js";
import { listCategoryRules } from "../category/rules-repository.js";
import { localDayKey } from "../strategy/dates.js";
import { fromCents, toCents } from "../strategy/money.js";
import { EXCLUDE_FROM_TOTALS_SQL } from "../strategy/totals.js";
import { silencedPatterns } from "./silenced.js";

/**
 * Los dos valores que `categorize()` devuelve cuando NO sabe. Ver el doc del
 * módulo: son la definición de la cola.
 */
export const UNCLASSIFIED_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  "otros",
  "transferencia_persona",
]);

/**
 * Las categorías con las que se puede **responder**: el glosario menos los dos
 * fallbacks de arriba. Responder con uno de ellos escribe la regla, devuelve
 * `ok` con su conteo y deja el grupo en la cola para siempre —su categoría
 * recalculada sigue siendo un fallback—, o sea un 200 que no hace nada y un
 * bucle infinito de preguntas.
 *
 * Vive **acá** y no en el borde HTTP porque no es una regla de un transporte:
 * es la definición de la cola dicha al revés, y toda superficie que escriba una
 * respuesta tiene que usar la misma. Estaba sólo en `api/schemas.ts` (W8) y la
 * tool MCP —una de las dos superficies que ese hallazgo nombraba— seguía
 * aceptando los dos (wargaming ronda 2, W14).
 */
export const RESPONDABLE_CATEGORIES = CATEGORIES.filter(
  (category) => !UNCLASSIFIED_CATEGORIES.has(category)
) as [Category, ...Category[]];

/** Un grupo de la cola: una contraparte, y todo lo que hace falta para poder
 * preguntar por ella una sola vez. */
export interface ClassifyGroup {
  /** La contraparte **normalizada**: la clave del grupo y, exactamente, el
   * patrón que escribiría la regla si se responde (ver `apply.ts`). */
  pattern: string;
  /** La contraparte como la escribe el banco, para mostrarla. */
  counterparty: string;
  /** Cuántos movimientos tiene. */
  count: number;
  /** Cuánta plata mueve — el orden por defecto de la cola. */
  total: number;
  /** En cuántos meses locales distintos aparece: separa el gasto recurrente
   * del que pasó una vez. */
  months: number;
  /** El fallback en el que cae hoy (`otros` o `transferencia_persona`). */
  category: Category;
  /** El movimiento más reciente del grupo, para poder decir "hace cuánto". */
  last_ts: string;
  /**
   * Cuántos movimientos y cuánta plata tiene esta contraparte en **todo el
   * ledger** — presentes sólo cuando la cola viene acotada a un lote
   * (`transactionIds`), y ausentes cuando no hay dos poblaciones que distinguir.
   *
   * Existen porque la tarjeta contaba el lote y el escritor
   * (`classify/apply.ts`) mueve el ledger entero: la tarjeta prometía "2
   * movimientos" y la respuesta contestaba "reclasificaste 47", en la misma
   * pantalla (wargaming ronda 3, W23). Es W1 por una tercera puerta, y la salida
   * es la de W12: no recortar el número, decir el alcance.
   */
  count_en_ledger?: number;
  total_en_ledger?: number;
}

export interface ClassifyQueueOptions {
  /**
   * Restringe la cola a estos movimientos. Es el aviso post-sync (D7-b): "entró
   * un lote, 12 de esas filas no sé qué son" lleva a la cola **filtrada por ese
   * lote**, no a la cola entera. Una lista vacía es una lista vacía (cola
   * vacía), no "sin filtro" — `undefined` es "sin filtro".
   */
  transactionIds?: readonly number[];
  /** Tope de grupos devueltos, del que más plata mueve al que menos. */
  limit?: number;
}

/** La fila mínima que la cola necesita de cada movimiento. */
export interface ClassifiableRow {
  id: number;
  ts: string;
  type: string;
  counterparty: string | null;
  is_internal: number;
  amount: number;
}

/**
 * Los movimientos sobre los que la cola tiene algo que preguntar: gasto
 * (`direction = 'out'`), con contraparte, y con las mismas exclusiones que
 * cualquier total del motor (`EXCLUDE_FROM_TOTALS_SQL`). Una fila en
 * `needs_review` no entra: su monto todavía no está afirmado, así que ni suma en
 * el orden por plata ni movería el gráfico si se la clasificara.
 */
export function selectClassifiableRows(
  db: Database.Database,
  transactionIds?: readonly number[]
): ClassifiableRow[] {
  if (transactionIds !== undefined && transactionIds.length === 0) return [];

  const idFilter =
    transactionIds === undefined
      ? ""
      : ` AND id IN (${transactionIds.map(() => "?").join(", ")})`;

  return db
    .prepare(
      `SELECT id, ts, type, counterparty, is_internal, amount FROM transactions
        WHERE direction = 'out'
          AND counterparty IS NOT NULL AND TRIM(counterparty) != ''
          AND ${EXCLUDE_FROM_TOTALS_SQL}${idFilter}`
    )
    .all(...(transactionIds ?? [])) as ClassifiableRow[];
}

/**
 * Agrupa por contraparte normalizada las filas cuya categoría recalculada es un
 * fallback, salteando las contrapartes silenciadas. Ordena por plata
 * descendente (desempate: más movimientos primero, y el patrón como último
 * criterio para que el orden sea total y estable).
 *
 * Pura a propósito: el progreso (`progress.ts`) la llama dos veces sobre las
 * mismas filas —una con las reglas de hoy y otra sin ninguna— y esa es la única
 * forma de saber cuánta plata ya se cubrió sin guardar un histórico.
 *
 * La grafía que se muestra es la del movimiento **más reciente** del grupo: el
 * banco cambia cómo escribe un comercio con el tiempo, y la última es la que el
 * usuario acaba de ver en su correo.
 */
export function groupUnclassified(
  rows: readonly ClassifiableRow[],
  rules: readonly EstablishmentRule[],
  silenced: ReadonlySet<string> = new Set()
): ClassifyGroup[] {
  interface Accumulator {
    pattern: string;
    counterparty: string;
    count: number;
    cents: number;
    months: Set<string>;
    category: Category;
    last_ts: string;
  }

  const groups = new Map<string, Accumulator>();

  for (const row of rows) {
    const category = categorize(
      { type: row.type, counterparty: row.counterparty, is_internal: row.is_internal === 1 },
      rules
    );
    if (!UNCLASSIFIED_CATEGORIES.has(category)) continue;

    const pattern = toRulePattern(row.counterparty ?? "");
    if (pattern === "" || silenced.has(pattern)) continue;

    const existing = groups.get(pattern);
    const month = localDayKey(row.ts)?.slice(0, 7);
    if (!existing) {
      groups.set(pattern, {
        pattern,
        counterparty: (row.counterparty ?? "").trim(),
        count: 1,
        cents: toCents(row.amount),
        months: new Set(month ? [month] : []),
        category,
        last_ts: row.ts,
      });
      continue;
    }

    existing.count += 1;
    existing.cents += toCents(row.amount);
    if (month) existing.months.add(month);
    if (row.ts > existing.last_ts) {
      existing.last_ts = row.ts;
      existing.counterparty = (row.counterparty ?? "").trim();
      // La categoría del grupo es la del movimiento más reciente: dentro de un
      // mismo patrón los dos fallbacks pueden convivir (una transferencia y un
      // débito al mismo nombre) y hay que mostrar uno solo.
      existing.category = category;
    }
  }

  return [...groups.values()]
    .map((group) => ({
      pattern: group.pattern,
      counterparty: group.counterparty,
      count: group.count,
      total: fromCents(group.cents),
      months: group.months.size,
      category: group.category,
      last_ts: group.last_ts,
    }))
    .sort((a, b) => b.total - a.total || b.count - a.count || a.pattern.localeCompare(b.pattern));
}

/**
 * La cola completa: grupos, no filas, ordenados por plata descendente.
 *
 * Sin `limit` devuelve todo — son 151 grupos sobre el ledger real, y el que
 * decide cuántos mostrar es quien pinta la pantalla, no el motor.
 */
export function classifyQueue(db: Database.Database, options: ClassifyQueueOptions = {}): ClassifyGroup[] {
  const rules = listCategoryRules(db);
  const silenced = silencedPatterns(db);
  const groups = groupUnclassified(selectClassifiableRows(db, options.transactionIds), rules, silenced);

  // En modo lote, además, cuánto hay de cada contraparte FUERA del lote: es lo
  // que la regla va a mover y la tarjeta no estaba diciendo (W23). El segundo
  // agrupamiento es sobre la misma tabla y con las mismas reglas, así que los
  // dos números salen de la misma definición y no de dos parecidas.
  if (options.transactionIds !== undefined) {
    const enElLedger = new Map(
      groupUnclassified(selectClassifiableRows(db), rules, silenced).map((group) => [group.pattern, group])
    );
    for (const group of groups) {
      const completo = enElLedger.get(group.pattern);
      group.count_en_ledger = completo?.count ?? group.count;
      group.total_en_ledger = completo?.total ?? group.total;
    }
  }

  return options.limit === undefined ? groups : groups.slice(0, options.limit);
}
