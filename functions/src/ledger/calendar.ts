/**
 * El calendario de pagos — copia de la parte pura de
 * `server/src/strategy/calendar.ts`.
 *
 * Lo que en el motor sale de la base (`sueldo.diasPago` y los días en los que
 * cayó un `type='sueldo'`) acá entra por parámetro: la lectura de Firestore
 * vive en `firestore-ledger.ts` y esto sólo decide fechas. Así el test de
 * paridad le puede dar las mismas dos listas a las dos implementaciones.
 *
 * `calendar.parity.test.ts` importa la del motor y compara.
 */
import { DEFAULT_UTC_OFFSET_HOURS, localDayKey } from "./derive.js";
import { localCalendarDate, localParts } from "./dates.js";

export interface PayWindow {
  minDay: number;
  maxDay: number;
}

/** Los días que un mes puede tener. Fuera de esto no hay ventana: sin esta
 * guarda un `"40-40"` predecía en silencio el último día de cada mes y un
 * `"0-0"` el primero — una fecha inventada con cara de configuración (W30). */
function esDiaDelMes(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= 31;
}

/**
 * Lee una entrada de `sueldo.diasPago` como una ventana inclusiva de día del
 * mes: `"<=N"` → `{1, N}`, `"A-B"` → `{A, B}`. Lo que no matchea ninguna de las
 * dos formas —o un rango invertido, o un día fuera de 1..31— **se descarta**,
 * no se adivina ni se tira.
 */
export function parseDiasPago(diasPago: readonly string[]): PayWindow[] {
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

/** Si el calendario sabe leer esta entrada. Es la definición que comparten los
 * escritores de perfil (W30). */
export function esVentanaDePago(spec: string): boolean {
  return parseDiasPago([spec]).length === 1;
}

/** Sin historial que la refine, una ventana predice su último día: la cota
 * superior conservadora, porque suponer que el sueldo cae más tarde de lo que
 * cae nunca sobreestima la plata disponible. */
function fallbackDayForWindow(window: PayWindow): number {
  return window.maxDay;
}

function refineWindowDay(window: PayWindow, historicalDays: readonly number[]): number {
  const matches = historicalDays.filter((day) => day >= window.minDay && day <= window.maxDay);
  if (matches.length === 0) return fallbackDayForWindow(window);
  const average = matches.reduce((sum, day) => sum + day, 0) / matches.length;
  return Math.round(average);
}

export interface EntradaCalendario {
  diasPago: readonly string[];
  /** Los días del mes en los que cayó un `type='sueldo'`, de todo el ledger. */
  historicalDays: readonly number[];
  offsetHours?: number;
}

/** Las próximas `count` fechas de pago estrictamente después de `from`. Menos
 * de `count` (hasta cero, nunca una excepción) cuando `diasPago` no tiene una
 * ventana legible. */
export function paydaysAfter(entrada: EntradaCalendario, from: Date, count = 1): Date[] {
  const offsetHours = entrada.offsetHours ?? DEFAULT_UTC_OFFSET_HOURS;
  const windows = parseDiasPago(entrada.diasPago);
  if (windows.length === 0) return [];

  const refinedDays = windows.map((window) => refineWindowDay(window, entrada.historicalDays));

  const { year, monthIndex } = localParts(from, offsetHours);
  const candidates: Date[] = [];
  // El lookahead escala con `count` en vez de ser 3 meses fijos: una fecha de
  // vencimiento de tarjeta puede estar muchos meses adelante y un tope fijo
  // devolvía de menos, haciendo que `aTiempo` se leyera pesimista.
  const monthsToScan = Math.max(3, Math.ceil(count / refinedDays.length) + 1);
  for (let offset = 0; offset < monthsToScan; offset++) {
    for (const day of refinedDays) {
      const candidate = localCalendarDate(year, monthIndex + offset, day, offsetHours);
      if (candidate.getTime() > from.getTime()) candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates.slice(0, count);
}

/** El próximo pago como `YYYY-MM-DD` local, o `null` si no hay ventana
 * legible. */
export function nextPayday(entrada: EntradaCalendario, from: Date): string | null {
  const [next] = paydaysAfter(entrada, from, 1);
  return next ? localDayKey(next.toISOString(), entrada.offsetHours ?? DEFAULT_UTC_OFFSET_HOURS) : null;
}

/** Los pagos estrictamente después de `from` y hasta `until` inclusive — los
 * que `tarjetaStatus` cuenta antes del vencimiento. */
export function paydaysBetween(entrada: EntradaCalendario, from: Date, until: Date): Date[] {
  if (until.getTime() <= from.getTime()) return [];
  const spanDays = Math.ceil((until.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  // Cota superior generosa (a lo sumo 2 ventanas por mes) para que un
  // vencimiento lejano tenga candidatos de sobra antes de filtrar por `until`.
  const count = Math.ceil(spanDays / 14) + 2;
  return paydaysAfter(entrada, from, count).filter((date) => date.getTime() <= until.getTime());
}
