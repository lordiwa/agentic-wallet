/**
 * El sync como job (spec §6.1/§7, F1-08): decide QUE ventana de correo leer,
 * llama a `ingest/`, y avanza el estado. `ingestOnce`/`ingestBatch` nunca
 * tocan `sync_state` (ver la doc de pipeline.ts) — cruzar esa frontera es el
 * trabajo entero de este modulo.
 *
 * SYNC INCREMENTAL CON CHECKPOINT
 * -------------------------------
 * El primer sync de un buzon real no es un caso de borde: son miles de
 * correos, cada uno pasa por Claude, y la corrida entera tarda horas. Hecho
 * de un saque tenia dos problemas fatales para el onboarding: cualquier
 * cliente con timeout (el MCP corta a los 60s) abandonaba la llamada, y como
 * la persistencia recien ocurria al final del loop, no quedaba NADA — cero
 * filas despues de dos horas de trabajo.
 *
 * Por eso una llamada a `runSync` ya no significa "leer todo el buzon", sino
 * "drenar un LOTE del backlog":
 *
 *   1. Si no hay checkpoint, se arma el backlog: una sola busqueda en Gmail
 *      desde `sync_state.last_sync_ts` (o EPOCH la primera vez), y la lista
 *      de ids queda guardada en `sync_progress`.
 *   2. Se procesa el proximo lote (tope por cantidad y por tiempo) y se
 *      PERSISTE. Recien despues se anota el avance en el checkpoint: si el
 *      proceso muere en el medio, el lote se repite y la persistencia
 *      idempotente por `gmail_msg_id` lo absorbe.
 *   3. Cuando el backlog queda vacio se borra el checkpoint y ahi si avanza
 *      `sync_state.last_sync_ts`.
 *
 * Cada llamada devuelve `progress` ({processed, total, remaining, complete}),
 * que es lo que le permite al onboarding decir "procesando 340/1717" y al
 * agente saber que tiene que volver a llamar.
 *
 * El sync de todos los dias no cambia: sin backlog pendiente, la ventana es
 * chica, entra en un lote y se cierra en una sola llamada, igual que antes.
 *
 * `last_sync_ts` se fija en el "ahora" del ARRANQUE del backlog, no en el del
 * ultimo lote: si un drenado empieza a las 10:00 y termina a las 18:00,
 * guardar las 18:00 se comeria en silencio todo lo que llego en el medio.
 *
 * La paginacion de Gmail (paginas de 50, nextPageToken) ya vive en el
 * `GmailClient`; nada de esto la re-implementa.
 */
import { ingestBatch, searchMessageIds } from "../ingest/index.js";
import type { IngestDeps, IngestSummary } from "../ingest/index.js";
import { getSyncState, setSyncState } from "../db/repository.js";
import {
  advanceSyncProgress,
  clearSyncProgress,
  getSyncProgress,
  startSyncProgress,
  type SyncProgress,
} from "../db/sync-progress.js";

export interface RunSyncOptions {
  /** ISO-8601 timestamp del momento de la llamada. Cuando abre un backlog
   * nuevo es el valor que terminara en `last_sync_ts`. Default `new Date()`;
   * inyectable para que los tests tengan algo determinista que afirmar. */
  now?: string;
  /** Tope de correos por llamada. Ver `DEFAULT_SYNC_BATCH_SIZE`. */
  batchSize?: number;
  /** Tope de tiempo de pared por llamada. Ver `DEFAULT_SYNC_MAX_MS`. */
  maxMs?: number;
  /** Reloj monotono en ms, inyectable para que los tests no duerman. */
  monotonicNow?: () => number;
}

/**
 * Cuantos correos como maximo por llamada. Es el tope duro; en la practica
 * manda casi siempre `DEFAULT_SYNC_MAX_MS`, porque un correo de transaccion
 * pasa por Claude y tarda segundos.
 */
export const DEFAULT_SYNC_BATCH_SIZE = 50;

/**
 * Presupuesto de tiempo por llamada. 45s es el numero que hace que esto
 * funcione con el cliente MCP tipico, que corta a los 60s: deja margen para
 * el correo que ya estaba en curso cuando se agoto el presupuesto (el corte
 * es entre correos, nunca en el medio) y para serializar la respuesta.
 */
export const DEFAULT_SYNC_MAX_MS = 45_000;

export interface SyncProgressReport {
  /** Correos del backlog ya procesados y persistidos. */
  processed: number;
  /** Correos que tenia el backlog al abrirse. */
  total: number;
  remaining: number;
  /** false = falta backlog; hay que volver a llamar. */
  complete: boolean;
}

export interface SyncResult extends IngestSummary {
  progress: SyncProgressReport;
  /** Los mismos contadores pero de TODO el backlog, no solo de este lote.
   * Cuando el buzon entra en una sola llamada, es identico al resumen. */
  cumulative: IngestSummary;
}

/** Sin fila en `sync_state` (primera corrida): se lee desde el principio de
 * los tiempos en vez de exigirle una cota al que llama. Ningun buzon es mas
 * viejo que esto, asi que equivale a "sin filtro". */
const EPOCH = "1970-01-01T00:00:00.000Z";

const EMPTY_SUMMARY: IngestSummary = {
  seen: 0,
  inserted: 0,
  duplicates: 0,
  needsReview: 0,
  skipped: 0,
  statementsPersisted: 0,
  statementsNeedReview: 0,
  reversalsApplied: 0,
};

/** Suma campo a campo dos resumenes. `totals` viene del checkpoint tipado
 * laxo (la capa de base no depende de `ingest/`), asi que las claves que
 * falten cuentan como cero. */
function addSummaries(base: Record<string, number>, batch: IngestSummary): IngestSummary {
  const result = { ...EMPTY_SUMMARY };
  for (const key of Object.keys(EMPTY_SUMMARY) as Array<keyof IngestSummary>) {
    result[key] = (base[key] ?? 0) + batch[key];
  }
  return result;
}

/**
 * Drena un lote del backlog. Ver la doc del modulo para el ciclo completo.
 *
 * Si `ingestBatch` revienta, el error se propaga y NO se avanza nada: ni el
 * checkpoint ni `sync_state`. La proxima llamada reintenta exactamente los
 * mismos correos, lo que es seguro porque la persistencia es idempotente por
 * `gmail_msg_id` — y lo que ya se habia drenado en lotes anteriores sigue en
 * la base, que es justamente lo que antes se perdia entero.
 */
export async function runSync(deps: IngestDeps, options: RunSyncOptions = {}): Promise<SyncResult> {
  const now = options.now ?? new Date().toISOString();
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_SYNC_BATCH_SIZE);

  const progress = getSyncProgress(deps.db) ?? (await openBacklog(deps, now));
  const batch = progress.pendingIds.slice(0, batchSize);

  // `seen` es un prefijo exacto del lote (ver IngestSummary.seen): lo que no
  // se alcanzo a atender queda pendiente tal cual para la proxima llamada.
  const summary = batch.length
    ? await ingestBatch(deps, {
        messageIds: batch,
        maxMs: options.maxMs ?? DEFAULT_SYNC_MAX_MS,
        monotonicNow: options.monotonicNow,
      })
    : EMPTY_SUMMARY;

  const pendingIds = progress.pendingIds.slice(summary.seen);
  const processed = progress.processed + summary.seen;
  const cumulative = addSummaries(progress.totals, summary);

  if (pendingIds.length === 0) {
    // Backlog cerrado: se borra el checkpoint y recien ahi avanza la ventana.
    clearSyncProgress(deps.db);
    setSyncState(deps.db, { last_sync_ts: progress.startedAt, last_history: JSON.stringify(cumulative) });
  } else {
    // El spread es el que le da al checkpoint la forma laxa que espera
    // (`Record<string, number>`): la capa de base no conoce `IngestSummary`.
    advanceSyncProgress(deps.db, { pendingIds, processed, totals: { ...cumulative }, updatedAt: now });
  }

  return {
    ...summary,
    cumulative,
    progress: {
      processed,
      total: progress.total,
      remaining: pendingIds.length,
      complete: pendingIds.length === 0,
    },
  };
}

/** Arma el backlog: una sola busqueda en Gmail para todo el drenado. */
async function openBacklog(deps: IngestDeps, now: string): Promise<SyncProgress> {
  const sinceTs = getSyncState(deps.db)?.last_sync_ts ?? EPOCH;
  const ids = await searchMessageIds(deps, sinceTs);
  // De-duplicado: la ventana de busqueda se solapa a proposito (ver
  // buildSearchQuery) y una pagina repetida no debe inflar el total.
  return startSyncProgress(deps.db, { sinceTs, startedAt: now, pendingIds: [...new Set(ids)] });
}
