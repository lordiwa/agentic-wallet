/**
 * `POST /ingest` — lee el Gmail del usuario y escribe en SU ledger.
 *
 * Es la única ruta de este backend que descifra el refresh token, y por eso es
 * la única (junto al callback del OAuth) que declara los secretos en
 * `index.ts`. `leerRefreshToken` lo dice en su propio doc: si aparece importada
 * fuera de la ingesta, es un bug de seguridad.
 *
 * Orden: ID token → refresh token cifrado de Firestore → access token de Google
 * → pipeline → resumen. El `sinceTs` sale de `config/sync` y se avanza sólo si
 * la corrida terminó bien, igual que el motor: avanzarlo antes convierte un
 * fallo a mitad de camino en un agujero permanente en el ledger.
 *
 * **POST y no GET** aunque parezca una lectura: escribe movimientos, cuesta
 * plata en cuota de Gmail, y un GET termina en el historial del navegador y en
 * los logs de Hosting.
 */
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { authenticate, AuthError } from "../auth/verify.js";
import { crearClienteGmail, GmailError, type FetchLike } from "../ingest/gmail-client.js";
import { ingestar, type ResumenIngesta } from "../ingest/pipeline.js";
import { FirestoreLedger } from "../ledger/firestore-ledger.js";
import * as paths from "../ledger/paths.js";
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

/**
 * Desde cuándo leer cuando el tenant nunca sincronizó.
 *
 * **No hay default de conveniencia** (CLAUDE.md regla 3): no se inventa "los
 * últimos 90 días". Si no hay `lastSyncTs`, el llamador tiene que decir desde
 * cuándo con `sinceTs` en el body, y si no lo dice se contesta 400. Elegir una
 * fecha por él sería decidir cuánto de su historia existe.
 */
export async function resolverSinceTs(
  db: Firestore,
  uid: string,
  pedido: unknown
): Promise<string | null> {
  if (typeof pedido === "string" && pedido.trim() !== "") return pedido.trim();
  const snap = await paths.configDoc(db, uid, "sync").get();
  const doc = snap.exists ? (snap.data() as { lastSyncTs?: unknown }) : {};
  return typeof doc.lastSyncTs === "string" && doc.lastSyncTs !== "" ? doc.lastSyncTs : null;
}

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

    const cuerpo = (req.body ?? {}) as { sinceTs?: unknown; maxMensajes?: unknown };
    const sinceTs = await resolverSinceTs(deps.db, uid, cuerpo.sinceTs);
    if (sinceTs === null) {
      res.status(400).json({
        error: "falta_since_ts",
        detalle: "este tenant nunca sincronizo: mande sinceTs para decidir desde cuando leer",
      });
      return;
    }

    const refreshToken = await leerRefreshToken(deps.db, uid, deps.config.clavesDeLectura);
    if (refreshToken === null) {
      res.status(409).json({ error: "gmail_no_conectado" });
      return;
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
        // reconectar. Cualquier otro error es transitorio y NO invalida nada —
        // marcar por un 500 de Google desconectaría al usuario sin motivo.
        if (error.code === "invalid_grant") {
          await marcarInvalido(deps.db, uid, error.code, deps.now?.() ?? new Date());
          res.status(409).json({ error: "gmail_reconectar", detalle: error.code });
          return;
        }
        res.status(502).json({ error: "google_no_responde", detalle: error.code });
        return;
      }
      throw error;
    }

    const config = await new FirestoreLedger(deps.db, uid).strategyConfig();

    let resumen: ResumenIngesta;
    try {
      resumen = await ingestar(
        {
          db: deps.db,
          uid,
          gmail: crearClienteGmail(accessToken, fetchImpl),
          offsetHours: config.utcOffsetHours,
        },
        {
          sinceTs,
          maxMensajes: typeof cuerpo.maxMensajes === "number" ? cuerpo.maxMensajes : undefined,
        }
      );
    } catch (error) {
      if (error instanceof GmailError) {
        res.status(502).json({ error: "gmail_fallo", detalle: `http_${error.status}` });
        return;
      }
      throw error;
    }

    // Se avanza DESPUÉS de que la corrida terminó, y al `ts` del correo más
    // nuevo que se vio — no a "ahora". Usar el reloj adelantaría la marca por
    // encima de correos que Gmail todavía no había indexado.
    if (resumen.ultimoTs !== null) {
      await paths.configDoc(deps.db, uid, "sync").set(
        { lastSyncTs: resumen.ultimoTs, lastIngestAt: (deps.now?.() ?? new Date()).toISOString() },
        { merge: true }
      );
    }

    res.set("Cache-Control", "no-store");
    res.status(200).json(resumen);
  };
}
