/**
 * "¿Hay un sync corriendo ahora mismo?" — la guarda de `POST /api/sync`,
 * sacada de la clausura del router para que **alguien mas pueda preguntarle**
 * (R9).
 *
 * Hasta N2 el flag vivia como un `let running = false` adentro de
 * `createSyncRouter`, y eso lo hacia incontestable desde afuera: la unica
 * forma de enterarse de que habia un lote en vuelo era pedir `POST /api/sync`
 * y comerse el 409. Para una pantalla que se rehidrata sola eso es peor que
 * inutil — un F5 en medio de un lote arrancaba en un estado limpio falso, y
 * el reintento automatico del 409 le pegaba a un lote que tarda minutos.
 *
 * Sigue siendo un booleano en memoria del proceso, y esta bien que lo sea:
 * este server es local y de un solo usuario (ver el encabezado de
 * `sync-route.ts`). Lo que cambia no es la garantia, es quien puede leerla —
 * ahora tambien `GET /api/sync/status`.
 */
export interface SyncGate {
  /** Lo que `GET /api/sync/status` publica como `running`. */
  isRunning(): boolean;
  /** Toma la guarda. `false` = ya habia uno corriendo (el 409). */
  begin(): boolean;
  end(): void;
}

export function createSyncGate(): SyncGate {
  let running = false;
  return {
    isRunning: () => running,
    begin: () => {
      if (running) return false;
      running = true;
      return true;
    },
    end: () => {
      running = false;
    },
  };
}
