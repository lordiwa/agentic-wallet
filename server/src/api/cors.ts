/**
 * CORS de lista blanca explicita, apagado por defecto.
 *
 * Existe por una razon concreta: el dashboard puede servirse desde un origen
 * distinto al del server (por ejemplo Firebase Hosting, ver
 * docs/frontend-desplegado.md), y ahi el navegador exige que la API declare
 * quien puede leer su respuesta. Sin `WALLET_ALLOWED_ORIGINS` seteada esto no
 * agrega ninguna cabecera y el server se comporta exactamente como antes:
 * habilitar un origen cruzado es una decision explicita, igual que
 * `WALLET_BIND_HOST=0.0.0.0`.
 *
 * Nunca manda `Access-Control-Allow-Credentials` ni acepta `*`. Lo primero
 * porque la API no usa cookies ni sesiones — no hay nada que mandar, y
 * pedirlo solo ampliaria la superficie. Lo segundo porque un comodin aca es
 * indistinguible de no tener lista blanca. El limite real de acceso lo ponen
 * `WALLET_BIND_HOST` (quien llega al puerto) y `WALLET_ACCESS_TOKEN` (quien
 * trae la llave, ver api/auth.ts), no esta cabecera — que solo decide quien
 * puede LEER la respuesta desde un navegador. CORS no es autenticacion y no
 * se usa como tal.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Coma-separada, tolerante a espacios y a la barra final que copiar/pegar
 * una URL del navegador suele arrastrar (`https://x.web.app/` y
 * `https://x.web.app` son el mismo origen para el header `Origin`). */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter((value) => value !== "" && value !== "*");
}

export function createCorsMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return function cors(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers.origin;
    if (typeof origin !== "string" || !allowed.has(origin)) {
      // Mismo origen (sin header `Origin`) u origen no autorizado: se sigue
      // de largo sin cabeceras. La request en si no se bloquea aca — de eso
      // se encarga el navegador al no encontrar el permiso.
      next();
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    // La respuesta cambia segun el origen: sin esto un cache intermedio
    // podria servirle a un origen la cabecera emitida para otro.
    res.setHeader("Vary", "Origin");
    // `DELETE` y `Authorization` entran con la fase N0 (TASK-054): la API ya
    // tiene rutas que borran y ahora lleva llave. Sin declararlos aca el
    // navegador mata la peticion en el preflight y el panel publicado no
    // carga — un fallo que se ve como "el server no responde".
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}
