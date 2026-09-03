/**
 * La puerta minima: `Authorization: Bearer <WALLET_ACCESS_TOKEN>` sobre todo
 * `/api/*` (fase N0 de docs/plan-final-mvp.md, TASK-054).
 *
 * Tres decisiones que no son obvias:
 *
 * 1. **Sin `WALLET_ACCESS_TOKEN` esto es un no-op.** El proyecto es
 *    local-first y el limite de acceso historico lo pone `WALLET_BIND_HOST`
 *    (quien llega al puerto). Inventar una llave por default romperia el uso
 *    local de siempre sin agregar seguridad; exponer el server al tailnet es
 *    una decision explicita y la llave viaja con esa decision.
 *
 * 2. **`GET /api/health` queda fuera.** Es el unico diagnostico posible
 *    (R27): desde un navegador, un server caido, un origen que CORS no
 *    permite y una credencial rechazada producen exactamente el mismo
 *    `TypeError: Failed to fetch`. `health` sin llave separa los tres — si
 *    responde, el server esta vivo y el origen esta permitido; lo que quede
 *    es la credencial. Pedirle llave a `health` convertiria al diagnostico en
 *    parte del problema que diagnostica.
 *
 * 3. **El preflight `OPTIONS` tampoco lleva llave.** El navegador nunca manda
 *    `Authorization` en un preflight: exigirla ahi hace que toda peticion
 *    cruzada muera antes de existir.
 *
 * La comparacion es de tiempo constante. No es que se espere un atacante
 * midiendo nanosegundos contra un tailnet privado, es que la alternativa
 * (`===`) no es mas simple ni mas rapida de leer.
 *
 * Telemetria: se cuenta el resultado (`missing` / `invalid` / `ok`) y nada
 * mas. Ni el token, ni el `Origin`, ni la IP — son valores del usuario y
 * CLAUDE.md los deja fuera del log.
 */
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { emitMetric } from "../db/telemetry.js";

/** Rutas de `/api` que se sirven sin llave. Relativas al punto de montaje. */
export const UNPROTECTED_API_PATHS = ["/health"] as const;

export type AuthOutcome = "disabled" | "ok" | "missing" | "invalid";

/** Una llave vacia o solo espacios es "no hay llave", no una llave vacia:
 * `WALLET_ACCESS_TOKEN=` en el `.env` es la forma habitual de desactivarla. */
export function normalizeAccessToken(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value === "" ? null : value;
}

/** El token de una cabecera `Authorization`. `null` si no es un Bearer o si
 * viene sin valor. El esquema es case-insensitive por RFC 7235. */
export function parseBearer(header: string | undefined | null): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
  if (!match) return null;
  const value = match[1].trim();
  return value === "" ? null : value;
}

/** Comparacion de tiempo constante. Las longitudes distintas se resuelven
 * antes porque `timingSafeEqual` tira si los buffers no miden igual — esa
 * fuga (la longitud) es inherente y no la arregla ninguna comparacion. */
export function matchesAccessToken(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** El veredicto puro, sin Express: lo que decide el middleware y lo que
 * `GET /api/health` reporta como `authenticated`. */
export function classifyRequestAuth(expected: string | null, header: string | undefined | null): AuthOutcome {
  if (expected === null) return "disabled";
  const presented = parseBearer(header);
  if (presented === null) return "missing";
  return matchesAccessToken(expected, presented) ? "ok" : "invalid";
}

export interface AuthMiddlewareOptions {
  /** Paths (relativos al montaje) que se sirven sin llave. Por defecto
   * `UNPROTECTED_API_PATHS`. */
  unprotected?: readonly string[];
}

/**
 * `expected === null` (sin `WALLET_ACCESS_TOKEN`) devuelve un middleware que
 * llama a `next()` y nada mas — el server se comporta exactamente como antes.
 */
export function createAuthMiddleware(expected: string | null, options: AuthMiddlewareOptions = {}): RequestHandler {
  const unprotected = new Set<string>(options.unprotected ?? UNPROTECTED_API_PATHS);

  return function requireAccessToken(req: Request, res: Response, next: NextFunction): void {
    if (expected === null) {
      next();
      return;
    }
    // Sin barra final: `/health/` y `/health` son la misma ruta para Express.
    const path = req.path.replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS" || unprotected.has(path)) {
      next();
      return;
    }

    const outcome = classifyRequestAuth(expected, req.headers.authorization);
    if (outcome === "ok") {
      next();
      return;
    }

    // Solo el conteo: ni el token presentado ni el origen del que vino.
    emitMetric("api.auth.rejected", { reason: outcome, method: req.method });
    res.status(401).json({
      error: "unauthorized",
      reason: outcome === "missing" ? "missing_token" : "invalid_token",
      // El unico camino de diagnostico que no necesita llave (R27).
      hint: "GET /api/health responde sin llave y dice si este server pide una (auth_required).",
    });
  };
}
