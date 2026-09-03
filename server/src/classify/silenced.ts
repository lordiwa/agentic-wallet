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
import { resolveLedgerCounterparty } from "./apply.js";

export interface SilencedCounterparty {
  /** Patrón normalizado — la clave, y con lo que se compara en la cola. */
  pattern: string;
  /** La grafía cruda con la que se silenció, para mostrar. */
  counterparty: string;
  created_at: string;
}

export type SilenceError = "empty_pattern" | "counterparty_not_found";

export type SilenceResult =
  | {
      ok: true;
      /** El patrón que quedó guardado — la contraparte real, normalizada. */
      pattern: string;
      /** La contraparte real del ledger contra la que se resolvió. */
      counterparty: string;
      /** **R13: `false` no es éxito.** `false` significa que ya estaba
       * silenciada y esta llamada no sacó nada de la cola. */
      changed: boolean;
    }
  | { ok: false; error: SilenceError };

/**
 * Saca una contraparte de la cola, para siempre.
 *
 * **El patrón se deriva de la contraparte REAL del ledger**, exactamente como
 * `classifyCounterparty` (ver el doc de `apply.ts`). Éste era el único escritor
 * de patrones del motor que aceptaba cualquier texto, y por ahí volvía a entrar
 * la trampa fundacional del proyecto: `toRulePattern` perdona la caja y los
 * acentos pero **no el espaciado interno**, así que silenciar `"CAFE  centro"`
 * con dos espacios guardaba un patrón que no puede matchear nada nunca,
 * devolvía `ok`, y dejaba la contraparte intacta en la cola. Un agente que use
 * la tool MCP con la grafía que le dictó un humano se llevaba un éxito y un
 * contador que sube (wargaming ronda 3, W22).
 *
 * Idempotente, y ahora lo **dice**: `changed: false` cuando ya estaba
 * silenciada. Sin eso la pantalla celebraba *"N movimientos salen de la cola"*
 * la segunda vez, con cero saliendo — que es la regla R13 (`changed:false` no es
 * éxito) implementada para `resolve` y nunca para acá (W21). La grafía cruda se
 * refresca igual: la del ledger es la que el usuario acaba de ver.
 */
export function silenceCounterparty(db: Database.Database, rawCounterparty: string): SilenceResult {
  if (toRulePattern(rawCounterparty) === "") return { ok: false, error: "empty_pattern" };

  const counterparty = resolveLedgerCounterparty(db, rawCounterparty);
  if (counterparty === null) return { ok: false, error: "counterparty_not_found" };

  const pattern = toRulePattern(counterparty);
  const yaEstaba = silencedPatterns(db).has(pattern);

  db.prepare(
    `INSERT INTO classify_silenced (pattern, counterparty, created_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(pattern) DO UPDATE SET counterparty = excluded.counterparty`
  ).run(pattern, counterparty);

  return { ok: true, pattern, counterparty, changed: !yaEstaba };
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
