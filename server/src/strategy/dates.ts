/**
 * Local-calendar-day helpers shared by the whole strategy engine, and the
 * single place the wallet decides what "today" means for its owner.
 *
 * The technique is a fixed whole-hour UTC offset, not a tz database: bank
 * emails carry an instant, and every figure the engine reports ("gastado
 * hoy", "este mes", "dias hasta el proximo pago") is a bucketing of those
 * instants into the user's own calendar days. A constant offset does that
 * exactly, with no dependency, for every user in a zone that does not
 * observe DST -- which covers all of Latin America except Chile/Paraguay and
 * parts of Mexico.
 *
 * CAVEAT, stated plainly: if the user's zone DOES observe DST, day
 * boundaries will be off by one hour for part of the year, which can put a
 * late-night or early-morning transaction on the neighbouring calendar day.
 * Amounts are never affected -- only which day they are counted in. Making
 * this DST-correct means swapping this module for `Intl.DateTimeFormat` with
 * a real IANA zone; every caller goes through the helpers here, so that is a
 * change to one file.
 *
 * Configure with `WALLET_UTC_OFFSET_HOURS` in `.env` (e.g. `-5` for Bogota/
 * Lima/Quito, `-3` for Buenos Aires, `+1` for Madrid). Read per call rather
 * than captured at import time so a test (or the onboarding CLI) can set it
 * without having to re-import the module graph.
 */
import "../config.js"; // side effect: loads .env so WALLET_UTC_OFFSET_HOURS is visible

const DEFAULT_UTC_OFFSET_HOURS = -5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The configured offset, or the default when unset/unparseable (a typo in
 * `.env` must not turn every date into NaN). */
function localUtcOffsetHours(): number {
  const raw = process.env.WALLET_UTC_OFFSET_HOURS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_UTC_OFFSET_HOURS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_UTC_OFFSET_HOURS;
}

export interface LocalDateParts {
  year: number;
  /** 0-based, like `Date.prototype.getMonth()`. */
  monthIndex: number;
  day: number;
}

/** Shifts a UTC instant by the fixed local time offset so UTC getters on the
 * result read as local wall-clock fields. Internal only -- callers
 * use the read/construct helpers below rather than this raw shift. */
function shiftToLocal(date: Date): Date {
  return new Date(date.getTime() + localUtcOffsetHours() * 60 * 60 * 1000);
}

/** local calendar day as `YYYY-MM-DD`, or `null` if `ts` doesn't
 * parse -- never throws (mirrors reconcile.ts's LOW-1 fix). */
export function localDayKey(ts: string | Date): string | null {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  if (Number.isNaN(date.getTime())) return null;
  return shiftToLocal(date).toISOString().slice(0, 10);
}

/** local {year, monthIndex, day} for a UTC instant. */
export function localParts(date: Date): LocalDateParts {
  const shifted = shiftToLocal(date);
  return { year: shifted.getUTCFullYear(), monthIndex: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

/**
 * The UTC instant of local midnight (00:00 -05:00 = 05:00 UTC) on
 * the given local calendar day. `monthIndex` may be out of [0,11]
 * (e.g. 13) and rolls over years normally, same as the native `Date`
 * constructor. `day` is clamped to the last real day of the resolved month
 * (e.g. day 31 in a 30-day month lands on the 30th) instead of overflowing
 * into the next month, so a config day like "30" never silently becomes
 * "March 2" in February.
 */
export function localCalendarDate(year: number, monthIndex: number, day: number): Date {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(Math.max(day, 1), daysInMonth);
  return new Date(Date.UTC(year, monthIndex, clampedDay, -localUtcOffsetHours(), 0, 0, 0));
}

/** Parses an ISO calendar-day string ("YYYY-MM-DD") as local
 * midnight -- used for strategy_config's `balanceSnapshot.at`, which is a
 * plain date with no time component. Returns `null` if it doesn't parse. */
export function parseLocalDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  return localCalendarDate(Number(y), Number(m) - 1, Number(d));
}

/** [from, to) half-open UTC-instant bounds for the local calendar month containing `now`. */
export function localMonthRange(now: Date): { from: Date; to: Date } {
  const { year, monthIndex } = localParts(now);
  return { from: localCalendarDate(year, monthIndex, 1), to: localCalendarDate(year, monthIndex + 1, 1) };
}

/** Whole calendar days from `from` to `to` (can be negative), rounded up --
 * a partial day still counts as a full day remaining/elapsed. */
export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Adds `days` whole days to a UTC instant. Safe for local midnight
 * instants (no DST to trip over an exact-24h shift). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Un `YYYY-MM-DD` pelado en un filtro es un **día local**, no un instante UTC.
 *
 * `ts` se guarda en UTC y todo el motor bucketea por día local, pero las
 * consultas comparan strings: `from=2026-09-01` deja entrar las compras de la
 * noche del 31 de agosto y `to=…T23:59:59.999Z` deja afuera las de la noche del
 * 30 de septiembre. Sobre el ledger real 233 de 1140 filas caen en un día
 * distinto del que el Resumen les asigna (wargaming ronda 3, W26).
 *
 * Vive **acá** y no en el borde HTTP porque qué es un día lo decide el motor, y
 * porque tenerlo en un solo borde es lo que dejó a la tool MCP
 * `query_transactions` cortando en UTC mientras el panel cortaba en local: la
 * misma pregunta, dos ventanas, sin un solo error (ronda 4, W29).
 *
 * Un instante ISO con hora se respeta tal cual — quien manda una hora está
 * pidiendo esa hora.
 */
const DIA_PELADO = /^\d{4}-\d{2}-\d{2}$/;

/** El primer instante del día local `valor`, o `valor` intacto si no es un día
 * pelado. */
export function instanteDesde(valor: string | undefined): string | undefined {
  if (valor === undefined || !DIA_PELADO.test(valor)) return valor;
  return parseLocalDay(valor)?.toISOString() ?? valor;
}

/** El último instante del día local `valor` (las consultas comparan con `<=`),
 * o `valor` intacto si no es un día pelado. */
export function instanteHasta(valor: string | undefined): string | undefined {
  if (valor === undefined || !DIA_PELADO.test(valor)) return valor;
  const inicio = parseLocalDay(valor);
  if (inicio === null) return valor;
  return new Date(addDays(inicio, 1).getTime() - 1).toISOString();
}
