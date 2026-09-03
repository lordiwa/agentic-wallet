/**
 * nextPayday and its supporting predictions (spec §9.1). Reads
 * strategy_config's `sueldo.diasPago` and, when they exist, real `sueldo`
 * transactions from the ledger to refine the predicted day-of-month.
 */
import type Database from "better-sqlite3";
import { getStrategyConfig } from "../db/strategy-config.js";
import { localDayKey, localCalendarDate, localParts } from "./dates.js";

export interface PayWindow {
  minDay: number;
  maxDay: number;
}

/** Los días que un mes puede tener. Fuera de esto no hay ventana: ver
 * `esDiaDelMes` y el comentario de `parseDiasPago`. */
function esDiaDelMes(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= 31;
}

/**
 * Parses one `sueldo.diasPago` entry into an inclusive day-of-month window:
 *   - `"<=N"` -> `{minDay: 1, maxDay: N}` (paid on or before day N)
 *   - `"A-B"` -> `{minDay: A, maxDay: B}` (paid sometime in [A, B])
 * An entry matching neither shape -- or an inverted range (A > B) -- is
 * skipped rather than guessed at or thrown on (AC9: "sin datos -> null/0 sin
 * crashear ni inventar").
 *
 * **Un día fuera de 1..31 tampoco es una ventana** (wargaming ronda 4, W30).
 * `localCalendarDate` clampea el día al mes real, así que `"40-40"` predecía en
 * silencio el último día de cada mes y `"0-0"` el primero: una fecha inventada
 * con cara de configuración. `normalizarDiasPago` (onboard/profile.ts) ya
 * rechazaba el rango, pero es el validador de UNA superficie —el panel—, y ni
 * `set_profile` (MCP) ni `--set` (CLI) pasan por él. Qué día del mes existe lo
 * decide la lectura, que es este archivo, y así vale para todas.
 */
export function parseDiasPago(diasPago: string[]): PayWindow[] {
  const windows: PayWindow[] = [];
  for (const raw of diasPago) {
    const spec = raw.trim();

    const le = /^<=(\d{1,2})$/.exec(spec);
    if (le) {
      const maxDay = Number(le[1]);
      if (esDiaDelMes(maxDay)) windows.push({ minDay: 1, maxDay });
      continue;
    }

    const range = /^(\d{1,2})-(\d{1,2})$/.exec(spec);
    if (range) {
      const minDay = Number(range[1]);
      const maxDay = Number(range[2]);
      if (esDiaDelMes(minDay) && esDiaDelMes(maxDay) && minDay <= maxDay) windows.push({ minDay, maxDay });
    }
  }
  return windows;
}

/** Si el calendario sabe leer esta entrada de `diasPago`. Es la definición que
 * comparten los tres escritores de perfil (W30). */
export function esVentanaDePago(spec: string): boolean {
  return parseDiasPago([spec]).length === 1;
}

/** Best-guess day-of-month for a window with no matching ledger history: the
 * window's latest day (e.g. "<=5" predicts day 5, "18-20" predicts day 20)
 * -- the conservative upper bound, since assuming pay lands later than it
 * actually does never overestimates available money, while assuming it
 * lands earlier could. */
function fallbackDayForWindow(window: PayWindow): number {
  return window.maxDay;
}

/** Refines a window's predicted day-of-month using real `sueldo` ledger
 * history: the rounded average day-of-month of every historical sueldo
 * transaction that falls inside this window. Falls back to
 * `fallbackDayForWindow` when no historical transaction matches it. */
function refineWindowDay(window: PayWindow, historicalDays: number[]): number {
  const matches = historicalDays.filter((day) => day >= window.minDay && day <= window.maxDay);
  if (matches.length === 0) return fallbackDayForWindow(window);
  const average = matches.reduce((sum, day) => sum + day, 0) / matches.length;
  return Math.round(average);
}

/** Every local day-of-month a `type='sueldo'` transaction landed on,
 * across the whole ledger. Invalid `ts` rows are skipped, never crash. */
function historicalPaydayDays(db: Database.Database): number[] {
  const rows = db.prepare("SELECT ts FROM transactions WHERE type = 'sueldo'").all() as { ts: string }[];
  const days: number[] = [];
  for (const row of rows) {
    const key = localDayKey(row.ts);
    if (key === null) continue;
    days.push(Number(key.slice(8, 10)));
  }
  return days;
}

/**
 * Predicts the next `count` payday dates strictly after `from` (spec §9.1),
 * sourced from `sueldo.diasPago` and refined against real `sueldo`
 * transactions when they exist. Returns fewer than `count` entries (down to
 * zero, never throws) when `diasPago` has no parseable window.
 */
export function paydaysAfter(db: Database.Database, from: Date, count = 1): Date[] {
  const config = getStrategyConfig(db);
  const windows = parseDiasPago(config.sueldo.diasPago);
  if (windows.length === 0) return [];

  const historicalDays = historicalPaydayDays(db);
  const refinedDays = windows.map((window) => refineWindowDay(window, historicalDays));

  const { year, monthIndex } = localParts(from);
  const candidates: Date[] = [];
  // TASK-025 review LOW: the lookahead scales with `count` instead of a
  // hardcoded 3 months. A fixed 3-month window silently undercounted
  // paydays for a `count` that needs more than that (paydaysBetween asks
  // for enough candidates to cover a due date that can be many months out
  // -- e.g. a card's fechaMaxima -- and tarjetaStatus.aTiempo read
  // pessimistically wrong as a result). `refinedDays.length` windows/month
  // (1-2 per spec's own diasPago shape) plus 1 buffer month covers `count`
  // candidates even when `from` falls after every window in its own month;
  // floored at 3 so the common 1-2 payday lookup stays cheap.
  const monthsToScan = Math.max(3, Math.ceil(count / refinedDays.length) + 1);
  for (let offset = 0; offset < monthsToScan; offset++) {
    for (const day of refinedDays) {
      const candidate = localCalendarDate(year, monthIndex + offset, day);
      if (candidate.getTime() > from.getTime()) candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates.slice(0, count);
}

/** The single next predicted payday strictly after `from`, as an
 * local `YYYY-MM-DD` string, or `null` when `diasPago` has no
 * parseable window. */
export function nextPayday(db: Database.Database, from: Date = new Date()): string | null {
  const [next] = paydaysAfter(db, from, 1);
  return next ? localDayKey(next) : null;
}

/** Every predicted payday strictly after `from` and on/before `until`
 * (inclusive) -- used by tarjetaStatus (spec §9.5) to count paychecks
 * arriving before a card's due date. */
export function paydaysBetween(db: Database.Database, from: Date, until: Date): Date[] {
  if (until.getTime() <= from.getTime()) return [];
  const spanDays = Math.ceil((until.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  // Generous upper bound (at most 2 windows/month) so even a due date many
  // months out is guaranteed enough candidates before filtering by `until`.
  const count = Math.ceil(spanDays / 14) + 2;
  return paydaysAfter(db, from, count).filter((date) => date.getTime() <= until.getTime());
}
