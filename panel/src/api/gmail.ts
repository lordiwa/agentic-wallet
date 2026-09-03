/**
 * Las dos rutas del consentimiento de Gmail que el panel sí llama.
 *
 * La tercera —`gmailAuthCallback`— la invoca **Google**, no este código: el
 * panel sólo ve su resultado en `?gmail=` cuando el navegador vuelve. Por eso
 * acá hay dos funciones y no tres.
 *
 * **Este módulo no pasa por `panelFetch`, y es a propósito.** Las Cloud
 * Functions viven en otro origen (`cloudfunctions.net`) y con otra credencial:
 * un **ID token de Firebase**, no la llave del server (`WALLET_ACCESS_TOKEN`).
 * Mandar una donde va la otra sería filtrar la llave del server a un host que
 * no la necesita —exactamente el R1 que `api/base.ts` existe para evitar—, así
 * que las dos credenciales no comparten camino ni por accidente.
 */
import { isDemoMode } from "./base";
import type { EstadoGmail } from "../lib/gmail-estado";

export interface RespuestaStart {
  authUrl: string;
  state: string;
  scopes: string[];
}

/**
 * De dónde salen las funciones. Vacío por defecto: nada precargado que sea de
 * un despliegue concreto (CLAUDE.md, regla 3). El valor real del piloto se fija
 * en el build con `VITE_FUNCTIONS_BASE_URL` — ver `docs/pivot-firebase.md`.
 */
export function getFunctionsBase(): string {
  const raw = import.meta.env?.VITE_FUNCTIONS_BASE_URL;
  if (typeof raw !== "string") return "";
  // Sin la barra final: los paths ya empiezan con "/".
  return raw.trim().replace(/\/+$/, "");
}

export function gmailConfigurado(): boolean {
  return getFunctionsBase() !== "";
}

/**
 * Quién sabe el ID token de Firebase.
 *
 * Es un proveedor inyectable y no una llamada directa al SDK de Firebase por
 * dos razones: los tests no necesitan un proyecto real, y el panel todavía no
 * tiene el login de Firebase cableado (ver `docs/pivot-firebase.md`). Cuando lo
 * tenga, `main.ts` registra acá el `getIdToken()` del SDK y nada más cambia.
 */
export type ProveedorIdToken = () => Promise<string | null>;

let proveedor: ProveedorIdToken = async () => null;

export function setProveedorIdToken(nuevo: ProveedorIdToken): void {
  proveedor = nuevo;
}

export async function obtenerIdToken(): Promise<string | null> {
  try {
    return await proveedor();
  } catch {
    // Un proveedor que falla es "no hay sesión", no una excepción que rompa la
    // pantalla: el usuario ve el estado "entrá para conectar tu correo".
    return null;
  }
}

/** El estado que muestra el modo demostración. Ficticio y sin salir a la red,
 * como el resto de `demo/demoFetch.ts`. */
const ESTADO_DEMO: EstadoGmail = {
  conectado: true,
  email: "demo@ejemplo.test",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  grantedAt: "2026-01-15T12:00:00.000Z",
  necesitaReconectar: false,
};

export class GmailApiError extends Error {}

function conIdToken(fetchImpl: typeof fetch, path: string, init: RequestInit, idToken: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${idToken}`);
  return fetchImpl(`${getFunctionsBase()}${path}`, { ...init, headers });
}

/**
 * `GET /gmailAuthStatus`.
 *
 * **El modo demostración gobierna sólo mientras no hay sesión**, y ese orden
 * importa en el sitio publicado: ahí el build trae `demo` como backend del
 * ledger *y* la URL de las funciones, porque son dos backends distintos. Quien
 * no entró ve la ficción de siempre; quien entró con su cuenta tiene una
 * respuesta de verdad que darle, y seguir inventándola le mostraría un correo
 * conectado que no es el suyo.
 */
export async function consultarEstadoGmail(fetchImpl: typeof fetch = fetch): Promise<EstadoGmail> {
  const idToken = await obtenerIdToken();
  if (idToken === null) {
    if (isDemoMode()) return ESTADO_DEMO;
    throw new GmailApiError("sin sesión");
  }
  if (!gmailConfigurado()) throw new GmailApiError("falta VITE_FUNCTIONS_BASE_URL");

  const res = await conIdToken(fetchImpl, "/gmailAuthStatus", { method: "GET" }, idToken);
  if (!res.ok) throw new GmailApiError(`gmailAuthStatus respondió ${res.status}`);
  return (await res.json()) as EstadoGmail;
}

/**
 * `POST /gmailAuthStart`.
 *
 * `returnTo` es una ruta del panel, no una URL: el backend sólo acepta las que
 * empiezan con "/" y las pega a su propio origen (`urlDeVuelta` en
 * `functions/src/oauth/config.ts`). Mandar una URL absoluta acá no abre un
 * redirector: la descarta y usa la ruta por defecto.
 */
export async function iniciarConexionGmail(
  returnTo: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<RespuestaStart> {
  if (!gmailConfigurado()) throw new GmailApiError("falta VITE_FUNCTIONS_BASE_URL");

  const idToken = await obtenerIdToken();
  if (idToken === null) throw new GmailApiError("sin sesión");

  const res = await conIdToken(
    fetchImpl,
    "/gmailAuthStart",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(returnTo === undefined ? {} : { returnTo }),
    },
    idToken
  );
  if (!res.ok) throw new GmailApiError(`gmailAuthStart respondió ${res.status}`);

  const cuerpo = (await res.json()) as Partial<RespuestaStart>;
  if (typeof cuerpo.authUrl !== "string" || cuerpo.authUrl === "") {
    throw new GmailApiError("gmailAuthStart no devolvió authUrl");
  }
  return {
    authUrl: cuerpo.authUrl,
    state: typeof cuerpo.state === "string" ? cuerpo.state : "",
    scopes: Array.isArray(cuerpo.scopes) ? cuerpo.scopes : [],
  };
}
