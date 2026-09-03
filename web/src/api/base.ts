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
 *   1. `?api=<url>` en la URL — **previa confirmacion explicita**, y recien
 *      ahi se guarda en `localStorage`. Es lo que permite apuntar el sitio ya
 *      desplegado a otro backend sin recompilar ni redeployar nada.
 *   2. Lo guardado en `localStorage` por una visita anterior.
 *   3. `VITE_API_BASE_URL` del build.
 *   4. Mismo origen (`""`) — el caso local de siempre.
 *
 * **Por que el paso 1 ahora pregunta** (R1, fase N0 / TASK-054): hasta hoy
 * `?api=` se guardaba solo, dentro del mismo `getApiBase()` que lo leia. Con
 * `WALLET_ACCESS_TOKEN` la llave del server viaja en la cabecera de cada
 * llamada, y entonces un enlace `https://panel/?api=https://mio` alcanzaba
 * para que el dashboard le entregara esa llave a un host ajeno con un solo
 * click. Son dos decisiones distintas y ninguna es automatica:
 *
 *   - **a que backend le hablo** — se confirma antes de guardarse;
 *   - **a que backend le doy la llave** — solo a los de `./origins.ts`. A un
 *     backend fuera de la lista se le habla igual, pero SIN credencial: es
 *     preferible un 401 que se explica a un 200 conseguido regalando la
 *     llave.
 *
 * La confirmacion es `window.confirm` a proposito: es explicita, bloqueante y
 * no necesita ninguna pantalla nueva en este dashboard, que la fase N2
 * reemplaza por el panel.
 *
 * La configuracion vive en el NAVEGADOR de quien mira, no en el bundle: el
 * artefacto publicado no lleva adentro ninguna URL privada ni ningun dato.
 *
 * El valor especial `demo` (`?api=demo`) no habla con ningun server: sirve
 * respuestas de demostracion locales (ver ../demo/demoFetch.ts). Es lo que
 * hace que el sitio desplegado se pueda mirar sin exponer un backend.
 */
import { demoFetch } from "../demo/demoFetch";
import { DEMO_BASE, classifyBackend, mayReceiveCredential, parseTrustedOrigins } from "./origins";

export const API_BASE_STORAGE_KEY = "wallet.api_base";
/** Origenes que el usuario confirmo como dignos de recibir la llave. */
export const TRUSTED_ORIGINS_STORAGE_KEY = "wallet.trusted_origins";
/** La llave del server (`WALLET_ACCESS_TOKEN`). Vive en este navegador. */
export const ACCESS_TOKEN_STORAGE_KEY = "wallet.access_token";

/** Base "magica" que activa el modo demostracion en lugar de un origen. */
export { DEMO_BASE };

/** Sin barra final: los paths ya empiezan con "/". */
function normalize(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage bloqueado (modo privado, cookies de terceros): no es un error
    // que valga la pena propagar, solo significa "no hay nada guardado".
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Ver readStorage: sin storage la eleccion vale para esta pestania nomas.
  }
}

/**
 * `?api=` presente (aunque venga vacio) es una propuesta: vacio significa
 * "volve al mismo origen", no "ignorame". Pero es solo una propuesta —
 * **nada se guarda ni se aplica sin confirmacion** (R1, ver el encabezado).
 *
 * `null` = no hay nada pendiente. Una cadena vacia = "volver al mismo
 * origen", que es una propuesta valida y distinta de no tener ninguna.
 */
export function pendingApiBase(): string | null {
  if (typeof window === "undefined" || !window.location?.search) return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("api")) return null;
  const proposed = normalize(params.get("api") ?? "");
  // Si ya es el backend en uso no hay nada que preguntar.
  return proposed === storedApiBase() ? null : proposed;
}

/** Pregunta una sola vez por carga de pagina: sin esto, cada `getApiBase()`
 * —y hay muchos por render— abriria su propio dialogo. */
let queryResuelta = false;

/**
 * El unico camino por el que un `?api=` de un enlace llega a `localStorage`,
 * y solo despues de que una persona diga que si. Devuelve la base aplicada, o
 * `null` si no habia propuesta o si la rechazaron.
 */
export function confirmPendingApiBase(confirmar: (mensaje: string) => boolean = defaultConfirm): string | null {
  const proposed = pendingApiBase();
  if (proposed === null) return null;
  const destino = proposed === "" ? "este mismo servidor" : proposed;
  const ok = confirmar(
    `Este enlace quiere que el dashboard le hable a:\n\n${destino}\n\n` +
      "Si no reconocés ese servidor, cancelá: guardarlo hace que todas las " +
      "consultas de este navegador vayan ahí.\n\n¿Guardarlo?"
  );
  if (!ok) return null;
  setApiBase(proposed === "" ? null : proposed);
  return proposed;
}

function defaultConfirm(mensaje: string): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") return false;
  return window.confirm(mensaje);
}

function storedApiBase(): string {
  const stored = readStorage(API_BASE_STORAGE_KEY);
  if (stored !== null) return normalize(stored);

  const fromBuild = import.meta.env?.VITE_API_BASE_URL;
  if (typeof fromBuild === "string" && fromBuild.trim() !== "") return normalize(fromBuild);

  return "";
}

export function getApiBase(): string {
  if (!queryResuelta && pendingApiBase() !== null) {
    queryResuelta = true;
    confirmPendingApiBase();
  }
  return storedApiBase();
}

/** Solo para los tests: vuelve al estado "todavia no se pregunto por el
 * `?api=` de esta carga". En el navegador no hace falta — cada carga de
 * pagina arranca con el modulo nuevo. */
export function resetQueryPrompt(): void {
  queryResuelta = false;
}

/** `null` vuelve al mismo origen. No recarga: el llamador decide. */
export function setApiBase(value: string | null): void {
  writeStorage(API_BASE_STORAGE_KEY, value === null || normalize(value) === "" ? null : normalize(value));
}

/** Los origenes que el usuario confirmo a mano como dignos de la llave. */
export function storedTrustedOrigins(): string[] {
  return parseTrustedOrigins(readStorage(TRUSTED_ORIGINS_STORAGE_KEY));
}

/** Si la llave puede salir hacia el backend en uso. */
export function credentialAllowed(base: string = getApiBase()): boolean {
  return mayReceiveCredential(
    classifyBackend(base, {
      configured: parseTrustedOrigins(import.meta.env?.VITE_WALLET_TRUSTED_API_ORIGINS),
      trusted: storedTrustedOrigins(),
    })
  );
}

export function getAccessToken(): string | null {
  const raw = readStorage(ACCESS_TOKEN_STORAGE_KEY);
  if (raw === null) return null;
  const value = raw.trim();
  return value === "" ? null : value;
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
 *
 * Y por eso mismo es el unico lugar donde se decide si la llave sale del
 * navegador: solo hacia un backend de la lista blanca. A uno ajeno se le
 * habla igual, pero pelado — un 401 que se explica es mejor que un 200
 * conseguido regalando la credencial.
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (isDemoMode()) return demoFetch(path, init);
  const headers = new Headers(init?.headers);
  const token = getAccessToken();
  if (token !== null && credentialAllowed()) headers.set("Authorization", `Bearer ${token}`);
  return fetch(apiUrl(path), { ...init, headers });
}
