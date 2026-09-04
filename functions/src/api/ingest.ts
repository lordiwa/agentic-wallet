/**
 * `POST /api/sync` — lee el Gmail del usuario y escribe en SU ledger.
 *
 * Es la única ruta de este backend que descifra el refresh token, y por eso es
 * la única (junto al callback del OAuth) que declara los secretos en
 * `index.ts`. `leerRefreshToken` lo dice en su propio doc: si aparece importada
 * fuera de la ingesta, es un bug de seguridad. **Ésa es la razón por la que
 * esta ruta no vive en la función `api`** con las otras dieciocho: mantenerla
 * aparte es lo que hace que el resto del backend no tenga la clave maestra en
 * su proceso ni por accidente, y además le deja su propio timeout de 540 s y su
 * concurrencia 1.
 *
 * Orden: ID token → guarda de sync → refresh token cifrado de Firestore →
 * access token de Google → drenado de un lote del backlog → resumen.
 *
 * **Los códigos de estado son los que el panel sabe leer** (`lib/sync-estado.ts`
 * los usa para elegir el cartel, y `Resumen.vue` los reconoce por el `error`
 * del cuerpo):
 *
 * | situación | status | `error` |
 * |---|---|---|
 * | ya hay un lote corriendo | 409 | `sync_already_running` |
 * | Gmail no conectado, o el permiso ya no existe | 503 | `gmail_not_configured` |
 * | Google no responde | 502 | `google_no_responde` |
 *
 * El permiso revocado comparte el 503 con el "nunca conectaste" a propósito:
 * para esta pantalla las dos cosas son "falta la credencial de Gmail", y quién
 * tiene que reconectar lo dice el chip de Gmail, que lee `gmailAuthStatus` y
 * tiene `necesitaReconectar`. El motivo exacto viaja igual en `detalle`.
 *
 * **POST y no GET** aunque parezca una lectura: escribe movimientos, cuesta
 * cuota de Gmail, y un GET termina en el historial del navegador y en los logs
 * de Hosting.
 */
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { authenticate, AuthError } from "../auth/verify.js";
import { crearClienteGmail, GmailError, type FetchLike } from "../ingest/gmail-client.js";
import { conGuardaDeSync, runSync, type ResultadoSync } from "../ingest/sync.js";
import { FirestoreLedger } from "../ledger/firestore-ledger.js";
import type { OAuthConfig } from "../oauth/config.js";
import { GoogleOAuthError, refrescarAccessToken } from "../oauth/google.js";
import { leerRefreshToken, marcarInvalido } from "../oauth/gmail-tokens.js";
import { applyCors } from "./handlers.js";

export interface IngestDeps {
  auth: Auth;
  db: Firestore;
  config: OAuthConfig;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

/** El tope que acepta `batch_size`, el mismo que el motor. Un número absurdo es
 * un 400 y no un lote que corre media hora contra Gmail. */
export const MAX_BATCH_SIZE = 500;

export function ingestHandler(deps: IngestDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ error: "metodo_no_permitido" });
      return;
    }

    let uid: string;
    try {
      ({ uid } = await authenticate(deps.auth, req));
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(error.status).json({ error: error.code, detalle: error.message });
        return;
      }
      throw error;
    }

    const cuerpo = (req.body ?? {}) as { sinceTs?: unknown; batch_size?: unknown; maxMensajes?: unknown };
    const pedido = cuerpo.batch_size ?? cuerpo.maxMensajes;
    let batchSize: number | undefined;
    if (pedido !== undefined) {
      if (
        typeof pedido !== "number" ||
        !Number.isInteger(pedido) ||
        pedido <= 0 ||
        pedido > MAX_BATCH_SIZE
      ) {
        res.status(400).json({ error: "batch_size_invalido", detalle: `1..${MAX_BATCH_SIZE}` });
        return;
      }
      batchSize = pedido;
    }

    const now = deps.now?.() ?? new Date();
    const ledger = new FirestoreLedger(deps.db, uid);

    // La guarda va ANTES de tocar el token: dos lotes a la vez sobre el mismo
    // buzón se pelean el CPU, gastan cuota doble y no adelantan nada.
    const salida = await conGuardaDeSync(ledger, now, async (): Promise<
      { ok: true; resultado: ResultadoSync } | { ok: false; status: number; body: Record<string, unknown> }
    > => {
      const refreshToken = await leerRefreshToken(deps.db, uid, deps.config.clavesDeLectura);
      if (refreshToken === null) {
        return {
          ok: false,
          status: 503,
          body: { error: "gmail_not_configured", detalle: "gmail_no_conectado" },
        };
      }

      const fetchImpl = deps.fetchImpl ?? (fetch as FetchLike);
      let accessToken: string;
      try {
        ({ accessToken } = await refrescarAccessToken(
          {
            refreshToken,
            clientId: deps.config.clientId,
            clientSecret: deps.config.clientSecret,
          },
          fetchImpl
        ));
      } catch (error) {
        if (error instanceof GoogleOAuthError) {
          // `invalid_grant` es el permiso que ya no existe: se marca y se pide
          // reconectar. Cualquier otro error es transitorio y NO invalida nada
          // — marcar por un 500 de Google desconectaría al usuario sin motivo.
          if (error.code === "invalid_grant") {
            await marcarInvalido(deps.db, uid, error.code, now);
            return {
              ok: false,
              status: 503,
              body: { error: "gmail_not_configured", detalle: "gmail_reconectar" },
            };
          }
          return { ok: false, status: 502, body: { error: "google_no_responde", detalle: error.code } };
        }
        throw error;
      }

      const config = await ledger.strategyConfig();

      try {
        const resultado = await runSync(
          {
            db: deps.db,
            uid,
            gmail: crearClienteGmail(accessToken, fetchImpl),
            offsetHours: config.utcOffsetHours,
          },
          {
            batchSize,
            now,
            desdeTs: typeof cuerpo.sinceTs === "string" ? cuerpo.sinceTs : undefined,
          }
        );
        return { ok: true, resultado };
      } catch (error) {
        if (error instanceof GmailError) {
          return { ok: false, status: 502, body: { error: "gmail_fallo", detalle: `http_${error.status}` } };
        }
        throw error;
      }
    });

    if (salida === null) {
      res.status(409).json({ error: "sync_already_running" });
      return;
    }
    if (!salida.ok) {
      res.status(salida.status).json(salida.body);
      return;
    }

    res.set("Cache-Control", "no-store");
    // `progress` e `inserted_ids` se repiten fuera del resumen para que el
    // cliente no tenga que saber qué forma tiene el resumen del motor: con
    // `complete:false` hay que volver a pulsar, y `inserted_ids` es a lo que
    // apunta el aviso post-sync de categoría, acotado a ESTE lote.
    res.status(200).json({
      summary: salida.resultado,
      progress: salida.resultado.progress,
      inserted_ids: salida.resultado.insertedIds,
    });
  };
}
