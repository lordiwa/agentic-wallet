/**
 * El progreso de la cola **medido en plata** (H35, decisión **M1**).
 *
 * Por qué en plata y no en filas: con 151 contrapartes, "quedan 118" no le dice
 * nada a nadie — no distingue la que mueve 312 de la que movió 1,20 una vez. Y
 * el criterio de terminado que M1 sella **no es cero filas**: es el 80 % de la
 * plata. Con 90 contrapartes de una sola fila, cero es un estado que nadie
 * alcanza en una tarde; "cubriste el 80 % de tu plata" son 30 respuestas.
 *
 * **Cómo se sabe cuánto se cubrió sin guardar un histórico.** El mismo cálculo,
 * dos veces sobre las mismas filas: una con las reglas y los silencios de hoy
 * (lo que queda) y otra **sin ninguna regla ni silencio** (lo que había antes de
 * que el usuario respondiera nada). La diferencia es exactamente la plata que
 * sus respuestas cubrieron. No hace falta tabla de progreso, y el número no
 * puede desincronizarse del ledger porque se deriva de él.
 *
 * **La plata silenciada cuenta como cubierta.** Responder *"no me preguntes más
 * por esta"* cierra la pregunta igual que elegir una categoría — es la decisión
 * M5, y es lo único que permite que el 80 % sea alcanzable cuando una
 * contraparte no tiene una sola verdad. Cubierta no significa "se sabe qué es";
 * significa "ya no hay nada que preguntar".
 *
 * El universo es el mismo de la cola (`selectClassifiableRows`): gasto, con
 * contraparte, sin las filas que ningún total del motor cuenta. Las filas sin
 * contraparte quedan fuera del numerador **y** del denominador — ver el doc de
 * `queue.ts`.
 */
import type Database from "better-sqlite3";
import { listCategoryRules } from "../category/rules-repository.js";
import { fromCents, toCents } from "../strategy/money.js";
import { groupUnclassified, selectClassifiableRows, type ClassifyGroup } from "./queue.js";
import { silencedPatterns } from "./silenced.js";

/** El 80 % de M1. Vive acá y en ningún otro lado: la pantalla lo lee, no lo
 * repite. */
export const MONEY_TARGET_RATIO = 0.8;

export interface ClassifyProgress {
  /** Toda la plata de gasto sobre la que la cola puede opinar. */
  spending_total: number;
  /** La plata que estaba sin clasificar antes de la primera regla y del primer
   * silencio: el denominador de `covered_ratio`. */
  baseline_total: number;
  /** La plata que las respuestas ya dadas cubrieron (regla escrita o silencio). */
  covered_total: number;
  /** `covered_total / baseline_total`, 0..1. Sin nada que cubrir vale 1: una
   * cola que nunca tuvo trabajo está terminada, no en cero por ciento. */
  covered_ratio: number;
  /** La plata que sigue en la cola. */
  unclassified_total: number;
  /**
   * `unclassified_total / spending_total`, 0..1: qué proporción de **todo el
   * gasto** sigue sin clasificar.
   *
   * **No es el complemento de `covered_ratio`** y no se puede dibujar al lado de
   * él: tienen denominadores distintos. La pantalla mezclaba los dos y llamaba
   * "tu plata" a las dos cosas (wargaming ronda 3, W19). Quien quiera el
   * complemento de la barra usa `remaining_ratio`.
   */
  unclassified_ratio: number;
  /**
   * `unclassified_total / baseline_total`, 0..1 — **el complemento exacto de
   * `covered_ratio`**, y el único número que se puede poner junto a la barra sin
   * que la suma dé cualquier cosa.
   *
   * Existe por W19: la tarjeta de la cola imprimía a la vez un título del 76 %
   * (sobre el gasto), una barra al 16 % (sobre la línea de base) y un pie cuyos
   * dos montos dan 84 %. Los tres eran ciertos y ninguno cerraba con los otros.
   */
  remaining_ratio: number;
  /** Contrapartes que quedan por responder. */
  groups: number;
  /** Movimientos que representan esas contrapartes. */
  transactions: number;
  /** El objetivo de M1 (0,8). */
  target_ratio: number;
  /** Cuántas respuestas más —grupos, de la que más plata mueve a la que menos—
   * hacen falta para llegar al objetivo. Es el "30 respuestas más" de la
   * pantalla. Cero cuando ya se llegó. */
  answers_to_target: number;
  /** Cuánta plata cubren esas respuestas. */
  amount_to_target: number;
  /** El criterio de terminado de M1: `covered_ratio >= target_ratio`. **No** es
   * "cero filas", y por eso puede ser `true` con la cola todavía llena. */
  done: boolean;
}

/** Suma en centavos, que es como suma todo agregado de este motor. */
function totalCents(groups: readonly ClassifyGroup[]): number {
  return groups.reduce((sum, group) => sum + toCents(group.total), 0);
}

/** Ratio 0..1 con cuatro decimales: lo que se sirve por HTTP no arrastra el
 * ruido de coma flotante de una división de centavos. */
function ratio(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 10_000) / 10_000;
}

export function classifyProgress(db: Database.Database): ClassifyProgress {
  const rows = selectClassifiableRows(db);
  const remaining = groupUnclassified(rows, listCategoryRules(db), silencedPatterns(db));
  // Sin reglas ni silencios: lo que había que preguntar el primer día.
  const baseline = groupUnclassified(rows, []);

  const spendingCents = rows.reduce((sum, row) => sum + toCents(row.amount), 0);
  const baselineCents = totalCents(baseline);
  const remainingCents = totalCents(remaining);
  const coveredCents = Math.max(0, baselineCents - remainingCents);

  // Cuánta plata más hay que cubrir para llegar al objetivo, y cuántos grupos
  // de la cola —los que más plata mueven— alcanzan para taparla.
  const neededCents = Math.max(0, Math.ceil(MONEY_TARGET_RATIO * baselineCents) - coveredCents);
  let answers = 0;
  let accumulated = 0;
  for (const group of remaining) {
    if (accumulated >= neededCents) break;
    accumulated += toCents(group.total);
    answers += 1;
  }

  return {
    spending_total: fromCents(spendingCents),
    baseline_total: fromCents(baselineCents),
    covered_total: fromCents(coveredCents),
    covered_ratio: baselineCents === 0 ? 1 : ratio(coveredCents, baselineCents),
    unclassified_total: fromCents(remainingCents),
    unclassified_ratio: ratio(remainingCents, spendingCents),
    remaining_ratio: baselineCents === 0 ? 0 : ratio(remainingCents, baselineCents),
    groups: remaining.length,
    transactions: remaining.reduce((sum, group) => sum + group.count, 0),
    target_ratio: MONEY_TARGET_RATIO,
    answers_to_target: answers,
    amount_to_target: fromCents(accumulated),
    done: baselineCents === 0 || coveredCents / baselineCents >= MONEY_TARGET_RATIO,
  };
}
