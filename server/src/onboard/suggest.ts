/**
 * "What do your own transactions say your profile should be?" — the evidence
 * half of `npm run onboard`.
 *
 * Everything here is derived from the user's already-synced ledger and
 * nothing else. No shipped defaults, no invented figures: if the ledger has
 * no salary deposits, `salary` is null and the agent asks instead of
 * guessing. That is the whole contract — a suggestion is a *reading of the
 * user's data*, and the user (or the agent on their behalf) always confirms
 * it before `setStrategyConfig` writes anything.
 *
 * Pure and read-only: opens no files, writes no rows, prints nothing. cli.ts
 * owns all I/O, which is what makes these rules testable.
 */
import type Database from "better-sqlite3";
import { topUncategorizedCounterparties, type UncategorizedCounterparty } from "../category/rules-repository.js";
import { localParts } from "../strategy/dates.js";

export interface SalarySuggestion {
  /** Where the deposits come from, as the bank writes it. */
  fuente: string;
  /** "quincenal" when deposits cluster on two days a month, else "mensual". */
  cadencia: string;
  /** Median deposit amount -- median, not mean, so one bonus doesn't skew it. */
  montoEstimado: number;
  /** Day-of-month windows the calendar can parse, e.g. ["15-15", "30-30"]. */
  diasPago: string[];
  /** How many deposits this reading is based on -- the agent should say this out loud. */
  sampleSize: number;
}

export interface OnboardSuggestions {
  /** Most frequent account-holder spelling seen in the ledger, or null. */
  titular: string | null;
  /** Salary reading, or null when there are no income rows to read. */
  salary: SalarySuggestion | null;
  /** Merchants currently landing in 'otros', biggest spend first. */
  uncategorized: UncategorizedCounterparty[];
  /** Average monthly outgoing spend, for proposing a colchon. Null if <1 month of data. */
  gastoMensualPromedio: number | null;
  /** Months of history the ledger actually covers. */
  mesesDeHistorial: number;
}

/** Median of a non-empty numeric list. Exportada porque
 * `suggestRecurringExpenses` (N4) toma la misma decisión por la misma razón —
 * un valor atípico no puede mover una propuesta— y duplicarla dejaría dos
 * definiciones de "mediana" que en algún momento divergen. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Token de cuenta enmascarada tal como lo escribe el banco: "XXXXXX20924",
 * "****1234", "2200112233". Nunca es un nombre. */
const MASKED_ACCOUNT_TOKEN = /^[x*·•\-]*\d+$/i;

/** Quita el token de cuenta enmascarada que las filas viejas guardaban pegado
 * al nombre ("PEREZ GOMEZ ANA MARIA XXXXXX20924"). */
function stripMaskedAccount(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter((token) => !MASKED_ACCOUNT_TOKEN.test(token))
    .join(" ");
}

/**
 * The account holder as the bank spells it, read off `account_holder` (the
 * name the parser lifts from "Cuenta débito: <NOMBRE> <cuenta>"). Returns the
 * most frequent non-empty name; null when the ledger has none.
 *
 * NUNCA devuelve un numero de cuenta enmascarado. El titular se compara
 * despues contra el `Contacto:` de cada transferencia para marcarla interna
 * (`rules/reconcile.ts`): proponer "XXXXXX20924" daba un valor que el usuario
 * confirmaba de buena fe y que despues no matcheaba con nada, dejando las
 * transferencias propias contadas como gasto. Sin evidencia de nombre la
 * respuesta correcta es null y que el onboarding pregunte.
 *
 * `account` se sigue leyendo como fallback por las filas sincronizadas antes
 * de que existiera `account_holder`, que guardaban el campo entero ahi.
 */
export function suggestTitular(db: Database.Database): string | null {
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(account_holder), ''), TRIM(account)) as name, COUNT(*) as c
         FROM transactions
        WHERE name IS NOT NULL AND name != ''
        GROUP BY name ORDER BY c DESC`
    )
    .all() as { name: string; c: number }[];

  for (const row of rows) {
    const name = stripMaskedAccount(row.name);
    if (name !== "") return name;
  }
  return null;
}

/**
 * Reads the salary from incoming `sueldo` rows: who pays, how much, and on
 * which days of the month.
 *
 * `cadencia` is inferred from the number of distinct paydays rather than
 * asked: two recurring days a month is "quincenal", anything else "mensual".
 * A day only counts as a payday if it shows up more than once, so a one-off
 * deposit on the 3rd never becomes a permanent payday -- unless it is all
 * the evidence there is, in which case the observed days are used as-is and
 * `sampleSize` tells the agent how thin the reading is.
 */
export function suggestSalary(db: Database.Database): SalarySuggestion | null {
  const rows = db
    .prepare(
      `SELECT ts, amount, counterparty FROM transactions
        WHERE direction = 'in' AND type = 'sueldo' AND is_reversed = 0
        ORDER BY ts ASC`
    )
    .all() as { ts: string; amount: number; counterparty: string | null }[];

  if (rows.length === 0) return null;

  const dayCounts = new Map<string, number>();
  for (const row of rows) {
    // ts is an ISO instant; the day-of-month is what payday means to a human --
    // y "humano" acá es el día LOCAL, porque es el que el calendario después lee
    // (`historicalPaydayDays` bucketea con `localDayKey`). Proponer el día UTC
    // hacía que un cobro de las 23:00 del 15 se propusiera como "16", el usuario
    // lo confirmara, y `refineWindowDay` no encontrara ningún cobro dentro de la
    // ventana que él mismo acababa de escribir (wargaming ronda 4, W34).
    const day = String(localParts(new Date(row.ts)).day);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  const recurring = [...dayCounts.entries()].filter(([, count]) => count > 1).map(([day]) => day);
  const dias = (recurring.length > 0 ? recurring : [...dayCounts.keys()]).sort(
    (a, b) => Number(a) - Number(b)
  );
  // Como ventana de un solo dia ("15" -> "15-15"): `parseDiasPago` sólo lee
  // ventanas, y un dia suelto no parsea -- se descarta en silencio y el
  // calendario de pagos queda mudo. La sugerencia se acepta tal cual via
  // --set, asi que tiene que salir ya en el formato que el motor consume.
  const diasPago = dias.map((day) => `${day}-${day}`);

  const fuenteCounts = new Map<string, number>();
  for (const row of rows) {
    const name = row.counterparty?.trim();
    if (name) fuenteCounts.set(name, (fuenteCounts.get(name) ?? 0) + 1);
  }
  const fuente = [...fuenteCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  return {
    fuente,
    cadencia: diasPago.length === 2 ? "quincenal" : "mensual",
    montoEstimado: Math.round(median(rows.map((r) => r.amount)) * 100) / 100,
    diasPago,
    sampleSize: rows.length,
  };
}

/**
 * Average monthly outgoing spend, and how many months of history back it.
 * This is the evidence behind a colchon proposal ("3x your monthly spend"),
 * but the multiplier is a decision for the user, not for this function --
 * it deliberately returns the observed figure and nothing derived from it.
 *
 * Returns a null average when the ledger covers less than a full month:
 * dividing two weeks of spending into a "monthly" figure would understate it
 * by half, and a colchon built on that number is worse than no proposal.
 */
export function suggestSpendBaseline(db: Database.Database): {
  gastoMensualPromedio: number | null;
  mesesDeHistorial: number;
} {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total, MIN(ts) as first_ts, MAX(ts) as last_ts
         FROM transactions
        WHERE direction = 'out' AND is_reversed = 0 AND is_internal = 0 AND needs_review = 0`
    )
    .get() as { total: number; first_ts: string | null; last_ts: string | null };

  if (!row.first_ts || !row.last_ts) return { gastoMensualPromedio: null, mesesDeHistorial: 0 };

  const days = (new Date(row.last_ts).getTime() - new Date(row.first_ts).getTime()) / 86_400_000;
  const months = days / 30.44;
  if (months < 1) return { gastoMensualPromedio: null, mesesDeHistorial: Math.round(months * 10) / 10 };

  return {
    gastoMensualPromedio: Math.round((row.total / months) * 100) / 100,
    mesesDeHistorial: Math.round(months * 10) / 10,
  };
}

/** Everything the onboarding agent needs to propose a profile, in one read. */
export function buildSuggestions(db: Database.Database): OnboardSuggestions {
  const baseline = suggestSpendBaseline(db);
  return {
    titular: suggestTitular(db),
    salary: suggestSalary(db),
    uncategorized: topUncategorizedCounterparties(db),
    ...baseline,
  };
}
