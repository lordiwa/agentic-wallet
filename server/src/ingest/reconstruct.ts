/**
 * Deterministic ledger reconstruction (F3, TASK-040): ingests a batch of
 * already-fetched Gmail messages (JSON, shape = GmailMessage[]) through the
 * SAME parse -> reconcile -> categorize -> statement -> persist pipeline as
 * pipeline.ts's `runIngest`, but WITHOUT the Claude EmailExtractor
 * cross-check (pipeline.ts's AC2 step). Built for the finance-copilot-via-
 * Claude-Code workflow: the assistant reads Produbanco emails through its
 * own session's Gmail MCP tools (no app-owned Gmail OAuth, no Claude
 * credential inside the app) and hands the raw batch here.
 *
 * There is no live Claude amount to cross-validate in this path, so the
 * deterministic parser (parser/produbanco.ts) is the SOLE source of truth
 * for every amount -- this is what keeps the "never invent amounts"
 * guarantee intact even without the extractor: the assistant only supplies
 * the raw email text it read, and the same strict regex parser that
 * pipeline.ts trusts as ground truth is the only thing that turns it into
 * money. A transaction candidate's needs_review is therefore exactly
 * whatever `parseEmail` itself set (unparseable amount, etc.) -- never
 * upgraded by a mismatch check, because there is nothing here to mismatch
 * against.
 *
 * Mirrors pipeline.ts's runIngest exactly for the ignored/statement/reverso
 * branches, reconcile, categorize, and the idempotent persist (insert +
 * flag-upgrade) logic. Reuses parseEmail/reconcile/categorize/
 * ingestStatementEmail/extractReversoFields/insertTransaction/
 * updateTransactionReviewFlags/IngestSummary as-is. pipeline.ts's own
 * `toNewTransaction`/`reversoAuditRow`/`persist` helpers are module-private
 * (not exported) -- they're re-derived below rather than exported out of
 * pipeline.ts, which stays untouched (this ticket's constraint). No Gmail
 * search/read here either: the batch is already fetched, so this iterates
 * `messages` directly and stays fully synchronous (no external I/O to
 * await).
 */
import type Database from "better-sqlite3";
import { categorize, type EstablishmentRule } from "../category/categorize.js";
import { listCategoryRules } from "../category/rules-repository.js";
import { insertTransaction, updateTransactionReviewFlags } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { parseEmail } from "../parser/index.js";
import type { InboundEmail } from "../parser/types.js";
import { reconcile } from "../rules/reconcile.js";
import type { ReconcilableTransaction, ReversoCandidate } from "../rules/reconcile.js";
import { ingestStatementEmail } from "../statement/ingest-statement.js";
import type { IngestSummary } from "./pipeline.js";
import { extractReversoFields } from "./reverso-extract.js";
import { emitMetric } from "./telemetry.js";
import type { GmailMessage } from "./types.js";

function toInboundEmail(msg: GmailMessage): InboundEmail {
  return {
    subject: msg.subject,
    body: msg.body,
    gmail_msg_id: msg.gmail_msg_id,
    gmail_thread_id: msg.gmail_thread_id,
    ts: msg.ts,
  };
}

/** Same shape as pipeline.ts's private `toNewTransaction`, minus the
 * hybrid/deterministic `source` parameter -- every row reconstructed here
 * skipped the Claude cross-check by construction, so `source` is always
 * 'deterministic' (never the misleading 'hybrid', which implies Claude saw
 * it -- see pipeline.ts's LOW-2 review fix doc). */
function toNewTransaction(
  tx: ReconcilableTransaction,
  threadId: string | null,
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
    category: categorize({ type: tx.type, counterparty: tx.counterparty, is_internal: tx.is_internal }, rules),
    raw_subject: tx.raw_subject,
    is_reversed: tx.is_reversed ?? false,
    is_internal: tx.is_internal ?? false,
    needs_review: tx.needs_review,
    source: "deterministic",
  };
}

/** Same shape as pipeline.ts's private `reversoAuditRow` -- a matched
 * reverso, or an ambiguous/unmatched one, always persists as its own
 * auditable `type:'reverso'` row, never summed as spend. */
function reversoAuditRow(candidate: ReversoCandidate, threadId: string | null, needsReview: boolean): NewTransaction {
  return {
    gmail_msg_id: candidate.gmail_msg_id ?? `reverso-${candidate.ts}-${candidate.amount}`,
    gmail_thread_id: threadId,
    ts: candidate.ts,
    direction: "in",
    type: "reverso",
    amount: candidate.amount,
    account: candidate.account,
    raw_subject: candidate.raw_subject,
    needs_review: needsReview,
    source: "deterministic",
  };
}

/**
 * Ingests `messages` through the deterministic pipeline and returns the same
 * `IngestSummary` shape pipeline.ts's `ingestOnce` does. Persistence is
 * idempotent by `gmail_msg_id`: calling this again with an overlapping or
 * identical batch inserts 0 new rows for anything already persisted, and
 * only ever upgrades `is_reversed`/`needs_review` flags -- never `amount` or
 * any other field (mirrors pipeline.ts's HIGH-1 review fix).
 */
export function reconstructFromMessages(
  db: Database.Database,
  messages: GmailMessage[],
  titular: string
): IngestSummary {
  const transactionCandidates: ReconcilableTransaction[] = [];
  const reversoCandidates: ReversoCandidate[] = [];
  // Reversos whose body had no parseable "Monto:" field can't become a valid
  // ReversoCandidate (amount is required) -- persisted directly as a
  // needs_review row instead of vanishing.
  const unresolvedReversos: NewTransaction[] = [];
  const threadIdByMsgId = new Map<string, string | null>();

  let seen = 0;
  let skipped = 0;
  let statementsPersisted = 0;
  let statementsNeedReview = 0;

  for (const msg of messages) {
    seen += 1;
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
        // ingestStatementEmail's persisted:false branch: not a recognizable
        // statement -- tracked as needs-review, never treated as valid.
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
        ts: email.ts,
        gmail_msg_id: email.gmail_msg_id,
      });
      continue;
    }

    // parseResult.kind === "transaction": NO EmailExtractor cross-check --
    // parseEmail's own amount/needs_review go straight in as the candidate
    // (this is the whole point of this entrypoint vs. pipeline.ts).
    transactionCandidates.push({ ...parseResult, gmail_msg_id: email.gmail_msg_id, ts: email.ts });
  }

  const reconciled = reconcile(transactionCandidates, reversoCandidates, { titular });

  let inserted = 0;
  let duplicates = 0;
  let needsReview = 0;

  /**
   * Same idempotent insert-or-upgrade logic as pipeline.ts's private
   * `persist`: a plain insert alone (`ON CONFLICT DO NOTHING`) silently
   * drops any new information a later run's reconcile pass learned about an
   * already-persisted row (most notably a reverso that arrived later and
   * now marks it is_reversed) -- so a duplicate hit upgrades
   * is_reversed/needs_review via `updateTransactionReviewFlags` instead,
   * never touching amount or any other field, and never downgrading a flag
   * that's already true.
   */
  // The user's merchant rules, read once per run rather than once per row.
  const categoryRules = listCategoryRules(db);

  const persist = (tx: NewTransaction) => {
    const result = insertTransaction(db, tx);
    let finalNeedsReview = Boolean(result.row.needs_review);

    if (result.inserted) {
      inserted += 1;
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
    persist(toNewTransaction(tx, threadIdByMsgId.get(tx.gmail_msg_id) ?? null, categoryRules));
  }

  // A matched reversal leaves an auditable trace of the reverso itself --
  // never summed, and not a needs_review item (it's fully resolved).
  for (const match of reconciled.reversalsApplied) {
    persist(reversoAuditRow(match.reverso, threadIdByMsgId.get(match.reverso.gmail_msg_id ?? "") ?? null, false));
  }

  // Ambiguous/unmatched reversals surface as their own needs_review rows so
  // a human sees them at /api/review instead of silently disappearing.
  for (const ambiguous of reconciled.ambiguous) {
    persist(reversoAuditRow(ambiguous, threadIdByMsgId.get(ambiguous.gmail_msg_id ?? "") ?? null, true));
  }
  for (const unmatched of reconciled.unmatched) {
    persist(reversoAuditRow(unmatched, threadIdByMsgId.get(unmatched.gmail_msg_id ?? "") ?? null, true));
  }
  for (const unresolved of unresolvedReversos) {
    persist(unresolved);
  }

  const summary: IngestSummary = {
    seen,
    inserted,
    duplicates,
    needsReview,
    skipped,
    statementsPersisted,
    statementsNeedReview,
    reversalsApplied: reconciled.reversalsApplied.length,
  };
  emitMetric("reconstruct.summary", { ...summary });
  return summary;
}
