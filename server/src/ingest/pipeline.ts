/**
 * The hybrid-ingestion pipeline (spec §6.1/§7, F1-07) — the architectural
 * core of Agentic Wallet. Wires together, in order:
 *
 *  1. Gmail search + read (mocked `GmailClient` in tests, `googleapis` for real).
 *  2. F1-03's deterministic parser (`parseEmail`) to classify + derive the
 *     authoritative amount.
 *  3. Claude's structured extraction (`EmailExtractor`, masked input) as a
 *     cross-validation signal only — never the source of truth for money
 *     (AC2, "regla de oro"): its `amount_text_raw`, re-parsed by the same
 *     strict regex the deterministic layer uses, must agree with F1-03's
 *     own derived amount or the row is flagged `needs_review` and excluded
 *     from totals.
 *  4. F1-04's reconcile rules (reversals/dedup/internal) over the batch of
 *     transaction + reverso candidates.
 *  5. F1-05's statement ingestion for "estado de cuenta" emails.
 *  6. Idempotent persistence by `gmail_msg_id` (AC4).
 *
 * `ingestOnce` never reads or writes `sync_state` — the caller (F1-08's
 * sync trigger) owns choosing `sinceTs` and advancing it on success, so
 * this pipeline stays a pure, fully-mockable unit independent of any
 * cron/API wiring.
 */
import type Database from "better-sqlite3";
import { categorize, type EstablishmentRule } from "../category/categorize.js";
import { listCategoryRules } from "../category/rules-repository.js";
import { insertTransaction, updateTransactionReviewFlags } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { listParsers, parseEmail } from "../parser/index.js";
import type { InboundEmail, ParsedTransaction } from "../parser/types.js";
import { reconcile } from "../rules/reconcile.js";
import type { ReconcilableTransaction, ReversoCandidate } from "../rules/reconcile.js";
import { ingestStatementEmail } from "../statement/ingest-statement.js";
import { validateAmount } from "./amount-validate.js";
import { maskEmailForExtractor } from "./mask.js";
import { extractReversoFields } from "./reverso-extract.js";
import { emitMetric, withSpan } from "./telemetry.js";
import type { EmailExtractor, GmailClient, GmailMessage } from "./types.js";

export interface IngestDeps {
  db: Database.Database;
  gmailClient: GmailClient;
  extractor: EmailExtractor;
  /**
   * Account holder's full name, forwarded to F1-04's internal-transfer rule.
   *
   * `null` cuando el usuario todavia no lo configuro. Es un estado legitimo,
   * no un error: el onboarding PROPONE el titular leyendo el ledger, asi que
   * el primer sync necesariamente ocurre antes de que exista. Sin titular se
   * omite el marcado de `is_internal` (nada con que comparar) y el resto de
   * la ingesta corre igual.
   */
  titular: string | null;
}

export interface IngestOptions {
  /** ISO-8601 lower bound; the caller (F1-08) is the one that reads/advances
   * this from `sync_state`. */
  sinceTs: string;
}

export interface IngestBatchOptions {
  /** The exact Gmail message ids to process, in order. No search is run:
   * the caller (`sync/run-sync.ts`) already has the backlog and decides how
   * much of it fits in this call. */
  messageIds: readonly string[];
  /**
   * Wall-clock budget in ms. The loop stops BEFORE starting a new message
   * once the budget is spent — never mid-message, so a half-processed email
   * is never persisted — and always processes at least one, so a caller with
   * an absurdly small budget still makes progress instead of deadlocking the
   * backlog. Defaults to no budget (process every id given).
   */
  maxMs?: number;
  /** Monotonic clock in ms, injectable so tests don't sleep. Defaults to `Date.now`. */
  monotonicNow?: () => number;
}

export interface IngestSummary {
  /**
   * Messages actually FETCHED AND PROCESSED in this run. For `ingestOnce`
   * that's everything the Gmail search returned; for `ingestBatch` it's a
   * PREFIX of `messageIds` (the loop can stop early on `maxMs`), which is
   * what lets the caller slice the backlog by this number and know the rest
   * is untouched.
   */
  seen: number;
  /** Rows newly written to `transactions` (new gmail_msg_id). */
  inserted: number;
  /** Rows that already existed for their gmail_msg_id (AC4, no-op). */
  duplicates: number;
  /** Rows persisted with needs_review=1 (mismatch, ambiguous/unmatched reverso, unparseable amount, etc.). */
  needsReview: number;
  /** Emails classified "ignored" by F1-03 (login notices, etc.). */
  skipped: number;
  /** Statement emails successfully persisted via F1-05. */
  statementsPersisted: number;
  /** Statement emails that were NOT recognizable and so were not persisted (F1-05's `persisted:false` branch). */
  statementsNeedReview: number;
  /** Reversal matches applied by F1-04. */
  reversalsApplied: number;
}

/**
 * Lo que un lote devuelve, que es el resumen **mas los ids de las filas nuevas**.
 *
 * Los ids no viven en `IngestSummary` a proposito: ese tipo es una bolsa de
 * contadores que `sync/run-sync.ts` suma campo a campo entre lotes, y un
 * arreglo no se suma. Ademas la pregunta que responden es de UN lote, no del
 * backlog acumulado: es el "lo que entro en ese lote" de D7-b — el aviso
 * post-sync que lleva a la cola de clasificacion acotada a lo recien leido
 * (`GET /api/classify/queue?transaction_ids=`).
 */
export interface IngestBatchResult extends IngestSummary {
  insertedIds: number[];
}

/**
 * Builds the Gmail search query per spec §6.1/§7: "from:produbanco
 * after:{last_sync}". Gmail's `after:` operator only accepts a date
 * (YYYY/MM/DD) and is evaluated in the Gmail ACCOUNT's local timezone
 * (local time, UTC-5) — not UTC. Naively truncating `sinceTs` to its UTC
 * calendar date can therefore start the search window up to 5h AFTER
 * `sinceTs` (e.g. `sinceTs` = 2026-07-01T02:00:00Z is still 2026-06-30
 * 21:00 local time, but "after:2026/07/01" only includes mail from
 * 2026-07-01 00:00 local time onward — silently losing that whole
 * 21:00-24:00 local time window once F1-08 advances `last_sync` day by day).
 * Review fix (TASK-017 MEDIUM-1): subtract a day so the window always
 * starts at or before `sinceTs` regardless of where in the UTC day it
 * falls. The resulting overlap with already-ingested mail is free —
 * persistence is idempotent by `gmail_msg_id` (AC4), and a re-seen,
 * already-persisted row now correctly *converges* (is_reversed/needs_review
 * only ever upgrade, see the HIGH-1 fix in `persist` below) rather than
 * duplicating or going stale.
 */
export function buildSearchQuery(sinceTs: string, senders: readonly string[] = registeredSenders()): string {
  const parsed = new Date(sinceTs);
  const oneDayMs = 24 * 60 * 60 * 1000;
  const datePart = Number.isNaN(parsed.getTime())
    ? sinceTs.slice(0, 10)
    : new Date(parsed.getTime() - oneDayMs).toISOString().slice(0, 10);

  // The `from:` filter is derived from the registered parsers, never
  // hardcoded: registering a bank's parser is what makes its mail reachable.
  // Parenthesised so the OR binds to the senders only and not to `after:`.
  const fromFilter =
    senders.length === 1 ? `from:${senders[0]}` : `(${senders.map((s) => `from:${s}`).join(" OR ")})`;

  return `${fromFilter} after:${datePart.replaceAll("-", "/")}`;
}

/** Every sender declared by every registered parser, de-duplicated. */
function registeredSenders(): string[] {
  return [...new Set(listParsers().flatMap((parser) => parser.gmailSenders))];
}

function toInboundEmail(msg: GmailMessage): InboundEmail {
  return {
    subject: msg.subject,
    body: msg.body,
    gmail_msg_id: msg.gmail_msg_id,
    gmail_thread_id: msg.gmail_thread_id,
    ts: msg.ts,
  };
}

function toNewTransaction(
  tx: ReconcilableTransaction,
  threadId: string | null,
  source: "hybrid" | "deterministic",
  rules: readonly EstablishmentRule[]
): NewTransaction {
  return {
    gmail_msg_id: tx.gmail_msg_id,
    gmail_thread_id: threadId,
    ts: tx.ts,
    direction: tx.direction,
    type: tx.type,
    // Sin coerción: `null` viaja hasta `insertTransaction`, que es donde vive
    // la invariante "monto desconocido ⇒ placeholder + needs_review".
    amount: tx.amount,
    currency: tx.currency,
    counterparty: tx.counterparty ?? null,
    account: tx.account ?? null,
    account_holder: tx.account_holder ?? null,
    // F2-B (TASK-024, AC3): populate `category` deterministically at
    // persist time from the same fields F1-04's reconcile pass already
    // resolved (type/counterparty/is_internal) — see category/categorize.ts.
    category: categorize({ type: tx.type, counterparty: tx.counterparty, is_internal: tx.is_internal }, rules),
    raw_subject: tx.raw_subject,
    is_reversed: tx.is_reversed ?? false,
    is_internal: tx.is_internal ?? false,
    needs_review: tx.needs_review,
    source,
  };
}

/**
 * Persists a reverso email as its own auditable `type:'reverso'` row —
 * never summed as spend. `needsReview` distinguishes a fully-resolved match
 * (false — it already did its job settling a consumo, nothing for a human
 * to do) from an ambiguous/unmatched candidate (true — a human needs to
 * look at it). Review fix (TASK-017 HIGH-1, part b): previously only
 * ambiguous/unmatched reversos were persisted at all; a successfully
 * matched reverso left no trace whatsoever.
 */
function reversoAuditRow(candidate: ReversoCandidate, threadId: string | null, needsReview: boolean): NewTransaction {
  return {
    // A reverso candidate always carries the gmail_msg_id of the email it
    // was extracted from (set below in ingestOnce); the fallback only
    // guards against a hand-built candidate that omitted it.
    gmail_msg_id: candidate.gmail_msg_id ?? `reverso-${candidate.ts}-${candidate.amount}`,
    gmail_thread_id: threadId,
    ts: candidate.ts,
    direction: "in",
    type: "reverso",
    amount: candidate.amount,
    account: candidate.account,
    // El comercio va a la fila para que una revisión ambigua se pueda
    // resolver sin volver al correo.
    counterparty: candidate.counterparty ?? null,
    raw_subject: candidate.raw_subject,
    needs_review: needsReview,
    source: "deterministic",
  };
}

/** Runs one hybrid-ingestion pass end to end. See module doc for the pipeline shape.
 * Instrumented per .claude/shared/OBSERVABILITY.md: a trace span + correlated
 * structured log around the whole run and around each external-integration
 * call (Gmail search/read, Claude extraction), plus a summary metric —
 * never logs email content/amounts/counterparty, only ids and counts. */
export async function ingestOnce(deps: IngestDeps, options: IngestOptions): Promise<IngestSummary> {
  return withSpan("ingest.run", { since_ts: options.sinceTs }, async () => {
    const ids = await searchMessageIds(deps, options.sinceTs);
    const { insertedIds: _ids, ...summary } = await runIngest(deps, { messageIds: ids });
    emitMetric("ingest.summary", { ...summary });
    return summary;
  });
}

/**
 * Ingests a KNOWN list of messages — the unit of work of the incremental
 * sync (see `sync/run-sync.ts`). Same pipeline as `ingestOnce`, minus the
 * Gmail search: the caller owns the backlog and the batching policy, so the
 * only thing this adds is the `maxMs` budget that lets a caller with a
 * timeout (a 60s MCP client, say) come back for more instead of losing
 * hours of work.
 *
 * Everything this batch touched is persisted before it returns — that's what
 * makes an interrupted first sync resumable rather than a total loss.
 */
export async function ingestBatch(deps: IngestDeps, options: IngestBatchOptions): Promise<IngestBatchResult> {
  return withSpan("ingest.batch", { count: options.messageIds.length }, async () => {
    const result = await runIngest(deps, options);
    // Los ids salen de la metrica: es una serie de contadores, y un arreglo
    // ahi no significa nada.
    const { insertedIds: _ids, ...summary } = result;
    emitMetric("ingest.summary", { ...summary });
    return result;
  });
}

/** The Gmail half of `ingestOnce`, exposed so the incremental sync can build
 * its backlog once and then drain it batch by batch. */
export async function searchMessageIds(deps: Pick<IngestDeps, "gmailClient">, sinceTs: string): Promise<string[]> {
  const query = buildSearchQuery(sinceTs);
  return withSpan("ingest.gmail_search", { query }, () => deps.gmailClient.searchMessageIds(query));
}

async function runIngest(deps: IngestDeps, options: IngestBatchOptions): Promise<IngestBatchResult> {
  const { db, gmailClient, extractor, titular } = deps;
  const ids = options.messageIds;
  const monotonicNow = options.monotonicNow ?? (() => Date.now());
  const budgetMs = options.maxMs ?? Number.POSITIVE_INFINITY;
  const startedAtMs = monotonicNow();

  const transactionCandidates: ReconcilableTransaction[] = [];
  const reversoCandidates: ReversoCandidate[] = [];
  // Reversos whose body had no parseable "Monto:" field can't become a
  // valid ReversoCandidate (amount is required) — persisted directly as a
  // needs_review row instead of vanishing (see the ticket's reverso
  // obligation: ambiguous/unmatched must surface at /api/review).
  const unresolvedReversos: NewTransaction[] = [];
  const threadIdByMsgId = new Map<string, string | null>();

  let seen = 0;
  let skipped = 0;
  let statementsPersisted = 0;
  let statementsNeedReview = 0;

  for (const id of ids) {
    // El corte va ANTES de empezar un correo — nunca en el medio — y jamas
    // en el primero: asi `seen` es siempre un prefijo exacto de `ids` (lo que
    // el checkpoint usa para saber que falta) y un presupuesto ridiculamente
    // corto igual avanza uno en vez de trabar el backlog para siempre.
    if (seen > 0 && monotonicNow() - startedAtMs >= budgetMs) break;
    seen += 1;
    const msg = await withSpan("ingest.gmail_get_message", { gmail_id: id }, () => gmailClient.getMessage(id));
    threadIdByMsgId.set(msg.gmail_msg_id, msg.gmail_thread_id);
    const email = toInboundEmail(msg);
    const parseResult = parseEmail(email);

    if (parseResult.kind === "ignored") {
      skipped += 1;
      continue;
    }

    if (parseResult.kind === "statement") {
      const result = ingestStatementEmail(db, email);
      if (result.persisted) {
        statementsPersisted += 1;
      } else {
        // F1-05's persisted:false branch: not a recognizable statement —
        // tracked as needs-review, never treated as a valid statement.
        statementsNeedReview += 1;
      }
      continue;
    }

    if (parseResult.kind === "reverso") {
      const fields = extractReversoFields(email.body);
      if (fields.amount === null) {
        unresolvedReversos.push({
          gmail_msg_id: email.gmail_msg_id,
          gmail_thread_id: email.gmail_thread_id ?? null,
          ts: email.ts,
          direction: "in",
          type: "reverso",
          amount: null,
          account: fields.account,
          counterparty: fields.counterparty,
          raw_subject: parseResult.raw_subject,
          needs_review: true,
          source: "deterministic",
        });
        continue;
      }
      reversoCandidates.push({
        raw_subject: parseResult.raw_subject,
        amount: fields.amount,
        account: fields.account,
        counterparty: fields.counterparty,
        ts: email.ts,
        gmail_msg_id: email.gmail_msg_id,
      });
      continue;
    }

    // parseResult.kind === "transaction": cross-validate Claude's
    // amount_text_raw against F1-03's own derived amount (AC2).
    const masked = maskEmailForExtractor(email);
    const extracted = await withSpan("ingest.claude_extract", { gmail_msg_id: email.gmail_msg_id }, () =>
      extractor.extract(masked)
    );
    const validation = validateAmount(parseResult.amount, extracted.amount_text_raw);

    const candidate: ParsedTransaction = validation.ok
      ? parseResult
      : {
          ...parseResult,
          needs_review: true,
          review_reason: parseResult.needs_review ? parseResult.review_reason : "claude_amount_mismatch",
        };

    transactionCandidates.push({ ...candidate, gmail_msg_id: email.gmail_msg_id, ts: email.ts });
  }

  const reconciled = reconcile(transactionCandidates, reversoCandidates, { titular });

  let inserted = 0;
  let duplicates = 0;
  let needsReview = 0;
  const insertedIds: number[] = [];

  /**
   * Review fix (TASK-017 HIGH-1, part a): `insertTransaction` alone is
   * insert-only (`ON CONFLICT DO NOTHING`), so when `tx`'s gmail_msg_id was
   * already persisted in an earlier run, a plain insert silently drops any
   * new information this run's reconcile pass learned about it (most
   * notably: a reverso that arrived later and now marks it is_reversed).
   * When that happens, upgrade the persisted row's is_reversed/needs_review
   * via `updateTransactionReviewFlags` — never amount or any other field,
   * and never downgrade a flag that's already true.
   */
  // The user's merchant rules, read once per run rather than once per row.
  const categoryRules = listCategoryRules(db);

  const persist = (tx: NewTransaction) => {
    const result = insertTransaction(db, tx);
    let finalNeedsReview = Boolean(result.row.needs_review);

    if (result.inserted) {
      inserted += 1;
      insertedIds.push(result.row.id);
      finalNeedsReview = Boolean(tx.needs_review);
    } else {
      duplicates += 1;
      const upgrade: { is_reversed?: boolean; needs_review?: boolean } = {};
      if (tx.is_reversed && !result.row.is_reversed) upgrade.is_reversed = true;
      if (tx.needs_review && !result.row.needs_review) upgrade.needs_review = true;
      if (Object.keys(upgrade).length > 0) {
        updateTransactionReviewFlags(db, tx.gmail_msg_id, upgrade);
        finalNeedsReview = finalNeedsReview || Boolean(upgrade.needs_review);
      }
    }

    if (finalNeedsReview) needsReview += 1;
  };

  for (const tx of reconciled.transactions) {
    persist(toNewTransaction(tx, threadIdByMsgId.get(tx.gmail_msg_id) ?? null, "hybrid", categoryRules));
  }

  // A matched reversal (F1-04) leaves an auditable trace of the reverso
  // itself — never summed, and not a needs_review item (it's fully
  // resolved) — so a reverso that arrives in a later run than its consumo
  // is never silently lost (TASK-017 HIGH-1, part b).
  for (const match of reconciled.reversalsApplied) {
    persist(reversoAuditRow(match.reverso, threadIdByMsgId.get(match.reverso.gmail_msg_id ?? "") ?? null, false));
  }

  // Ambiguous/unmatched reversals (F1-04) surface as their own needs_review
  // rows so a human sees them at /api/review instead of the reverso
  // silently disappearing.
  for (const ambiguous of reconciled.ambiguous) {
    persist(reversoAuditRow(ambiguous, threadIdByMsgId.get(ambiguous.gmail_msg_id ?? "") ?? null, true));
  }
  for (const unmatched of reconciled.unmatched) {
    persist(reversoAuditRow(unmatched, threadIdByMsgId.get(unmatched.gmail_msg_id ?? "") ?? null, true));
  }
  for (const unresolved of unresolvedReversos) {
    persist(unresolved);
  }

  return {
    seen,
    inserted,
    duplicates,
    needsReview,
    skipped,
    statementsPersisted,
    statementsNeedReview,
    reversalsApplied: reconciled.reversalsApplied.length,
    insertedIds,
  };
}
