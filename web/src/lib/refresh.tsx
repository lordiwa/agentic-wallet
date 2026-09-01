import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Reloj de refresco compartido del dashboard.
 *
 * El dashboard se mira, no se opera: queda abierto en una pestania mientras
 * el sync corre en el server, asi que un numero de hace una hora no es "un
 * dato viejo", es un dato equivocado. Cada seccion ya trae su propio fetch
 * (ver el comentario de StrategySection sobre por que no comparten estado);
 * lo unico que hace falta compartir es CUANDO volver a pedir, y eso es este
 * contador: cada tick, los `useEffect` que lo tienen en sus deps vuelven a
 * pedir sus datos. Es la pieza mas chica que da auto-refresh sin obligar a
 * un refactor a estado compartido.
 *
 * Se elige polling y no SSE a proposito: el unico stream que habla el server
 * es `POST /api/chat` (respuesta del chat, no estado del ledger), no hay
 * canal de eventos del ledger, y montar uno para un dashboard de un solo
 * usuario seria construir infraestructura para un problema que un GET cada
 * medio minuto ya resuelve.
 *
 * El reloj se para con la pestania oculta y dispara un tick al volver: sin
 * eso, una pestania olvidada de fondo pasa el dia pegandole a la API (y al
 * despertar mostraria igual datos viejos hasta el proximo intervalo).
 */
export const DEFAULT_REFRESH_MS = 30_000;

export interface RefreshState {
  /** Cambia en cada refresco. Su valor no significa nada — que cambie, si. */
  tick: number;
  /** Momento del ultimo tick, para poder decir "actualizado hace X". */
  lastRefreshAt: Date | null;
  /** Fuerza un refresco ya (lo usa el sync al terminar: los datos que acaba
   * de escribir tienen que verse sin esperar al proximo intervalo). */
  refreshNow: () => void;
}

/**
 * El default es inerte a proposito: un componente montado fuera del provider
 * (un test de una sola seccion, por ejemplo) se comporta exactamente como
 * antes de que existiera el auto-refresco — una sola carga, sin reloj.
 */
const RefreshContext = createContext<RefreshState>({
  tick: 0,
  lastRefreshAt: null,
  refreshNow: () => {},
});

export function useRefresh(): RefreshState {
  return useContext(RefreshContext);
}

/** Atajo para el caso comun: `useEffect(..., [useRefreshTick()])`. */
export function useRefreshTick(): number {
  return useContext(RefreshContext).tick;
}

export interface RefreshProviderProps {
  intervalMs?: number;
  children: ReactNode;
}

export function RefreshProvider({ intervalMs = DEFAULT_REFRESH_MS, children }: RefreshProviderProps) {
  const [tick, setTick] = useState(0);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);

  const refreshNow = useCallback(() => {
    setTick((t) => t + 1);
    setLastRefreshAt(new Date());
  }, []);

  // Por ref para que el efecto del reloj no dependa de `refreshNow` y se
  // reinicie el intervalo en cada render.
  const refreshRef = useRef(refreshNow);
  refreshRef.current = refreshNow;

  useEffect(() => {
    if (intervalMs <= 0) return;

    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(() => refreshRef.current(), intervalMs);
    };
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Al volver, primero se pone al dia y recien despues reanuda el
        // reloj: esperar el intervalo entero mostraria datos de antes de
        // que la pestania se ocultara.
        refreshRef.current();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);

  const value = useMemo<RefreshState>(
    () => ({ tick, lastRefreshAt, refreshNow }),
    [tick, lastRefreshAt, refreshNow]
  );

  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}
