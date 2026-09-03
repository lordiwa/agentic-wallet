/**
 * El silenciador de contrapartes (H33, decisión **M5**): *"no me preguntes más
 * por esta"*.
 *
 * Es lo único que permite que la cola de clasificación **cierre**. Una
 * contraparte puede tener dos verdades —la misma persona que un mes cobra una
 * consulta y otro devuelve un préstamo— y para esas no hay categoría correcta:
 * cualquier regla que se escriba es mentira para la mitad de sus filas. Sin una
 * salida, esa contraparte vuelve a la cola para siempre y la pantalla miente
 * cada vez que celebra el vacío.
 *
 * La clave es el patrón **normalizado**, el mismo `toRulePattern` que usa
 * `category_rules`: el banco escribe el mismo comercio con distinta caja y
 * distintos acentos según el correo, y silenciar una grafía sola no silenciaría
 * nada. `counterparty` guarda la grafía cruda con la que se silenció, para poder
 * listar lo silenciado sin volver a buscarlo en el ledger.
 *
 * Lo que el silenciador NO hace: tocar la categoría. Una contraparte silenciada
 * sigue cayendo donde `categorize()` la deje —normalmente `otros` o
 * `transferencia_persona`—; lo único que cambia es que deja de preguntarse. La
 * plata silenciada cuenta como *cubierta* en el progreso (`progress.ts`) porque
 * la pregunta quedó cerrada, no porque se sepa qué es.
 */
import type Database from "better-sqlite3";
import { toRulePattern } from "../category/categorize.js";

export interface SilencedCounterparty {
  /** Patrón normalizado — la clave, y con lo que se compara en la cola. */
  pattern: string;
  /** La grafía cruda con la que se silenció, para mostrar. */
  counterparty: string;
  created_at: string;
}

/**
 * Saca una contraparte de la cola, para siempre. Devuelve `false` sin escribir
 * nada si el texto queda vacío al normalizarlo — un patrón vacío es substring de
 * toda contraparte y silenciaría la cola entera de un saque (misma guarda que
 * `upsertCategoryRule`).
 *
 * Idempotente: silenciar dos veces la misma contraparte no duplica ni falla; se
 * refresca la grafía cruda, que puede haber llegado mejor escrita la segunda vez.
 */
export function silenceCounterparty(db: Database.Database, rawCounterparty: string): boolean {
  const pattern = toRulePattern(rawCounterparty);
  if (pattern === "") return false;

  db.prepare(
    `INSERT INTO classify_silenced (pattern, counterparty, created_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(pattern) DO UPDATE SET counterparty = excluded.counterparty`
  ).run(pattern, rawCounterparty.trim());
  return true;
}

/**
 * Devuelve una contraparte silenciada a la cola. Existe porque un silencio es
 * un botón de un solo toque en una lista larga: sin esta función, un toque
 * equivocado sólo se deshace editando la sqlite a mano. Devuelve `false` si no
 * había nada que devolver.
 */
export function unsilenceCounterparty(db: Database.Database, rawCounterparty: string): boolean {
  const pattern = toRulePattern(rawCounterparty);
  if (pattern === "") return false;
  return db.prepare("DELETE FROM classify_silenced WHERE pattern = ?").run(pattern).changes > 0;
}

/** Todo lo silenciado, lo más reciente primero. */
export function listSilencedCounterparties(db: Database.Database): SilencedCounterparty[] {
  return db
    .prepare("SELECT pattern, counterparty, created_at FROM classify_silenced ORDER BY created_at DESC, pattern ASC")
    .all() as SilencedCounterparty[];
}

/**
 * Los patrones silenciados como conjunto, que es la forma en la que la cola los
 * consulta: una lectura por corrida, no una por fila.
 */
export function silencedPatterns(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT pattern FROM classify_silenced").all() as { pattern: string }[];
  return new Set(rows.map((row) => row.pattern));
}
