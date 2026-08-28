/**
 * Boundary contracts for the hybrid-ingestion pipeline (spec §6.1/§7,
 * F1-07). Two independent boundaries get mocked in tests: `GmailClient`
 * (read-only Gmail I/O) and `EmailExtractor` (Claude Agent SDK structured
 * extraction). `TokenStore` is a third, smaller boundary used only by the
 * real `GmailClient` construction path (OAuth refresh-token persistence),
 * never by `pipeline.ts` directly.
 */

/** One Gmail message, already decoded to plain text (no more base64url). */
export interface GmailMessage {
  gmail_msg_id: string;
  gmail_thread_id: string | null;
  subject: string;
  body: string;
  /** ISO-8601 timestamp Gmail assigned the message (its `internalDate`). */
  ts: string;
}

/**
 * Read-only Gmail access (spec: "Gmail SOLO LECTURA"). Only `search` and
 * `get` exist on this interface by design — enforcing read-only at the code
 * layer, not just via the OAuth scope (see the claude-agent-sdk-gmail
 * skill's Best Practices).
 */
export interface GmailClient {
  /** Returns ALL message ids matching `query`, paginating internally. */
  searchMessageIds(query: string): Promise<string[]>;
  getMessage(id: string): Promise<GmailMessage>;
}

/**
 * Claude's per-email structured output. Per the hybrid-ingestion "regla de
 * oro": `amount_text_raw` is the EXACT amount substring as it appeared in
 * the email (e.g. "USD 9.42") — NEVER a number Claude has already
 * interpreted. The deterministic layer (amount-validate.ts) is the only
 * thing allowed to turn it into money.
 */
export interface ExtractedEmail {
  amount_text_raw: string | null;
  counterparty?: string | null;
}

/** The agent does NOT persist directly (AC1) — it only classifies/extracts. */
export interface EmailExtractor {
  extract(email: Pick<GmailMessage, "subject" | "body">): Promise<ExtractedEmail>;
}

/** OAuth refresh-token persistence, used by the real Gmail client wiring only. */
export interface TokenStore {
  save(refreshToken: string): Promise<void>;
  load(): Promise<string | null>;
}
