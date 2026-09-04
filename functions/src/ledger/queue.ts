/**
 * La cola de clasificación y su progreso — **copia de la parte PURA** de
 * `server/src/classify/{queue,progress}.ts`.
 *
 * Se copia por la misma razón de empaquetado que `categorize.ts`:
 * `firebase deploy --only functions` sube esta carpeta y nada más. Lo que no se
 * negocia es que las dos copias no puedan divergir en silencio, y de eso se
 * encarga `queue.parity.test.ts`, que importa las del motor y compara las
 * salidas sobre los mismos ledgers.
 *
 * La única diferencia de forma con el original: **el huso viaja por parámetro**
 * y no por `process.env`. Una función de 2a gen atiende varias peticiones
 * concurrentes en el mismo proceso; escribir el huso del tenant en el entorno
 * le cambiaría el calendario a la petición de otro, en silencio (ver el doc de
 * `derive.ts`).
 *
 * Los comentarios del original que explican POR QUÉ la cola es como es —por qué
 * agrupa por contraparte y no por fila, por qué mide en plata, por qué el
 * silencio cuenta como cubierto— viven allá y no se duplican acá.
 */
import {
  CATEGORIES,
  categorize,
  toRulePattern,
  UNCLASSIFIED_CATEGORIES,
  type Category,
  type EstablishmentRule,
} from "./categorize.js";
import { DEFAULT_UTC_OFFSET_HOURS, fromCents, localDayKey } from "./derive.js";
import type { LedgerRow } from "./rows.js";

/** El glosario menos los dos fallbacks: con lo que se puede RESPONDER.
 * Copia de `RESPONDABLE_CATEGORIES` (`server/src/classify/queue.ts`). */
export const RESPONDABLE_CATEGORIES = CATEGORIES.filter(
  (category) => !UNCLASSIFIED_CATEGORIES.has(category)
) as [Category, ...Category[]];

export function esRespondable(value: unknown): value is Category {
  return typeof value === "string" && (RESPONDABLE_CATEGORIES as readonly string[]).includes(value);
}

/** Un grupo de la cola: una contraparte. Espejo de `ClassifyGroup`. */
export interface ClassifyGroup {
  pattern: string;
  counterparty: string;
  count: number;
  total: number;
  months: number;
  category: Category;
  last_ts: string;
  count_en_ledger?: number;
  total_en_ledger?: number;
}

/**
 * Agrupa por contraparte normalizada las filas cuya categoría recalculada sigue
 * siendo un fallback, salteando las silenciadas. Copia literal del algoritmo de
 * `groupUnclassified`, con el offset por parámetro.
 */
export function groupUnclassified(
  rows: readonly LedgerRow[],
  rules: readonly EstablishmentRule[],
  silenced: ReadonlySet<string> = new Set(),
  offsetHours: number = DEFAULT_UTC_OFFSET_HOURS
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
      { type: row.type, counterparty: row.counterparty, is_internal: row.isInternal },
      rules
    );
    if (!UNCLASSIFIED_CATEGORIES.has(category)) continue;

    const pattern = toRulePattern(row.counterparty ?? "");
    if (pattern === "" || silenced.has(pattern)) continue;

    const existing = groups.get(pattern);
    const month = localDayKey(row.ts, offsetHours)?.slice(0, 7);
    if (!existing) {
      groups.set(pattern, {
        pattern,
        counterparty: (row.counterparty ?? "").trim(),
        count: 1,
        cents: row.amountCents,
        months: new Set(month ? [month] : []),
        category,
        last_ts: row.ts,
      });
      continue;
    }

    existing.count += 1;
    existing.cents += row.amountCents;
    if (month) existing.months.add(month);
    if (row.ts > existing.last_ts) {
      existing.last_ts = row.ts;
      existing.counterparty = (row.counterparty ?? "").trim();
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

/** El 80 % de M1, copiado de `progress.ts`. */
export const MONEY_TARGET_RATIO = 0.8;

export interface ClassifyProgress {
  spending_total: number;
  baseline_total: number;
  covered_total: number;
  covered_ratio: number;
  unclassified_total: number;
  unclassified_ratio: number;
  remaining_ratio: number;
  groups: number;
  transactions: number;
  target_ratio: number;
  answers_to_target: number;
  amount_to_target: number;
  done: boolean;
}

function totalCents(groups: readonly ClassifyGroup[]): number {
  return groups.reduce((sum, group) => sum + Math.round(group.total * 100), 0);
}

function ratio(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 10_000) / 10_000;
}

/**
 * El progreso, copia de `classifyProgress` con las filas por parámetro.
 *
 * `rows` tiene que ser **toda** la población de la cola (el equivalente de
 * `selectClassifiableRows`: gasto, con contraparte, dentro de las exclusiones
 * de todo total), no sólo las que siguen sin clasificar: `spending_total` es su
 * denominador y la línea de base se calcula sobre las mismas filas sin reglas.
 */
export function computeProgress(
  rows: readonly LedgerRow[],
  rules: readonly EstablishmentRule[],
  silenced: ReadonlySet<string>,
  offsetHours: number = DEFAULT_UTC_OFFSET_HOURS
): ClassifyProgress {
  const remaining = groupUnclassified(rows, rules, silenced, offsetHours);
  // Sin reglas ni silencios: lo que había que preguntar el primer día.
  const baseline = groupUnclassified(rows, [], new Set(), offsetHours);

  const spendingCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  const baselineCents = totalCents(baseline);
  const remainingCents = totalCents(remaining);
  const coveredCents = Math.max(0, baselineCents - remainingCents);

  const neededCents = Math.max(0, Math.ceil(MONEY_TARGET_RATIO * baselineCents) - coveredCents);
  let answers = 0;
  let accumulated = 0;
  for (const group of remaining) {
    if (accumulated >= neededCents) break;
    accumulated += Math.round(group.total * 100);
    answers += 1;
  }

  return {
    spending_total: fromCents(spendingCents),
    baseline_total: fromCents(baselineCents),
    covered_total: fromCents(coveredCents),
    covered_ratio: baselineCents === 0 ? 1 : ratio(coveredCents, baselineCents),
    unclassified_total: fromCents(remainingCents),
    unclassified_ratio: ratio(remainingCents, spendingCents),
    remaining_ratio: baselineCents === 0 ? 0 : ratio(remainingCents, baselineCents),
    groups: remaining.length,
    transactions: remaining.reduce((sum, group) => sum + group.count, 0),
    target_ratio: MONEY_TARGET_RATIO,
    answers_to_target: answers,
    amount_to_target: fromCents(accumulated),
    done: baselineCents === 0 || coveredCents / baselineCents >= MONEY_TARGET_RATIO,
  };
}
