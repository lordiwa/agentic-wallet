/**
 * Limite de tasa por IP: la cuarta proteccion de la exposicion publica
 * (TASK-054, D14). No reemplaza a la llave — la protege.
 *
 * Por que existe: con `WALLET_ACCESS_TOKEN` puesto, un atacante que llega al
 * puerto no entra, pero puede *intentar*. Sin un tope, esos intentos son
 * gratis e infinitos, y cada 401 igual cuesta un handshake TLS y un proceso
 * despierto. El tope no adivina quien es legitimo: acota cuanto puede
 * equivocarse cualquiera.
 *
 * Cuatro decisiones que no son obvias:
 *
 * 1. **Token bucket, no ventana fija.** Una ventana fija de 10/segundo deja
 *    pasar 20 peticiones en 200ms si caen a caballo del borde, y ademas
 *    castiga al panel legitimo que arranca y pide seis endpoints de una. El
 *    bucket separa las dos cosas que importan: el *promedio* sostenido
 *    (`rps`) y el *pico* tolerado (`burst`).
 *
 * 2. **Apagado por defecto**, igual que `WALLET_ACCESS_TOKEN` y
 *    `WALLET_ALLOWED_ORIGINS`. El proyecto es local-first: en una maquina
 *    local el unico cliente sos vos, y un tope nacido activo solo puede
 *    romper un uso que ya funcionaba. Se enciende con la misma decision
 *    explicita que abre el puerto — ver el aviso de arranque en index.ts.
 *
 * 3. **La IP detras de un proxy no se adivina.** Con Caddy delante, *toda*
 *    peticion llega desde 127.0.0.1 y un limite por IP se vuelve un limite
 *    global: el primer atacante deja fuera a todos. Pero leer
 *    `X-Forwarded-For` sin mas es peor que no limitar — el cliente elige el
 *    header y con el elige su propio cubo, uno nuevo por peticion. Por eso
 *    `trustProxy` es opt-in y se toma el **ultimo** salto de la cadena, que
 *    es el que agrego nuestro proxy; los de la izquierda los pudo escribir
 *    el cliente.
 *
 * 4. **No se loguea la IP.** CLAUDE.md deja los valores del usuario fuera del
 *    log: la telemetria cuenta rechazos, no direcciones. La IP se usa como
 *    clave en memoria y ahi se queda.
 *
 * Esto es proteccion basica, no un WAF: es por proceso y en memoria, asi que
 * no sobrevive a un reinicio ni se comparte entre replicas. Para un server
 * single-user es exactamente el alcance que corresponde.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { emitMetric } from "../db/telemetry.js";

export interface RateLimitOptions {
  /** Peticiones por segundo sostenidas. `0` (o menos) apaga el limite. */
  rps: number;
  /** Pico tolerado antes de que mande `rps`. Por defecto `max(rps, 1) * 2`. */
  burst?: number;
  /** Leer la IP del cliente de `X-Forwarded-For`. Solo con un proxy propio
   * delante (ver decision 3). */
  trustProxy?: boolean;
  /** Reloj inyectable: los tests necesitan mover el tiempo sin dormir. */
  now?: () => number;
}

interface Bucket {
  /** Tokens disponibles, fraccionarios: se rellenan de forma continua. */
  tokens: number;
  /** Ultimo instante en que se recalculo `tokens`. */
  updated: number;
}

/**
 * La IP que identifica al cliente. Sin `trustProxy` es la del socket; con el,
 * el ultimo salto de `X-Forwarded-For`.
 *
 * Devuelve `null` cuando no hay forma de saberlo (un socket ya cerrado, un
 * transporte sin direccion). Un `null` NO se limita: inventar una clave
 * comun —`"unknown"`— meteria a todos esos casos en el mismo cubo, y bastaria
 * un cliente sin IP legible para dejar fuera a los demas.
 */
export function clientKey(req: Request, trustProxy: boolean): string | null {
  if (trustProxy) {
    const header = req.headers["x-forwarded-for"];
    const raw = Array.isArray(header) ? header.join(",") : header;
    if (typeof raw === "string") {
      const hops = raw
        .split(",")
        .map((hop) => hop.trim())
        .filter((hop) => hop !== "");
      // El ultimo lo escribio nuestro proxy; los anteriores pudo mentirlos
      // el cliente.
      if (hops.length > 0) return hops[hops.length - 1];
    }
  }
  const direct = req.ip ?? req.socket?.remoteAddress;
  return typeof direct === "string" && direct !== "" ? direct : null;
}

/** El pico por defecto: el doble del promedio, y nunca menos de 1 — con
 * `burst: 0` ninguna peticion pasaria jamas, ni la primera. */
export function resolveBurst(rps: number, burst: number | undefined): number {
  if (burst !== undefined && burst > 0) return burst;
  return Math.max(rps, 1) * 2;
}

/**
 * `rps <= 0` devuelve un middleware que solo llama a `next()`, igual que
 * `createAuthMiddleware` sin token: apagado es apagado, no un limite enorme.
 */
export function createRateLimitMiddleware(options: RateLimitOptions): RequestHandler {
  const { rps, trustProxy = false, now = Date.now } = options;

  if (!Number.isFinite(rps) || rps <= 0) {
    return function rateLimitDisabled(_req: Request, _res: Response, next: NextFunction): void {
      next();
    };
  }

  const capacity = resolveBurst(rps, options.burst);
  const buckets = new Map<string, Bucket>();
  // Un cubo lleno es indistinguible de uno que nunca existio, asi que se
  // tira: sin esto el Map crece con cada IP que toco el server alguna vez, y
  // un escaneo de internet lo convierte en una fuga de memoria lenta.
  const idleMs = (capacity / rps) * 1000;
  let lastSweep = now();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = clientKey(req, trustProxy);
    if (key === null) {
      next();
      return;
    }

    const t = now();
    if (t - lastSweep >= idleMs) {
      for (const [k, b] of buckets) {
        if (t - b.updated >= idleMs) buckets.delete(k);
      }
      lastSweep = t;
    }

    const bucket = buckets.get(key) ?? { tokens: capacity, updated: t };
    // Rellenado continuo y tope en `capacity`: estar ausente una hora da el
    // pico completo, no una hora de credito acumulado.
    const refill = ((t - bucket.updated) / 1000) * rps;
    bucket.tokens = Math.min(capacity, bucket.tokens + refill);
    bucket.updated = t;

    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      // Cuantos tokens faltan para uno entero, redondeado hacia arriba: un
      // `Retry-After: 0` invita a reintentar de inmediato y no frena nada.
      const waitSeconds = Math.max(1, Math.ceil((1 - bucket.tokens) / rps));
      // Solo el conteo: la IP es un valor del usuario y no va al log.
      emitMetric("api.rate_limit.rejected", { method: req.method });
      res.setHeader("Retry-After", String(waitSeconds));
      res.status(429).json({
        error: "rate_limited",
        reason: "too_many_requests",
        retry_after_seconds: waitSeconds,
      });
      return;
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
    next();
  };
}
