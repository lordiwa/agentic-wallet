/**
 * PKCE (RFC 7636) y la URL de consentimiento de Google.
 *
 * **Por qué PKCE si el cliente es confidencial.** Nuestro cliente OAuth es de
 * tipo web y tiene `client_secret`, así que en teoría PKCE es opcional: Google
 * no canjea un `code` sin el secreto. Se usa igual porque tapa un agujero que
 * el secreto no tapa — la **inyección de código de autorización**. Si alguien
 * consigue que el navegador de la víctima llegue al callback con un `code`
 * ajeno (por un redirect abierto, por un log, por el historial), sin PKCE ese
 * `code` se canjea igual y el token de OTRA cuenta termina guardado en el
 * tenant de la víctima. Con PKCE, el canje exige el `code_verifier` que sólo
 * existe del lado nuestro, atado a ESE `state`. Es la recomendación vigente de
 * OAuth 2.1 y de las BCP: PKCE en todos los clientes, no sólo en los públicos.
 *
 * `S256` y nunca `plain`. `plain` manda el verifier tal cual en la URL de
 * autorización, o sea que quien pueda leer esa URL puede canjear el code.
 */
import { createHash, randomBytes } from "node:crypto";

/** Endpoint de autorización de Google. */
export const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
/** Endpoint de canje de tokens. */
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
/** Endpoint de revocación. */
export const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/**
 * El scope, y sólo éste.
 *
 * `gmail.readonly` es el mínimo que permite `messages.list` + `messages.get`,
 * que es literalmente todo lo que hace la ingesta. No hay `gmail.modify` (nos
 * dejaría borrar correos del banco), no hay `gmail.send`, no hay `userinfo`
 * extra: la identidad ya la da Firebase Auth.
 *
 * Se deja explícito en un solo lugar porque agregar un scope acá es una
 * decisión de producto —cambia lo que la pantalla de Google le promete al
 * usuario— y no un detalle de implementación.
 */
export const GMAIL_SCOPES: readonly string[] = ["https://www.googleapis.com/auth/gmail.readonly"];

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/**
 * Verifier de 43-128 caracteres del alfabeto unreserved (RFC 7636 §4.1). 32
 * bytes aleatorios en base64url dan 43 caracteres, el mínimo legal, con 256
 * bits de entropía — que es de sobra: el verifier vive diez minutos.
 */
export function crearVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function challengeS256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function crearPkce(): PkcePair {
  const verifier = crearVerifier();
  return { verifier, challenge: challengeS256(verifier) };
}

/** Un identificador de `state` opaco y de largo fijo. 32 bytes: adivinarlo no
 * es una estrategia. */
export function crearState(): string {
  return randomBytes(32).toString("base64url");
}

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
  /** Sugerencia de qué cuenta preseleccionar. Es una comodidad, NO una
   * restricción: el usuario puede elegir otra en la pantalla de Google, y por
   * eso el callback igual verifica de qué cuenta vino el token. */
  loginHint?: string | null;
}

/**
 * Arma la URL de consentimiento.
 *
 * `access_type=offline` + `prompt=consent` es la única combinación que
 * garantiza un `refresh_token` en la respuesta. Sin `prompt=consent`, Google
 * devuelve refresh token sólo la PRIMERA vez que esa cuenta autoriza este
 * cliente; en el segundo intento manda sólo un access token y el flujo
 * "reconectá tu Gmail" quedaría roto de una forma difícil de ver, porque el 200
 * de Google llega igual.
 *
 * `include_granted_scopes=false` a propósito: no queremos acumular en este
 * token permisos que el usuario le dio a otra app nuestra.
 */
export function construirAuthUrl(params: AuthUrlParams): string {
  const url = new URL(AUTH_ENDPOINT);
  const q = url.searchParams;
  q.set("client_id", params.clientId);
  q.set("redirect_uri", params.redirectUri);
  q.set("response_type", "code");
  q.set("scope", (params.scopes ?? GMAIL_SCOPES).join(" "));
  q.set("access_type", "offline");
  q.set("prompt", "consent");
  q.set("include_granted_scopes", "false");
  q.set("state", params.state);
  q.set("code_challenge", params.codeChallenge);
  q.set("code_challenge_method", "S256");
  if (params.loginHint) q.set("login_hint", params.loginHint);
  return url.toString();
}
