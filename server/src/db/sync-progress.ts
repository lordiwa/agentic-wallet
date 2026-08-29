/**
 * Checkpoint del sync incremental: la memoria de "voy por la mitad del
 * backlog" que le permite a `sync/run-sync.ts` drenar el buzon de a lotes.
 *
 * Vive separado de `repository.ts` (que es el ledger) porque es estado de
 * proceso, no dato financiero, y separado de `sync_state` porque responde
 * otra pregunta: `sync_state.last_sync_ts` es "hasta cuando ya lei"; esto es
 * "que me falta de la lectura en curso". Ver el comentario de la tabla en
 * `schema.ts` para el porque del diseño.
 *
 * Nada aqui sabe de Gmail ni de Claude: recibe ids y contadores y los
 * persiste. Toda la politica (tamaño de lote, cuando cerrar el backlog) es
 * de `run-sync.ts`.
 */
import type Database from "better-sqlite3";

/** Contadores acumulados del backlog. Es la forma de `IngestSummary`, pero
 * tipada laxo a proposito: la capa de base no depende de `ingest/`. */
export type SyncTotals = Record<string, number>;

export interface SyncProgress {
  /** Cota inferior de la ventana de Gmail con la que se armo este backlog. */
  sinceTs: string;
  /** "Ahora" del momento en que se abrio el backlog — el valor que ira a
   * `sync_state.last_sync_ts` cuando termine de drenarse. */
  startedAt: string;
  /** Correos que tenia el backlog al abrirse. */
  total: number;
  /** Correos ya procesados y persistidos. */
  processed: number;
  /** gmail_msg_id que todavia faltan, en orden. */
  pendingIds: string[];
  /** Suma de los resumenes de cada lote drenado hasta ahora. */
  totals: SyncTotals;
  updatedAt: string;
}

interface SyncProgressRow {
  since_ts: string;
  started_at: string;
  total: number;
  processed: number;
  pending_ids: string;
  totals: string;
  updated_at: string;
}

/** Un JSON corrupto en el checkpoint no debe tumbar el sync: se lee como
 * "no hay nada", que hace que `run-sync` abra un backlog nuevo. Reprocesar
 * es gratis (la persistencia es idempotente por gmail_msg_id). */
function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toProgress(row: SyncProgressRow): SyncProgress {
  return {
    sinceTs: row.since_ts,
    startedAt: row.started_at,
    total: row.total,
    processed: row.processed,
    pendingIds: parseJson<string[]>(row.pending_ids, []),
    totals: parseJson<SyncTotals>(row.totals, {}),
    updatedAt: row.updated_at,
  };
}

export function getSyncProgress(db: Database.Database): SyncProgress | undefined {
  const row = db.prepare("SELECT * FROM sync_progress WHERE id = 1").get() as SyncProgressRow | undefined;
  return row ? toProgress(row) : undefined;
}

export interface StartSyncProgressInput {
  sinceTs: string;
  startedAt: string;
  pendingIds: readonly string[];
}

/**
 * Abre un backlog nuevo, pisando cualquier checkpoint anterior (fila unica,
 * `CHECK (id = 1)`): no existen dos drenados en paralelo.
 */
export function startSyncProgress(db: Database.Database, input: StartSyncProgressInput): SyncProgress {
  const progress: SyncProgress = {
    sinceTs: input.sinceTs,
    startedAt: input.startedAt,
    total: input.pendingIds.length,
    processed: 0,
    pendingIds: [...input.pendingIds],
    totals: {},
    updatedAt: input.startedAt,
  };
  write(db, progress);
  return progress;
}

export interface AdvanceSyncProgressInput {
  /** Lo que queda despues del lote. */
  pendingIds: readonly string[];
  /** Acumulado, no delta: cuantos correos del backlog ya se procesaron. */
  processed: number;
  totals: SyncTotals;
  updatedAt: string;
}

/**
 * Anota el avance de un lote. Se llama DESPUES de persistir el lote, nunca
 * antes: si el proceso muere en el medio, el lote se repite y la
 * persistencia idempotente lo absorbe — al reves se perderian correos.
 */
export function advanceSyncProgress(db: Database.Database, input: AdvanceSyncProgressInput): void {
  const current = getSyncProgress(db);
  if (!current) return;
  write(db, {
    ...current,
    processed: input.processed,
    pendingIds: [...input.pendingIds],
    totals: input.totals,
    updatedAt: input.updatedAt,
  });
}

/** Backlog terminado: sin checkpoint, el proximo sync vuelve a ser el
 * incremental barato de siempre (una ventana chica desde `last_sync_ts`). */
export function clearSyncProgress(db: Database.Database): void {
  db.prepare("DELETE FROM sync_progress WHERE id = 1").run();
}

function write(db: Database.Database, progress: SyncProgress): void {
  db.prepare(
    `INSERT INTO sync_progress (id, since_ts, started_at, total, processed, pending_ids, totals, updated_at)
     VALUES (1, @since_ts, @started_at, @total, @processed, @pending_ids, @totals, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       since_ts = excluded.since_ts,
       started_at = excluded.started_at,
       total = excluded.total,
       processed = excluded.processed,
       pending_ids = excluded.pending_ids,
       totals = excluded.totals,
       updated_at = excluded.updated_at`
  ).run({
    since_ts: progress.sinceTs,
    started_at: progress.startedAt,
    total: progress.total,
    processed: progress.processed,
    pending_ids: JSON.stringify(progress.pendingIds),
    totals: JSON.stringify(progress.totals),
    updated_at: progress.updatedAt,
  });
}
