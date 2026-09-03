/**
 * `suggestRecurringExpenses` (H30) — *"¿cuáles son mis gastos fijos?"*, leído
 * del historial y de ningún otro lado. Es el motor del **Escenario 2** de la
 * fase N4 (`docs/plan-final-mvp.md` §3):
 *
 *   "entro por primera vez → analiza 3-6 meses anteriores → crea patrón de
 *    gastos fijos → pregunta gastos particulares"
 *
 * Igual que el resto de `onboard/`: **puro y de sólo lectura**. No escribe una
 * regla, no toca `strategy_config`, no marca una fila. Propone; confirmar es
 * otro acto, del usuario, y lo ejecuta el escritor que ya existe
 * (`classify/apply.ts`). Es la regla 3 del CLAUDE.md dicha en código: nada
 * precargado, nada guardado sin confirmación.
 *
 * Cuatro decisiones, y ninguna es de gusto:
 *
 * 1. **MEDIANA de los totales MENSUALES, no promedio.** Un mes con dos cargos
 *    del mismo servicio —el recibo que se pagó tarde y el del mes que empieza—
 *    duplica ese mes. Con promedio, ese mes doble sube la propuesta para
 *    siempre; con mediana, no la mueve. Se agrupa por mes antes de medianar
 *    porque lo que se propone es *cuánto sale por mes este gasto*, no cuánto
 *    sale un cargo suelto. Es la misma elección de `suggestSalary`, por la
 *    misma razón (ahí es un bono, acá un cargo doble).
 *
 * 2. **La candidata es la contraparte que aparece en >= 3 MESES DISTINTOS.**
 *    Tres cargos en el mismo mes no son un gasto fijo: son un mes movido. El
 *    mes es la unidad porque es la unidad del gasto fijo.
 *
 * 3. **Top 10 por plata** (H34, W8). Sobre el ledger real la regla devuelve 37
 *    candidatas, y 37 tarjetas de sí/no no son una pantalla de alta: son otra
 *    cola disfrazada. Las que sobran **no se pierden** — están, exactamente,
 *    en la cola de clasificación de N3, y esto es cierto por construcción y no
 *    por promesa: la población de acá es la misma que la de la cola
 *    (`selectClassifiableRows` + los mismos filtros de `queue.ts`), así que lo
 *    que no entra al top 10 sigue esperando ahí con su pregunta intacta.
 *
 * 4. **El freno de los 3 meses** (R33). Con menos historial no se propone
 *    nada. Cinco semanas pueden tocar tres meses del calendario (31/1, 15/2,
 *    1/3) y producir un "gasto fijo" que es una casualidad de almanaque; un
 *    patrón leído de eso no es una lectura, es una adivinanza con formato de
 *    dato. Las candidatas se siguen contando —para poder decir cuántas hay
 *    esperando— pero `propuestas` viene vacío y `suficienteHistorial` en
 *    `false`, y la pantalla dice cuánto lleva acumulado.
 *
 * Y una que hereda: **el tamaño de la muestra se dice en voz alta**
 * (`sampleSize`, en cuántos meses apareció), como ya hace `suggestSalary`.
 * Sobre el ledger real sólo 2 contrapartes aparecen en 6 meses o más (riesgo 3
 * del plan): prometer un patrón sin decir sobre cuánto se apoya sería prometer
 * de más.
 */
import type Database from "better-sqlite3";
import { categorize, toRulePattern } from "../category/categorize.js";
import { listCategoryRules } from "../category/rules-repository.js";
import { UNCLASSIFIED_CATEGORIES, selectClassifiableRows } from "../classify/queue.js";
import { silencedPatterns } from "../classify/silenced.js";
import { localDayKey } from "../strategy/dates.js";
import { fromCents, toCents } from "../strategy/money.js";
import { median, suggestSpendBaseline } from "./suggest.js";

/** En cuántos meses distintos tiene que aparecer una contraparte para que
 * proponerla como gasto fijo sea una lectura y no una corazonada. */
export const MESES_PARA_SER_FIJO = 3;

/** Cuántas propuestas ve el usuario (H34). El resto sigue en la cola. */
export const TOPE_DE_PROPUESTAS = 10;

/** El freno de R33: por debajo de esto el análisis no se dibuja activo. */
export const MESES_MINIMOS_DE_HISTORIAL = 3;

export interface RecurringExpenseProposal {
  /** La contraparte normalizada — el mismo patrón que escribiría la regla si
   * se confirma (ver `classify/apply.ts`). */
  pattern: string;
  /** La contraparte como la escribe el banco en el movimiento más reciente. */
  counterparty: string;
  /** Mediana de los totales mensuales: cuánto sale por mes, típicamente. */
  montoEstimado: number;
  /** Día del mes en que suele caer — la mediana de los días observados. */
  diaTipico: number;
  /** **En cuántos meses distintos apareció.** Es el tamaño de la muestra, y
   * se dice en voz alta: no se promete más de lo que hay. */
  sampleSize: number;
  /** Cuántos movimientos respaldan la lectura (>= `sampleSize`). */
  count: number;
  /** Cuánta plata movió en total. Es el orden de la lista y el criterio del
   * top 10. */
  total: number;
  /** El movimiento más reciente, para poder decir "el último, hace tanto". */
  lastTs: string;
}

export interface RecurringExpensesSuggestion {
  /** Las propuestas que se muestran: el top 10 por plata, o menos. */
  propuestas: RecurringExpenseProposal[];
  /** Cuántas contrapartes cumplen la regla de recurrencia, antes del tope. */
  candidatas: number;
  /** Las candidatas que NO se muestran y siguen esperando en la cola de
   * clasificación. Cero no es "no hay más": es "entraron todas". */
  enLaCola: number;
  /** Meses de historial que el ledger cubre (`suggestSpendBaseline`). */
  mesesDeHistorial: number;
  /** El umbral de R33, publicado para que la pantalla no lo repita a mano. */
  mesesMinimos: number;
  /** R33: `false` cuando el historial no alcanza y el análisis no se activa. */
  suficienteHistorial: boolean;
}

interface Acumulador {
  pattern: string;
  counterparty: string;
  count: number;
  cents: number;
  /** Total de cada mes, en centavos, por clave `YYYY-MM`. */
  porMes: Map<string, number>;
  /** Los días del mes observados, para el día típico. */
  dias: number[];
  lastTs: string;
}

/**
 * Agrupa por contraparte los movimientos sobre los que hay algo que proponer.
 *
 * La población es **exactamente la de la cola de clasificación**: gasto, con
 * contraparte, dentro de las exclusiones de todos los totales, cuya categoría
 * recalculada sigue siendo un fallback, y sin las silenciadas. Que sea la misma
 * es lo que hace verdadera la frase "las que no entran al top 10 caen en la
 * cola" — no caen: ya estaban ahí, y esta función sólo mira un subconjunto.
 *
 * Una contraparte que ya tiene regla no aparece: su pregunta está contestada, y
 * volver a preguntarla sería desandar una respuesta que el usuario ya dio.
 */
function agruparCandidatas(db: Database.Database): Acumulador[] {
  const rules = listCategoryRules(db);
  const silenciadas = silencedPatterns(db);
  const grupos = new Map<string, Acumulador>();

  for (const row of selectClassifiableRows(db)) {
    const category = categorize(
      { type: row.type, counterparty: row.counterparty, is_internal: row.is_internal === 1 },
      rules
    );
    if (!UNCLASSIFIED_CATEGORIES.has(category)) continue;

    const pattern = toRulePattern(row.counterparty ?? "");
    if (pattern === "" || silenciadas.has(pattern)) continue;

    // El día y el mes son los LOCALES: un cargo del 1 a las 02:00 UTC es del
    // último día del mes anterior para quien lo pagó, y el día típico de un
    // gasto fijo es el que el humano tiene en la cabeza.
    const dayKey = localDayKey(row.ts);
    if (dayKey === null) continue; // un `ts` ilegible no tiene mes al que sumar
    const mes = dayKey.slice(0, 7);
    const dia = Number(dayKey.slice(8, 10));
    const cents = toCents(row.amount);

    const existente = grupos.get(pattern);
    if (!existente) {
      grupos.set(pattern, {
        pattern,
        counterparty: (row.counterparty ?? "").trim(),
        count: 1,
        cents,
        porMes: new Map([[mes, cents]]),
        dias: [dia],
        lastTs: row.ts,
      });
      continue;
    }

    existente.count += 1;
    existente.cents += cents;
    existente.porMes.set(mes, (existente.porMes.get(mes) ?? 0) + cents);
    existente.dias.push(dia);
    // La grafía que se muestra es la del movimiento más reciente: el banco
    // cambia cómo escribe un comercio, y la última es la que el usuario vio.
    if (row.ts > existente.lastTs) {
      existente.lastTs = row.ts;
      existente.counterparty = (row.counterparty ?? "").trim();
    }
  }

  return [...grupos.values()].filter((grupo) => grupo.porMes.size >= MESES_PARA_SER_FIJO);
}

function aPropuesta(grupo: Acumulador): RecurringExpenseProposal {
  const totalesMensuales = [...grupo.porMes.values()];
  return {
    pattern: grupo.pattern,
    counterparty: grupo.counterparty,
    montoEstimado: fromCents(Math.round(median(totalesMensuales))),
    // Mediana también acá, y por lo mismo: un mes en que el débito salió el 28
    // en vez del 5 no puede mover el día que la pantalla dice. Con un número
    // par de días la mediana cae entre dos y se redondea — un día del mes es un
    // entero o no es un día.
    diaTipico: Math.round(median(grupo.dias)),
    sampleSize: grupo.porMes.size,
    count: grupo.count,
    total: fromCents(grupo.cents),
    lastTs: grupo.lastTs,
  };
}

/**
 * Los gastos fijos que el historial sostiene, del que más plata mueve al que
 * menos, acotados al top 10.
 *
 * El desempate es total y estable —plata, después movimientos, después el
 * patrón— para que dos corridas sobre el mismo ledger den la misma lista: una
 * pantalla de alta cuyas diez filas se barajan solas no es una lectura, es
 * ruido.
 */
export function suggestRecurringExpenses(db: Database.Database): RecurringExpensesSuggestion {
  const { mesesDeHistorial } = suggestSpendBaseline(db);
  const candidatas = agruparCandidatas(db).sort(
    (a, b) => b.cents - a.cents || b.count - a.count || a.pattern.localeCompare(b.pattern)
  );

  const suficienteHistorial = mesesDeHistorial >= MESES_MINIMOS_DE_HISTORIAL;
  const propuestas = suficienteHistorial ? candidatas.slice(0, TOPE_DE_PROPUESTAS).map(aPropuesta) : [];

  return {
    propuestas,
    candidatas: candidatas.length,
    enLaCola: candidatas.length - propuestas.length,
    mesesDeHistorial,
    mesesMinimos: MESES_MINIMOS_DE_HISTORIAL,
    suficienteHistorial,
  };
}
