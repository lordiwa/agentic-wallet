/**
 * Los helpers de calendario que `derive.ts` no tenía todavía — copia de
 * `server/src/strategy/dates.ts` con **el offset por parámetro**.
 *
 * `derive.ts` ya trae `localDayKey`, `localMonthKey` y `localMonthRange` porque
 * la migración los necesitaba. Acá está el resto, que hace falta desde que se
 * portan el calendario de pagos, el balance desde el snapshot y los filtros de
 * fecha del listado.
 *
 * La razón de que el offset sea un argumento y no `process.env` es la misma que
 * documenta `derive.ts` y no se repite: una función de 2a gen atiende varias
 * peticiones en el mismo proceso.
 *
 * La misma advertencia del original vale igual acá: el huso es un offset fijo
 * de horas enteras, no una zona IANA. En un país con horario de verano los
 * bordes del día quedan corridos una hora parte del año; los montos nunca se
 * ven afectados, sólo en qué día se cuentan.
 */
import { DEFAULT_UTC_OFFSET_HOURS } from "./derive.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface LocalDateParts {
  year: number;
  /** 0-based, como `Date.prototype.getMonth()`. */
  monthIndex: number;
  day: number;
}

/** `{year, monthIndex, day}` locales de un instante UTC. */
export function localParts(date: Date, offsetHours: number = DEFAULT_UTC_OFFSET_HOURS): LocalDateParts {
  const shifted = new Date(date.getTime() + offsetHours * 3_600_000);
  return { year: shifted.getUTCFullYear(), monthIndex: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

/**
 * El instante UTC de la medianoche local del día dado. `monthIndex` puede
 * salirse de [0,11] y rueda de año como el constructor nativo; `day` se
 * **clampea** al último día real del mes, para que un "30" configurado no se
 * convierta en silencio en el 2 de marzo.
 */
export function localCalendarDate(
  year: number,
  monthIndex: number,
  day: number,
  offsetHours: number = DEFAULT_UTC_OFFSET_HOURS
): Date {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(Math.max(day, 1), daysInMonth);
  return new Date(Date.UTC(year, monthIndex, clampedDay, -offsetHours, 0, 0, 0));
}

/** Lee un `YYYY-MM-DD` como medianoche local, o `null` si no parsea. */
export function parseLocalDay(day: string, offsetHours: number = DEFAULT_UTC_OFFSET_HOURS): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  return localCalendarDate(Number(y), Number(m) - 1, Number(d), offsetHours);
}

/** Días calendario enteros de `from` a `to`, redondeando hacia arriba: un día
 * parcial cuenta como un día entero que falta. */
export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Un `YYYY-MM-DD` pelado en un filtro es un **día local**, no un instante UTC.
 *
 * Copia de `instanteDesde`/`instanteHasta`. Sin ellas, `from=2026-09-01` deja
 * entrar las compras de la noche del 31 de agosto: sobre el ledger real eran
 * 233 de 1140 filas cayendo en un día distinto del que el Resumen les asigna
 * (wargaming ronda 3, W26). Un instante con hora se respeta tal cual — quien
 * manda una hora está pidiendo esa hora.
 */
const DIA_PELADO = /^\d{4}-\d{2}-\d{2}$/;

export function instanteDesde(
  valor: string | undefined,
  offsetHours: number = DEFAULT_UTC_OFFSET_HOURS
): string | undefined {
  if (valor === undefined || !DIA_PELADO.test(valor)) return valor;
  return parseLocalDay(valor, offsetHours)?.toISOString() ?? valor;
}

export function instanteHasta(
  valor: string | undefined,
  offsetHours: number = DEFAULT_UTC_OFFSET_HOURS
): string | undefined {
  if (valor === undefined || !DIA_PELADO.test(valor)) return valor;
  const inicio = parseLocalDay(valor, offsetHours);
  if (inicio === null) return valor;
  return new Date(addDays(inicio, 1).getTime() - 1).toISOString();
}
