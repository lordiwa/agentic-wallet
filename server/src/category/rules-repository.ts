/**
 * Reads and writes the user's own merchant rules (`category_rules`), the
 * data behind `categorize`'s rule 6.
 *
 * Patterns are stored already normalized (see `toRulePattern`), so a lookup
 * never has to normalize both sides at query time and `pattern`'s UNIQUE
 * constraint really does mean "one rule per merchant" regardless of how the
 * bank cased or accented it in any given email.
 */
import type Database from "better-sqlite3";
import { CATEGORIES, toRulePattern, type Category, type EstablishmentRule } from "./categorize.js";

interface CategoryRuleRow {
  pattern: string;
  category: string;
}

/**
 * Every configured rule, longest pattern first. Longest-first matters:
 * "farmacia san jose" must win over a broader "farmacia" rule, and
 * `categorize` takes the first match it finds.
 */
export function listCategoryRules(db: Database.Database): EstablishmentRule[] {
  const rows = db
    .prepare("SELECT pattern, category FROM category_rules ORDER BY LENGTH(pattern) DESC, pattern ASC")
    .all() as CategoryRuleRow[];
  return rows.map((row) => ({ pattern: row.pattern, category: row.category as Category }));
}

/**
 * Adds or updates one rule, keyed on the normalized pattern. Returns false
 * (writing nothing) for a blank pattern -- an empty pattern is a substring of
 * every counterparty, so it would swallow the entire ledger into one
 * category.
 */
export function upsertCategoryRule(db: Database.Database, rawPattern: string, category: Category): boolean {
  const pattern = toRulePattern(rawPattern);
  if (pattern === "") return false;

  db.prepare(
    `INSERT INTO category_rules (pattern, category, created_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(pattern) DO UPDATE SET category = excluded.category`
  ).run(pattern, category);
  return true;
}

/**
 * Las categorias que NO se aprenden del historial, y por que:
 *
 * - `otros` y `transferencia_persona` son los fallbacks que `categorize`
 *   devuelve justamente cuando NO sabe. Aprenderlos convertiria un "no se" en
 *   un dato, y ademas cristalizaria el nombre de una persona como patron de
 *   comercio -- que despues matchearia por substring a cualquier otro.
 * - `efectivo` y `recarga` salen del `type`, sin mirar la contraparte: una
 *   regla ahi es redundante en el mejor caso y, si el mismo nombre aparece en
 *   un consumo, un error.
 */
const NOT_LEARNABLE = new Set(["otros", "transferencia_persona", "efectivo", "recarga"]);

/** Una categoria del glosario que vale la pena aprender. Lo de afuera del
 * glosario (una etiqueta vieja, una migracion a medias) no se convierte en
 * regla: `categorize` no la sabe devolver, asi que la regla seria letra
 * muerta que ademas tapa a las que si matchean. */
function isLearnable(category: string): category is Category {
  return !NOT_LEARNABLE.has(category) && (CATEGORIES as readonly string[]).includes(category);
}

export interface LearnRulesResult {
  /** Reglas nuevas escritas. */
  learned: number;
  /** Contrapartes con categorias contradictorias en el historial: no se adivina. */
  skippedAmbiguous: number;
  /** Contrapartes que ya tenian regla: la del usuario manda. */
  skippedExisting: number;
}

/**
 * Deriva reglas de comercio del historial que el usuario YA clasifico a mano.
 *
 * Es el complemento de `--rule`: cuando alguien llega con una base ya
 * etiquetada (historial migrado, categorias corregidas a mano), esas etiquetas
 * son conocimiento real sobre sus comercios que `category_rules` todavia no
 * tiene. Sin las reglas, `categorize` -- que recalcula en vivo y no lee la
 * columna `category` -- no puede reproducir esa clasificacion, y el dashboard
 * muestra numeros distintos a los de la base.
 *
 * Dos cosas que deliberadamente NO hace:
 *
 * 1. **No pisa una regla existente.** Una regla escrita por el usuario es una
 *    afirmacion; esto es una inferencia sobre su historial. La inferencia
 *    nunca gana.
 * 2. **No desempata.** Si la misma contraparte aparece con dos categorias
 *    distintas, no hay forma de saber cual quiso el usuario, asi que se salta
 *    y se reporta en `skippedAmbiguous` para que un humano decida.
 *
 * El patron es la contraparte normalizada COMPLETA, no un fragmento: inventar
 * un prefijo ("centro medico" a partir de "CENTRO MEDICO SUR") arrastraria
 * comercios que el usuario nunca clasifico. Idempotente.
 */
export function learnRulesFromHistory(db: Database.Database): LearnRulesResult {
  const rows = db
    .prepare(
      `SELECT counterparty, category
         FROM transactions
        WHERE direction = 'out'
          AND counterparty IS NOT NULL AND TRIM(counterparty) != ''
          AND category IS NOT NULL AND TRIM(category) != ''
          AND is_internal = 0 AND is_reversed = 0 AND needs_review = 0`
    )
    .all() as { counterparty: string; category: string }[];

  // `null` marca una contraparte vista con mas de una categoria.
  const byPattern = new Map<string, Category | null>();
  for (const row of rows) {
    if (!isLearnable(row.category)) continue;
    const pattern = toRulePattern(row.counterparty);
    if (pattern === "") continue;
    const seen = byPattern.get(pattern);
    if (seen === undefined) byPattern.set(pattern, row.category);
    else if (seen !== row.category) byPattern.set(pattern, null);
  }

  const existing = new Set(listCategoryRules(db).map((rule) => rule.pattern));
  const result: LearnRulesResult = { learned: 0, skippedAmbiguous: 0, skippedExisting: 0 };

  db.transaction(() => {
    for (const [pattern, category] of byPattern) {
      if (existing.has(pattern)) {
        result.skippedExisting += 1;
        continue;
      }
      if (category === null) {
        result.skippedAmbiguous += 1;
        continue;
      }
      if (upsertCategoryRule(db, pattern, category)) result.learned += 1;
    }
  })();

  return result;
}

export interface UncategorizedCounterparty {
  counterparty: string;
  /** How many transactions share this counterparty. */
  count: number;
  /** Total amount spent with it, for ranking by what actually matters. */
  total: number;
}

/**
 * The counterparties currently landing in `'otros'`, ranked by money spent --
 * i.e. exactly the list worth asking a human about, biggest impact first.
 * Only outgoing rows are considered: income has no merchant to classify.
 */
export function topUncategorizedCounterparties(
  db: Database.Database,
  limit = 15
): UncategorizedCounterparty[] {
  return db
    .prepare(
      `SELECT counterparty, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
         FROM transactions
        WHERE direction = 'out'
          AND counterparty IS NOT NULL AND TRIM(counterparty) != ''
          AND (category IS NULL OR category = '' OR category = 'otros')
          AND is_reversed = 0
        GROUP BY counterparty
        ORDER BY total DESC, count DESC
        LIMIT ?`
    )
    .all(limit) as UncategorizedCounterparty[];
}
