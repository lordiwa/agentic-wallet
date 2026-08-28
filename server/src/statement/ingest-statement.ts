import type Database from "better-sqlite3";
import { insertStatement } from "../db/repository.js";
import type { InsertResult, StatementRow } from "../db/repository.js";
import { parseStatementBody } from "./parse-statement.js";
import type { ParsedStatement } from "./parse-statement.js";
import type { InboundEmail } from "../parser/types.js";

/**
 * A parse that produced none of the three fields that make a statement
 * useful (balance, min_payment, due_date) is not a recognizable Produbanco
 * statement — persisting it would put an all-null row in `statements` that
 * a payment strategy could read as "no balance due". Nothing is written;
 * the caller (a future ticket, F1-07) is expected to route this for review
 * instead.
 */
export type IngestStatementResult =
  | ({ persisted: true } & InsertResult<StatementRow>)
  | { persisted: false; needs_review: true; reason: "no_recognizable_statement_fields"; parsed: ParsedStatement };

function isUnrecognizable(parsed: ParsedStatement): boolean {
  return parsed.balance === null && parsed.min_payment === null && parsed.due_date === null;
}

/**
 * Parses a Produbanco "Estado de Cuenta" email body and persists it as the
 * official statement of record (spec 5.4). Idempotent by `gmail_msg_id` —
 * reparsing the same email is a no-op (delegated to `insertStatement`).
 */
export function ingestStatementEmail(
  db: Database.Database,
  email: Pick<InboundEmail, "gmail_msg_id" | "body">
): IngestStatementResult {
  const parsed = parseStatementBody(email.body);

  if (isUnrecognizable(parsed)) {
    return { persisted: false, needs_review: true, reason: "no_recognizable_statement_fields", parsed };
  }

  const result = insertStatement(db, {
    gmail_msg_id: email.gmail_msg_id,
    card_mask: parsed.card_mask,
    issue_date: parsed.issue_date,
    min_payment: parsed.min_payment,
    due_date: parsed.due_date,
    balance: parsed.balance,
  });
  return { persisted: true, ...result };
}
