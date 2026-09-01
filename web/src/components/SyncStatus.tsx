import { useEffect, useState } from "react";
import { fetchSyncStatus } from "../api/client";
import type { SyncStatusResponse } from "../api/types";
import { syncFreshness, timeAgo } from "../lib/freshness";
import { useRefresh } from "../lib/refresh";

const LABEL = {
  nunca: "Nunca se sincronizo",
  "al-dia": "Al dia",
  atrasado: "Atrasado",
  "en-progreso": "Sincronizacion a medias",
} as const;

/**
 * "Desde cuando son estos numeros" — la pregunta que un dashboard que se
 * refresca solo tiene que contestar antes que ninguna otra: sin esto, una
 * pantalla que no cambia es indistinguible de una pantalla rota.
 *
 * Va separado de SyncButton porque contesta en frio (GET /api/sync/status, no
 * dispara nada) y se repite en cada tick, mientras que el boton solo habla
 * cuando alguien lo pulsa.
 */
export function SyncStatus() {
  const { tick, lastRefreshAt } = useRefresh();
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSyncStatus()
      .then((res) => {
        if (cancelled) return;
        setStatus(res);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al leer el estado del sync");
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  if (error) return <p role="alert">Estado del sync no disponible: {error}</p>;
  if (!status) return <p>Leyendo estado del sync...</p>;

  const freshness = syncFreshness(status.last_sync_ts, status.backlog !== null);
  const ago = timeAgo(status.last_sync_ts);

  return (
    <section aria-label="Estado de sincronizacion">
      <p>
        <strong data-freshness={freshness}>{LABEL[freshness]}</strong>
        {ago ? ` - ultima sincronizacion ${ago}` : ""}
      </p>
      {status.backlog && (
        <p>
          Procesando historial: {status.backlog.processed} de {status.backlog.total} correos (faltan{" "}
          {status.backlog.remaining}). Pulsa Sincronizar otra vez para seguir.
        </p>
      )}
      {lastRefreshAt && <p>Pantalla actualizada a las {lastRefreshAt.toLocaleTimeString()}</p>}
    </section>
  );
}
