/**
 * Los tres escritores del flujo, sobre Firestore: responder *"qué es esto"*,
 * silenciar una contraparte y resolver la cola de monto.
 *
 * Son las copias de `server/src/classify/{apply,silenced}.ts` y
 * `server/src/review/resolve.ts`, con la misma división que allá: **todo error
 * es un resultado tipado, nunca una excepción**, para que la capa HTTP se
 * limite a traducirlo a un status y no invente su propio conjunto.
 *
 * Las dos reglas que el puerto tiene que preservar y no aflojar:
 *
 * 1. **El patrón se deriva de la contraparte REAL del ledger, nunca del texto
 *    que llegó.** Es la trampa fundacional del proyecto: `matchEstablishment`
 *    busca el patrón *dentro* de la contraparte, así que un patrón más largo
 *    que la contraparte se guarda bien, se lista bien y no clasifica una sola
 *    fila. Acá es imposible por construcción: si el texto no corresponde a una
 *    contraparte que existe, no se escribe nada.
 * 2. **El monto sale del parser.** `correct` no es una lectura automática: es
 *    una persona afirmando un número, y la única puerta por la que se escribe
 *    un monto se abre sólo para una fila que el motor ya marcó. Sobre una fila
 *    sana esta capa no escribe un monto nunca — si lo hiciera sería un editor
 *    de montos arbitrario sobre todo el ledger, y la invariante se caería por
 *    ahí.
 */
import { toRulePattern, type Category } from "./categorize.js";
import { localMonthRange, toCents, type TransactionDoc } from "./derive.js";
import { recategorizar, type FirestoreLedger, type ReviewResolutionDoc } from "./firestore-ledger.js";

// --- responder "qué es esto" -------------------------------------------------

export interface ClassifyRequest {
  counterparty: string;
  category: Category;
}

export interface ClassifySuccess {
  ok: true;
  pattern: string;
  counterparty: string;
  category: Category;
  /** Movimientos **que el usuario puede ver** que cambiaron de categoría:
   * gasto, dentro de las exclusiones de todo total. Son exactamente los que la
   * tarjeta de la cola contó. */
  reclassified: number;
  /** Cuántos de ellos caen en el mes local en curso — o sea si el gráfico del
   * Resumen se va a mover. Con cero, la respuesta fue correcta y la pantalla
   * tiene que poder decir que no verá el efecto (R19). */
  reclassified_this_month: number;
  /** Cuántas contrapartes ADEMÁS de la preguntada movió la regla. Una regla
   * matchea por subcadena, así que un nombre corto alcanza a los grupos que lo
   * contienen; la salida no es recortar el número —sería falso— sino decir el
   * alcance (W12). */
  otras_contrapartes: number;
}

export type ClassifyError = "empty_pattern" | "counterparty_not_found";
export type ClassifyResult = ClassifySuccess | { ok: false; error: ClassifyError };

export async function classifyCounterparty(
  ledger: FirestoreLedger,
  request: ClassifyRequest,
  now: Date,
  offsetHours: number
): Promise<ClassifyResult> {
  if (toRulePattern(request.counterparty) === "") return { ok: false, error: "empty_pattern" };

  const counterparty = await ledger.resolveCounterparty(request.counterparty);
  if (counterparty === null) return { ok: false, error: "counterparty_not_found" };

  // El patrón sale de la contraparte del ledger. Ver el doc del módulo.
  const pattern = toRulePattern(counterparty);
  if (pattern === "") return { ok: false, error: "empty_pattern" };

  const before = await ledger.rules();
  const candidatos = await ledger.docsQueContienenPatron(pattern);
  const previas = new Map(candidatos.map((doc) => [doc.gmailMsgId, recategorizar(doc, before)]));

  await ledger.upsertRule(counterparty, pattern, request.category, now);
  // Se re-lee en vez de simular el orden: `rules()` ordena por largo de patrón,
  // y con dos reglas anidadas cuál gana depende de ese orden. Simularlo sería
  // tener la regla de desempate escrita dos veces.
  const after = await ledger.rules();

  const { from, to } = localMonthRange(now, offsetHours);
  const desde = from.toISOString();
  const hasta = to.toISOString();

  const cambios: { id: string; category: Category }[] = [];
  let reclassified = 0;
  let reclassifiedThisMonth = 0;
  /** Las contrapartes que la regla movió de verdad. Ver `otras_contrapartes`. */
  const alcanzadas = new Set<string>();

  for (const doc of candidatos) {
    const next = recategorizar(doc, after);
    if (next === previas.get(doc.gmailMsgId)) continue;

    // La columna se escribe en TODAS: dejar el ledger a medias sería peor que
    // el problema. Los conteos, en cambio, sólo miran las visibles.
    cambios.push({ id: doc.gmailMsgId, category: next });

    const visible = doc.direction === "out" && doc.countable;
    if (!visible) continue;

    reclassified += 1;
    alcanzadas.add(toRulePattern(doc.counterparty ?? ""));
    if (doc.ts >= desde && doc.ts < hasta) reclassifiedThisMonth += 1;
  }

  await ledger.actualizarCategorias(cambios);

  // La preguntada no cuenta como "otra". Se descuenta sólo si de verdad movió
  // algo: si su propia plata no se movió, las que quedan siguen siendo las
  // otras.
  const otrasContrapartes = alcanzadas.size - (alcanzadas.has(pattern) ? 1 : 0);

  return {
    ok: true,
    pattern,
    counterparty,
    category: request.category,
    reclassified,
    reclassified_this_month: reclassifiedThisMonth,
    otras_contrapartes: otrasContrapartes,
  };
}

// --- "no me preguntes más por esta" -----------------------------------------

export type SilenceError = "empty_pattern" | "counterparty_not_found";

export type SilenceResult =
  | {
      ok: true;
      pattern: string;
      counterparty: string;
      /** **R13: `false` no es éxito.** Significa que ya estaba silenciada y
       * esta llamada no sacó un solo movimiento de la cola. */
      changed: boolean;
    }
  | { ok: false; error: SilenceError };

/**
 * El patrón se deriva de la contraparte real, igual que al clasificar. Éste era
 * el único escritor de patrones del motor que aceptaba cualquier texto, y por
 * ahí volvía a entrar la trampa: `toRulePattern` perdona la caja y los acentos
 * pero **no el espaciado interno**, así que silenciar `"CAFE  centro"` con dos
 * espacios guardaba un patrón que no matchea nada, devolvía `ok`, y dejaba la
 * contraparte intacta en la cola (W22).
 */
export async function silenceCounterparty(
  ledger: FirestoreLedger,
  rawCounterparty: string,
  now: Date
): Promise<SilenceResult> {
  if (toRulePattern(rawCounterparty) === "") return { ok: false, error: "empty_pattern" };

  const counterparty = await ledger.resolveCounterparty(rawCounterparty);
  if (counterparty === null) return { ok: false, error: "counterparty_not_found" };

  const pattern = toRulePattern(counterparty);
  const changed = await ledger.silenciar(pattern, counterparty, now);
  return { ok: true, pattern, counterparty, changed };
}

export async function unsilenceCounterparty(ledger: FirestoreLedger, raw: string): Promise<boolean> {
  return ledger.desilenciar(toRulePattern(raw));
}

// --- la salida de la cola de monto ------------------------------------------

export const REVIEW_ACTIONS = ["confirm", "correct", "discard"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export interface ResolveReviewInput {
  id: string;
  action: ReviewAction;
  /** Obligatorio en `correct`, prohibido en el resto. */
  amount?: number;
  note?: string;
  /** Quién resuelve. Sin esto la auditoría no sirve de nada, así que se exige:
   * cada superficie pasa su propio default. */
  resolvedBy: string;
}

export type ResolveReviewError =
  | "not_found"
  | "amount_required"
  | "amount_not_allowed"
  | "invalid_amount"
  | "foreign_currency"
  | "resolved_by_required";

export type ResolveReviewResult =
  | { ok: true; changed: true; action: ReviewAction; doc: TransactionDoc; resolution: ReviewResolutionDoc }
  | { ok: true; changed: false; reason: "already_resolved"; doc: TransactionDoc }
  | { ok: false; error: ResolveReviewError };

/** Un monto que una persona puede afirmar: finito y no negativo. **Cero es
 * válido** — CLAUDE.md regla 4: lo desconocido no es 0, es `null` +
 * `needs_review`, y de eso justamente se está saliendo acá. */
function esMontoEscribible(amount: number): boolean {
  return Number.isFinite(amount) && amount >= 0;
}

export async function resolveReview(
  ledger: FirestoreLedger,
  input: ResolveReviewInput,
  monedaBase: string,
  now: Date
): Promise<ResolveReviewResult> {
  if (input.resolvedBy.trim() === "") return { ok: false, error: "resolved_by_required" };

  if (input.action === "correct") {
    if (input.amount === undefined) return { ok: false, error: "amount_required" };
    if (!esMontoEscribible(input.amount)) return { ok: false, error: "invalid_amount" };
  } else if (input.amount !== undefined) {
    // Aceptar un número y descartarlo en silencio le haría creer al humano que
    // corrigió algo que nunca se escribió.
    return { ok: false, error: "amount_not_allowed" };
  }

  const doc = await ledger.transactionDoc(input.id);
  if (doc === null) return { ok: false, error: "not_found" };
  // El estado que decide es el de la fila, no el historial: una fila que ya
  // salió de la cola no vuelve a entrar por acá.
  if (!doc.needsReview) return { ok: true, changed: false, reason: "already_resolved", doc };

  // El parser marca las compras en otra moneda a propósito, porque los totales
  // suman sin mirar `currency`: no hay conversión en ningún lado. Un `confirm`
  // desharía esa guarda y metería el número crudo como si fuera moneda base.
  // Quedan las dos salidas honestas: `correct` con el equivalente convertido
  // (que además deja `source = 'human'`) o `discard`.
  if (input.action === "confirm" && doc.currency !== monedaBase) {
    return { ok: false, error: "foreign_currency" };
  }

  const previousAmount = doc.amountCents / 100;
  const newAmount = input.action === "correct" ? (input.amount as number) : null;

  let actualizado: TransactionDoc;
  if (input.action === "correct") {
    actualizado = {
      ...doc,
      amountCents: toCents(newAmount as number),
      // `correct` sobre una fila en otra moneda ES, por diseño, una persona
      // afirmando el equivalente convertido, así que la cifra queda en moneda
      // base y suma como tal. Dejar el rótulo viejo dibujaría "12,40 ARS" sobre
      // un número que son dólares (W15). En una fila que ya estaba en la moneda
      // base esto no cambia nada.
      currency: monedaBase,
      // `source` es una afirmación sobre cómo se obtuvo el monto: después de
      // una corrección manual no es ni `hybrid` ni `deterministic`.
      source: "human",
      needsReview: false,
    };
  } else if (input.action === "discard") {
    actualizado = { ...doc, needsReview: false, isDiscarded: true };
  } else {
    actualizado = { ...doc, needsReview: false };
  }

  const { doc: guardado, resolution } = await ledger.aplicarResolucion(actualizado, {
    transaction_id: doc.gmailMsgId,
    gmail_msg_id: doc.gmailMsgId,
    action: input.action,
    previous_amount: previousAmount,
    new_amount: newAmount,
    note: input.note ?? null,
    resolved_by: input.resolvedBy.trim(),
    resolved_at: now.toISOString(),
  });

  return { ok: true, changed: true, action: input.action, doc: guardado, resolution };
}
