/**
 * POST /api/sync (F1-08 / TASK-018): manually triggers one sync pass
 * (`runSync` -> F1-07's `ingestBatch`) and returns a summary (emails seen,
 * new transactions, needs_review, ...) mas el progreso del backlog.
 *
 * Una llamada drena un LOTE, no el buzon entero: cuando `progress.complete`
 * es false hay que volver a llamar (ver sync/run-sync.ts para el porque).
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
import type { SyncResult } from "../sync/run-sync.js";
import { syncBodySchema } from "./schemas.js";
import { createSyncGate, type SyncGate } from "./sync-gate.js";

export interface SyncRunnerOptions {
  /** Cuantos correos como maximo drena esta llamada. Sin valor manda el
   * default del motor / el `.env`. */
  batchSize?: number;
}

/**
 * Una llamada al runner drena UN LOTE del backlog, no el buzon entero (ver
 * sync/run-sync.ts): el resultado trae `progress` para saber si hay que
 * volver a llamar.
 */
export type SyncRunner = (options?: SyncRunnerOptions) => Promise<SyncResult>;

/**
 * `gate` se inyecta para que `GET /api/sync/status` pueda publicar `running`
 * (R9): la guarda es una sola por proceso y la comparten los dos routers. Sin
 * pasarla, cada router se arma la suya — que es lo correcto para un test que
 * monta este router solo.
 */
export function createSyncRouter(getRunner: () => SyncRunner | null, gate: SyncGate = createSyncGate()): Router {
  const router = Router();

  router.post("/sync", (req, res) => {
    const runner = getRunner();
    if (!runner) {
      res.status(503).json({ error: "gmail_not_configured" });
      return;
    }

    // H19: cuantos correos drena esta llamada. El runner ya lo aceptaba; lo
    // unico que faltaba era poder decirlo por HTTP. Sin el campo manda el
    // default del motor, no un numero elegido aca.
    const body = syncBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: "invalid sync body", details: body.error.flatten() });
      return;
    }

    if (!gate.begin()) {
      res.status(409).json({ error: "sync_already_running" });
      return;
    }

    runner({ batchSize: body.data.batch_size })
      .then((summary) => {
        // `progress` se repite fuera de `summary` para que el cliente no
        // tenga que saber que forma tiene el resumen del motor: con
        // `complete:false` hay que volver a pulsar Sincronizar.
        // `inserted_ids` viaja igual de afuera: es a lo que apunta el aviso
        // post-sync de categoria (D7-b), acotado a ESTE lote.
        res.json({ summary, progress: summary.progress, inserted_ids: summary.insertedIds ?? [] });
      })
      .catch((error: unknown) => {
        res.status(500).json({
          error: "sync_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        gate.end();
      });
  });

  return router;
}
