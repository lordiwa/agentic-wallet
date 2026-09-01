/**
 * De donde salen los datos del dashboard.
 *
 * Historicamente no habia nada que resolver: el server Express sirve la SPA y
 * la API en el mismo puerto, asi que `/api/...` relativo siempre daba en el
 * blanco. Eso deja de ser cierto cuando el mismo build se publica en un
 * hosting estatico (Firebase, ver docs/frontend-desplegado.md): ahi `/api`
 * no existe y hay que decirle al frontend a que server hablarle.
 *
 * Orden de resolucion, de mas explicito a menos:
 *
 *   1. `?api=<url>` en la URL — y se guarda en `localStorage`. Es lo que
 *      permite apuntar el sitio ya desplegado a otro backend sin recompilar
 *      ni redeployar nada: se pega la URL una vez y queda.
 *   2. Lo guardado en `localStorage` por una visita anterior.
 *   3. `VITE_API_BASE_URL` del build.
 *   4. Mismo origen (`""`) — el caso local de siempre.
 *
 * La configuracion vive en el NAVEGADOR de quien mira, no en el bundle: el
 * artefacto publicado no lleva adentro ninguna URL privada ni ningun dato.
 *
 * El valor especial `demo` (`?api=demo`) no habla con ningun server: sirve
 * respuestas de demostracion locales (ver ../demo/demoFetch.ts). Es lo que
 * hace que el sitio desplegado se pueda mirar sin exponer un backend.
 */
import { demoFetch } from "../demo/demoFetch";

export const API_BASE_STORAGE_KEY = "wallet.api_base";

/** Base "magica" que activa el modo demostracion en lugar de un origen. */
export const DEMO_BASE = "demo";

/** Sin barra final: los paths ya empiezan con "/". */
function normalize(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(API_BASE_STORAGE_KEY);
  } catch {
    // Storage bloqueado (modo privado, cookies de terceros): no es un error
    // que valga la pena propagar, solo significa "no hay nada guardado".
    return null;
  }
}

function writeStorage(value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(API_BASE_STORAGE_KEY);
    else window.localStorage.setItem(API_BASE_STORAGE_KEY, value);
  } catch {
    // Ver readStorage: sin storage la eleccion vale para esta pestania nomas.
  }
}

/**
 * `?api=` presente (aunque venga vacio) es una orden: vacio significa
 * "volve al mismo origen", no "ignorame". Se aplica una sola vez y queda
 * guardada, para que un F5 sin el parametro no revierta la eleccion.
 */
function takeFromQuery(): string | null | undefined {
  if (typeof window === "undefined" || !window.location?.search) return undefined;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("api")) return undefined;
  const raw = normalize(params.get("api") ?? "");
  const value = raw === "" ? null : raw;
  writeStorage(value);
  return value;
}

export function getApiBase(): string {
  const fromQuery = takeFromQuery();
  if (fromQuery !== undefined) return fromQuery ?? "";

  const stored = readStorage();
  if (stored !== null) return normalize(stored);

  const fromBuild = import.meta.env?.VITE_API_BASE_URL;
  if (typeof fromBuild === "string" && fromBuild.trim() !== "") return normalize(fromBuild);

  return "";
}

/** `null` vuelve al mismo origen. No recarga: el llamador decide. */
export function setApiBase(value: string | null): void {
  writeStorage(value === null || normalize(value) === "" ? null : normalize(value));
}

export function isDemoMode(): boolean {
  return getApiBase() === DEMO_BASE;
}

export function apiUrl(path: string): string {
  const base = getApiBase();
  return base === "" || base === DEMO_BASE ? path : `${base}${path}`;
}

/**
 * El unico punto por donde el dashboard sale a la red. `client.ts` llama a
 * esto y no a `fetch` directo, para que la base configurada y el modo demo
 * valgan para TODAS las llamadas — incluido el streaming del chat, que
 * tambien pasa por aca.
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (isDemoMode()) return demoFetch(path, init);
  return fetch(apiUrl(path), init);
}
