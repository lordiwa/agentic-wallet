/**
 * Deterministic transaction categorization (spec glosario §17, F2-B). Pure,
 * synchronous, no I/O — `categorize` always returns one of the glossary's
 * fixed `Category` values and NEVER invents a new one; anything it can't
 * confidently place lands in the catch-all `'otros'` (AC1).
 *
 * Rule order mirrors the ticket's own list (AC2), evaluated top to bottom —
 * the first match wins:
 *
 *   1. `type: 'retiro'`                       -> 'efectivo'
 *   2. `type: 'servicio'`                     -> 'servicios'
 *   3. `type: 'recarga'`                      -> 'recarga'
 *   4. `type: 'sueldo' | 'recibido'`          -> 'otros' (income, not a gasto — see note below)
 *   5. `type: 'transferencia'`, not internal, has a counterparty -> 'transferencia_persona'
 *      `type: 'transferencia'`, internal or no counterparty      -> 'otros'
 *   6. user-defined establishment match on `counterparty` (any remaining
 *      type, chiefly 'debito'/'credito' consumo rows, whose counterparty
 *      carries the "Establecimiento" merchant name) — see `rules` below
 *   7. no match -> 'otros'
 *
 * Type rules (1-5) are checked BEFORE the establishment match (6) so that,
 * e.g., a 'recarga' to a phone carrier categorizes as 'recarga' rather than
 * 'servicios' — the type is the more specific signal there, even when that
 * same carrier is also a servicios establishment for 'servicio'-type combo
 * payments.
 *
 * Rule 6 is data, not code: the merchant patterns come from the user's own
 * `category_rules` table (filled by `npm run onboard`), because a shipped
 * merchant list would only ever be right for the one person it was written
 * for. With no rules configured, every unmatched consumo is 'otros'.
 *
 * Income (`sueldo`/`recibido`) is documented here per the ticket's "tu
 * criterio documentado" clause: it is not a gasto, so it gets the neutral
 * `'otros'` rather than `null` — `categorize` always returns a concrete
 * `Category`, keeping its return type total and its callers (ingest,
 * backfill) simple.
 *
 * `'comida'`, `'transporte'`, and `'suscripcion'` are valid glossary
 * categories with no matching rule yet — the ticket gives no known
 * establishment list for them (only salud/mascota/servicios have one) — so
 * they are currently unreachable output values, reserved for a future
 * ticket that supplies merchant patterns for them. This is intentional, not
 * an oversight: AC1 forbids guessing, so no such rule was invented.
 */

/**
 * The glossary's fixed category set (spec glosario §17), como lista en
 * runtime: quien tenga que validar una categoria que viene de afuera (el
 * `--rule` del onboarding, el `set_rule` del MCP) necesita los valores, no
 * solo el tipo. `Category` se deriva de aqui para que lista y tipo no puedan
 * separarse.
 */
export const CATEGORIES = [
  "comida",
  "transporte",
  "salud",
  "mascota",
  "servicios",
  "recarga",
  "efectivo",
  "transferencia_persona",
  "suscripcion",
  "otros",
] as const;

export type Category = (typeof CATEGORIES)[number];

/** The minimal transaction shape `categorize` needs — a structural subset of
 * `ReconcilableTransaction`/`TransactionRow`, so callers can pass either
 * without an adapter. */
export interface CategorizeInput {
  type: string;
  counterparty?: string | null;
  is_internal?: boolean;
}

/** Strips accents and lowercases, so establishment matching is tolerant of
 * casing/diacritics — mirrors `parser/produbanco.ts`'s own `normalize`
 * helper (not imported, to stay inside this ticket's file boundary). */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * One user-defined merchant rule: "a counterparty containing `pattern` is
 * `category`". Substring match on the normalized counterparty — e.g. a
 * "farmacia" pattern matches both "FARMACIA CENTRAL" and "Farmacía Sur".
 *
 * There is deliberately NO built-in list. Which merchants exist, and which
 * category each belongs to, is specific to one person in one country; a
 * shipped list would silently mis-categorize everyone else's ledger. The
 * rules live in the user's own `category_rules` table, populated by
 * `npm run onboard` from their real, already-synced counterparties.
 */
export interface EstablishmentRule {
  category: Category;
  /** Already-normalized (lowercase, no accents) substring to look for. */
  pattern: string;
}

/**
 * La categoria que una regla de comercio del usuario le asigna a esta
 * contraparte, o `null` si ninguna matchea.
 *
 * Exportada aparte de `categorize` porque hay una diferencia que importa: esto
 * es una afirmacion EXPLICITA del usuario sobre un comercio, mientras que el
 * resto de `categorize` son fallbacks estructurales por `type`. Quien
 * re-etiqueta historial ya clasificado (`reclassify.ts`) necesita distinguir
 * las dos cosas para saber cuando pisar una categoria que ya existia.
 */
export function matchEstablishment(
  counterparty: string | null | undefined,
  rules: readonly EstablishmentRule[]
): Category | null {
  if (!counterparty) return null;
  const normalized = normalize(counterparty);
  for (const rule of rules) {
    if (rule.pattern !== "" && normalized.includes(rule.pattern)) {
      return rule.category;
    }
  }
  return null;
}

/** Normalizes a raw counterparty (or a user-typed fragment of one) into the
 * form `category_rules.pattern` is stored and matched in. Exported so the
 * onboarding CLI stores exactly what `categorize` will later compare. */
export function toRulePattern(text: string): string {
  return normalize(text).trim();
}

/**
 * Assigns a deterministic `Category` to a transaction. Pure and total: same
 * input (and same rules) always yields the same output, and every branch
 * returns a concrete `Category` (never `null`/`undefined`) — see module doc
 * for the full rule table and its rationale.
 *
 * `rules` defaults to none, so an un-onboarded wallet places every consumo in
 * `'otros'` rather than guessing from somebody else's merchant list.
 */
export function categorize(tx: CategorizeInput, rules: readonly EstablishmentRule[] = []): Category {
  switch (tx.type) {
    case "retiro":
      return "efectivo";
    case "servicio":
      return "servicios";
    case "recarga":
      return "recarga";
    case "sueldo":
    case "recibido":
      return "otros";
    case "transferencia":
      if (tx.is_internal) return "otros";
      return tx.counterparty ? "transferencia_persona" : "otros";
    default:
      break;
  }

  return matchEstablishment(tx.counterparty, rules) ?? "otros";
}
