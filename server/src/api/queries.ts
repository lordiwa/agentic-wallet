/**
 * Read-only SQL for the F1-09 API. Deliberately separate from
 * db/repository.ts (which this ticket may only import, not edit): these
 * queries need filtering (is_reversed/is_internal exclusion, needs_review,
 * overview aggregates) that the F1-02 repository does not expose, and the
 * ticket's design guidance is to add that here rather than touch the
 * repository module owned by another ticket.
 */
import type Database from "better-sqlite3";
import type { StatementRow, TransactionRow } from "../db/repository.js";
import { getStrategyConfig } from "../db/strategy-config.js";

export interface TransactionsListFilter {
  from?: string;
  to?: string;
  type?: string;
  direction?: string;
  counterparty?: string;
  limit?: number;
  offset?: number;
  /** When false (default), rows with is_reversed=1 are excluded entirely. */
  includeReversed?: boolean;
  /** When false (default), rows with is_internal=1 are excluded entirely. */
  includeInternal?: boolean;
  /** When false (default), rows a human discarded from the review queue
   * (is_discarded=1) are excluded entirely — mismo criterio que las otras dos
   * banderas: una fila que alguien declaró "esto no es un movimiento real" no
   * tiene por qué aparecer en un listado salvo que se la pida. */
  includeDiscarded?: boolean;
}

/**
 * Lists transactions with the same range/type/direction/counterparty filters
 * as repository.listTransactions, plus reversed/internal exclusion. When a
 * flag is set to include reversed/internal rows, they come back "marked"
 * (the row's is_reversed/is_internal columns are part of the payload) rather
 * than filtered out.
 */
export function queryTransactions(db: Database.Database, filter: TransactionsListFilter = {}): TransactionRow[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filter.from) {
    clauses.push("ts >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    clauses.push("ts <= @to");
    params.to = filter.to;
  }
  if (filter.type) {
    clauses.push("type = @type");
    params.type = filter.type;
  }
  if (filter.direction) {
    clauses.push("direction = @direction");
    params.direction = filter.direction;
  }
  if (filter.counterparty) {
    clauses.push("counterparty = @counterparty");
    params.counterparty = filter.counterparty;
  }
  if (!filter.includeReversed) {
    // Las DOS filas del reverso, no una. El consumo original lleva
    // `is_reversed = 1` y su corrección se persiste como una fila de auditoría
    // aparte (`type = 'reverso'`, `direction = 'in'`, ver `rules/reconcile.ts`).
    // Filtrar sólo la primera escondía el cargo y dibujaba la corrección como
    // un ingreso verde: plata que `EXCLUDE_FROM_TOTALS_SQL` nunca cuenta,
    // listada como si entrara. Sobre el ledger real eran 138 de las 172 filas
    // del filtro "Entrada" (wargaming del MVP, W4).
    clauses.push("is_reversed = 0 AND type != 'reverso'");
  }
  if (!filter.includeInternal) {
    clauses.push("is_internal = 0");
  }
  if (!filter.includeDiscarded) {
    clauses.push("is_discarded = 0");
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.limit = filter.limit ?? 100;
  params.offset = filter.offset ?? 0;

  return db
    .prepare(`SELECT * FROM transactions ${where} ORDER BY ts DESC LIMIT @limit OFFSET @offset`)
    .all(params) as TransactionRow[];
}

/** Transactions still awaiting manual review (needs_review=1), most recent first. */
export function queryReviewTransactions(db: Database.Database): TransactionRow[] {
  return db.prepare("SELECT * FROM transactions WHERE needs_review = 1 ORDER BY ts DESC").all() as TransactionRow[];
}

export interface OverviewCounts {
  total: number;
  needsReview: number;
}

/** Total transaction count and needs_review count, for the overview's "conteos". */
export function countTransactions(db: Database.Database): OverviewCounts {
  const total = (db.prepare("SELECT COUNT(*) as c FROM transactions").get() as { c: number }).c;
  const needsReview = (
    db.prepare("SELECT COUNT(*) as c FROM transactions WHERE needs_review = 1").get() as { c: number }
  ).c;
  return { total, needsReview };
}

/** Most recent card statement (by issue_date, falling back to insertion order), or undefined if none loaded yet. */
export function latestStatement(db: Database.Database): StatementRow | undefined {
  return db
    .prepare(`SELECT * FROM statements ORDER BY (issue_date IS NULL) ASC, issue_date DESC, id DESC LIMIT 1`)
    .get() as StatementRow | undefined;
}

export interface BalanceSnapshot {
  amount: number;
  currency: string;
  at: string | null;
}

/**
 * Reads the bank balance snapshot from strategy_config (key
 * "balanceSnapshot" — camelCase, matching the F1-10 seed loader's other keys
 * like colchonObjetivo/topeTransferenciasMensual/zonaHoraria), JSON-encoded
 * as {amount, at}. If the key is missing or the JSON is malformed, this
 * gracefully returns null rather than inventing a figure (ticket AC: "no
 * inventar cifras").
 *
 * La moneda sale de `strategy_config.moneda`, no de una constante. Estaba
 * cableada en `"USD"` de cuando la app era de una sola moneda, y desde que
 * `npm run onboard` la deja configurar eso dejó de ser cierto: el panel usa
 * este campo para decidir si una fila está "en otra moneda" y deshabilitar
 * Confirmar (R14), mientras el motor compara contra la config
 * (`review/resolve.ts`). Con un perfil en EUR los dos criterios se daban
 * vuelta: la UI bloqueaba las filas que el motor acepta y ofrecía las que
 * rechaza (wargaming del MVP, W7).
 */
export function getBalanceSnapshot(db: Database.Database): BalanceSnapshot | null {
  const row = db.prepare("SELECT value FROM strategy_config WHERE key = 'balanceSnapshot'").get() as
    | { value: string }
    | undefined;
  if (!row) return null;

  try {
    const parsed = JSON.parse(row.value) as { amount?: unknown; at?: unknown };
    if (typeof parsed.amount !== "number") return null;
    return {
      amount: parsed.amount,
      currency: getStrategyConfig(db).moneda,
      at: typeof parsed.at === "string" ? parsed.at : null,
    };
  } catch {
    return null;
  }
}
