/**
 * El escritor de la cola (H28) — *"qué es esto"* responde con **una regla**.
 *
 * Es el único escritor de categoría del MVP, y es el motivo por el que la
 * decisión **M4** puede eliminar el editor de reglas sin perder nada: escribe
 * exactamente la misma fila de `category_rules` que el editor escribiría a mano,
 * con una diferencia que no es cosmética.
 *
 * **El patrón se deriva de la contraparte REAL del ledger, nunca del texto que
 * llegó.** Ésa es la trampa conocida del proyecto: un patrón más largo que la
 * contraparte no matchea nunca — `matchEstablishment` busca el patrón *dentro*
 * de la contraparte, así que escribir "farmacia san jose sucursal 3" contra un
 * ledger que dice "FARMACIA SAN JOSE" produce una regla que se guarda bien, se
 * lista bien, y no clasifica una sola fila. El editor a mano hacía eso fácil; acá
 * es **imposible por construcción**: si el texto recibido no corresponde a una
 * contraparte que existe en el ledger, no se escribe nada y se devuelve
 * `counterparty_not_found`. El patrón sale de la fila, no del teclado.
 *
 * Lo que además se escribe: la columna `category` de los movimientos que la
 * regla acaba de mover. No hace falta para los totales —el motor recalcula en
 * vivo, ver `strategy/spending.ts`— pero deja el ledger consistente con lo que
 * el gráfico muestra, y respeta la invariante de `category/reclassify.ts`: una
 * categoría concreta ya guardada sólo la pisa una regla explícita del usuario,
 * que es precisamente lo que acaba de pasar.
 *
 * Lo que NO toca, nunca: `amount`, `direction`, `type`, `needs_review`. Esta capa
 * mueve etiquetas; la plata sale del parser (CLAUDE.md, regla 1).
 */
import type Database from "better-sqlite3";
import { categorize, toRulePattern, type Category, type EstablishmentRule } from "../category/categorize.js";
import { listCategoryRules, upsertCategoryRule } from "../category/rules-repository.js";
import { emitMetric, withSpanSync } from "../db/telemetry.js";
import { localMonthRange } from "../strategy/dates.js";
import { EXCLUDE_FROM_TOTALS_SQL } from "../strategy/totals.js";

export interface ClassifyRequest {
  /** La contraparte tal como la devuelve la cola. Se valida contra el ledger. */
  counterparty: string;
  category: Category;
}

export interface ClassifySuccess {
  ok: true;
  /** El patrón que se guardó — la contraparte real, normalizada. */
  pattern: string;
  /** La contraparte real del ledger contra la que se resolvió. */
  counterparty: string;
  category: Category;
  /**
   * Cuántos movimientos **de los que el usuario puede ver** cambiaron de
   * categoría por esta regla: gasto, dentro de las exclusiones de todos los
   * totales. Son exactamente los que la tarjeta de la cola contó.
   *
   * No cuenta las filas que ningún total cuenta —un reverso, una interna, una
   * descartada, una que todavía espera confirmación de monto, un ingreso—
   * aunque la regla también les escriba la columna `category`. Contarlas hacía
   * que la tarjeta dijera "2 movimientos" y la respuesta "reclasificaste 6", en
   * la misma pantalla y con un segundo de diferencia (wargaming del MVP, W1).
   */
  reclassified: number;
  /**
   * Cuántos de ellos caen en el mes local en curso. La pantalla lo necesita para
   * ser honesta (R19): el gráfico del Resumen es **sólo del mes en curso**
   * (`api/routes.ts`), así que reclasificar 14 movimientos de los cuales 0 son
   * de este mes no mueve una sola barra — y la pantalla tiene que poder decirlo
   * en vez de prometer un efecto que no va a verse.
   *
   * Por eso mismo hereda el filtro de `reclassified`: este número **es** la
   * promesa "el gráfico se va a mover", y una fila que el gráfico no suma no
   * puede entrar en ella.
   */
  reclassified_this_month: number;
  /**
   * Cuántas contrapartes **además de la preguntada** movió esta regla.
   *
   * Una regla matchea con `includes`, así que responder por un nombre corto
   * alcanza también a los grupos cuyo nombre lo contiene, y ésos salen de la
   * cola sin haber sido preguntados. El conteo de arriba los incluye —se
   * movieron de verdad, y el gráfico se mueve por ellos—, pero la tarjeta que el
   * usuario acababa de leer hablaba de UNA contraparte: sobre el ledger real le
   * pasa a 10 de los 147 grupos, y en el peor la tarjeta prometía 1 movimiento y
   * la respuesta contestaba "reclasificaste 7".
   *
   * O sea el síntoma de W1 otra vez, por otra puerta. La salida no es recortar
   * el número —sería falso— sino **decir el alcance**: cero cuando la regla tocó
   * sólo lo que se preguntó, y la pantalla lo dice cuando no lo es (wargaming
   * ronda 2, W12).
   */
  otras_contrapartes: number;
}

export type ClassifyError = "empty_pattern" | "counterparty_not_found";

export type ClassifyResult = ClassifySuccess | { ok: false; error: ClassifyError };

interface ClassifiedRow {
  id: number;
  ts: string;
  type: string;
  counterparty: string;
  is_internal: number;
  category: string | null;
  /** 1 si es una fila que la cola contó y el gráfico suma. Ver `rowsMatching`. */
  visible: number;
}

/**
 * Busca en el ledger la contraparte que corresponde al texto recibido,
 * comparando en forma normalizada (misma caja, sin acentos) porque el banco
 * escribe el mismo comercio de varias maneras. Devuelve la grafía cruda de la
 * fila más reciente: es la que el usuario acaba de ver.
 *
 * Es **igualdad**, no substring, y a propósito: aceptar un fragmento convertiría
 * a esta ruta en el editor de reglas que M4 elimina, con su trampa intacta pero
 * disfrazada. Quien de verdad quiera un patrón ancho ("farmacia" para todas las
 * farmacias) tiene la tool MCP `set_rule`, que es explícita sobre lo que hace.
 */
export function resolveLedgerCounterparty(db: Database.Database, raw: string): string | null {
  const wanted = toRulePattern(raw);
  if (wanted === "") return null;

  const rows = db
    .prepare(
      `SELECT counterparty, MAX(ts) as ts FROM transactions
        WHERE counterparty IS NOT NULL AND TRIM(counterparty) != ''
        GROUP BY counterparty
        ORDER BY ts DESC`
    )
    .all() as { counterparty: string; ts: string }[];

  for (const row of rows) {
    if (toRulePattern(row.counterparty) === wanted) return row.counterparty.trim();
  }
  return null;
}

/**
 * Las filas que una regla con este patrón podría mover: cualquiera cuya
 * contraparte normalizada lo contenga, que es como matchea `categorize`.
 *
 * `visible` marca las que la cola contó y el gráfico suma —gasto, dentro de las
 * exclusiones de todos los totales (`EXCLUDE_FROM_TOTALS_SQL`)—, que son las
 * únicas que pueden entrar en un número que se le dice al usuario. Ver
 * `classifyCounterparty`.
 */
function rowsMatching(db: Database.Database, pattern: string): ClassifiedRow[] {
  const rows = db
    .prepare(
      `SELECT id, ts, type, counterparty, is_internal, category,
              (direction = 'out' AND ${EXCLUDE_FROM_TOTALS_SQL}) AS visible
         FROM transactions
        WHERE counterparty IS NOT NULL AND TRIM(counterparty) != ''`
    )
    .all() as ClassifiedRow[];
  return rows.filter((row) => toRulePattern(row.counterparty).includes(pattern));
}

function recategorize(row: ClassifiedRow, rules: readonly EstablishmentRule[]): Category {
  return categorize({ type: row.type, counterparty: row.counterparty, is_internal: row.is_internal === 1 }, rules);
}

/**
 * Escribe UNA regla para una contraparte y devuelve qué movió.
 *
 * `now` entra por parámetro (no `new Date()` adentro) para que el conteo del mes
 * en curso sea testeable sin viajar en el tiempo.
 */
export function classifyCounterparty(
  db: Database.Database,
  request: ClassifyRequest,
  now: Date = new Date()
): ClassifyResult {
  return withSpanSync("classify.counterparty", { category: request.category }, () => {
    if (toRulePattern(request.counterparty) === "") return { ok: false, error: "empty_pattern" };

    const counterparty = resolveLedgerCounterparty(db, request.counterparty);
    if (counterparty === null) return { ok: false, error: "counterparty_not_found" };

    // El patrón sale de la contraparte del ledger. Ver el doc del módulo.
    const pattern = toRulePattern(counterparty);
    const before = listCategoryRules(db);
    const candidates = rowsMatching(db, pattern);
    const previous = new Map(candidates.map((row) => [row.id, recategorize(row, before)]));

    const written = upsertCategoryRule(db, counterparty, request.category);
    if (!written) return { ok: false, error: "empty_pattern" };
    const after = listCategoryRules(db);

    const { from, to } = localMonthRange(now);
    const updateCategory = db.prepare("UPDATE transactions SET category = @category WHERE id = @id");

    let reclassified = 0;
    let reclassifiedThisMonth = 0;
    /** Las contrapartes que la regla movió de verdad. Ver `otras_contrapartes`. */
    const alcanzadas = new Set<string>();

    db.transaction(() => {
      for (const row of candidates) {
        const next = recategorize(row, after);
        if (next === previous.get(row.id)) continue;

        // La columna se escribe en TODAS: dejar el ledger a medias sería peor
        // que el problema. Los conteos, en cambio, sólo miran las visibles.
        updateCategory.run({ id: row.id, category: next });
        if (row.visible !== 1) continue;

        reclassified += 1;
        alcanzadas.add(toRulePattern(row.counterparty));
        const ts = new Date(row.ts).getTime();
        if (ts >= from.getTime() && ts < to.getTime()) reclassifiedThisMonth += 1;
      }
    })();

    // La preguntada no cuenta como "otra". Se descuenta sólo si de verdad movió
    // algo: si su propia plata no se movió, las que quedan siguen siendo las
    // otras.
    const otrasContrapartes = alcanzadas.size - (alcanzadas.has(pattern) ? 1 : 0);

    // Sólo conteos y la categoría del glosario: el nombre del comercio es un
    // dato personal y no entra a la telemetría (CLAUDE.md).
    emitMetric("classify.rule_written", {
      category: request.category,
      reclassified,
      reclassified_this_month: reclassifiedThisMonth,
      otras_contrapartes: otrasContrapartes,
    });

    return {
      ok: true,
      pattern,
      counterparty,
      category: request.category,
      reclassified,
      reclassified_this_month: reclassifiedThisMonth,
      otras_contrapartes: otrasContrapartes,
    };
  });
}
