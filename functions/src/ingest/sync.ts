/**
 * El sync como job: decide QUÉ ventana de correo leer, llama a la ingesta, y
 * avanza el estado. Puerto de `server/src/sync/run-sync.ts`.
 *
 * ## Por qué hay un checkpoint y no una búsqueda por llamada
 *
 * Gmail devuelve `messages.list` **del más nuevo al más viejo**. Una ingesta
 * que en cada llamada busca desde `lastSyncTs` y procesa los primeros N
 * procesa los N más NUEVOS, y después avanza la marca al `ts` del más nuevo
 * que vio. La siguiente llamada busca desde ahí y no encuentra nada: los
 * miles de correos viejos que quedaron atrás salieron del alcance de toda
 * búsqueda futura, en silencio y sin error. En un buzón de un año, un primer
 * sync con `maxMensajes: 200` ingiere 200 correos y da el trabajo por
 * terminado.
 *
 * Por eso una llamada no significa "leer el buzón" sino **drenar un LOTE del
 * backlog**:
 *
 *   1. Sin checkpoint, se arma el backlog: UNA búsqueda desde `lastSyncTs` (o
 *      desde la época la primera vez) y la lista de ids queda guardada.
 *   2. Se procesa el próximo lote y se PERSISTE. Recién después se anota el
 *      avance: si la función muere en el medio, el lote se repite y la
 *      persistencia idempotente por `gmail_msg_id` lo absorbe.
 *   3. Cuando el backlog queda vacío se borra el checkpoint y **ahí** avanza
 *      `lastSyncTs`.
 *
 * `lastSyncTs` se fija en el "ahora" del ARRANQUE del backlog, no en el del
 * último lote: si un drenado empieza a las 10:00 y termina a las 18:00,
 * guardar las 18:00 se comería en silencio todo lo que llegó en el medio. Es
 * la misma razón por la que tampoco se usa el `ts` del correo más nuevo visto.
 *
 * El sync de todos los días no cambia: sin backlog pendiente la ventana es
 * chica, entra en un lote y se cierra en una sola llamada.
 */
import type { Firestore } from "firebase-admin/firestore";
import { FirestoreLedger } from "../ledger/firestore-ledger.js";
import * as paths from "../ledger/paths.js";
import { armarQuery, ingestarIds, type DepsIngesta, type ResumenIngesta } from "./pipeline.js";

/**
 * Cuántos correos como máximo drena una llamada.
 *
 * Más chico que el `MAX_MENSAJES_DEFAULT` del pipeline a propósito: acá el
 * tope lo pone el timeout de la función (540 s) y cada correo son dos viajes a
 * Gmail más una lectura y una escritura de Firestore. Con 150 quedan minutos de
 * sobra para el peor caso, y lo que no entra queda en el checkpoint en vez de
 * perderse.
 */
export const LOTE_POR_DEFECTO = 150;

/**
 * Cuántos ids puede guardar un checkpoint.
 *
 * Un documento de Firestore no pasa de 1 MiB; un id de Gmail son ~16 bytes, así
 * que 20 000 entran con muchísimo aire. El tope existe igual porque un buzón sin
 * `lastSyncTs` se busca desde la época y no hay razón para descubrir el límite
 * duro con un buzón real: por encima de esto el backlog se arma igual, con los
 * más nuevos, y el resto entra en el siguiente ciclo.
 */
export const MAX_IDS_EN_CHECKPOINT = 20_000;

/** Sin checkpoint y sin `lastSyncTs`: se lee desde el principio de los tiempos
 * en vez de exigirle una cota al que llama. Ningún buzón es más viejo. */
const EPOCH = "1970-01-01T00:00:00.000Z";

export interface ProgresoSync {
  /** Correos del backlog ya procesados y persistidos. */
  processed: number;
  /** Correos que tenía el backlog al abrirse. */
  total: number;
  remaining: number;
  /** `false` = falta backlog; hay que volver a llamar. */
  complete: boolean;
}

export interface ResultadoSync extends ResumenIngesta {
  progress: ProgresoSync;
}

/** El checkpoint tal como queda en `config/sync`. */
interface Checkpoint {
  ids: string[];
  processed: number;
  /** El "ahora" del arranque del backlog: lo que terminará en `lastSyncTs`. */
  openedAt: string;
  updatedAt: string;
}

function leerCheckpoint(data: Record<string, unknown>): Checkpoint | null {
  const raw = data.backlogIds;
  const openedAt = data.backlogOpenedAt;
  if (!Array.isArray(raw) || typeof openedAt !== "string" || openedAt === "") return null;
  const ids = raw.filter((id): id is string => typeof id === "string");
  const processed = typeof data.backlogProcessed === "number" ? data.backlogProcessed : 0;
  if (processed >= ids.length) return null;
  return {
    ids,
    processed,
    openedAt,
    updatedAt: typeof data.backlogUpdatedAt === "string" ? data.backlogUpdatedAt : openedAt,
  };
}

export interface OpcionesSync {
  /** Tope de correos de esta llamada. */
  batchSize?: number;
  /** El "ahora" del arranque, inyectable para que los tests tengan algo
   * determinista que afirmar. */
  now?: Date;
  /**
   * Desde cuándo abrir un backlog NUEVO, pisando `lastSyncTs`. Sólo se mira
   * cuando no hay checkpoint abierto: un drenado a medias no cambia de ventana
   * a mitad de camino porque alguien mandó otra fecha.
   *
   * No es un default de conveniencia (CLAUDE.md regla 3): sin este campo y sin
   * `lastSyncTs` se lee **desde la época**, que es "sin filtro" y no una fecha
   * elegida por nosotros. Leer desde la época es seguro justamente por el
   * checkpoint — se drena por lotes en vez de intentar el buzón entero.
   */
  desdeTs?: string;
}

export async function runSync(
  deps: DepsIngesta & { db: Firestore },
  opciones: OpcionesSync = {}
): Promise<ResultadoSync> {
  const now = opciones.now ?? new Date();
  const batchSize = opciones.batchSize ?? LOTE_POR_DEFECTO;
  const ref = paths.configDoc(deps.db, deps.uid, "sync");

  const snap = await ref.get();
  const estado = snap.exists ? (snap.data() as Record<string, unknown>) : {};

  let checkpoint = leerCheckpoint(estado);
  if (checkpoint === null) {
    const desde =
      opciones.desdeTs !== undefined && opciones.desdeTs.trim() !== ""
        ? opciones.desdeTs.trim()
        : typeof estado.lastSyncTs === "string" && estado.lastSyncTs !== ""
          ? estado.lastSyncTs
          : EPOCH;
    const ids = await deps.gmail.buscarIds(armarQuery(desde), MAX_IDS_EN_CHECKPOINT);
    checkpoint = { ids, processed: 0, openedAt: now.toISOString(), updatedAt: now.toISOString() };
    await ref.set(
      {
        backlogIds: ids,
        backlogProcessed: 0,
        backlogOpenedAt: checkpoint.openedAt,
        backlogUpdatedAt: checkpoint.updatedAt,
      },
      { merge: true }
    );
  }

  const lote = checkpoint.ids.slice(checkpoint.processed, checkpoint.processed + batchSize);
  // Se PERSISTE antes de anotar el avance: si esto muere en el medio, el lote
  // se repite y la escritura idempotente por `gmail_msg_id` lo absorbe. Al
  // revés se perderían correos.
  const resumen = await ingestarIds(deps, lote);

  const processed = checkpoint.processed + lote.length;
  const total = checkpoint.ids.length;
  const complete = processed >= total;

  if (complete) {
    // El backlog se cerró: se borra el checkpoint y RECIÉN AHÍ avanza la marca,
    // al "ahora" del arranque del backlog.
    await ref.set(
      {
        lastSyncTs: checkpoint.openedAt,
        lastIngestAt: now.toISOString(),
        backlogIds: null,
        backlogProcessed: null,
        backlogOpenedAt: null,
        backlogUpdatedAt: null,
        backlog: null,
      },
      { merge: true }
    );
  } else {
    await ref.set(
      {
        backlogProcessed: processed,
        backlogUpdatedAt: now.toISOString(),
        lastIngestAt: now.toISOString(),
        // El backlog en la forma que `GET /api/sync/status` publica, para que
        // esa ruta no tenga que saber cómo se guarda el checkpoint.
        backlog: {
          processed,
          total,
          remaining: Math.max(0, total - processed),
          updated_at: now.toISOString(),
        },
      },
      { merge: true }
    );
  }

  return {
    ...resumen,
    progress: { processed, total, remaining: Math.max(0, total - processed), complete },
  };
}

/** Vencimiento de la guarda de sync: una función que muere por timeout no
 * llega a soltarla, y sin esto la billetera quedaría con "hay un sync
 * corriendo" para siempre. Diez minutos es el timeout de la función (540 s) más
 * aire. */
export const VENCIMIENTO_GUARDA_MS = 10 * 60 * 1000;

/** Toma la guarda, corre, y la suelta pase lo que pase. `null` = ya había uno
 * corriendo (el 409 que el panel dibuja como "otro lo está corriendo"). */
export async function conGuardaDeSync<T>(
  ledger: FirestoreLedger,
  now: Date,
  fn: () => Promise<T>
): Promise<T | null> {
  if (!(await ledger.tomarGuardaDeSync(now, VENCIMIENTO_GUARDA_MS))) return null;
  try {
    return await fn();
  } finally {
    await ledger.soltarGuardaDeSync();
  }
}
