/**
 * Los campos DERIVADOS que un documento de `transactions` lleva escritos, y por
 * qué existen.
 *
 * En SQLite el motor pregunta lo que quiere y el planificador se arregla:
 * `EXCLUDE_FROM_TOTALS_SQL` son cinco condiciones sobre cinco columnas
 * (`server/src/strategy/totals.ts`) y ningún índice hace falta para que un
 * ledger de mil filas responda al instante. Firestore no funciona así: cada
 * combinación de filtros necesita su índice compuesto, un `!=` es una
 * desigualdad que arrastra el orden, y no hay `GROUP BY`.
 *
 * La salida es mover el trabajo al momento de la escritura. Cada uno de estos
 * campos colapsa una pregunta que el motor hace mil veces en un valor que se
 * calcula una vez:
 *
 * - `countable` colapsa las CINCO condiciones de `EXCLUDE_FROM_TOTALS_SQL` en
 *   un booleano. Sin él, todo agregado del motor necesitaría un índice de seis
 *   campos y una desigualdad de más; con él, `where('countable','==',true)` es
 *   el prefijo compartido de todas las consultas de plata.
 * - `month` colapsa "a qué mes LOCAL pertenece" en una igualdad. `ts` está en
 *   UTC y el motor bucketea por día local con un offset fijo
 *   (`server/src/strategy/dates.ts`); un rango sobre `ts` para "este mes" mete
 *   las compras de la noche del último día del mes anterior. Sobre el ledger
 *   real eso movía 233 de 1140 filas de mes (wargaming ronda 3, W26).
 * - `pattern` colapsa `toRulePattern(counterparty)` — la clave por la que la
 *   cola de clasificación agrupa y por la que una regla del usuario matchea.
 * - `baseCategory` es `categorize()` SIN reglas: la parte de la categoría que
 *   no depende de la configuración del usuario y por lo tanto se puede
 *   persistir sin quedar vieja cuando el usuario escribe una regla. Ver
 *   `queueEligible` para por qué eso alcanza.
 *
 * **La invariante de CLAUDE.md no se toca:** `amount` sigue siendo el del
 * parser determinista y `needsReview` sigue excluyendo del total. Lo que se
 * precalcula acá es CÓMO SE FILTRA, nunca CUÁNTO ES.
 */
import { categorize, toRulePattern, UNCLASSIFIED_CATEGORIES, type Category } from "./categorize.js";

/** El offset horario por defecto, el mismo que `server/src/strategy/dates.ts`. */
export const DEFAULT_UTC_OFFSET_HOURS = -5;

/**
 * La fila cruda que el motor persiste hoy en SQLite, con los booleanos como
 * los escribe el parser (0/1). Es la entrada tanto de la migración como de la
 * futura ingesta.
 */
export interface RawTransaction {
  gmail_msg_id: string;
  gmail_thread_id: string | null;
  ts: string;
  direction: string;
  type: string;
  amount: number;
  currency: string;
  counterparty: string | null;
  account: string | null;
  account_holder: string | null;
  category: string | null;
  raw_subject: string | null;
  is_reversed: number;
  is_internal: number;
  needs_review: number;
  is_discarded: number;
  source: string;
  created_at: string;
}

/** El documento tal cual queda en `users/{uid}/transactions/{gmailMsgId}`. */
export interface TransactionDoc {
  gmailMsgId: string;
  gmailThreadId: string | null;
  ts: string;
  direction: string;
  type: string;
  /**
   * En CENTAVOS enteros, no en float.
   *
   * El motor ya hace toda su aritmética en centavos (`strategy/money.ts`) y
   * sólo vuelve a decimales para reportar; guardar el float era una herencia
   * de SQLite. Firestore serializa los números como IEEE 754 igual que
   * SQLite, así que el riesgo es idéntico — pero acá se está creando el
   * esquema desde cero y no hay excusa para heredar el pie de barro.
   */
  amountCents: number;
  currency: string;
  counterparty: string | null;
  account: string | null;
  accountHolder: string | null;
  /** La columna `category` del SQLite: histórica, NUNCA la que se muestra.
   * Lo que se muestra se recalcula con `categorize()` + las reglas de hoy. */
  storedCategory: string | null;
  rawSubject: string | null;
  isReversed: boolean;
  isInternal: boolean;
  needsReview: boolean;
  isDiscarded: boolean;
  source: string;
  createdAt: string;
  /** El `id INTEGER` que la fila tenía en SQLite. Se conserva sólo para poder
   * auditar la migración contra el snapshot; nada del motor nuevo lo usa. */
  legacyId: number | null;

  // --- derivados (ver el doc del módulo) ---
  countable: boolean;
  month: string | null;
  day: string | null;
  pattern: string | null;
  baseCategory: Category;
  /** `countable && direction === 'out' && pattern !== null && baseCategory es
   * un fallback`: exactamente las filas que la cola de clasificación puede
   * llegar a preguntar. Ver `queueEligible`. */
  queueEligible: boolean;
}

/** `EXCLUDE_FROM_TOTALS_SQL` (`server/src/strategy/totals.ts`) como predicado. */
export function isCountable(row: {
  is_internal: number;
  is_reversed: number;
  needs_review: number;
  is_discarded: number;
  type: string;
}): boolean {
  return (
    row.is_internal === 0 &&
    row.is_reversed === 0 &&
    row.needs_review === 0 &&
    row.is_discarded === 0 &&
    row.type !== "reverso"
  );
}

/** Día calendario local `YYYY-MM-DD`, o `null` si `ts` no parsea. Mismo
 * algoritmo que `localDayKey`, pero con el offset por parámetro. */
export function localDayKey(ts: string, offsetHours: number = DEFAULT_UTC_OFFSET_HOURS): string | null {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + offsetHours * 3_600_000).toISOString().slice(0, 10);
}

/**
 * El offset va por PARÁMETRO y no por `process.env`, al revés que en el server.
 *
 * En el server el offset se lee de `process.env.WALLET_UTC_OFFSET_HOURS` en
 * cada llamada, y eso era correcto mientras un proceso servía a una persona.
 * Una Cloud Function de 2a gen atiende hasta 80 peticiones **concurrentes** en
 * el mismo proceso: escribir `process.env` por request para "poner el huso del
 * tenant" haría que la petición de un usuario le cambie el calendario a la de
 * otro, en silencio y sin error. El huso es un dato del tenant y viaja como
 * argumento.
 */
export function localMonthKey(ts: string, offsetHours: number = DEFAULT_UTC_OFFSET_HOURS): string | null {
  return localDayKey(ts, offsetHours)?.slice(0, 7) ?? null;
}

/** Los `[from, to)` en instantes UTC del mes local que contiene `now`. */
export function localMonthRange(
  now: Date,
  offsetHours: number = DEFAULT_UTC_OFFSET_HOURS
): { from: Date; to: Date } {
  const shifted = new Date(now.getTime() + offsetHours * 3_600_000);
  const year = shifted.getUTCFullYear();
  const monthIndex = shifted.getUTCMonth();
  const localMidnight = (y: number, m: number): Date =>
    new Date(Date.UTC(y, m, 1) - offsetHours * 3_600_000);
  return { from: localMidnight(year, monthIndex), to: localMidnight(year, monthIndex + 1) };
}

/** Redondeo a centavos, copiado de `server/src/strategy/money.ts`. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Traduce una fila de SQLite al documento de Firestore, calculando los
 * derivados. Pura: la migración y la ingesta usan exactamente esta.
 */
export function toTransactionDoc(
  row: RawTransaction & { id?: number },
  offsetHours: number = DEFAULT_UTC_OFFSET_HOURS
): TransactionDoc {
  const countable = isCountable(row);
  const pattern = row.counterparty ? toRulePattern(row.counterparty) || null : null;
  const baseCategory = categorize({
    type: row.type,
    counterparty: row.counterparty,
    is_internal: row.is_internal === 1,
  });

  return {
    gmailMsgId: row.gmail_msg_id,
    gmailThreadId: row.gmail_thread_id,
    ts: row.ts,
    direction: row.direction,
    type: row.type,
    amountCents: toCents(row.amount),
    currency: row.currency,
    counterparty: row.counterparty,
    account: row.account,
    accountHolder: row.account_holder,
    storedCategory: row.category,
    rawSubject: row.raw_subject,
    isReversed: row.is_reversed === 1,
    isInternal: row.is_internal === 1,
    needsReview: row.needs_review === 1,
    isDiscarded: row.is_discarded === 1,
    source: row.source,
    createdAt: row.created_at,
    legacyId: row.id ?? null,
    countable,
    month: localMonthKey(row.ts, offsetHours),
    day: localDayKey(row.ts, offsetHours),
    pattern,
    baseCategory,
    queueEligible:
      countable && row.direction === "out" && pattern !== null && UNCLASSIFIED_CATEGORIES.has(baseCategory),
  };
}
