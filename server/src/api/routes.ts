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
import { getSyncState } from "../db/repository.js";
import { getSyncProgress } from "../db/sync-progress.js";
import { listReviewResolutions, resolveReview } from "../review/resolve.js";
import {
  bufferBodySchema,
  classifyBodySchema,
  classifyQueueQuerySchema,
  debtIdParamSchema,
  projectionQuerySchema,
  reviewIdParamSchema,
  reviewResolveBodySchema,
  silenceBodySchema,
  transactionsQuerySchema,
} from "./schemas.js";
import {
  classifyCounterparty,
  classifyProgress,
  classifyQueue,
  listSilencedCounterparties,
  movementsByCategory,
  silenceCounterparty,
  unsilenceCounterparty,
} from "../classify/index.js";
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

    // Con `category` la lista es la de una barra del gráfico, y esa la arma el
    // motor recalculando (H21) — incluido qué período significa una barra sin
    // fechas.
    if (q.category) {
      const result = movementsByCategory(getDb(), {
        category: q.category,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        limit: q.limit,
        offset: q.offset,
      });
      res.json({
        transactions: result.transactions,
        count: result.transactions.length,
        total: result.total,
        amount: result.amount,
      });
      return;
    }

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
      includeDiscarded: q.include_discarded,
    });
    res.json({ transactions: rows, count: rows.length });
  });

  router.get("/review", (_req, res) => {
    const rows = queryReviewTransactions(getDb());
    res.json({ transactions: rows, count: rows.length });
  });

  /**
   * La salida de la cola de revisión. Toda la decisión vive en
   * `review/resolve.ts`; acá sólo se valida la forma del request y se traduce
   * el error tipado del motor a un status HTTP.
   *
   * `not_found` es el único 404: el resto son afirmaciones del cliente que el
   * motor rechaza (un monto donde no va, un monto que falta) y ésos son 400.
   */
  router.post("/review/:id/resolve", (req, res) => {
    const params = reviewIdParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "invalid review id", details: params.error.flatten() });
      return;
    }
    const body = reviewResolveBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid resolve body", details: body.error.flatten() });
      return;
    }

    const result = resolveReview(getDb(), {
      id: params.data.id,
      action: body.data.action,
      amount: body.data.amount,
      note: body.data.note,
      resolvedBy: body.data.resolved_by ?? "http",
    });

    if (!result.ok) {
      res.status(result.error === "not_found" ? 404 : 400).json({ error: result.error });
      return;
    }
    res.json(result);
  });

  /** El rastro de quién resolvió qué y cuándo — la contraparte auditable de
   * `POST /review/:id/resolve`. */
  router.get("/review/resolutions", (_req, res) => {
    const resolutions = listReviewResolutions(getDb());
    res.json({ resolutions, count: resolutions.length });
  });

  /**
   * La cola de clasificación (H32): **grupos, no filas**. `?transaction_ids=`
   * la acota al lote de un sync, que es a donde lleva el aviso post-sync (D7-b).
   */
  router.get("/classify/queue", (req, res) => {
    const parsed = classifyQueueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid query parameters", details: parsed.error.flatten() });
      return;
    }
    const groups = classifyQueue(getDb(), {
      limit: parsed.data.limit,
      transactionIds: parsed.data.transaction_ids,
    });
    res.json({ groups, count: groups.length });
  });

  /** El progreso por plata y el criterio de terminado de M1 (H35). */
  router.get("/classify/progress", (_req, res) => {
    res.json(classifyProgress(getDb()));
  });

  /**
   * Responder "qué es esto" (H28). Toda la decisión vive en
   * `classify/apply.ts`; acá sólo se valida la forma y se traduce el error
   * tipado del motor a un status: una contraparte que no existe en el ledger es
   * una afirmación del cliente que el motor rechaza — 400, no 404, igual que en
   * `POST /review/:id/resolve`.
   */
  router.post("/classify", (req, res) => {
    const body = classifyBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid classify body", details: body.error.flatten() });
      return;
    }
    const result = classifyCounterparty(getDb(), body.data);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json(result);
  });

  /** "No me preguntes más por esta" (H33, M5). */
  router.post("/classify/silence", (req, res) => {
    const body = silenceBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid silence body", details: body.error.flatten() });
      return;
    }
    if (!silenceCounterparty(getDb(), body.data.counterparty)) {
      res.status(400).json({ error: "empty_pattern" });
      return;
    }
    res.json({ ok: true, counterparty: body.data.counterparty });
  });

  /** Devuelve a la cola algo silenciado por error. */
  router.delete("/classify/silence", (req, res) => {
    const body = silenceBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid silence body", details: body.error.flatten() });
      return;
    }
    const removed = unsilenceCounterparty(getDb(), body.data.counterparty);
    res.json({ ok: true, changed: removed });
  });

  router.get("/classify/silenced", (_req, res) => {
    const silenced = listSilencedCounterparties(getDb());
    res.json({ silenced, count: silenced.length });
  });

  router.get("/overview", (_req, res) => {
    res.json(buildOverview(getDb(), new Date()));
  });

  /**
   * "Cuando fue la ultima vez que leimos el buzon, y quedo algo a medias?"
   * — lo unico que `POST /sync` no puede contestar, porque su respuesta solo
   * existe mientras corre la llamada. Un dashboard que se refresca solo
   * necesita poder preguntarlo en frio, sin disparar un sync.
   *
   * `last_sync_ts` sale de `sync_state` (hasta cuando ya leimos) y `backlog`
   * de `sync_progress` (el drenado a medias); ver db/schema.ts para por que
   * son dos tablas. Sin fila en `sync_progress` el backlog es `null`: no hay
   * nada pendiente, no es que valga cero.
   */
  router.get("/sync/status", (_req, res) => {
    const db = getDb();
    const state = getSyncState(db);
    const progress = getSyncProgress(db);
    res.json({
      last_sync_ts: state?.last_sync_ts ?? null,
      backlog: progress
        ? {
            processed: progress.processed,
            total: progress.total,
            remaining: Math.max(0, progress.total - progress.processed),
            updated_at: progress.updatedAt,
          }
        : null,
    });
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
