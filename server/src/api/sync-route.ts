/**
 * POST /api/sync (F1-08 / TASK-018): manually triggers one sync pass
 * (`runSync` -> F1-07's `ingestOnce`) and returns a summary (emails seen,
 * new transactions, needs_review, ...).
 *
 * `getRunner` returns `null` when Gmail/Claude credentials aren't
 * configured (see sync/build-sync-runner.ts) -- the route reports that as a
 * clean 503 instead of constructing a GmailClient/EmailExtractor that would
 * throw mid-request. Any other failure from the runner (e.g. a real Gmail/
 * Claude call rejecting) is caught and reported as a clean 500 -- this route
 * must never crash the server with an unhandled rejection.
 *
 * A simple in-process boolean guards against two overlapping POSTs
 * double-running the sync job. Fase 1 is local/single-user, so this
 * in-memory flag (no distributed lock, no queue) is enough.
 */
import { Router } from "express";
import type { IngestSummary } from "../ingest/index.js";

export type SyncRunner = () => Promise<IngestSummary>;

export function createSyncRouter(getRunner: () => SyncRunner | null): Router {
  const router = Router();
  let running = false;

  router.post("/sync", (_req, res) => {
    const runner = getRunner();
    if (!runner) {
      res.status(503).json({ error: "gmail_not_configured" });
      return;
    }
    if (running) {
      res.status(409).json({ error: "sync_already_running" });
      return;
    }

    running = true;
    runner()
      .then((summary) => {
        res.json({ summary });
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: "sync_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        running = false;
      });
  });

  return router;
}
