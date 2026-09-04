/**
 * Read-only chat tool surface (F3-B / TASK-034): five pure `(db, input) ->
 * result` handlers wrapping the existing deterministic engine
 * (server/src/strategy) and ledger queries (server/src/api/queries.ts),
 * plus their registration as an in-process Claude Agent SDK MCP server
 * (createSdkMcpServer + tool(), per .claude/skills/claude-agent-sdk-gmail).
 *
 * Every monetary figure a handler returns is read straight off the F2-C
 * engine or a ledger query -- never invented here. Where a figure has no
 * data to derive from (no statement, no parseable category, no known
 * next payday), the handler returns an explicit null/'no data' marker
 * rather than a guessed number, matching the rest of this codebase's
 * documented "sin datos -> null/0 sin inventar" convention.
 *
 * The handlers are deliberately kept separate from the `tool()`/
 * `createSdkMcpServer` wiring below so `*.test.ts` can unit-test the pure
 * functions directly against a seeded in-memory DB without touching the
 * Agent SDK at all -- the SDK wiring itself has nothing to unit-test
 * beyond "does it call the handler and JSON-serialize its result."
 *
 * READ-ONLY: no handler in this file writes or mutates the DB.
 */
import type Database from "better-sqlite3";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { buildDailyBrief, type DailyBrief } from "../brief/build-brief.js";
import type { Category } from "../category/categorize.js";
import { buildOverview, type Overview } from "../api/routes.js";
import {
  latestStatement,
  queryTransactions as queryTransactionRows,
  type TransactionsListFilter,
} from "../api/queries.js";
import type { TransactionRow } from "../db/repository.js";
import {
  colchonStatus,
  localDayKey,
  localMonthRange,
  fromCents,
  nextPayday,
  parseLocalDay,
  safeToSpendHoy,
  spendingByCategory,
  tarjetaStatus,
  toCents,
  type ColchonStatus,
  type TarjetaStatus,
} from "../strategy/index.js";

// ---------------------------------------------------------------------------
// 1. get_strategy_overview
// ---------------------------------------------------------------------------

/** No input -- mirrors GET /api/overview, which also takes no query params. */
export type GetStrategyOverviewInput = Record<string, never>;

/**
 * The same computed output as GET /api/overview (safe-to-spend, colchón
 * status, card status, transfers vs cap, projection): reuses `buildOverview`
 * (server/src/api/routes.ts) verbatim, so this tool can never drift from the
 * route's own arithmetic.
 */
export function getStrategyOverview(db: Database.Database, _input: GetStrategyOverviewInput = {}): Overview {
  return buildOverview(db, new Date());
}

// ---------------------------------------------------------------------------
// 2. query_transactions (+ spending_by_category for a date range)
// ---------------------------------------------------------------------------

export interface QueryTransactionsInput {
  from?: string;
  to?: string;
  type?: string;
  direction?: string;
  counterparty?: string;
  limit?: number;
  /** Defaults to excluding reversed rows, same as api/queries.js. */
  include_reversed?: boolean;
  /** Defaults to excluding internal transfers, same as api/queries.js. */
  include_internal?: boolean;
}

export interface QueryTransactionsResult {
  transactions: TransactionRow[];
  count: number;
  /**
   * spendingByCategory over [from, to) when both bounds are present and
   * parse as valid instants; `null` (never a guess) when the range is
   * missing or unparseable -- this is "no data", not "zero spend".
   */
  spending_by_category: Partial<Record<Category, number>> | null;
}

function spendingByCategoryForRange(
  db: Database.Database,
  from: string | undefined,
  to: string | undefined
): Partial<Record<Category, number>> | null {
  if (!from || !to) return null;
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;
  return spendingByCategory(db, { from: fromDate, to: toDate });
}

/**
 * Filtered ledger lookups via api/queries.js's `queryTransactions`
 * (from/to/type/direction/counterparty/limit), excluding reversed+internal
 * rows by default, plus `spending_by_category` for the same [from, to)
 * range when one is given.
 */
export function queryTransactions(db: Database.Database, input: QueryTransactionsInput = {}): QueryTransactionsResult {
  const filter: TransactionsListFilter = {
    from: input.from,
    to: input.to,
    type: input.type,
    direction: input.direction,
    counterparty: input.counterparty,
    limit: input.limit,
    includeReversed: input.include_reversed,
    includeInternal: input.include_internal,
  };

  const transactions = queryTransactionRows(db, filter);

  return {
    transactions,
    count: transactions.length,
    spending_by_category: spendingByCategoryForRange(db, input.from, input.to),
  };
}

// ---------------------------------------------------------------------------
// 3. get_daily_brief
// ---------------------------------------------------------------------------

export interface GetDailyBriefInput {
  /**
   * local calendar day (YYYY-MM-DD). Absent defers to
   * `buildDailyBrief`'s own documented default (yesterday, local tz --
   * the brief mirrors the report the user used to receive each morning about
   * the previous day's spending) rather than reimplementing that default
   * here.
   */
  date?: string;
}

/** On-demand brief content for a given date, via `buildDailyBrief`
 * (server/src/brief/build-brief.ts) -- no re-derivation of its math. */
export function getDailyBrief(db: Database.Database, input: GetDailyBriefInput = {}): DailyBrief {
  return buildDailyBrief(db, { date: input.date });
}

// ---------------------------------------------------------------------------
// 4. get_card_statement
// ---------------------------------------------------------------------------

export type GetCardStatementInput = Record<string, never>;

export interface CardStatementResult {
  available: boolean;
  card_mask: string | null;
  issue_date: string | null;
  balance: number | null;
  min_payment: number | null;
  due_date: string | null;
  /** "no statement loaded" when `available` is false; `null` otherwise. */
  message: string | null;
}

/** Latest statement figures (saldo, fecha corte/pago) via api/queries.js's
 * `latestStatement`, or an explicit "no statement loaded" result -- never a
 * guessed statement. */
export function getCardStatement(db: Database.Database, _input: GetCardStatementInput = {}): CardStatementResult {
  const statement = latestStatement(db);
  if (!statement) {
    return {
      available: false,
      card_mask: null,
      issue_date: null,
      balance: null,
      min_payment: null,
      due_date: null,
      message: "no statement loaded",
    };
  }

  return {
    available: true,
    card_mask: statement.card_mask,
    issue_date: statement.issue_date,
    balance: statement.balance,
    min_payment: statement.min_payment,
    due_date: statement.due_date,
    message: null,
  };
}

// ---------------------------------------------------------------------------
// 5. check_affordability -- the advisor capability
// ---------------------------------------------------------------------------

/** The glossary's fixed category set (category/categorize.ts), duplicated as
 * a runtime list only for input validation -- categorize() itself remains
 * the single source of truth for assigning a category to a transaction. */
const KNOWN_CATEGORIES: readonly Category[] = [
  "comida",
  "transporte",
  "salud",
  "mascota",
  "servicios",
  "recarga",
  "efectivo",
  "transferencia_persona",
  "suscripcion",
  "vivienda",
  "entretenimiento",
  "limpieza",
  "deuda",
  "prestamo",
  "regalo",
  "otros",
];

function isKnownCategory(value: string): value is Category {
  return (KNOWN_CATEGORIES as readonly string[]).includes(value);
}

export interface CheckAffordabilityInput {
  amount: number;
  /** local calendar day (YYYY-MM-DD) to evaluate the check against.
   * Absent/unparseable falls back to the real current instant. */
  date?: string;
  category?: string;
}

export interface AffordabilityVerdict {
  viable: boolean;
  reason: string;
  amount: number;
  /** local calendar day this verdict was evaluated for. */
  date: string | null;
  safeToSpendHoy: number;
  /** `safeToSpendHoy - amount`, cents-safe; negative when not viable. */
  safeToSpendAfter: number;
  bufferStatus: ColchonStatus;
  cardStatus: TarjetaStatus | null;
  nextPayday: string | null;
  /** This-month spend in `category` (0 if none), or `null` when no
   * category was given or it isn't one of the glossary's known values. */
  categorySpentThisMonth: number | null;
}

/**
 * check_affordability (F3-B advisor capability): whether a proposed spend
 * fits inside today's `safeToSpendHoy` (spec §9.4), the single figure the
 * F2-C engine already computes for "money safely spendable today" --
 * viable iff `amount <= safeToSpendHoy` (the amount/safeToSpendHoy boundary
 * itself counts as viable, not just strictly under it). `bufferStatus`,
 * `cardStatus`, and `nextPayday` ride along as the supporting context a
 * chat advisor needs to explain the verdict, all sourced from the same
 * engine calls `safeToSpendHoy` itself composes from -- no independent
 * arithmetic invented here.
 */
export function checkAffordability(db: Database.Database, input: CheckAffordabilityInput): AffordabilityVerdict {
  const now = (input.date ? parseLocalDay(input.date) : null) ?? new Date();

  const safeToday = safeToSpendHoy(db, now);
  const safeAfterCents = toCents(safeToday) - toCents(input.amount);
  const safeAfter = fromCents(safeAfterCents);
  const viable = safeAfterCents >= 0;

  let categorySpentThisMonth: number | null = null;
  if (input.category && isKnownCategory(input.category)) {
    const { from, to } = localMonthRange(now);
    const spending = spendingByCategory(db, { from, to });
    categorySpentThisMonth = spending[input.category] ?? 0;
  }

  const reason = viable
    ? `El gasto de $${input.amount.toFixed(2)} cabe dentro del safe-to-spend de hoy ($${safeToday.toFixed(2)}).`
    : `El gasto de $${input.amount.toFixed(2)} excede el safe-to-spend de hoy ($${safeToday.toFixed(2)}) por $${Math.abs(safeAfter).toFixed(2)}.`;

  return {
    viable,
    reason,
    amount: input.amount,
    date: localDayKey(now),
    safeToSpendHoy: safeToday,
    safeToSpendAfter: safeAfter,
    bufferStatus: colchonStatus(db),
    cardStatus: tarjetaStatus(db, now),
    nextPayday: nextPayday(db, now),
    categorySpentThisMonth,
  };
}

// ---------------------------------------------------------------------------
// In-process MCP server registration (separable from the handlers above so
// they stay independently unit-testable -- see module doc).
// ---------------------------------------------------------------------------

const EMPTY_SHAPE = {};

const QUERY_TRANSACTIONS_SHAPE = {
  from: z.string().optional().describe("ISO timestamp, inclusive lower bound on ts."),
  to: z.string().optional().describe("ISO timestamp, inclusive upper bound on ts."),
  type: z.string().optional().describe("Exact transaction type, e.g. 'debito', 'servicio', 'transferencia'."),
  direction: z.string().optional().describe("'in' or 'out'."),
  counterparty: z.string().optional().describe("Exact counterparty name."),
  limit: z.number().int().positive().optional().describe("Max rows to return (default 100)."),
  include_reversed: z.boolean().optional().describe("Include is_reversed=1 rows (default false)."),
  include_internal: z.boolean().optional().describe("Include is_internal=1 rows (default false)."),
};

const GET_DAILY_BRIEF_SHAPE = {
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe("local calendar day; defaults to yesterday."),
};

const CHECK_AFFORDABILITY_SHAPE = {
  amount: z.number().describe("Proposed spend amount in USD."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional()
    .describe("local calendar day to evaluate against; defaults to today."),
  category: z.string().optional().describe("One of the glossary categories, e.g. 'comida', 'transporte'."),
};

/** Wraps a handler's result as the `CallToolResult` shape the SDK expects. */
function asToolResult(result: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

/**
 * Registers the five read-only handlers above as an in-process Claude Agent
 * SDK MCP server (createSdkMcpServer + tool(), per the
 * claude-agent-sdk-gmail skill's pattern), for `query()`'s `mcpServers`
 * option. `getDb` is a lazy provider (matches api/routes.ts's own
 * `createApiRouter(getDb)`), not a live handle.
 */
export function createEngineToolsServer(getDb: () => Database.Database) {
  return createSdkMcpServer({
    name: "wallet-engine",
    version: "1.0.0",
    tools: [
      tool(
        "get_strategy_overview",
        "The current strategy overview: safe-to-spend today, colchón (buffer) status, card status, this month's transfers vs cap, next payday, and spending by category. Read-only.",
        EMPTY_SHAPE,
        async () => asToolResult(getStrategyOverview(getDb())),
        { annotations: { readOnlyHint: true, openWorldHint: false } }
      ),
      tool(
        "query_transactions",
        "Filtered ledger lookups (from/to/type/direction/counterparty/limit), excluding reversed and internal transfers by default, plus spending grouped by category when a from/to range is given. Read-only.",
        QUERY_TRANSACTIONS_SHAPE,
        async (args) => asToolResult(queryTransactions(getDb(), args)),
        { annotations: { readOnlyHint: true, openWorldHint: false } }
      ),
      tool(
        "get_daily_brief",
        "The on-demand daily brief for a given local date (default yesterday): total spent, top consumos, comparison vs historical average, strategy alerts, and card-payment reminder. Read-only.",
        GET_DAILY_BRIEF_SHAPE,
        async (args) => asToolResult(getDailyBrief(getDb(), args)),
        { annotations: { readOnlyHint: true, openWorldHint: false } }
      ),
      tool(
        "get_card_statement",
        "The latest credit card statement (saldo, fecha de corte, fecha de pago), or an explicit 'no statement loaded' result. Read-only.",
        EMPTY_SHAPE,
        async () => asToolResult(getCardStatement(getDb())),
        { annotations: { readOnlyHint: true, openWorldHint: false } }
      ),
      tool(
        "check_affordability",
        "Whether a proposed spend is viable against today's safe-to-spend figure, with the supporting colchón/card/payday context. This is the financial-advisor capability. Read-only.",
        CHECK_AFFORDABILITY_SHAPE,
        async (args) => asToolResult(checkAffordability(getDb(), args)),
        { annotations: { readOnlyHint: true, openWorldHint: false } }
      ),
    ],
  });
}
