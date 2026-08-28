/**
 * buildDailyBrief (spec §13 + §10.2, F2-F / TASK-027): the daily brief that
 * replaces the ad-hoc spending report the user used to get manually --
 * total gastado del día anterior, top consumos, comparación vs promedio
 * histórico, alertas de estrategia, y recordatorio de abonar a la tarjeta
 * si llegó el sueldo.
 *
 * Pure over the ledger + strategy_config, same as the F2-C engine it reuses
 * (colchonStatus/tarjetaStatus/transferenciasMes): never the LLM, never a
 * side effect. `date`/`totalGastado`/`topConsumos` are computed with the
 * exact same exclusion clause every strategy aggregate applies
 * (EXCLUDE_FROM_TOTALS_SQL, see strategy/totals.ts) so a reversed/internal/
 * needs_review/reverso row never inflates the brief the way it never
 * inflates the F2-C figures.
 */
import type Database from "better-sqlite3";
import {
  addDays,
  colchonStatus,
  daysBetween,
  localDayKey,
  localMonthRange,
  fromCents,
  parseLocalDay,
  tarjetaStatus,
  toCents,
  transferenciasMes,
} from "../strategy/index.js";
import { EXCLUDE_FROM_TOTALS_SQL } from "../strategy/totals.js";
import { emitMetric, withSpanSync } from "../db/telemetry.js";

/** How many transactions `topConsumos` reports -- the spec names no N, so
 * this is a documented cap, matching transfers.ts's `topContrapartes` cap. */
const TOP_CONSUMOS_LIMIT = 5;

/**
 * "Cerca del tope" (§10.2) for transferenciasMes: fires once the month's
 * transfers reach this fraction of `topeTransferenciasMensual` -- 90% is a
 * documented, tunable constant (the spec names no exact ratio). Also covers
 * `sobrepasado` (>=100%), so a single condition handles both "close to" and
 * "over" the cap.
 */
const TRANSFERENCIAS_CERCA_TOPE_RATIO = 0.9;

/**
 * "Colchón no financiado antes de fin de mes" (§10.2): fires only once the
 * colchón is both unfunded AND this many days (or fewer) remain in the
 * local calendar month -- an unfunded colchón on day 3 of the month isn't
 * yet an actionable alert, but on day 28 it is. Documented, tunable
 * constant; the spec names no exact threshold.
 */
const COLCHON_ALERT_DAYS_BEFORE_MONTH_END = 5;

/**
 * "Llegó el sueldo" window (AC3) for `recordatorioTarjeta`: a `type='sueldo'`
 * income transaction counts as "reciente" when it lands within this many
 * days of `now` (inclusive). Documented, tunable constant -- the spec names
 * no exact window; 3 days comfortably covers "the brief that runs the
 * morning after payday" without also picking up an unrelated payday from
 * weeks ago.
 */
const RECORDATORIO_SUELDO_WINDOW_DAYS = 3;

export type BriefAlertType = "transferencias_cerca_tope" | "colchon_no_financiado" | "tarjeta_riesgo_atraso";

export interface BriefAlert {
  type: BriefAlertType;
  message: string;
}

export interface BriefConsumo {
  counterparty: string | null;
  type: string;
  amount: number;
}

export interface BriefVsPromedio {
  /** The target day's own total gastado. */
  dia: number;
  /** Historical average daily spend (see `historicalDailyAverageOutCents`). */
  promedio: number;
  /** `dia - promedio` -- positive means the day spent above its historical average. */
  diferencia: number;
}

export interface DailyBrief {
  /** local calendar day (YYYY-MM-DD) this brief covers. */
  date: string;
  totalGastado: number;
  topConsumos: BriefConsumo[];
  vsPromedio: BriefVsPromedio;
  alertas: BriefAlert[];
  recordatorioTarjeta: boolean;
}

export interface BuildDailyBriefOptions {
  /** local calendar day (YYYY-MM-DD) this brief covers. Defaults to
   * "yesterday" in local time relative to `now` (AC4: the brief mirrors the
   * report the user used to receive each morning about the previous day's
   * spending). */
  date?: string;
  now?: Date;
}

interface DayRange {
  from: Date;
  to: Date;
}

/** [from, to) half-open local time-calendar-day bounds for `day` ("YYYY-MM-DD"),
 * or `null` if it doesn't parse. */
function dayRange(day: string): DayRange | null {
  const from = parseLocalDay(day);
  if (!from) return null;
  return { from, to: addDays(from, 1) };
}

interface OutRow {
  ts: string;
  type: string;
  amount: number;
  counterparty: string | null;
}

/**
 * Historical average daily spend (in cents) across every `direction='out'`
 * row in the whole ledger (the shared totals exclusions applied, no `type`
 * restriction -- unlike strategy/balance.ts's essentials-only average, this
 * one deliberately mirrors what `totalGastado` itself counts, since the
 * brief compares like-for-like: "today's total gasto" vs "the historical
 * daily total gasto"). Mirrors strategy/balance.ts's
 * `esencialesPromedioDiarioCents` span-based technique (documented there):
 * total cents / (days from the earliest to the latest matching row,
 * inclusive), `0` when there's no matching history. A row with an
 * unparseable `ts` is skipped entirely, same guard.
 */
function historicalDailyAverageOutCents(db: Database.Database): number {
  const rows = db
    .prepare(`SELECT ts, amount FROM transactions WHERE direction = 'out' AND ${EXCLUDE_FROM_TOTALS_SQL}`)
    .all() as { ts: string; amount: number }[];

  let totalCents = 0;
  let minTs: string | null = null;
  let maxTs: string | null = null;
  for (const row of rows) {
    if (localDayKey(row.ts) === null) continue; // unparseable ts -- never crash, never guess a span
    totalCents += toCents(row.amount);
    if (minTs === null || row.ts < minTs) minTs = row.ts;
    if (maxTs === null || row.ts > maxTs) maxTs = row.ts;
  }

  if (minTs === null || maxTs === null) return 0;

  const spanDays = Math.max(1, daysBetween(new Date(minTs), new Date(maxTs)) + 1);
  return Math.round(totalCents / spanDays);
}

/**
 * buildDailyBrief (spec §13, F2-F / TASK-027). `date` defaults to yesterday
 * in local time relative to `now`; `now` defaults to the real current instant.
 */
export function buildDailyBrief(db: Database.Database, options: BuildDailyBriefOptions = {}): DailyBrief {
  const now = options.now ?? new Date();
  const date = options.date ?? localDayKey(addDays(now, -1)) ?? localDayKey(now) ?? "";

  return withSpanSync("brief.build", { date }, () => {
    const range = dayRange(date) ?? { from: now, to: now }; // unparseable date -> empty [now, now) window, never crashes

    const dayRows = db
      .prepare(
        `SELECT ts, type, amount, counterparty FROM transactions
         WHERE direction = 'out' AND ts >= @from AND ts < @to AND ${EXCLUDE_FROM_TOTALS_SQL}`
      )
      .all({ from: range.from.toISOString(), to: range.to.toISOString() }) as OutRow[];

    let totalCents = 0;
    for (const row of dayRows) totalCents += toCents(row.amount);

    const topConsumos: BriefConsumo[] = [...dayRows]
      .sort((a, b) => toCents(b.amount) - toCents(a.amount))
      .slice(0, TOP_CONSUMOS_LIMIT)
      .map((row) => ({ counterparty: row.counterparty, type: row.type, amount: fromCents(toCents(row.amount)) }));

    const promedioCents = historicalDailyAverageOutCents(db);
    const vsPromedio: BriefVsPromedio = {
      dia: fromCents(totalCents),
      promedio: fromCents(promedioCents),
      diferencia: fromCents(totalCents - promedioCents),
    };

    const alertas: BriefAlert[] = [];

    const transferencias = transferenciasMes(db, now);
    if (transferencias.tope > 0 && transferencias.total / transferencias.tope >= TRANSFERENCIAS_CERCA_TOPE_RATIO) {
      alertas.push({
        type: "transferencias_cerca_tope",
        message: `Transferencias del mes: $${transferencias.total.toFixed(2)} de $${transferencias.tope.toFixed(2)} (cerca del tope o superado).`,
      });
    }

    const colchon = colchonStatus(db);
    const { to: monthEnd } = localMonthRange(now);
    const daysUntilMonthEnd = daysBetween(now, monthEnd);
    if (!colchon.financiado && daysUntilMonthEnd <= COLCHON_ALERT_DAYS_BEFORE_MONTH_END) {
      alertas.push({
        type: "colchon_no_financiado",
        message: `Colchón sin financiar cerca de fin de mes: faltan $${colchon.faltante.toFixed(2)}.`,
      });
    }

    const tarjeta = tarjetaStatus(db, now);
    if (tarjeta && !tarjeta.aTiempo) {
      alertas.push({
        type: "tarjeta_riesgo_atraso",
        message: `Riesgo de no pagar la tarjeta a tiempo${tarjeta.fechaMaxima ? ` (vence ${tarjeta.fechaMaxima})` : ""}.`,
      });
    }

    // recordatorioTarjeta (AC3): a recent sueldo income landed AND the card
    // isn't paid off. "Paid off" can't be known precisely from the ledger
    // alone (no explicit "card payment made" event yet) -- approximated as
    // the latest statement still carrying a positive saldoCorte. Documented
    // heuristic, not a precise payment-tracking signal.
    const since = addDays(now, -RECORDATORIO_SUELDO_WINDOW_DAYS);
    const sueldoRow = db
      .prepare(
        `SELECT COUNT(*) as c FROM transactions
         WHERE type = 'sueldo' AND direction = 'in' AND ts >= @since AND ts <= @now AND ${EXCLUDE_FROM_TOTALS_SQL}`
      )
      .get({ since: since.toISOString(), now: now.toISOString() }) as { c: number };
    const sueldoLlego = sueldoRow.c > 0;
    const tarjetaNoPagada = tarjeta !== null && tarjeta.saldoCorte > 0;
    const recordatorioTarjeta = sueldoLlego && tarjetaNoPagada;

    const brief: DailyBrief = { date, totalGastado: fromCents(totalCents), topConsumos, vsPromedio, alertas, recordatorioTarjeta };

    emitMetric("brief.built", { alertCount: alertas.length, recordatorioTarjeta });

    return brief;
  });
}
