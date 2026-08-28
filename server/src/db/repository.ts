import type Database from "better-sqlite3";

export interface TransactionRow {
  id: number;
  gmail_msg_id: string;
  gmail_thread_id: string | null;
  ts: string;
  direction: string;
  type: string;
  amount: number;
  currency: string;
  counterparty: string | null;
  account: string | null;
  /** Titular como lo escribe el banco; null cuando el correo no lo trae. */
  account_holder: string | null;
  category: string | null;
  raw_subject: string | null;
  is_reversed: number;
  is_internal: number;
  needs_review: number;
  source: string;
  created_at: string;
}

export interface NewTransaction {
  gmail_msg_id: string;
  gmail_thread_id?: string | null;
  ts: string;
  direction: string;
  type: string;
  amount: number;
  currency?: string;
  counterparty?: string | null;
  account?: string | null;
  account_holder?: string | null;
  category?: string | null;
  raw_subject?: string | null;
  is_reversed?: boolean;
  is_internal?: boolean;
  needs_review?: boolean;
  source?: string;
}

export interface StatementRow {
  id: number;
  card_mask: string | null;
  issue_date: string | null;
  balance: number | null;
  min_payment: number | null;
  due_date: string | null;
  gmail_msg_id: string | null;
}

export interface NewStatement {
  gmail_msg_id?: string | null;
  card_mask?: string | null;
  issue_date?: string | null;
  balance?: number | null;
  min_payment?: number | null;
  due_date?: string | null;
}

export interface InsertResult<T> {
  inserted: boolean;
  row: T;
}

export interface SyncStateRow {
  id: number;
  last_sync_ts: string | null;
  last_history: string | null;
}

export interface SyncStateUpdate {
  last_sync_ts: string | null;
  last_history: string | null;
}

export interface ListTransactionsFilter {
  from?: string;
  to?: string;
  type?: string;
  direction?: string;
  counterparty?: string;
  limit?: number;
  offset?: number;
}

/** Idempotent insert keyed on gmail_msg_id: reinserting the same message is a no-op. */
export function insertTransaction(db: Database.Database, tx: NewTransaction): InsertResult<TransactionRow> {
  const result = db
    .prepare(
      `INSERT INTO transactions (
        gmail_msg_id, gmail_thread_id, ts, direction, type, amount, currency,
        counterparty, account, account_holder, category, raw_subject, is_reversed, is_internal, needs_review, source
      ) VALUES (
        @gmail_msg_id, @gmail_thread_id, @ts, @direction, @type, @amount, @currency,
        @counterparty, @account, @account_holder, @category, @raw_subject, @is_reversed, @is_internal, @needs_review, @source
      )
      ON CONFLICT(gmail_msg_id) DO NOTHING`
    )
    .run({
      gmail_msg_id: tx.gmail_msg_id,
      gmail_thread_id: tx.gmail_thread_id ?? null,
      ts: tx.ts,
      direction: tx.direction,
      type: tx.type,
      amount: tx.amount,
      currency: tx.currency ?? "USD",
      counterparty: tx.counterparty ?? null,
      account: tx.account ?? null,
      account_holder: tx.account_holder ?? null,
      category: tx.category ?? null,
      raw_subject: tx.raw_subject ?? null,
      is_reversed: tx.is_reversed ? 1 : 0,
      is_internal: tx.is_internal ? 1 : 0,
      needs_review: tx.needs_review ? 1 : 0,
      source: tx.source ?? "claude",
    });

  const row = getTransactionByGmailMsgId(db, tx.gmail_msg_id);
  if (!row) {
    // Can't happen: we just inserted or the row already existed under this id.
    throw new Error(`insertTransaction: no row found for gmail_msg_id ${tx.gmail_msg_id}`);
  }
  return { inserted: result.changes === 1, row };
}

export function getTransactionByGmailMsgId(db: Database.Database, gmailMsgId: string): TransactionRow | undefined {
  return db.prepare("SELECT * FROM transactions WHERE gmail_msg_id = ?").get(gmailMsgId) as
    | TransactionRow
    | undefined;
}

export interface ReviewFlagsUpdate {
  is_reversed?: boolean;
  needs_review?: boolean;
}

/**
 * Updates ONLY `is_reversed`/`needs_review` on an already-persisted
 * transaction, keyed by `gmail_msg_id` — never `amount` or any other field.
 * `insertTransaction` alone is insert-only (`ON CONFLICT DO NOTHING`), so a
 * later ingestion pass that reconciles a row already persisted in an
 * earlier run (e.g. a reverso email arriving after its consumo was first
 * ingested — TASK-017 review fix, HIGH-1) has no other way to correct it;
 * this is that narrow, scoped escape hatch. A no-op call (both flags
 * omitted) is safe and never throws. Returns the current row, or
 * `undefined` if no row exists for `gmailMsgId`.
 */
export function updateTransactionReviewFlags(
  db: Database.Database,
  gmailMsgId: string,
  flags: ReviewFlagsUpdate
): TransactionRow | undefined {
  const sets: string[] = [];
  const params: Record<string, unknown> = { gmail_msg_id: gmailMsgId };

  if (flags.is_reversed !== undefined) {
    sets.push("is_reversed = @is_reversed");
    params.is_reversed = flags.is_reversed ? 1 : 0;
  }
  if (flags.needs_review !== undefined) {
    sets.push("needs_review = @needs_review");
    params.needs_review = flags.needs_review ? 1 : 0;
  }

  if (sets.length > 0) {
    db.prepare(`UPDATE transactions SET ${sets.join(", ")} WHERE gmail_msg_id = @gmail_msg_id`).run(params);
  }

  return getTransactionByGmailMsgId(db, gmailMsgId);
}

export function listTransactions(db: Database.Database, filter: ListTransactionsFilter = {}): TransactionRow[] {
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

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.limit = filter.limit ?? 100;
  params.offset = filter.offset ?? 0;

  return db
    .prepare(`SELECT * FROM transactions ${where} ORDER BY ts DESC LIMIT @limit OFFSET @offset`)
    .all(params) as TransactionRow[];
}

/** Reads the single sync_state row (id=1), or undefined if F1-08's sync job has never completed. */
export function getSyncState(db: Database.Database): SyncStateRow | undefined {
  return db.prepare("SELECT * FROM sync_state WHERE id = 1").get() as SyncStateRow | undefined;
}

/**
 * Upserts the single sync_state row (id=1, `CHECK (id = 1)` in the schema)
 * atomically — INSERT..ON CONFLICT DO UPDATE runs as one statement, so a
 * concurrent reader never observes a torn write between last_sync_ts and
 * last_history. Used by F1-08's sync job to advance sync_state only after a
 * successful ingestOnce run.
 */
export function setSyncState(db: Database.Database, state: SyncStateUpdate): void {
  db.prepare(
    `INSERT INTO sync_state (id, last_sync_ts, last_history) VALUES (1, @last_sync_ts, @last_history)
     ON CONFLICT(id) DO UPDATE SET last_sync_ts = excluded.last_sync_ts, last_history = excluded.last_history`
  ).run(state);
}

/**
 * Idempotent insert keyed on gmail_msg_id: reinserting the same statement is
 * a no-op. Statements are always sourced from a specific email (F1-05), so a
 * missing gmail_msg_id is rejected up front — before any write — rather than
 * inserting a NULL-keyed row and only discovering the problem on the
 * post-insert lookup. (F1-02 review: the old throw-after-write shape let a
 * caller retry duplicate a phantom row.)
 */
export function insertStatement(db: Database.Database, statement: NewStatement): InsertResult<StatementRow> {
  const gmailMsgId = statement.gmail_msg_id ?? null;
  if (!gmailMsgId) {
    throw new Error("insertStatement: gmail_msg_id is required");
  }

  const result = db
    .prepare(
      `INSERT INTO statements (gmail_msg_id, card_mask, issue_date, balance, min_payment, due_date)
       VALUES (@gmail_msg_id, @card_mask, @issue_date, @balance, @min_payment, @due_date)
       ON CONFLICT(gmail_msg_id) DO NOTHING`
    )
    .run({
      gmail_msg_id: gmailMsgId,
      card_mask: statement.card_mask ?? null,
      issue_date: statement.issue_date ?? null,
      balance: statement.balance ?? null,
      min_payment: statement.min_payment ?? null,
      due_date: statement.due_date ?? null,
    });

  const row = db.prepare("SELECT * FROM statements WHERE gmail_msg_id = ?").get(gmailMsgId) as
    | StatementRow
    | undefined;
  if (!row) {
    // Can't happen: we just inserted or the row already existed under this id.
    throw new Error(`insertStatement: no row found for gmail_msg_id ${gmailMsgId}`);
  }
  return { inserted: result.changes === 1, row };
}
