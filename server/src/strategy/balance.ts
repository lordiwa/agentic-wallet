/**
 * balanceActual, colchonStatus, and safeToSpendHoy (spec §9.2-9.4) -- the
 * money-available-today trio.
 */
import type Database from "better-sqlite3";
import { getStrategyConfig } from "../db/strategy-config.js";
import { tarjetaStatus } from "./card.js";
import { nextPayday } from "./calendar.js";
import { addDays, daysBetween, localDayKey, parseLocalDay } from "./dates.js";
import { fromCents, toCents } from "./money.js";
import { EXCLUDE_FROM_TOTALS_SQL } from "./totals.js";

/**
 * balanceActual (spec §9.2): balanceSnapshot.amount + ingresos - gastos
 * since the snapshot.
 *
 * `balanceSnapshot.at` is a plain calendar day (no time component), and its
 * `amount` is assumed to already reflect everything through the end of that
 * local day -- so only transactions strictly after local
 * midnight of the *following* day count toward the delta; a transaction
 * dated on the snapshot day itself would double-count. If `at` doesn't
 * parse, the delta window falls back to "everything" (epoch onward) rather
 * than throwing.
 *
 * Ambiguity resolved beyond the literal spec text ("excluyendo is_internal
 * e is_reversed"): this also excludes needs_review and type='reverso' rows,
 * applying the full shared `EXCLUDE_FROM_TOTALS_SQL` clause (see totals.ts)
 * rather than just the two named there. balanceActual sums both ingresos
 * and gastos since a point in time -- it IS a totals aggregate, and the
 * F2-B review CONSTRAINTS block marks that exclusion set as critical for
 * "todo agregado" -- so the two are applied consistently everywhere in this
 * package rather than diverging on this one function.
 */
export function balanceActual(db: Database.Database, now: Date = new Date()): number {
  const config = getStrategyConfig(db);
  const snapshotDay = parseLocalDay(config.balanceSnapshot.at);
  const since = snapshotDay ? addDays(snapshotDay, 1) : new Date(0);

  const rows = db
    .prepare(
      `SELECT direction, amount FROM transactions
       WHERE ts >= @since AND ts <= @now AND ${EXCLUDE_FROM_TOTALS_SQL}`
    )
    .all({ since: since.toISOString(), now: now.toISOString() }) as { direction: string; amount: number }[];

  let deltaCents = 0;
  for (const row of rows) {
    const cents = toCents(row.amount);
    if (row.direction === "in") deltaCents += cents;
    else if (row.direction === "out") deltaCents -= cents;
  }

  return fromCents(toCents(config.balanceSnapshot.amount) + deltaCents);
}

export interface ColchonStatus {
  objetivo: number;
  reservado: number;
  /** La formula de la §9.3: `reservado >= objetivo`. **Sola no alcanza para
   * decir "cumpliste"** — ver `fijado`. */
  financiado: boolean;
  faltante: number;
  /**
   * **R25.** Hay una meta contra la que medir (`objetivo > 0`).
   *
   * Sin esto, "no fije objetivo" y "cumpli mi objetivo" contestan identico
   * —`financiado: true, faltante: 0`—, y el unico que sabia distinguirlos era el
   * panel en su propia capa (`panel/src/lib/colchon.ts`): para el chat, el brief
   * y cualquier agente por MCP, una billetera recien instalada tenia el colchon
   * financiado (wargaming ronda 4, W32).
   *
   * Va aca y no cambiando `financiado` porque `financiado` es la formula de la
   * especificacion y el brief dispara su alerta con ella: invertirla haria sonar
   * "colchon no financiado" en toda billetera que todavia no fijo objetivo.
   */
  fijado: boolean;
}

/** colchonStatus (spec §9.3): the "colchon" savings goal against
 * `strategy_config.colchonObjetivo`. Degrades to `reservado: 0` when no
 * `savings` row (label='colchon') exists yet. */
export function colchonStatus(db: Database.Database): ColchonStatus {
  const config = getStrategyConfig(db);
  const row = db.prepare("SELECT reserved FROM savings WHERE label = 'colchon' ORDER BY id DESC LIMIT 1").get() as
    | { reserved: number | null }
    | undefined;

  const objetivoCents = toCents(config.colchonObjetivo);
  const reservadoCents = toCents(row?.reserved ?? 0);
  const financiado = reservadoCents >= objetivoCents;
  const faltanteCents = Math.max(0, objetivoCents - reservadoCents);

  return {
    objetivo: fromCents(objetivoCents),
    reservado: fromCents(reservadoCents),
    financiado,
    faltante: fromCents(faltanteCents),
    fijado: objetivoCents > 0,
  };
}

const ESSENTIAL_TYPES = ["debito", "servicio", "retiro"];

/** Historical average daily spend (in cents) on `type IN (debito, servicio,
 * retiro)` -- explicitly NOT transferencia -- across the whole ledger,
 * excluding the shared totals exclusions. `0` when there is no matching
 * history. The averaging window is the span between the earliest and latest
 * matching row (inclusive), not the ledger's full date range.
 *
 * TASK-025 review MEDIUM: a row with an unparseable `ts` is skipped
 * entirely (never folded into the min/max span or the total) -- same guard
 * calendar.ts's `historicalPaydayDays` already applies. Without it, `new
 * Date(minTs)`/`new Date(maxTs)` on an Invalid Date makes `daysBetween`
 * return NaN, and `Math.max(1, NaN)` is NaN too (Math.max propagates any
 * NaN argument, it does NOT fall back to 1) -- silently turning
 * safeToSpendHoy's headline number into NaN. Today's single ts producer
 * always writes `toISOString()`, so this is currently unreachable, but
 * every other date-consuming spot in this package already degrades safely
 * on a bad ts and this one must too. */
function esencialesPromedioDiarioCents(db: Database.Database): number {
  const placeholders = ESSENTIAL_TYPES.map((_, i) => `@t${i}`).join(", ");
  const params: Record<string, unknown> = {};
  ESSENTIAL_TYPES.forEach((t, i) => (params[`t${i}`] = t));

  const rows = db
    .prepare(
      `SELECT ts, amount FROM transactions
       WHERE type IN (${placeholders}) AND direction = 'out' AND ${EXCLUDE_FROM_TOTALS_SQL}`
    )
    .all(params) as { ts: string; amount: number }[];

  let totalCents = 0;
  let minTs: string | null = null;
  let maxTs: string | null = null;
  for (const row of rows) {
    if (localDayKey(row.ts) === null) continue; // unparseable ts -- never crash, never guess a span
    totalCents += toCents(row.amount);
    if (minTs === null || row.ts < minTs) minTs = row.ts;
    if (maxTs === null || row.ts > maxTs) maxTs = row.ts;
  }

  if (minTs === null || maxTs === null) return 0; // no valid-ts rows matched

  const spanDays = Math.max(1, daysBetween(new Date(minTs), new Date(maxTs)) + 1);
  return Math.round(totalCents / spanDays);
}

/**
 * safeToSpendHoy (spec §9.4):
 *
 *   max(0, (disponible - colchonReservado - proximoPagoTarjeta -
 *           esencialesEstimadosHastaProximoPago) / diasHastaProximoPago)
 *
 *  - disponible               = balanceActual()
 *  - colchonReservado         = colchonStatus().reservado
 *  - proximoPagoTarjeta       = tarjetaStatus().saldoCorte -- the amount
 *    owed at the last statement's cutoff, i.e. the standing card obligation
 *    coming due -- or 0 when there is no statement yet.
 *  - esencialesEstimadosHastaProximoPago = esencialesPromedioDiarioCents()
 *    (type IN debito/servicio/retiro, no transferencias) * diasHastaProximoPago.
 *  - diasHastaProximoPago     = whole days from `now` to nextPayday().
 *
 * Divide-by-zero / no-data guard: when there is no predictable next payday,
 * or it isn't strictly in the future (diasHastaProximoPago <= 0), the daily
 * budget is undefined -- return 0 instead of dividing by zero or by a
 * non-positive number.
 */
export function safeToSpendHoy(db: Database.Database, now: Date = new Date()): number {
  const nextPay = nextPayday(db, now);
  const nextPayDate = nextPay ? parseLocalDay(nextPay) : null;
  if (nextPayDate === null) return 0;

  const diasHastaProximoPago = daysBetween(now, nextPayDate);
  if (diasHastaProximoPago <= 0) return 0;

  const disponibleCents = toCents(balanceActual(db, now));
  const colchonCents = toCents(colchonStatus(db).reservado);
  const tarjeta = tarjetaStatus(db, now);
  const proximoPagoTarjetaCents = tarjeta ? toCents(tarjeta.saldoCorte) : 0;
  const esencialesCents = esencialesPromedioDiarioCents(db) * diasHastaProximoPago;

  const numeratorCents = disponibleCents - colchonCents - proximoPagoTarjetaCents - esencialesCents;
  const perDayCents = Math.round(numeratorCents / diasHastaProximoPago);

  return Math.max(0, fromCents(perDayCents));
}
