/**
 * Special-rules engine over parsed transactions (spec 5.3, TASK-013 / F1-04).
 * Applied to F1-03's parser output BEFORE totals are computed. Every export
 * here is a pure function: no DB access, no ingestion pipeline. F1-07 wires
 * these against real gmail reads / DB lookups and persists the result.
 */

import type { ParsedTransaction } from "../parser/types.js";
import { localDayKey } from "../strategy/dates.js";

/**
 * A parsed transaction enriched with the two identity fields F1-03's
 * `ParsedTransaction` doesn't carry — it's a bank-agnostic parse result with
 * no notion of "when" or "which email produced it". F1-07 has both (from the
 * `InboundEmail` it fed to the parser) and must attach them before calling
 * into this layer. `is_reversed` / `is_internal` mirror the DB columns in
 * `server/src/db/repository.ts` that F1-07 eventually persists.
 */
export interface ReconcilableTransaction extends ParsedTransaction {
  gmail_msg_id: string;
  ts: string;
  is_reversed?: boolean;
  is_internal?: boolean;
}

/**
 * The fields needed to match a "Reverso Consumo" email against a previous
 * debito consumo.
 *
 * CAVEAT: F1-03's `ReversoEmail` (see server/src/parser/types.ts) currently
 * only carries `raw_subject` — `produbanco.ts` classifies the subject and
 * stops there, it does not extract amount/account/ts for reverso emails.
 * This shape is therefore NOT what the parser emits today. F1-07 (or a
 * follow-up to F1-03's reverso case) must supply amount/account/ts per
 * reverso, most likely by extracting them from the same `InboundEmail` the
 * same way `produbanco.ts` already does for retiro/debito bodies.
 */
export interface ReversoCandidate {
  raw_subject: string;
  amount: number;
  account: string | null;
  /** El comercio del consumo revertido ("Establecimiento" en el cuerpo). Es
   * el segundo eje del apareo cuando no hay cuenta — ver `corroborations`. */
  counterparty?: string | null;
  ts: string;
  gmail_msg_id?: string;
}

export interface ReversalMatch {
  reverso: ReversoCandidate;
  consumo: ReconcilableTransaction;
}

export interface ApplyReversalsResult {
  transactions: ReconcilableTransaction[];
  reversalsApplied: ReversalMatch[];
  ambiguous: ReversoCandidate[];
  /** Reversos that matched zero candidate consumos (wrong amount/account,
   * outside the temporal window, or an invalid ts). Reported so a reverso
   * with no match doesn't just silently evaporate — it's not "ambiguous"
   * (that's for 2+ candidates), just unresolved. */
  unmatched: ReversoCandidate[];
}

/**
 * Window (in hours) within which a reverso is still considered "cercano" to
 * its consumo when they fall on different local calendar days (e.g. an
 * 11:50pm consumo reversed at 1:30am). Same-calendar-day always matches
 * regardless of this window; it only widens the match across a midnight
 * boundary. Chosen as a conservative reading of spec 5.3's "mismo dia /
 * pocas horas" — wide enough to cover a same-night reversal, narrow enough
 * that a reverso two days later still requires a human look (needs_review
 * territory, not handled by this window).
 */
export const REVERSAL_CROSS_MIDNIGHT_WINDOW_HOURS = 6;

function isWithinReversalWindow(consumoTs: string, reversoTs: string): boolean {
  // `localDayKey` (strategy/dates.ts) holds the single definition of "which
  // calendar day is this instant on", driven by WALLET_UTC_OFFSET_HOURS. It
  // returns null for an unparseable ts instead of throwing — every caller
  // here reads that as "can't safely place this in any window": no match,
  // not a crash.
  const consumoDay = localDayKey(consumoTs);
  const reversoDay = localDayKey(reversoTs);
  if (consumoDay === null || reversoDay === null) return false; // invalid ts never matches
  if (consumoDay === reversoDay) return true;
  const diffMs = Math.abs(new Date(reversoTs).getTime() - new Date(consumoTs).getTime());
  return diffMs <= REVERSAL_CROSS_MIDNIGHT_WINDOW_HOURS * 60 * 60 * 1000;
}

/** Cents-safe amount equality. F1-03 already validates amounts (AC6, no
 * re-parsing here) but float comparison can still drift (0.1 + 0.2 style),
 * so compare rounded to integer cents rather than with `===`. */
function amountsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Si dos cuentas **pueden** ser la misma.
 *
 * Tres valores, no dos: `null` es "no lo sé", no "una cuenta más". La versión
 * anterior comparaba por igualdad y eso rompía el apareo en las dos
 * direcciones a la vez:
 *
 * - dos desconocidas daban IGUAL, así que el eje desaparecía y el apareo
 *   degeneraba a monto + día — dos consumos del mismo monto el mismo día
 *   quedaban marcados para siempre (29 % de las revisiones del ledger real);
 * - una conocida contra una desconocida daba DISTINTA, así que un reverso no
 *   apareaba a nadie y **su consumo seguía sumando como gasto**. Ese es el
 *   caso de quien empieza hoy: el correo de consumo trae "Cuenta débito" y el
 *   de reverso no.
 *
 * Desconocida es compatible con todo. Lo que excluye es un desacuerdo real
 * entre dos cuentas conocidas: eso sí es evidencia de que son otra tarjeta.
 *
 * Y son dos identificadores distintos, no dos lecturas del mismo: el consumo
 * identifica la CUENTA (`Cuenta Débito: ... XXXXXX54321`) y el reverso la
 * TARJETA. Ver docs/formato-correos-produbanco.md sección 4.9.
 */
function accountsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return true;
  return a === b;
}

/** Compatible no es lo mismo que corroborado: dos cuentas conocidas e iguales
 * son evidencia a favor; una desconocida no es evidencia de nada. */
function accountsCorroborate(a: string | null | undefined, b: string | null | undefined): boolean {
  return a !== null && a !== undefined && b !== null && b !== undefined && a === b;
}

/**
 * El comercio corrobora cuando los dos correos lo nombran igual (tolerando
 * tildes, mayúsculas y espacios: es el mismo campo del mismo banco).
 *
 * Un comercio **distinto** no descarta: el nombre llega recortado o con
 * sufijo de sucursal según el correo, y descartar por eso dejaría el consumo
 * revertido sumando como gasto. Sirve para elegir entre candidatos, nunca
 * para quedarse sin ninguno.
 */
function counterpartiesCorroborate(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const normalizedA = normalizeName(a);
  return normalizedA !== "" && normalizedA === normalizeName(b);
}

/** Cuánta evidencia independiente tiene este candidato a favor. Los dos ejes
 * pesan igual: si uno corrobora la cuenta y otro el comercio, no hay con qué
 * elegir y decide un humano. */
function corroborations(tx: ReconcilableTransaction, reverso: ReversoCandidate): number {
  return (
    (accountsCorroborate(tx.account, reverso.account) ? 1 : 0) +
    (counterpartiesCorroborate(tx.counterparty, reverso.counterparty) ? 1 : 0)
  );
}

/**
 * Rule 1 (spec 5.3.1 / AC1): match each reverso against a previously-parsed
 * debito consumo by amount + account + temporal closeness, mark the matched
 * consumo `is_reversed = true` (so downstream totals can exclude it), and
 * leave the reverso itself untouched as an auditable record — it is never
 * summed by this layer or any caller.
 *
 * El apareo es en dos pasos, y la diferencia importa cuando falta un campo
 * (ver `accountsCompatible`):
 *
 * 1. **Compatibilidad** — quién *podría* ser: mismo monto, dentro de la
 *    ventana, y sin desacuerdo entre dos cuentas conocidas. Un campo
 *    desconocido no descarta a nadie.
 * 2. **Corroboración** — quién tiene más evidencia a favor (cuenta y comercio
 *    que coinciden). Gana la cima; si hay empate en la cima, no se elige.
 *
 * Ambiguity guard (AC5): si más de un candidato empata en la cima, ninguno se
 * toca y el reverso se reporta en `ambiguous`. Nunca se casa a ciegas —
 * apuntarle al consumo equivocado borra un gasto real de los totales y suma
 * uno que sí ocurrió.
 *
 * Matching is first-come-first-served over `reversos` in array order: once
 * a consumo is claimed by one reverso it's no longer a candidate for a
 * later one, so a second reverso with no other candidate simply lands in
 * `unmatched` rather than being flagged ambiguous.
 *
 * MEDIUM-1: when a reverso is ambiguous, `needs_review = true` is set on
 * the tied candidate rows themselves (not just recorded in the separate
 * `ambiguous` array), so the flag survives on the real transaction.
 *
 * MEDIUM-2: a reverso that matches zero candidates is reported in
 * `unmatched` instead of being silently dropped.
 *
 * LOW-1: an invalid `ts` (on either side) never throws and never matches —
 * see `localDayKey`. A consumo with an invalid ts is flagged
 * `needs_review` up front since none of its date-based matching can be
 * trusted; a reverso with an invalid ts is reported unmatched.
 */
export function applyReversals(
  transactions: ReconcilableTransaction[],
  reversos: ReversoCandidate[]
): ApplyReversalsResult {
  // Shallow-copy so matched rows are fresh objects — callers' input array
  // is never mutated in place.
  const result = transactions.map((tx) => ({ ...tx }));
  for (const tx of result) {
    if (localDayKey(tx.ts) === null) {
      tx.needs_review = true;
      tx.review_reason = tx.review_reason ?? "invalid_ts";
    }
  }

  const reversalsApplied: ReversalMatch[] = [];
  const ambiguous: ReversoCandidate[] = [];
  const unmatched: ReversoCandidate[] = [];

  for (const reverso of reversos) {
    if (localDayKey(reverso.ts) === null) {
      unmatched.push(reverso); // can't safely window an invalid ts
      continue;
    }

    const candidates = result.filter(
      (tx) =>
        tx.type === "debito" &&
        tx.direction === "out" &&
        !tx.is_reversed &&
        tx.amount !== null &&
        amountsEqual(tx.amount, reverso.amount) &&
        accountsCompatible(tx.account, reverso.account) &&
        isWithinReversalWindow(tx.ts, reverso.ts)
    );

    if (candidates.length === 0) {
      unmatched.push(reverso);
      continue;
    }

    // Entre los compatibles gana el que trae más evidencia corroborante. No es
    // un desempate cosmético: sin él, aflojar la comparación de cuentas
    // (`accountsCompatible`) convertiría en ambiguo todo lo que hoy aparea bien
    // por cuenta, y una bandera puesta no se saca nunca.
    const best = Math.max(...candidates.map((tx) => corroborations(tx, reverso)));
    const strongest = candidates.filter((tx) => corroborations(tx, reverso) === best);

    if (strongest.length > 1) {
      ambiguous.push(reverso);
      // Sólo los empatados en la cima: los candidatos con menos evidencia no
      // compiten con ellos y marcarlos sería daño permanente gratis.
      for (const candidate of strongest) {
        candidate.needs_review = true;
        candidate.review_reason = candidate.review_reason ?? "ambiguous_reversal_match";
      }
      continue;
    }

    strongest[0].is_reversed = true;
    reversalsApplied.push({ reverso, consumo: strongest[0] });
  }

  return { transactions: result, reversalsApplied, ambiguous, unmatched };
}

export interface DedupeRetirosResult {
  transactions: ReconcilableTransaction[];
  removed: ReconcilableTransaction[];
}

/** Matches the App-order retiro email's subject ("Retiro de Efectivo sin
 * Tarjeta (orden) ... App Móvil"), as opposed to the canonical "en cajero
 * automático" one. Used to decide which half of a same-day/same-amount
 * retiro group is safe to drop — never the "en cajero" side. */
const ORDEN_SUBJECT_RE = /orden/i;

/**
 * Rule 2 (spec 5.3.2 / AC2): a single cash withdrawal produces two
 * Produbanco emails — "Retiro de Efectivo sin Tarjeta (orden)" (App Movil)
 * and "... en cajero automático" (ATM). They're the same operation and
 * must be counted once, using the "en cajero" email as canonical (it's the
 * one with the `Monto:` field F1-03 anchors its amount extraction on).
 *
 * HIGH-1: grouping by day+amount alone is not enough to decide what to
 * remove — two genuine "en cajero" withdrawals of the same amount on the
 * same day are two real transactions, not a duplicate pair. A group is
 * only collapsed when it's *exactly* one "orden" record paired with
 * *exactly* one "en cajero" record; the orden record is dropped and the
 * cajero one kept. Any other shape in the group (two+ "en cajero" records,
 * more than one "orden" record, etc.) is never auto-collapsed — every
 * record in that group is left in place and flagged `needs_review` instead
 * of guessing which one is the duplicate.
 *
 * LOW-1: a retiro with an invalid `ts` can't be safely bucketed by day, so
 * it's excluded from grouping entirely (never grouped, never removed) and
 * flagged `needs_review` instead of throwing.
 *
 * CAVEAT: as of F1-03, the App-order subject doesn't match any recognized
 * case in `produbanco.ts` — it falls through to
 * `{kind:"ignored", reason:"unrecognized_subject"}` and never reaches this
 * layer as a `retiro` transaction. In practice this function currently has
 * nothing to collapse. It's still implemented per the ticket's explicit
 * ask, as a guard for the day F1-03 starts recognizing the App-order
 * subject too (or a different bank sends a genuine duplicate).
 */
export function dedupeRetiros(transactions: ReconcilableTransaction[]): DedupeRetirosResult {
  // Clone so flagging needs_review (invalid-ts / ambiguous-group cases)
  // never mutates the caller's input array in place.
  const result = transactions.map((tx) => ({ ...tx }));
  const groups = new Map<string, ReconcilableTransaction[]>();

  for (const tx of result) {
    if (tx.type !== "retiro" || tx.amount === null) continue;
    const dayKey = localDayKey(tx.ts);
    if (dayKey === null) {
      tx.needs_review = true;
      tx.review_reason = tx.review_reason ?? "invalid_ts";
      continue;
    }
    const key = `${dayKey}|${Math.round(tx.amount * 100)}`;
    const group = groups.get(key);
    if (group) group.push(tx);
    else groups.set(key, [tx]);
  }

  const removed: ReconcilableTransaction[] = [];
  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    const ordenTxs = group.filter((tx) => ORDEN_SUBJECT_RE.test(tx.raw_subject));
    const cajeroTxs = group.filter((tx) => !ORDEN_SUBJECT_RE.test(tx.raw_subject));

    if (ordenTxs.length === 1 && cajeroTxs.length === 1) {
      removed.push(ordenTxs[0]);
      continue;
    }

    // Not a clean orden/cajero pair (e.g. two+ "en cajero" records) —
    // never guess which one is the duplicate.
    for (const tx of group) {
      tx.needs_review = true;
      tx.review_reason = tx.review_reason ?? "ambiguous_retiro_group";
    }
  }

  const removedSet = new Set(removed);
  const kept = result.filter((tx) => !removedSet.has(tx));
  return { transactions: kept, removed };
}

export interface MarkInternalTransfersOptions {
  /** `null`/vacio = titular sin configurar todavia; ver `markInternalTransfers`. */
  titular: string | null;
}

/** Strips accents and case/whitespace so name matching is tolerant, mirroring
 * the `normalize()` helper in server/src/parser/produbanco.ts. */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Cuantos tokens del titular tienen que aparecer en la contraparte para darlas
 * por la misma persona cuando la escritura no es identica.
 *
 * Tres, no dos: con el patron de nombre latinoamericano (dos nombres + dos
 * apellidos) dos tokens compartidos todavia pueden ser dos personas de la
 * misma familia -- un "GONZALO PATRICIO <apellido> <apellido>" comparte
 * apellido con el titular y NO es una interna. Tres ya es identidad en la
 * practica. Menos de tres nunca se marca aunque "suene" parecido: marcar de
 * mas convierte un gasto real en una interna y lo borra de los totales.
 */
const INTERNAL_NAME_TOKEN_MATCH = 3;

/** Los tokens de un nombre, sin puntuacion: el banco (y las anotaciones a mano
 * del historial migrado) agregan parentesis y puntos suspensivos alrededor del
 * nombre -- "JOSE RAFAEL PEREZ (Otro Banco)" -- que no son parte de el. */
function nameTokens(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token !== "")
  );
}

/**
 * Si una contraparte y el titular son la misma persona.
 *
 * No alcanza con comparar los strings normalizados: el banco no escribe el
 * nombre en un orden estable. El titular configurado puede ser
 * "<apellidos> <nombres>" y el mismo correo del banco escribir
 * "<nombres> <apellidos>", o agregar entre parentesis a que banco fue la
 * transferencia. Comparar por conjunto de tokens cubre las tres formas sin
 * inventar equivalencias: o los tokens son exactamente los mismos, o
 * comparten al menos `INTERNAL_NAME_TOKEN_MATCH`.
 */
export function isSameHolder(counterparty: string, titular: string): boolean {
  const cpTokens = nameTokens(counterparty);
  const titularTokens = nameTokens(titular);
  if (cpTokens.size === 0 || titularTokens.size === 0) return false;

  let shared = 0;
  for (const token of titularTokens) if (cpTokens.has(token)) shared += 1;

  // Misma escritura (mismo conjunto exacto): vale aunque el titular tenga uno
  // o dos tokens, que es el caso que cubria la comparacion por igualdad.
  if (shared === titularTokens.size && shared === cpTokens.size) return true;
  return shared >= INTERNAL_NAME_TOKEN_MATCH;
}

/**
 * Los tipos donde "la contraparte es el titular" significa plata propia
 * cambiando de cuenta, en cualquiera de los dos sentidos.
 *
 * `transferencia` (`direction: 'out'`) era el unico caso hasta que la bandeja
 * real mostro el otro: la variante 4.4b del formato Produbanco (§4.4b de
 * docs/formato-correos-produbanco.md) notifica el MISMO movimiento desde el
 * lado que recibe — `Enviada por: <titular>` y `Cuenta Contacto` apuntando a
 * otra cuenta del propio titular. El parser lo clasifica `recibido` porque el
 * correo es, literalmente, una transferencia recibida; el hecho economico es
 * el mismo y **no es un ingreso**. Sin `recibido` en este conjunto esas filas
 * sumaban al saldo plata que nunca entro desde afuera.
 *
 * `sueldo` NO entra, aunque tambien sea `direction: 'in'`: lo paga un
 * empleador, no una cuenta propia. Y `debito`/`servicio`/`retiro` tampoco:
 * ahi la contraparte es un comercio, y un comercio homonimo del titular no
 * convierte un gasto real en un movimiento interno.
 */
const TRANSFER_LIKE_TYPES: ReadonlySet<string> = new Set(["transferencia", "recibido"]);

/**
 * Si una transaccion ya parseada es un movimiento entre cuentas propias.
 * Compartida entre `markInternalTransfers` (durante el sync) y el
 * re-etiquetado del historial ya sincronizado (`category/reclassify.ts`), para
 * que ambos caminos usen exactamente el mismo criterio.
 */
export function isInternalTransfer(
  tx: { type: string; counterparty?: string | null },
  titular: string | null
): boolean {
  if (titular === null || titular.trim() === "") return false;
  if (!TRANSFER_LIKE_TYPES.has(tx.type) || !tx.counterparty) return false;
  return isSameHolder(tx.counterparty, titular);
}

/**
 * Rule 3 (spec 5.3.3 / AC3): a transferencia whose counterparty
 * (Contacto/Beneficiario/Enviada por, already extracted by F1-03) is the
 * account holder itself is an internal movement — mark `is_internal = true`
 * so it's excluded from the totals downstream. Vale en los dos sentidos: la
 * enviada no es gasto y la recibida no es ingreso (ver
 * `TRANSFER_LIKE_TYPES`). Comparison is accent/case/whitespace/orden
 * tolerante — ver `isSameHolder`.
 *
 * Sin titular configurado (`null` o vacio) la regla no se aplica: no hay
 * nombre contra el cual comparar, y marcar por parecido seria inventar. Las
 * filas quedan sin marcar — el usuario configura el titular y un backfill (o
 * el siguiente sync sobre esos correos) las corrige.
 */
export function markInternalTransfers(
  transactions: ReconcilableTransaction[],
  { titular }: MarkInternalTransfersOptions
): ReconcilableTransaction[] {
  if (titular === null || titular.trim() === "") return transactions;
  return transactions.map((tx) => (isInternalTransfer(tx, titular) ? { ...tx, is_internal: true } : tx));
}

export interface ReconcileOptions {
  /** `null` = sin configurar; la regla 3 (internas) se omite. */
  titular: string | null;
}

export interface ReconcileResult {
  transactions: ReconcilableTransaction[];
  reversalsApplied: ReversalMatch[];
  ambiguous: ReversoCandidate[];
  unmatched: ReversoCandidate[];
  retirosRemoved: ReconcilableTransaction[];
}

/**
 * Runs the full special-rules pipeline in order: reversals first (so a
 * reversed consumo is settled before anything else looks at it), then
 * retiro dedup, then internal-transfer marking.
 *
 * Rule 4 (sueldo vs recibido, spec 5.3.4 / AC4) needs no code here — F1-03
 * already classifies `type` as "sueldo" (Acme Internacional Recibida) vs
 * "recibido" (terceros), and nothing in this pipeline touches `type`, so
 * the distinction survives unchanged by construction.
 */
export function reconcile(
  transactions: ReconcilableTransaction[],
  reversos: ReversoCandidate[],
  options: ReconcileOptions
): ReconcileResult {
  const {
    transactions: afterReversals,
    reversalsApplied,
    ambiguous,
    unmatched,
  } = applyReversals(transactions, reversos);
  const { transactions: afterDedupe, removed: retirosRemoved } = dedupeRetiros(afterReversals);
  const afterInternal = markInternalTransfers(afterDedupe, options);
  return { transactions: afterInternal, reversalsApplied, ambiguous, unmatched, retirosRemoved };
}
