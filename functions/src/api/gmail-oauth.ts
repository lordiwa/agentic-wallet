/**
 * Las tres rutas del consentimiento de Gmail.
 *
 * ```
 *   POST /gmailAuthStart      ID token  →  { authUrl, state }      el panel abre authUrl
 *   GET  /gmailAuthCallback   ?code&state  →  302 al panel          lo llama GOOGLE, no el panel
 *   GET  /gmailAuthStatus     ID token  →  { conectado: bool }     nunca el token
 * ```
 *
 * **La asimetría de autenticación entre `start` y `callback` es el punto que
 * hay que entender.** `start` exige ID token: es el panel hablando y ahí sabemos
 * quién es. `callback` NO puede exigirlo — lo invoca el navegador siguiendo un
 * `302` de accounts.google.com, sin ningún header nuestro. Por eso el `state`
 * es la única prueba de identidad que tiene el callback, y por eso es
 * imposible de adivinar, de un solo uso y con vencimiento. Si el callback
 * aceptara un uid por query, cualquiera podría pegar el refresh token de su
 * propia cuenta en el tenant de otra persona (o al revés). Ver
 * `docs/pivot-firebase.md` §1.6.
 *
 * Como en `handlers.ts`, las dependencias entran por parámetro: estos handlers
 * se testean sin el runtime de Firebase.
 */
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { authenticate, AuthError } from "../auth/verify.js";
import { conResultado, urlDeVuelta, type OAuthConfig } from "../oauth/config.js";
import { canjearCode, correoDelToken, GoogleOAuthError, type FetchLike } from "../oauth/google.js";
import { guardarRefreshToken, leerEstado } from "../oauth/gmail-tokens.js";
import { construirAuthUrl, crearPkce, crearState, GMAIL_SCOPES } from "../oauth/pkce.js";
import { canjearState, guardarState, StateError } from "../oauth/state-store.js";
import { applyCors } from "./handlers.js";

export interface OAuthDeps {
  auth: Auth;
  db: Firestore;
  config: OAuthConfig;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

function responderAuthError(res: Response, error: unknown): boolean {
  if (error instanceof AuthError) {
    res.status(error.status).json({ error: error.code, detalle: error.message });
    return true;
  }
  return false;
}

/**
 * `POST /gmailAuthStart` — devuelve la URL de consentimiento.
 *
 * Es POST y no GET aunque no modifique el estado del usuario, porque sí escribe
 * un documento (el state) y porque un GET termina en el historial, en los logs
 * del proxy y en un prefetch del navegador. Un prefetch de esta ruta crearía
 * states fantasma cada vez que alguien pasa el mouse por encima del link.
 */
export function gmailStartHandler(deps: OAuthDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ error: "metodo_no_permitido" });
      return;
    }

    let uid: string;
    let email: string | null;
    try {
      ({ uid, email } = await authenticate(deps.auth, req));
    } catch (error) {
      if (responderAuthError(res, error)) return;
      throw error;
    }

    const state = crearState();
    const { verifier, challenge } = crearPkce();
    const body = (req.body ?? {}) as { returnTo?: unknown };
    const returnTo = typeof body.returnTo === "string" ? body.returnTo : undefined;

    await guardarState({
      db: deps.db,
      stateId: state,
      uid,
      verifier,
      // Se valida ACÁ, al guardarlo, no al usarlo: así el documento nunca
      // contiene una URL que no sea del panel, y el callback no tiene que
      // volver a desconfiar de su propia base.
      returnTo: urlDeVuelta(deps.config.panelOrigin, returnTo),
      master: deps.config.master,
      ahora: deps.now?.(),
    });

    const authUrl = construirAuthUrl({
      clientId: deps.config.clientId,
      redirectUri: deps.config.redirectUri,
      state,
      codeChallenge: challenge,
      scopes: GMAIL_SCOPES,
      loginHint: email,
    });

    // El `state` vuelve al panel sólo para que pueda mostrar "esperando a
    // Google" y descartarlo si el usuario cancela. No autoriza nada por sí
    // solo: sin el `code` de Google no sirve de nada.
    res.status(200).json({ authUrl, state, scopes: GMAIL_SCOPES });
  };
}

/** Los códigos con los que el callback vuelve al panel. Son cortos y no dicen
 * nada de nadie: viajan en una URL que queda en el historial. */
export type ResultadoCallback =
  | "ok"
  | "cancelado"
  | "state_invalido"
  | "sin_refresh_token"
  | "scope_insuficiente"
  | "google_rechazo"
  | "error";

/**
 * `GET /gmailAuthCallback` — el redirect de Google.
 *
 * Siempre termina en un `302` al panel, incluso cuando falla. Mostrar un JSON
 * de error en `cloudfunctions.net` dejaría al usuario en una página en blanco
 * fuera de la app, sin forma de volver; el panel, en cambio, puede leer
 * `?gmail=<resultado>` y decir qué pasó en su propio idioma.
 *
 * La única excepción es un `state` que no valida: ahí el redirect va a la ruta
 * por defecto, porque el `returnTo` guardado es justamente lo que no se pudo
 * leer.
 */
export function gmailCallbackHandler(deps: OAuthDeps) {
  const fetchImpl = deps.fetchImpl ?? ((input, init) => fetch(input, init));

  return async (req: Request, res: Response): Promise<void> => {
    if (req.method !== "GET") {
      res.status(405).json({ error: "metodo_no_permitido" });
      return;
    }
    const porDefecto = urlDeVuelta(deps.config.panelOrigin, undefined);
    const volver = (url: string, resultado: ResultadoCallback): void => {
      // `Cache-Control: no-store` en TODAS las respuestas de esta ruta: la URL
      // que llega trae el `code`, y un intermediario que la cachee lo guarda.
      res.set("Cache-Control", "no-store");
      res.redirect(302, conResultado(url, "gmail", resultado));
    };

    const q = req.query as Record<string, unknown>;
    const state = typeof q.state === "string" ? q.state : "";
    const code = typeof q.code === "string" ? q.code : "";

    // El usuario apretó "Cancelar" en la pantalla de Google. Google manda
    // `?error=access_denied` y ningún code. No es un fallo: es una respuesta.
    if (typeof q.error === "string" && q.error !== "") {
      volver(porDefecto, "cancelado");
      return;
    }
    if (state === "" || code === "") {
      volver(porDefecto, "state_invalido");
      return;
    }

    // El state se consume ANTES de hablar con Google: si es inválido no hay
    // razón para gastar una llamada, y si es válido queda quemado aunque el
    // canje falle después. Un state que sobrevive a un canje fallido se puede
    // reintentar con otro code, que es medio replay.
    let canjeado;
    try {
      canjeado = await canjearState(deps.db, state, deps.config.master, deps.now?.());
    } catch (error) {
      if (error instanceof StateError) {
        volver(porDefecto, "state_invalido");
        return;
      }
      // DecryptError entra acá: el documento existía pero fue manipulado.
      volver(porDefecto, "state_invalido");
      return;
    }

    let tokens;
    try {
      tokens = await canjearCode(
        {
          code,
          codeVerifier: canjeado.verifier,
          clientId: deps.config.clientId,
          clientSecret: deps.config.clientSecret,
          redirectUri: deps.config.redirectUri,
        },
        fetchImpl
      );
    } catch (error) {
      if (error instanceof GoogleOAuthError) {
        volver(canjeado.returnTo, "google_rechazo");
        return;
      }
      volver(canjeado.returnTo, "error");
      return;
    }

    if (tokens.refreshToken === null) {
      // Pasa cuando la cuenta ya había autorizado este cliente y Google decide
      // no reemitir. Sin refresh token no hay ingesta mañana, así que NO se
      // guarda nada a medias: el usuario reintenta y el `prompt=consent` de la
      // URL hace que la segunda vez sí venga.
      volver(canjeado.returnTo, "sin_refresh_token");
      return;
    }

    // En la pantalla de Google se pueden destildar permisos. Un token sin
    // `gmail.readonly` no sirve para nada y guardarlo daría un "conectado" que
    // falla recién en la primera ingesta.
    const faltantes = GMAIL_SCOPES.filter((s) => !tokens.scopes.includes(s));
    if (faltantes.length > 0) {
      volver(canjeado.returnTo, "scope_insuficiente");
      return;
    }

    const email = await correoDelToken(tokens.accessToken, fetchImpl);

    await guardarRefreshToken({
      db: deps.db,
      uid: canjeado.uid,
      refreshToken: tokens.refreshToken,
      email,
      scopes: tokens.scopes,
      master: deps.config.master,
      ahora: deps.now?.(),
    });

    volver(canjeado.returnTo, "ok");
  };
}

/**
 * `GET /gmailAuthStatus` — ¿está conectado?
 *
 * Devuelve metadatos y **nunca** el token, ni cifrado. Que el blob esté cifrado
 * no lo hace publicable: es el material sobre el que trabajaría cualquier
 * intento offline si mañana la clave se filtra.
 */
export function gmailStatusHandler(deps: Pick<OAuthDeps, "auth" | "db">) {
  return async (req: Request, res: Response): Promise<void> => {
    if (applyCors(req, res)) return;
    if (req.method !== "GET") {
      res.status(405).json({ error: "metodo_no_permitido" });
      return;
    }

    let uid: string;
    try {
      ({ uid } = await authenticate(deps.auth, req));
    } catch (error) {
      if (responderAuthError(res, error)) return;
      throw error;
    }

    res.set("Cache-Control", "no-store");
    res.status(200).json(await leerEstado(deps.db, uid));
  };
}
