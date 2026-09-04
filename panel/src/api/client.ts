/**
 * El unico punto por donde el panel sale a la red, y el diagnostico de por
 * que no salio.
 *
 * R27, el motivo de que esto exista: desde un navegador, un server caido, un
 * origen que la lista blanca de CORS no permite y una credencial rechazada
 * producen **el mismo** `TypeError: Failed to fetch`. Sin `GET /api/health`
 * —que el server responde sin llave a proposito— el chip solo podria decir
 * "no anda", que es exactamente lo que ya se ve.
 */
import { credentialAllowed, currentBackendVerdict, getAccessToken, getApiBase, isDemoMode } from "./base";
import { demoFetch } from "../demo/demoFetch";
import { getFunctionsBase, obtenerIdToken } from "./gmail";
import { DEMO_BASE, mayReceiveCredential, normalizeBase } from "./origins";
import type { OriginVerdict } from "./origins";

export type EstadoConexion =
  /** Datos inventados: no se llamo a nadie. */
  | "demo"
  /** Respondio y la llave (si hace falta) sirve. */
  | "conectado"
  /** Pide llave y este navegador no tiene ninguna cargada. */
  | "sin-llave"
  /** Pide llave, mandamos una, y la rechazo. */
  | "llave-rechazada"
  /** El backend esta fuera de la lista blanca: se le habla sin credencial. */
  | "no-autorizado"
  /** Ni siquiera respondio: caido, o el origen no pasa el CORS del server. */
  | "sin-respuesta";

export interface DiagnosticoConexion {
  estado: EstadoConexion;
  /** La base tal cual se resolvio. `""` es el mismo origen. */
  base: string;
  verdict: OriginVerdict;
  /** Si el server declaro pedir llave. `null` cuando no llego a contestar. */
  authRequired: boolean | null;
}

export interface HealthResponse {
  status?: string;
  auth_required?: boolean;
  authenticated?: boolean;
}

export function apiUrlFor(base: string, path: string): string {
  const value = normalizeBase(base);
  return value === "" || value === DEMO_BASE ? path : `${value}${path}`;
}

/**
 * Agrega `Authorization` **solo** si el backend en uso puede recibirla. Un
 * backend ajeno se llama igual, pero pelado: es preferible un 401 que se
 * explica a un 200 conseguido regalando la llave.
 */
export function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  const token = getAccessToken();
  if (token !== null && credentialAllowed()) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

/**
 * Las rutas que NO viven en la funcion `api`, con el nombre que tienen.
 *
 * Hasta el portado completo esto era al reves: una lista explicita de lo UNICO
 * que existia (`/api/overview`), porque un prefijo habria mandado
 * `/api/transactions` a una funcion inexistente y el panel habria leido el 404
 * de Firebase como si fuera del backend. Ya no: **todo `/api/*` lo sirve la
 * funcion `api`**, y lo que queda aca son las dos excepciones, cada una por su
 * motivo (ver el doc de `functions/src/api/router.ts`).
 *
 * - `/api/sync` -> `ingest`, la unica funcion que descifra el refresh token.
 *   Tenerla aparte es lo que hace que el resto del backend no tenga la clave
 *   maestra en su proceso; ademas necesita 540 s de timeout.
 * - `/api/health` -> `health`, la sonda publica, que no comparte proceso con
 *   nada que lea un ledger.
 */
export const RUTAS_APARTE: Readonly<Record<string, string>> = {
  "/api/sync": "/ingest",
  "/api/health": "/health",
};

/**
 * A donde va un path del panel dentro de las funciones. **Nunca `null`**: no
 * queda una sola ruta del flujo sin portar, asi que "esto todavia no lo leo de
 * tu cuenta" dejo de ser una respuesta posible.
 */
export function rutaEnFunciones(path: string): string {
  const [sinQuery, query] = path.split("?");
  const base = sinQuery ?? path;
  const destino = RUTAS_APARTE[base] ?? base;
  return query === undefined ? destino : `${destino}?${query}`;
}

/** Hay identidad y hay a donde hablarle: el backend real del pivot. */
async function backendDeFirebase(): Promise<string | null> {
  if (getFunctionsBase() === "") return null;
  return obtenerIdToken();
}

/**
 * El unico punto por donde salen las llamadas al ledger.
 *
 * **El modo demostracion gobierna solo mientras no hay sesion**, igual que en
 * `api/gmail.ts`. En el sitio publicado el build trae `demo` como backend del
 * ledger para quien mira de afuera; en cuanto alguien entra con su cuenta hay
 * datos de verdad que darle, y seguir inventandolos le mostraria el dinero de
 * nadie con la etiqueta de propio.
 *
 * La toma de control se limita al modo demostracion a proposito: si el usuario
 * configuro un server real (`?api=` confirmado, o un build con base propia),
 * ese server es su eleccion explicita y una sesion de Firebase no se la pisa.
 */
export async function panelFetch(path: string, init?: RequestInit): Promise<Response> {
  // N2 (T4): el modo demo ya tiene sus respuestas. No sale a la red — ni
  // siquiera al mismo origen — y por eso se decide aca y no en cada endpoint.
  if (isDemoMode()) {
    const idToken = await backendDeFirebase();
    if (idToken === null) return demoFetch(path, init);

    const ruta = rutaEnFunciones(path);
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${idToken}`);
    return fetch(`${getFunctionsBase()}${ruta}`, { ...init, headers });
  }
  return fetch(apiUrl(path), { ...init, headers: buildHeaders(init) });
}

function apiUrl(path: string): string {
  return apiUrlFor(getApiBase(), path);
}

/**
 * `GET /api/health` — el unico endpoint sin llave. Traduce la respuesta (o su
 * ausencia) a los seis estados de arriba, que son los que el chip sabe
 * explicar.
 */
export async function probeHealth(fetchImpl: typeof fetch = fetch): Promise<DiagnosticoConexion> {
  const base = getApiBase();
  const verdict = currentBackendVerdict(base);
  if (verdict === "demo") {
    // Con sesion el ledger ya NO sale del demo (ver `panelFetch`), asi que el
    // chip tampoco puede seguir diciendo "datos inventados": es el rotulo que
    // explica de donde salen los numeros de la pantalla, y mentiria sobre
    // numeros reales. W25 otra vez, ahora del lado de la sesion.
    const idToken = await backendDeFirebase();
    if (idToken === null) return { estado: "demo", base, verdict, authRequired: null };
    return probarFunciones(fetchImpl, idToken, base);
  }

  const token = getAccessToken();
  const conCredencial = token !== null && credentialAllowed(base);

  let body: HealthResponse;
  try {
    const res = await fetchImpl(apiUrlFor(base, "/api/health"), {
      headers: conCredencial ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return { estado: "sin-respuesta", base, verdict, authRequired: null };
    body = (await res.json()) as HealthResponse;
  } catch {
    return { estado: "sin-respuesta", base, verdict, authRequired: null };
  }

  const authRequired = body.auth_required === true;
  if (!authRequired) return { estado: "conectado", base, verdict, authRequired };
  if (body.authenticated === true) return { estado: "conectado", base, verdict, authRequired };

  // Pide llave y no entramos. El motivo cambia la accion que corresponde:
  // cargar la llave, cambiar de backend, o autorizar este backend.
  if (!mayGetCredential(verdict)) return { estado: "no-autorizado", base, verdict, authRequired };
  return { estado: token === null ? "sin-llave" : "llave-rechazada", base, verdict, authRequired };
}

/**
 * `GET /health` de las Cloud Functions.
 *
 * El veredicto sigue siendo `demo` —es lo que dice el build sobre el backend
 * del ledger— pero el ESTADO es el real: quien entro esta conectado a las
 * funciones, y el chip tiene que decir eso.
 */
async function probarFunciones(
  fetchImpl: typeof fetch,
  idToken: string,
  base: string
): Promise<DiagnosticoConexion> {
  try {
    const res = await fetchImpl(`${getFunctionsBase()}/health`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return { estado: "sin-respuesta", base, verdict: "demo", authRequired: true };
  } catch {
    return { estado: "sin-respuesta", base, verdict: "demo", authRequired: true };
  }
  // `authRequired: true` y no lo que diga `/health`: esa ruta es publica a
  // proposito, pero el ledger detras de ella exige el ID token igual.
  return { estado: "conectado", base, verdict: "demo", authRequired: true };
}

/**
 * La MISMA funcion que decide si la llave sale (`origins.ts`), y no una copia
 * con la lista al reves. La copia decia `verdict !== "foreign"`, asi que el
 * veredicto `denied` que trajo W27 —el usuario dijo explicitamente que no—
 * habria caido en "sin llave" ("cargate una llave") en vez de "no autorizado"
 * ("ese servidor no la recibe"), que es justo la decision que acababa de tomar.
 */
function mayGetCredential(verdict: OriginVerdict): boolean {
  return mayReceiveCredential(verdict);
}

/** Las cuatro etiquetas `.tag` del sistema (§2.1). El chip no elige colores:
 * elige una de estas clases, y el hex vive en tokens.css. */
export type ClaseTag = "ok" | "warn" | "bad" | "neu";

/** Estado -> etiqueta del sistema. `null` es "todavia no se probo". */
export function tagDeEstado(estado: EstadoConexion | null): { clase: ClaseTag; texto: string } {
  switch (estado) {
    case "conectado":
      return { clase: "ok", texto: "Conectado" };
    case "demo":
      return { clase: "neu", texto: "Demostración" };
    case "sin-llave":
      return { clase: "warn", texto: "Sin llave" };
    case "llave-rechazada":
      return { clase: "bad", texto: "Llave rechazada" };
    case "no-autorizado":
      return { clase: "bad", texto: "No autorizado" };
    case "sin-respuesta":
      return { clase: "bad", texto: "Sin respuesta" };
    default:
      return { clase: "neu", texto: "Sin probar" };
  }
}

/** Como se nombra el backend en el chip. Nunca la URL entera: el host alcanza
 * y no llena la barra. */
export function etiquetaBackend(base: string): string {
  const value = normalizeBase(base);
  if (value === "") return "este mismo servidor";
  if (value === DEMO_BASE) return "sin servidor";
  try {
    // `new URL("data:…")` y `new URL("javascript:…")` parsean feliz y dejan
    // `host` vacio, asi que el chip mostraba un nombre en blanco — y con el,
    // el cartel "este enlace quiere cambiar tu backend a ___" quedaba pidiendo
    // que se confirme algo que no se puede leer. Ese cartel ES la mitigacion de
    // R1 (wargaming ronda 2, W13): sin texto no mitiga nada.
    const host = new URL(value).host;
    return host === "" ? value : host;
  } catch {
    return value;
  }
}

/** El texto que el chip muestra, en el mismo lugar donde muestra el estado.
 * Vive aca y no en el componente para poder testear la explicacion sin
 * montar nada. */
export function explicarEstado(diag: DiagnosticoConexion): string {
  switch (diag.estado) {
    case "demo":
      return "Modo demostración — datos inventados, ninguna llamada real.";
    case "conectado":
      return diag.authRequired ? "Responde y la llave sirve." : "Responde. Este server no pide llave.";
    case "sin-llave":
      return "El server pide llave y este navegador no tiene ninguna cargada.";
    case "llave-rechazada":
      return "El server pide llave y rechazó la que tenés cargada.";
    case "no-autorizado":
      return "Ese servidor no está autorizado: se le habla sin credencial, por eso responde 401.";
    case "sin-respuesta":
      return "No respondió. O el server está caído, o tu origen no está en su lista de CORS.";
  }
}
