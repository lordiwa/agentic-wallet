/**
 * "Esta al dia?" en una linea.
 *
 * El umbral es 24 horas por como funciona el sync, no por gusto: el ledger
 * se alimenta de correos de notificacion, que llegan a lo largo del dia, y
 * `POST /api/sync` drena UN LOTE por llamada (ver server/src/sync/run-sync.ts)
 * — pedirle frescura de minutos a algo que se opera a mano seria marcar
 * "atrasado" el estado normal. Mas de un dia sin leer el buzon si es algo
 * que quien mira el dashboard tiene que ver.
 *
 * Un backlog a medias gana sobre la fecha: `last_sync_ts` solo avanza cuando
 * el backlog termina de drenarse, asi que "hace 3 minutos" y "faltan 1600
 * correos" son ciertas a la vez, y la segunda es la que importa.
 */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type Freshness = "nunca" | "al-dia" | "atrasado" | "en-progreso";

export function syncFreshness(
  lastSyncTs: string | null,
  hasBacklog: boolean,
  now: Date = new Date()
): Freshness {
  if (hasBacklog) return "en-progreso";
  if (!lastSyncTs) return "nunca";
  const at = Date.parse(lastSyncTs);
  if (Number.isNaN(at)) return "nunca";
  return now.getTime() - at <= STALE_AFTER_MS ? "al-dia" : "atrasado";
}

/**
 * "hace 5 minutos" y no una fecha ISO: la pregunta que se hace de un vistazo
 * es cuanto hace, no cuando exactamente. Devuelve null cuando no hay fecha
 * (el llamador dice "nunca" con sus palabras, aca no se inventa una).
 */
export function timeAgo(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;

  const seconds = Math.floor((now.getTime() - at) / 1000);
  // Un reloj adelantado en el server daria negativo; "recien" es mas honesto
  // que "hace -3 minutos".
  if (seconds < 60) return "recien";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? "hora" : "horas"}`;

  const days = Math.floor(hours / 24);
  return `hace ${days} ${days === 1 ? "dia" : "dias"}`;
}
