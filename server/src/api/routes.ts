/**
 * Fase 1 read-only API (F1-09 / TASK-015, spec section 11) plus the Fase 2
 * STRATEGY API (F2-D / TASK-026, spec section 11): /transactions, /review,
 * /overview (now carrying the strategy indicators), /transfers,
 * /strategy/projection, and the two write endpoints POST /debts/:id/paid
 * and POST /buffer -- plus the F2-F daily brief endpoint, GET /brief
 * (spec §13 AC4, TASK-027). `getDb` is a lazy provider (not a live handle) so
 * mounting this router never opens the database until a request actually
 * needs it — keeping db-less callers (e.g. app construction in tests that
 * never hit these routes) side-effect free.
 *
 * The strategy indicators are never recomputed here -- every figure comes
 * straight from the F2-C engine (server/src/strategy/index.ts), the single
 * source of truth for that arithmetic; this layer only wires HTTP
 * params/body <-> engine calls and shapes the JSON response. GET /brief is
 * the same pattern one level up: every figure comes from buildDailyBrief
 * (server/src/brief/build-brief.ts), which itself only calls the F2-C engine
 * plus the shared totals exclusion -- this route just validates ?date= and
 * forwards it.
 */
import type Database from "better-sqlite3";
import { Router } from "express";
import { z } from "zod";
import { buildDailyBrief } from "../brief/build-brief.js";
import type { Category } from "../category/categorize.js";
import { markDebtPaid, updateBufferReserved } from "./mutations.js";
import {
  countTransactions,
  getBalanceSnapshot,
  latestStatement,
  queryReviewTransactions,
  queryTransactions,
  type BalanceSnapshot,
} from "./queries.js";
import { bufferBodySchema, debtIdParamSchema, projectionQuerySchema, transactionsQuerySchema } from "./schemas.js";
import {
  colchonStatus,
  localMonthRange,
  nextPayday,
  proyeccionSinDeuda,
  safeToSpendHoy,
  spendingByCategory,
  tarjetaStatus,
  transferenciasMes,
  type ColchonStatus,
  type TarjetaStatus,
  type TransferenciasMesStatus,
} from "../strategy/index.js";

export interface OverviewCard {
  card_mask: string | null;
  issue_date: string | null;
  balance: number | null;
  min_payment: number | null;
  due_date: string | null;
}

export interface Overview {
  balance: BalanceSnapshot | null;
  card: OverviewCard | null;
  counts: { total: number; needs_review: number };
  safe_to_spend_hoy: number;
  buffer_status: ColchonStatus;
  card_status: TarjetaStatus | null;
  transfers_summary: TransferenciasMesStatus;
  next_payday: string | null;
  spending_by_category: Partial<Record<Category, number>>;
}

/**
 * The exact computation GET /api/overview responds with (F2-D AC1),
 * factored out (TASK-034/F3-B) so the chat engine tool (get_strategy_overview
 * in chat/engine-tools.ts) can reuse it verbatim instead of re-deriving the
 * same figures -- no behavior change to the route, which now just calls
 * this and serializes the result.
 */
export function buildOverview(db: Database.Database, now: Date = new Date()): Overview {
  const statement = latestStatement(db);
  const balance = getBalanceSnapshot(db);
  const counts = countTransactions(db);
  const { from, to } = localMonthRange(now);

  return {
    balance,
    card: statement
      ? {
          card_mask: statement.card_mask,
          issue_date: statement.issue_date,
          balance: statement.balance,
          min_payment: statement.min_payment,
          due_date: statement.due_date,
        }
      : null,
    counts: { total: counts.total, needs_review: counts.needsReview },
    // Strategy indicators (F2-D AC1) -- all sourced from the F2-C engine.
    safe_to_spend_hoy: safeToSpendHoy(db, now),
    buffer_status: colchonStatus(db),
    card_status: tarjetaStatus(db, now),
    transfers_summary: transferenciasMes(db, now),
    next_payday: nextPayday(db, now),
    spending_by_category: spendingByCategory(db, { from, to }),
  };
}

/** ?date= for GET /brief -- optional local calendar day (YYYY-MM-DD).
 * Absent means "let buildDailyBrief default to yesterday" (AC4), not a
 * guessed default here. Defined inline (not in ./schemas.js) per this
 * ticket's file boundary -- schemas.ts belongs to a different ticket. */
const briefQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional(),
});

export function createApiRouter(getDb: () => Database.Database): Router {
  const router = Router();

  router.get("/transactions", (req, res) => {
    const parsed = transactionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid query parameters", details: parsed.error.flatten() });
      return;
    }
    const q = parsed.data;
    const rows = queryTransactions(getDb(), {
      from: q.from,
      to: q.to,
      type: q.type,
      direction: q.direction,
      counterparty: q.counterparty,
      limit: q.limit,
      offset: q.offset,
      includeReversed: q.include_reversed,
      includeInternal: q.include_internal,
    });
    res.json({ transactions: rows, count: rows.length });
  });

  router.get("/review", (_req, res) => {
    const rows = queryReviewTransactions(getDb());
    res.json({ transactions: rows, count: rows.length });
  });

  router.get("/overview", (_req, res) => {
    res.json(buildOverview(getDb(), new Date()));
  });

  router.get("/transfers", (_req, res) => {
    res.json(transferenciasMes(getDb()));
  });

  router.get("/brief", (req, res) => {
    const parsed = briefQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid query parameters", details: parsed.error.flatten() });
      return;
    }
    res.json(buildDailyBrief(getDb(), { date: parsed.data.date }));
  });

  router.get("/strategy/projection", (req, res) => {
    const parsed = projectionQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid query parameters", details: parsed.error.flatten() });
      return;
    }
    res.json(proyeccionSinDeuda(getDb(), parsed.data.abono));
  });

  router.post("/debts/:id/paid", (req, res) => {
    const parsed = debtIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid debt id", details: parsed.error.flatten() });
      return;
    }
    const debt = markDebtPaid(getDb(), parsed.data.id);
    if (!debt) {
      res.status(404).json({ error: "debt not found" });
      return;
    }
    res.json({ debt });
  });

  router.post("/buffer", (req, res) => {
    const parsed = bufferBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid buffer body", details: parsed.error.flatten() });
      return;
    }
    const savings = updateBufferReserved(getDb(), parsed.data.reserved);
    res.json({ savings });
  });

  return router;
}
