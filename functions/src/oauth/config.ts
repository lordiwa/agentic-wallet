/**
 * La configuración del flujo OAuth: de dónde salen el client id, el secreto, la
 * URL del callback y la del panel.
 *
 * Todo entra por variables de entorno porque es así como el runtime de Cloud
 * Functions inyecta los secretos de Secret Manager (`defineSecret` en
 * `index.ts` los publica como env vars del proceso, sólo en las funciones que
 * los declaran). Que el mismo mecanismo sirva para los tests es la ventaja
 * lateral: un test setea `process.env` y listo, sin mocks del SDK.
 *
 * **Nada de esto tiene default.** Un `?? "algo"` acá sería una función que
 * arranca contra un client id equivocado y falla mucho después, en la pantalla
 * de Google, con un error que no señala a este archivo.
 */
import { masterKeyFromEnv, type MasterKey } from "./crypto.js";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Tiene que coincidir EXACTAMENTE con una de las "Authorized redirect URIs"
   * del cliente OAuth en la consola de Google, byte por byte: Google compara
   * strings, no URLs normalizadas. Una barra final de más y el canje falla con
   * `redirect_uri_mismatch`. */
  redirectUri: string;
  /** Origen del panel. Es la base de todos los redirects de vuelta, y la
   * allowlist de una sola entrada que impide que este flujo se use como
   * redirector abierto. */
  panelOrigin: string;
  /** La clave activa: con ésta se cifra todo lo nuevo. */
  master: MasterKey;
  /** Claves con las que todavía hay que poder DESCIFRAR — la activa más las
   * viejas de una rotación en curso. */
  clavesDeLectura: MasterKey[];
}

function requerido(env: NodeJS.ProcessEnv, nombre: string): string {
  const valor = env[nombre];
  if (valor === undefined || valor.trim() === "") {
    throw new Error(`falta la variable ${nombre}`);
  }
  return valor.trim();
}

/**
 * Claves viejas para una rotación: `WALLET_TOKEN_KEK_PREVIOUS` con
 * `version:base64` separados por coma. Vacío en operación normal.
 */
function clavesPrevias(env: NodeJS.ProcessEnv): MasterKey[] {
  const raw = env.WALLET_TOKEN_KEK_PREVIOUS;
  if (raw === undefined || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((par) => par.trim())
    .filter((par) => par !== "")
    .map((par) => {
      const corte = par.indexOf(":");
      if (corte <= 0) throw new Error("WALLET_TOKEN_KEK_PREVIOUS: se esperaba version:base64");
      const version = Number.parseInt(par.slice(0, corte), 10);
      const key = Buffer.from(par.slice(corte + 1), "base64");
      if (!Number.isInteger(version) || version < 1 || key.length !== 32) {
        throw new Error("WALLET_TOKEN_KEK_PREVIOUS: version o largo de clave invalidos");
      }
      return { version, key };
    });
}

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): OAuthConfig {
  const master = masterKeyFromEnv(env);
  const previas = clavesPrevias(env);
  if (previas.some((k) => k.version === master.version)) {
    throw new Error("una clave previa repite la version de la activa");
  }
  return {
    clientId: requerido(env, "WALLET_GMAIL_CLIENT_ID"),
    clientSecret: requerido(env, "WALLET_GMAIL_CLIENT_SECRET"),
    redirectUri: requerido(env, "WALLET_OAUTH_REDIRECT_URI"),
    panelOrigin: requerido(env, "WALLET_PANEL_ORIGIN").replace(/\/+$/, ""),
    master,
    clavesDeLectura: [master, ...previas],
  };
}

/** Ruta por defecto a la que vuelve el navegador tras conectar. Hash routing
 * porque el panel usa `createWebHashHistory`. */
export const RUTA_EXITO = "/#/conectado";
export const RUTA_ERROR = "/#/conectado";

/**
 * Convierte un `returnTo` que vino del cliente en una URL absoluta del panel, o
 * devuelve la ruta por defecto.
 *
 * **Esto es lo que impide que la función sea un redirector abierto.** Un
 * `returnTo` sin validar convierte nuestro dominio en el trampolín ideal para
 * un phishing: el link empieza en `cloudfunctions.net` —que es nuestro— y
 * termina en el sitio de quien lo armó. Peor todavía, un redirect a un dominio
 * ajeno con el `code` en la URL le regala el código de autorización.
 *
 * Sólo se aceptan rutas relativas de una barra. `//malo.example` se rechaza
 * porque es protocol-relative: el navegador lo lee como un host, no como una
 * ruta.
 */
export function urlDeVuelta(panelOrigin: string, returnTo: string | undefined): string {
  if (typeof returnTo !== "string" || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return panelOrigin + RUTA_EXITO;
  }
  // Un backslash lo normalizan algunos navegadores a "/", así que "/\ajeno" se
  // volvería "//ajeno" — el mismo escape por otra puerta.
  if (returnTo.includes("\\")) return panelOrigin + RUTA_EXITO;
  return panelOrigin + returnTo;
}

/** Agrega un parámetro de resultado al redirect de vuelta, para que el panel
 * pueda decir qué pasó sin tener que preguntarle al API. */
export function conResultado(url: string, clave: string, valor: string): string {
  // No se usa `new URL().searchParams` porque el destino lleva hash routing y
  // el query tiene que quedar ANTES del `#` para que Vue Router lo vea.
  const corte = url.indexOf("#");
  const base = corte === -1 ? url : url.slice(0, corte);
  const hash = corte === -1 ? undefined : url.slice(corte + 1);
  const separador = base.includes("?") ? "&" : "?";
  const query = `${separador}${encodeURIComponent(clave)}=${encodeURIComponent(valor)}`;
  return hash === undefined ? base + query : `${base}${query}#${hash}`;
}
