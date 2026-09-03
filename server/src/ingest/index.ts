export type { EmailExtractor, ExtractedEmail, GmailClient, GmailMessage, TokenStore } from "./types.js";
export { maskAccountNumbers, maskEmailForExtractor } from "./mask.js";
export { deriveAmountFromText, validateAmount } from "./amount-validate.js";
export type { AmountValidationResult } from "./amount-validate.js";
export { extractReversoFields } from "./reverso-extract.js";
export type { ExtractedReversoFields } from "./reverso-extract.js";
export { buildSearchQuery, ingestBatch, ingestOnce, searchMessageIds } from "./pipeline.js";
export type { IngestBatchOptions, IngestBatchResult, IngestDeps, IngestOptions, IngestSummary } from "./pipeline.js";
export { createGoogleapisGmailClient } from "./googleapis-gmail-client.js";
export { DEFAULT_HEAL_LIMIT, healCounterparties } from "./heal-counterparty.js";
export type {
  HealCounterpartiesDeps,
  HealCounterpartiesOptions,
  HealCounterpartiesResult,
} from "./heal-counterparty.js";
export type { GoogleapisGmailClientConfig } from "./googleapis-gmail-client.js";
export { createClaudeEmailExtractor, ExtractedEmailSchema } from "./claude-email-extractor.js";
export { InMemoryTokenStore, KeyringTokenStore } from "./token-store.js";
export { emitMetric, withSpan } from "./telemetry.js";
export type { SpanContext } from "./telemetry.js";
