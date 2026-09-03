/**
 * Los handlers HTTP, separados de `index.ts` a propósito.
 *
 * `index.ts` es el borde de Firebase: ahí se llama a `onRequest`, se elige la
 * región y se inicializa el SDK de admin. Nada de eso se puede ejecutar en un
 * test sin arrastrar el runtime entero. Acá abajo hay funciones que reciben sus
 * dependencias por parámetro (`Firestore`, `Auth`) y un par req/res — o sea,
 * exactamente lo que un test puede construir.
 *
 * Es la misma separación que en el server, donde la lógica de `/overview` vive
 * en `buildOverview` y la ruta sólo serializa.
 */
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { authenticate, AuthError } from "../auth/verify.js";
import { FirestoreLedger } from "../ledger/firestore-ledger.js";
import { buildFirebaseOverview } from "./overview.js";

/**
 * Los orígenes que pueden llamar al API desde un navegador.
 *
 * Lista fija, no `*`. Con `*` el navegador no manda credenciales, pero acá las
 * credenciales viajan en un header `Authorization` que el propio JS de la
 * página pone — o sea que `*` habilitaría a cualquier sitio a llamar al API con
 * el token que le hayan pasado. La lista es corta porque el panel vive en dos
 * URLs de Hosting y en el dev server local.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  "https://agentic-wallet-71314.web.app",
  "https://agentic-wallet-71314.firebaseapp.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

/** Devuelve true si ya se contestó el preflight y el handler no debe seguir. */
export function applyCors(req: Request, res: Response, allowed: readonly string[] = ALLOWED_ORIGINS): boolean {
  const origin = req.headers.origin;
  if (typeof origin === "string" && allowed.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Max-Age", "3600");
  }
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

export interface HealthPayload {
  ok: true;
  service: "agentic-wallet-functions";
  version: string;
  /** Sin datos de nadie: ni conteos de ledger, ni uid, ni proyecto. Un
   * healthcheck público que sepa cuántos usuarios hay es un contador de
   * clientes gratis para cualquiera. */
  ts: string;
}

/** `GET /health` — pública, sin auth. */
export function healthHandler(version: string) {
  return (req: Request, res: Response): void => {
    if (applyCors(req, res)) return;
    if (req.method !== "GET") {
      res.status(405).json({ error: "metodo_no_permitido" });
      return;
    }
    const payload: HealthPayload = {
      ok: true,
      service: "agentic-wallet-functions",
      version,
      ts: new Date().toISOString(),
    };
    res.status(200).json(payload);
  };
}

export interface OverviewDeps {
  auth: Auth;
  db: Firestore;
  /** Inyectable sólo para los tests: el "ahora" con el que se calcula el mes. */
  now?: () => Date;
}

/** `GET /overview` — exige ID token; lee SÓLO el ledger del uid del token. */
export function overviewHandler(deps: OverviewDeps) {
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
      if (error instanceof AuthError) {
        res.status(error.status).json({ error: error.code, detalle: error.message });
        return;
      }
      throw error;
    }

    // El uid sale del token y de ningun otro lado. Si alguna vez aparece un
    // `?uid=` en esta ruta, es un bug de seguridad, no una feature.
    const ledger = new FirestoreLedger(deps.db, uid);
    const overview = await buildFirebaseOverview(ledger, deps.now?.() ?? new Date());
    res.status(200).json(overview);
  };
}
