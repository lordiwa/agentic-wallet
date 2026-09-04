/**
 * Los gastos fijos leídos del historial (H30) — copia de la parte pura de
 * `server/src/onboard/recurring.ts`.
 *
 * Sigue siendo **de sólo lectura**: propone, no escribe. Confirmar una
 * propuesta es otro acto, del usuario, y lo ejecuta el mismo escritor de la
 * cola (`POST /api/classify`). No hay una segunda forma de escribir una regla.
 *
 * Las cuatro decisiones que le dan forma —mediana y no promedio, tres meses
 * DISTINTOS para ser candidata, top 10 por plata, y el freno de historial— están
 * argumentadas en el original y no se repiten acá. Lo que sí se repite, porque
 * es lo que el puerto tiene que preservar: **el universo es exactamente el de la
 * cola de clasificación**, así que lo que no entra al top 10 no se pierde, ya
 * estaba en la cola.
 *
 * `recurring.parity.test.ts` importa el motor y compara.
 */
import { categorize, toRulePattern, UNCLASSIFIED_CATEGORIES, type EstablishmentRule } from "./categorize.js";
import { DEFAULT_UTC_OFFSET_HOURS, fromCents, localDayKey } from "./derive.js";
import type { LedgerRow } from "./rows.js";

export const MESES_PARA_SER_FIJO = 3;
export const TOPE_DE_PROPUESTAS = 10;
export const MESES_MINIMOS_DE_HISTORIAL = 3;

/** Los tres cargos mensuales consecutivos que menos días abarcan (31/1, 28/2,
 * 31/3) son 59 días. Cincuenta y seis deja pasar a ésos y frena a cualquier
 * racha más corta que sólo TOCA tres meses del calendario. */
export const DIAS_MINIMOS_DE_LA_CANDIDATA = (MESES_PARA_SER_FIJO - 1) * 28;

export const DISPERSION_MAXIMA_DEL_DIA = 3;
export const VECINDAD_DEL_DIA = 1;

export interface RecurringExpenseProposal {
  pattern: string;
  counterparty: string;
  montoEstimado: number;
  /** `null` cuando los días observados no sostienen un día típico. */
  diaTipico: number | null;
  sampleSize: number;
  count: number;
  total: number;
  lastTs: string;
}

export interface RecurringExpensesSuggestion {
  propuestas: RecurringExpenseProposal[];
  candidatas: number;
  enLaCola: number;
  mesesDeHistorial: number;
  mesesMinimos: number;
  suficienteHistorial: boolean;
}

/** Copia de `median` (`server/src/onboard/suggest.ts`). */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

/**
 * El día del mes que la pantalla puede prometer, o `null` si no hay ninguno.
 *
 * Tres guardas encadenadas, y cada una tapa un agujero que la anterior dejaba:
 * la dispersión (la mediana entre el 2 y el 27 da 15, un día en el que no pasó
 * nada), que el día nombrado sea un día **observado** (la mediana de un número
 * par cae entre dos), y que tenga **mayoría** (el día existía pero había pasado
 * una sola vez, y la pantalla dice "suele caer", que es una afirmación sobre la
 * tendencia).
 */
export function diaTipicoDe(dias: readonly number[]): number | null {
  if (dias.length === 0) return null;
  const centro = median([...dias]);
  const dispersion = median(dias.map((dia) => Math.abs(dia - centro)));
  if (dispersion > DISPERSION_MAXIMA_DEL_DIA) return null;

  const frecuencia = new Map<number, number>();
  for (const dia of dias) frecuencia.set(dia, (frecuencia.get(dia) ?? 0) + 1);

  const elegido = [...frecuencia.keys()].sort(
    (a, b) =>
      Math.abs(a - centro) - Math.abs(b - centro) ||
      (frecuencia.get(b) ?? 0) - (frecuencia.get(a) ?? 0) ||
      a - b
  )[0] as number;

  const cerca = dias.filter((dia) => Math.abs(dia - elegido) <= VECINDAD_DEL_DIA).length;
  return cerca * 2 > dias.length ? elegido : null;
}

interface Acumulador {
  pattern: string;
  counterparty: string;
  count: number;
  cents: number;
  porMes: Map<string, number>;
  dias: number[];
  firstTs: string;
  lastTs: string;
}

function duracionEnDias(grupo: Acumulador): number {
  const desde = new Date(grupo.firstTs).getTime();
  const hasta = new Date(grupo.lastTs).getTime();
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return 0;
  return (hasta - desde) / 86_400_000;
}

function agruparCandidatas(
  clasificables: readonly LedgerRow[],
  rules: readonly EstablishmentRule[],
  silenciadas: ReadonlySet<string>,
  offsetHours: number
): Acumulador[] {
  const grupos = new Map<string, Acumulador>();

  for (const row of clasificables) {
    const category = categorize(
      { type: row.type, counterparty: row.counterparty, is_internal: row.isInternal },
      rules
    );
    if (!UNCLASSIFIED_CATEGORIES.has(category)) continue;

    const pattern = toRulePattern(row.counterparty ?? "");
    if (pattern === "" || silenciadas.has(pattern)) continue;

    // El día y el mes son los LOCALES: un cargo del 1 a las 02:00 UTC es del
    // último día del mes anterior para quien lo pagó.
    const dayKey = localDayKey(row.ts, offsetHours);
    if (dayKey === null) continue;
    const mes = dayKey.slice(0, 7);
    const dia = Number(dayKey.slice(8, 10));

    const existente = grupos.get(pattern);
    if (!existente) {
      grupos.set(pattern, {
        pattern,
        counterparty: (row.counterparty ?? "").trim(),
        count: 1,
        cents: row.amountCents,
        porMes: new Map([[mes, row.amountCents]]),
        dias: [dia],
        firstTs: row.ts,
        lastTs: row.ts,
      });
      continue;
    }

    existente.count += 1;
    existente.cents += row.amountCents;
    existente.porMes.set(mes, (existente.porMes.get(mes) ?? 0) + row.amountCents);
    existente.dias.push(dia);
    if (row.ts < existente.firstTs) existente.firstTs = row.ts;
    if (row.ts > existente.lastTs) {
      existente.lastTs = row.ts;
      existente.counterparty = (row.counterparty ?? "").trim();
    }
  }

  return [...grupos.values()].filter(
    (grupo) => grupo.porMes.size >= MESES_PARA_SER_FIJO && duracionEnDias(grupo) >= DIAS_MINIMOS_DE_LA_CANDIDATA
  );
}

function aPropuesta(grupo: Acumulador): RecurringExpenseProposal {
  return {
    pattern: grupo.pattern,
    counterparty: grupo.counterparty,
    montoEstimado: fromCents(Math.round(median([...grupo.porMes.values()]))),
    diaTipico: diaTipicoDe(grupo.dias),
    sampleSize: grupo.porMes.size,
    count: grupo.count,
    total: fromCents(grupo.cents),
    lastTs: grupo.lastTs,
  };
}

export interface EntradaRecurring {
  /** La población de la cola: gasto, con contraparte, contable. La misma que
   * consume `computeProgress` — que sean la misma es lo que hace verdadera la
   * frase "las que no entran al top 10 siguen en la cola". */
  clasificables: readonly LedgerRow[];
  rules: readonly EstablishmentRule[];
  silenciadas: ReadonlySet<string>;
  /** Meses que cubre el ledger, de `suggestSpendBaseline`. */
  mesesDeHistorial: number;
  offsetHours?: number;
}

export function suggestRecurringExpenses(entrada: EntradaRecurring): RecurringExpensesSuggestion {
  const offsetHours = entrada.offsetHours ?? DEFAULT_UTC_OFFSET_HOURS;
  const candidatas = agruparCandidatas(
    entrada.clasificables,
    entrada.rules,
    entrada.silenciadas,
    offsetHours
  ).sort((a, b) => b.cents - a.cents || b.count - a.count || a.pattern.localeCompare(b.pattern));

  const suficienteHistorial = entrada.mesesDeHistorial >= MESES_MINIMOS_DE_HISTORIAL;
  const propuestas = suficienteHistorial ? candidatas.slice(0, TOPE_DE_PROPUESTAS).map(aPropuesta) : [];

  return {
    propuestas,
    candidatas: candidatas.length,
    enLaCola: candidatas.length - propuestas.length,
    mesesDeHistorial: entrada.mesesDeHistorial,
    mesesMinimos: MESES_MINIMOS_DE_HISTORIAL,
    suficienteHistorial,
  };
}

/**
 * `mesesDeHistorial` de `suggestSpendBaseline`: el lapso entre el gasto más
 * viejo y el más nuevo, en meses de 30,44 días, con un decimal.
 *
 * Ojo con el conjunto: el original filtra `direction='out' AND is_reversed=0
 * AND is_internal=0 AND needs_review=0` — **sin** `is_discarded` y **sin**
 * excluir `type='reverso'`, a diferencia de todo agregado de plata. Se copia
 * tal cual: acá lo único que se usa es el lapso, y cambiar el conjunto para
 * "arreglarlo" haría que las dos implementaciones den distinto.
 */
export function mesesDeHistorialDe(primerTs: string | null, ultimoTs: string | null): number {
  if (primerTs === null || ultimoTs === null) return 0;
  const days = (new Date(ultimoTs).getTime() - new Date(primerTs).getTime()) / 86_400_000;
  if (!Number.isFinite(days)) return 0;
  return Math.round((days / 30.44) * 10) / 10;
}
