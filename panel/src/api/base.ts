/**
 * De donde salen los datos del panel, y quien puede recibir la llave.
 *
 * Orden de resolucion, de mas explicito a menos:
 *
 *   1. Lo guardado en `localStorage` por una confirmacion anterior.
 *   2. `VITE_API_BASE_URL` del build.
 *   3. Mismo origen (`""`) — el server que sirve el panel.
 *
 * **`?api=` NO esta en esa lista, y esa es la diferencia con
 * `web/src/api/base.ts`.** Ahi el parametro se guardaba solo, en el mismo
 * `getApiBase()` que lo leia. Con la llave en la cabecera eso es la
 * credencial viajando a un host ajeno con un solo click (R1): basta mandar
 * `https://panel/?api=https://mio` para que la proxima llamada del panel
 * entregue el token. Aca `?api=` queda como una **propuesta pendiente** que
 * no se usa ni se guarda hasta que alguien la confirma a mano, y confirmarla
 * no la vuelve confiable — darle la llave es una segunda decision aparte
 * (ver `confirmPendingApiBase`).
 *
 * La configuracion vive en el NAVEGADOR de quien mira, no en el bundle: el
 * artefacto publicado no lleva adentro ninguna URL privada ni ningun dato.
 */
import { DEMO_BASE, classifyBackend, mayReceiveCredential, normalizeBase, parseTrustedOrigins } from "./origins";
import type { OriginVerdict } from "./origins";

export { DEMO_BASE };

export const API_BASE_STORAGE_KEY = "wallet.api_base";
/** Origenes que el usuario confirmo a mano como dignos de recibir la llave. */
export const TRUSTED_ORIGINS_STORAGE_KEY = "wallet.trusted_origins";
/** Origenes que el usuario guardo **negandoles** la llave, con el boton
 * "Guardar sin darle la llave". Ver `denyBackendOrigin` (W27). */
export const DENIED_ORIGINS_STORAGE_KEY = "wallet.denied_origins";
/** La llave del server. Vive en este navegador y no sale de el salvo hacia un
 * backend de la lista blanca. */
export const ACCESS_TOKEN_STORAGE_KEY = "wallet.access_token";

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

/** La lista fijada en el build. Vacia por defecto: nada precargado que sea de
 * una persona o de un despliegue concreto (CLAUDE.md). */
export function configuredTrustedOrigins(): string[] {
  return parseTrustedOrigins(import.meta.env?.VITE_WALLET_TRUSTED_API_ORIGINS);
}

/** Los que confirmo el usuario en este navegador. */
export function storedTrustedOrigins(): string[] {
  return parseTrustedOrigins(readStorage(TRUSTED_ORIGINS_STORAGE_KEY));
}

/** Los que el usuario guardo negandoles la llave. */
export function storedDeniedOrigins(): string[] {
  return parseTrustedOrigins(readStorage(DENIED_ORIGINS_STORAGE_KEY));
}

/**
 * Anota un origen como digno de recibir la llave.
 *
 * Levanta la negacion si la habia: la ultima decision del usuario es la que
 * manda, y no hay forma de volver a autorizar un origen negado si esta funcion
 * no lo saca de la lista.
 */
export function trustBackendOrigin(base: string): void {
  const url = normalizeBase(base);
  const parsed = parseTrustedOrigins(url);
  if (parsed.length === 0) return;

  const denegados = storedDeniedOrigins().filter((origin) => !parsed.includes(origin));
  writeStorage(DENIED_ORIGINS_STORAGE_KEY, denegados.length === 0 ? null : denegados.join(","));

  const origins = storedTrustedOrigins();
  const verdict = classifyBackend(url, {
    configured: configuredTrustedOrigins(),
    trusted: origins,
    denied: denegados,
  });
  // Solo tiene sentido anotar un origen ajeno: el resto ya entra por otra via.
  if (verdict !== "foreign") return;
  writeStorage(TRUSTED_ORIGINS_STORAGE_KEY, [...origins, ...parsed].join(","));
}

/**
 * Anota un origen como **negado**: se le habla, pero sin credencial.
 *
 * Existe porque "Guardar sin darle la llave" era un no-op para todo backend que
 * ya entraba solo — un `127.0.0.1:9999` cualquiera es `loopback`, y el usuario
 * que apretaba el boton prudente entregaba la llave igual (wargaming ronda 3,
 * W27). Un boton que no puede cumplir su etiqueta es peor que no tenerlo: pide
 * una decision y la descarta.
 */
export function denyBackendOrigin(base: string): void {
  const parsed = parseTrustedOrigins(normalizeBase(base));
  if (parsed.length === 0) return;

  // Negar tambien retira una autorizacion previa, por lo mismo que autorizar
  // levanta la negacion: hay una sola decision por origen y es la ultima.
  const confiables = storedTrustedOrigins().filter((origin) => !parsed.includes(origin));
  writeStorage(TRUSTED_ORIGINS_STORAGE_KEY, confiables.length === 0 ? null : confiables.join(","));

  const denegados = storedDeniedOrigins();
  const nuevos = parsed.filter((origin) => !denegados.includes(origin));
  if (nuevos.length === 0) return;
  writeStorage(DENIED_ORIGINS_STORAGE_KEY, [...denegados, ...nuevos].join(","));
}

export function forgetTrustedOrigins(): void {
  writeStorage(TRUSTED_ORIGINS_STORAGE_KEY, null);
  writeStorage(DENIED_ORIGINS_STORAGE_KEY, null);
}

/**
 * `?api=` de la URL, **sin aplicar**. `null` cuando no viene el parametro.
 * Una cadena vacia (`?api=`) es una propuesta valida: significa "volve al
 * mismo origen".
 */
export function pendingApiBase(): string | null {
  if (typeof window === "undefined" || !window.location?.search) return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("api")) return null;
  const proposed = normalizeBase(params.get("api") ?? "");
  // Si ya es el backend en uso no hay nada que confirmar.
  return proposed === getApiBase() ? null : proposed;
}

export function getApiBase(): string {
  const stored = readStorage(API_BASE_STORAGE_KEY);
  if (stored !== null) return normalizeBase(stored);

  const fromBuild = import.meta.env?.VITE_API_BASE_URL;
  if (typeof fromBuild === "string" && fromBuild.trim() !== "") return normalizeBase(fromBuild);

  return "";
}

/**
 * Quien quiere enterarse de que el backend cambio.
 *
 * Existe porque el backend **se puede cambiar sin recargar la pagina**
 * (`confirmPendingApiBase` desde el chip), y el unico lugar donde el panel dice
 * "estos numeros son ficcion" era un `const demo = isDemoMode()` evaluado al
 * montar (wargaming ronda 3, W25). Un enlace `?api=demo` cambiaba la fuente de
 * todos los numeros y dejaba el rotulo diciendo lo de antes — o su ausencia.
 *
 * Es una suscripcion pelada y no un `ref` de Vue a proposito: este modulo es la
 * politica de credenciales y no tiene que depender del framework (el mismo
 * motivo por el que no toca `window` fuera de los helpers de storage).
 */
type OyenteDeBackend = () => void;
const oyentes = new Set<OyenteDeBackend>();

export function onBackendChange(oyente: OyenteDeBackend): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

/** `null` vuelve al mismo origen. No recarga: el llamador decide. */
export function setApiBase(value: string | null): void {
  const normalized = normalizeBase(value);
  writeStorage(API_BASE_STORAGE_KEY, value === null || normalized === "" ? null : normalized);
  for (const oyente of oyentes) oyente();
}

export interface ConfirmOptions {
  /**
   * Ademas de guardar el backend, anotar su origen como digno de recibir la
   * llave. Es una segunda decision explicita: guardar a quien le hablo no es
   * lo mismo que decidir a quien le doy la credencial.
   */
  trust?: boolean;
}

/**
 * Aplica la propuesta de `?api=`. **Es el unico camino por el que un enlace
 * llega a `localStorage`**, y solo se llama desde un click.
 *
 * Devuelve la base guardada, o `null` si no habia nada pendiente.
 */
export function confirmPendingApiBase(options: ConfirmOptions = {}): string | null {
  const proposed = pendingApiBase();
  if (proposed === null) return null;
  setApiBase(proposed === "" ? null : proposed);
  if (options.trust) trustBackendOrigin(proposed);
  else denyBackendOrigin(proposed);
  return proposed;
}

/** Limpia el `?api=` de la barra de direcciones para que un F5 no vuelva a
 * ofrecer lo mismo. No cambia nada guardado. */
export function dismissPendingApiBase(): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.delete("api");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function isDemoMode(): boolean {
  return getApiBase() === DEMO_BASE;
}

export function apiUrl(path: string): string {
  const base = getApiBase();
  return base === "" || base === DEMO_BASE ? path : `${base}${path}`;
}

/** Como se clasifica el backend en uso ahora mismo. */
export function currentBackendVerdict(base: string = getApiBase()): OriginVerdict {
  return classifyBackend(base, {
    configured: configuredTrustedOrigins(),
    trusted: storedTrustedOrigins(),
    denied: storedDeniedOrigins(),
  });
}

/** Si la llave puede salir hacia el backend en uso. */
export function credentialAllowed(base: string = getApiBase()): boolean {
  return mayReceiveCredential(currentBackendVerdict(base));
}

export function getAccessToken(): string | null {
  const raw = readStorage(ACCESS_TOKEN_STORAGE_KEY);
  if (raw === null) return null;
  const value = raw.trim();
  return value === "" ? null : value;
}

export function setAccessToken(value: string | null): void {
  const normalized = value === null ? null : value.trim();
  writeStorage(ACCESS_TOKEN_STORAGE_KEY, normalized === null || normalized === "" ? null : normalized);
}
