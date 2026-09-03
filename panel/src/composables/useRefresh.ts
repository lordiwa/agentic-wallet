/**
 * El reloj de refresco compartido, **portado** de `web/src/lib/refresh.tsx` a
 * un composable de Vue. Misma decisión, mismo intervalo, mismo comportamiento
 * con la pestaña oculta: lo que cambia es el mecanismo (`provide`/`inject` y
 * `ref` en vez de contexto y `useState`), no la política.
 *
 * Del original, palabra por palabra, porque sigue siendo el porqué:
 *
 *   El panel se mira, no se opera: queda abierto en una pestaña mientras el
 *   sync corre en el server, así que un número de hace una hora no es "un dato
 *   viejo", es un dato equivocado. Lo único que hace falta compartir es CUÁNDO
 *   volver a pedir, y eso es este contador: cada tick, lo que lo tenga en sus
 *   dependencias vuelve a pedir sus datos.
 *
 *   Se elige polling y no SSE a propósito: el único stream que habla el server
 *   es `POST /api/chat`, no hay canal de eventos del ledger, y montar uno para
 *   un panel de un solo usuario sería construir infraestructura para un
 *   problema que un GET cada medio minuto ya resuelve.
 *
 *   El reloj se para con la pestaña oculta y dispara un tick al volver: sin
 *   eso, una pestaña olvidada de fondo pasa el día pegándole a la API (y al
 *   despertar mostraría igual datos viejos hasta el próximo intervalo).
 *
 * Lo único que N2 le agrega es `setIntervalMs`, y no es una mejora suelta: el
 * chip del Resumen consulta más seguido **mientras** hay un sync corriendo y
 * vuelve al ritmo normal al terminar (es lo que dibuja `p3-sincronizacion.html`
 * en su nota: "durante un sync el panel consulta cada 3 s"). Sin eso, la barra
 * de progreso se movería una vez cada medio minuto.
 */
import { inject, onScopeDispose, provide, ref, watch, type InjectionKey, type Ref } from "vue";

export const DEFAULT_REFRESH_MS = 30_000;

/** El ritmo mientras hay un lote en vuelo (`p3-sincronizacion.html`). */
export const SYNC_REFRESH_MS = 3_000;

export interface RefreshState {
  /** Cambia en cada refresco. Su valor no significa nada — que cambie, sí.
   * Se lee; el único que lo escribe es el reloj. */
  tick: Ref<number>;
  /** Momento del último tick, para poder decir "actualizado hace X". */
  lastRefreshAt: Ref<Date | null>;
  /** Fuerza un refresco ya (lo usa el sync al terminar: los datos que acaba de
   * escribir tienen que verse sin esperar al próximo intervalo). */
  refreshNow: () => void;
  /** Cambia el ritmo. `0` o menos para el reloj sin desmontar nada. */
  setIntervalMs: (ms: number) => void;
}

const REFRESH_KEY: InjectionKey<RefreshState> = Symbol("wallet.refresh");

/**
 * El default es inerte a propósito: un componente montado fuera del provider
 * (el test de una sola tarjeta, por ejemplo) se comporta exactamente como
 * antes de que existiera el auto-refresco — una sola carga, sin reloj.
 */
function inertState(): RefreshState {
  return {
    tick: ref(0),
    lastRefreshAt: ref(null),
    refreshNow: () => {},
    setIntervalMs: () => {},
  };
}

/** Monta el reloj y lo publica para los descendientes. Se llama una vez, en la
 * raíz. */
export function provideRefresh(intervalMs = DEFAULT_REFRESH_MS): RefreshState {
  const tick = ref(0);
  const lastRefreshAt = ref<Date | null>(null);
  const periodo = ref(intervalMs);

  function refreshNow(): void {
    tick.value += 1;
    lastRefreshAt.value = new Date();
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  function stop(): void {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }
  function start(): void {
    if (timer === undefined && periodo.value > 0) timer = setInterval(refreshNow, periodo.value);
  }

  function onVisibility(): void {
    if (document.hidden) {
      stop();
    } else {
      // Al volver, primero se pone al día y recién después reanuda el reloj:
      // esperar el intervalo entero mostraría datos de antes de que la pestaña
      // se ocultara.
      refreshNow();
      start();
    }
  }

  // Cambiar el ritmo reinicia el intervalo: si no, el nuevo período recién
  // valdría después del tick que ya estaba agendado con el viejo — y el que
  // estaba agendado puede ser el de 30 s justo cuando arranca un sync.
  // `flush: "sync"` porque acá no se está actualizando el DOM: se está
  // reprogramando un `setInterval`, y esperar al próximo ciclo de render es
  // esperar de gusto.
  watch(periodo, () => {
    stop();
    if (!document.hidden) start();
  }, { flush: "sync" });

  if (!document.hidden) start();
  document.addEventListener("visibilitychange", onVisibility);
  onScopeDispose(() => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  });

  const state: RefreshState = {
    tick,
    lastRefreshAt,
    refreshNow,
    setIntervalMs: (ms: number) => {
      periodo.value = ms;
    },
  };
  provide(REFRESH_KEY, state);
  return state;
}

export function useRefresh(): RefreshState {
  return inject(REFRESH_KEY, inertState, true);
}
