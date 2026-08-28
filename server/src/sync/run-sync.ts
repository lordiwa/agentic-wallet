/**
 * The manual sync job (spec §6.1/§7, F1-08): orchestrates one ingestion pass
 * as a job -- reads `last_sync_ts` from `sync_state`, invokes F1-07's
 * `ingestOnce`, and advances `sync_state` on success. `ingestOnce` itself
 * deliberately never touches `sync_state` (see pipeline.ts's module doc) --
 * that boundary-crossing is this module's whole job, kept as a thin wrapper
 * so `ingestOnce` stays a pure, fully-mockable unit.
 *
 * Pagination (pages of 50, nextPageToken) already lives in F1-07's
 * `GmailClient` (googleapis-gmail-client.ts) / `ingestOnce`'s consumption of
 * `searchMessageIds` -- nothing here re-implements or needs to know about it.
 */
import { ingestOnce } from "../ingest/index.js";
import type { IngestDeps, IngestSummary } from "../ingest/index.js";
import { getSyncState, setSyncState } from "../db/repository.js";

export interface RunSyncOptions {
  /** ISO-8601 timestamp recorded as the new `last_sync_ts` on success.
   * Defaults to `new Date().toISOString()`; injectable so tests get a
   * deterministic, assertable value. */
  now?: string;
}

/** No `sync_state` row yet (first run ever): start from the beginning of
 * time rather than requiring a caller-supplied bound. Gmail's own message
 * history obviously never predates this, so it's equivalent to "no filter". */
const EPOCH = "1970-01-01T00:00:00.000Z";

/**
 * Runs one sync pass: determines `sinceTs` from `sync_state.last_sync_ts`
 * (or `EPOCH` on first run), delegates to `ingestOnce`, and -- only if that
 * succeeds -- atomically upserts `sync_state` with the new `last_sync_ts`
 * and a small JSON summary of what happened (`last_history`).
 *
 * If `ingestOnce` throws, this function propagates the error and never
 * writes `sync_state`, so `last_sync_ts` is NOT advanced -- the next sync
 * naturally retries the same window instead of silently skipping it.
 * Reusing that same window is safe: `ingestOnce` is idempotent by
 * `gmail_msg_id` (AC4/AC5 of F1-07), so re-seeing already-ingested mail
 * never duplicates a transaction.
 */
export async function runSync(deps: IngestDeps, options: RunSyncOptions = {}): Promise<IngestSummary> {
  const now = options.now ?? new Date().toISOString();
  const state = getSyncState(deps.db);
  const sinceTs = state?.last_sync_ts ?? EPOCH;

  const summary = await ingestOnce(deps, { sinceTs });

  setSyncState(deps.db, { last_sync_ts: now, last_history: JSON.stringify(summary) });
  return summary;
}
