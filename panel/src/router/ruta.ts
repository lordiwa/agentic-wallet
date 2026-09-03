/**
 * La navegación del panel, en el hash y sin dependencias.
 *
 * Por qué no `vue-router`: el MVP tiene **tres** pantallas y ninguna anida,
 * ninguna carga en diferido y ninguna guarda su entrada. Lo que sí hace falta
 * es que un destino se pueda escribir con su contexto —"Movimientos, filtrado
 * por la categoría que toqué", "Preguntas, acotado al lote que acaba de
 * entrar"— y eso son dos funciones puras. Cuando alguna de esas condiciones
 * cambie, esto se reemplaza por el router de verdad y los llamadores no se
 * enteran: hablan con `ir()`, no con la URL.
 *
 * El hash y no el path porque el panel se sirve como archivo estático detrás
 * de `tailscale serve`, sin reescritura de rutas: un F5 en `/movimientos`
 * daría 404, y en `#/movimientos` no.
 */
import { onScopeDispose, ref, type Ref } from "vue";

/**
 * Las superficies del MVP.
 *
 * **Tres se navegan y una no** (§2.2). `resumen`, `preguntas` y `movimientos`
 * son las tres de la barra lateral; `alta` —el análisis del historial de N4— es
 * un destino sin enlace propio a propósito: se entra por una tarjeta del
 * Resumen y se sale a la cola, y P1 nunca bloqueó a nadie, así que tampoco va
 * antes del hogar. Un cuarto enlace en la barra la volvería un paso obligado de
 * la navegación, que es exactamente lo que el plan decidió no hacer.
 */
export type Pantalla = "resumen" | "preguntas" | "movimientos" | "alta";

/** Las que dibuja la barra lateral. No es la lista de rutas válidas. */
export const PANTALLAS: readonly Pantalla[] = ["resumen", "preguntas", "movimientos"];

/** Las rutas que el hash entiende: las tres de la barra más `alta`. */
export const RUTAS: readonly Pantalla[] = [...PANTALLAS, "alta"];

export interface Ruta {
  pantalla: Pantalla;
  /** El contexto del destino: `categoria`, `ids`, `pestana`. Strings porque
   * salen de una URL. */
  params: Record<string, string>;
}

/** El hogar. Una ruta que no se entiende no es un error: es el hogar. */
export const RUTA_INICIAL: Ruta = { pantalla: "resumen", params: {} };

function esPantalla(valor: string): valor is Pantalla {
  return (RUTAS as readonly string[]).includes(valor);
}

export function parseHash(hash: string): Ruta {
  const limpio = hash.replace(/^#\/?/, "");
  if (limpio === "") return RUTA_INICIAL;

  const [nombre, query = ""] = limpio.split("?");
  if (!esPantalla(nombre)) return RUTA_INICIAL;

  const params: Record<string, string> = {};
  for (const [clave, valor] of new URLSearchParams(query)) params[clave] = valor;
  return { pantalla: nombre, params };
}

export function toHash(pantalla: Pantalla, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return `#/${pantalla}${query ? `?${query}` : ""}`;
}

export interface Navegacion {
  ruta: Ref<Ruta>;
  ir: (pantalla: Pantalla, params?: Record<string, string>) => void;
}

/**
 * La ruta actual, siguiendo el hash. Un `hashchange` puede venir de un click en
 * un enlace o del botón *atrás* del navegador; para esta función son lo mismo,
 * y eso es lo que hace que el atrás funcione sin escribir nada más.
 */
export function useRuta(): Navegacion {
  const ruta = ref<Ruta>(parseHash(window.location.hash));

  const onHashChange = () => {
    ruta.value = parseHash(window.location.hash);
  };
  window.addEventListener("hashchange", onHashChange);
  onScopeDispose(() => window.removeEventListener("hashchange", onHashChange));

  return {
    ruta,
    ir: (pantalla, params = {}) => {
      const destino = toHash(pantalla, params);
      // Si el hash ya es el destino, `location.hash` no dispara `hashchange`:
      // se refleja a mano para que ir dos veces al mismo lado no quede mudo.
      if (window.location.hash === destino) ruta.value = parseHash(destino);
      else window.location.hash = destino;
    },
  };
}
