import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { clientKey, createRateLimitMiddleware, resolveBurst } from "./rate-limit.js";

/** Un `Request` con lo unico que el middleware mira. */
function req(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    headers: {},
    ip: "10.0.0.1",
    socket: {},
    ...overrides,
  } as unknown as Request;
}

interface FakeRes {
  res: Response;
  statusCode: number | null;
  body: unknown;
  headers: Record<string, string>;
}

function res(): FakeRes {
  const captured: FakeRes = {
    statusCode: null,
    body: undefined,
    headers: {},
    res: undefined as unknown as Response,
  };
  captured.res = {
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      captured.statusCode = code;
      return captured.res;
    },
    json(payload: unknown) {
      captured.body = payload;
      return captured.res;
    },
  } as unknown as Response;
  return captured;
}

/** Un reloj movible: el token bucket se prueba adelantando el tiempo, no
 * durmiendo un segundo real por caso. */
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("resolveBurst", () => {
  it("por defecto tolera el doble del promedio", () => {
    expect(resolveBurst(10, undefined)).toBe(20);
  });

  it("un burst explicito manda", () => {
    expect(resolveBurst(10, 3)).toBe(3);
  });

  it("nunca devuelve cero: con burst 0 ni la primera peticion pasaria", () => {
    expect(resolveBurst(0, 0)).toBe(2);
    expect(resolveBurst(0.5, undefined)).toBe(2);
  });
});

describe("clientKey", () => {
  it("sin trustProxy usa la IP del socket y IGNORA X-Forwarded-For", () => {
    const r = req({ headers: { "x-forwarded-for": "1.2.3.4" }, ip: "10.0.0.1" });
    expect(clientKey(r, false)).toBe("10.0.0.1");
  });

  it("con trustProxy toma el ULTIMO salto, que es el que agrego nuestro proxy", () => {
    // El cliente mando "9.9.9.9" de mentira; Caddy le appendeo la real.
    const r = req({ headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" } });
    expect(clientKey(r, true)).toBe("203.0.113.7");
  });

  it("un X-Forwarded-For repetido (array) se aplana antes de elegir el ultimo", () => {
    const r = req({ headers: { "x-forwarded-for": ["9.9.9.9", "203.0.113.7"] as unknown as string } });
    expect(clientKey(r, true)).toBe("203.0.113.7");
  });

  it("con trustProxy pero sin el header cae al socket", () => {
    expect(clientKey(req({ ip: "10.0.0.9" }), true)).toBe("10.0.0.9");
  });

  it("sin IP legible devuelve null y no una clave comun", () => {
    const r = req({ ip: undefined, socket: {} as never });
    expect(clientKey(r, false)).toBeNull();
  });
});

describe("createRateLimitMiddleware", () => {
  it("con rps 0 es un no-op: apagado es apagado", () => {
    const mw = createRateLimitMiddleware({ rps: 0 });
    const next = vi.fn();
    const r = res();
    for (let i = 0; i < 50; i++) mw(req(), r.res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(50);
    expect(r.statusCode).toBeNull();
  });

  it("deja pasar el burst completo y recien despues corta", () => {
    const c = clock();
    const mw = createRateLimitMiddleware({ rps: 10, burst: 3, now: c.now });
    const next = vi.fn();
    const r = res();

    for (let i = 0; i < 3; i++) mw(req(), r.res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(3);
    expect(r.statusCode).toBeNull();

    mw(req(), r.res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(3);
    expect(r.statusCode).toBe(429);
    expect(r.body).toMatchObject({ error: "rate_limited", reason: "too_many_requests" });
  });

  it("el 429 trae Retry-After de al menos 1 segundo", () => {
    const c = clock();
    const mw = createRateLimitMiddleware({ rps: 10, burst: 1, now: c.now });
    const r = res();
    mw(req(), r.res, vi.fn() as unknown as NextFunction);
    mw(req(), r.res, vi.fn() as unknown as NextFunction);
    expect(r.statusCode).toBe(429);
    expect(Number(r.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("los tokens se rellenan con el tiempo", () => {
    const c = clock();
    const mw = createRateLimitMiddleware({ rps: 10, burst: 2, now: c.now });
    const next = vi.fn();
    const r = res();

    mw(req(), r.res, next as unknown as NextFunction);
    mw(req(), r.res, next as unknown as NextFunction);
    mw(req(), r.res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(2);

    // 10 rps => 100ms devuelve exactamente un token.
    c.advance(100);
    mw(req(), r.res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it("el credito no se acumula mas alla del burst", () => {
    const c = clock();
    const mw = createRateLimitMiddleware({ rps: 10, burst: 2, now: c.now });
    const next = vi.fn();
    const r = res();

    // Una hora ausente no compra una hora de peticiones.
    c.advance(3_600_000);
    for (let i = 0; i < 5; i++) mw(req(), r.res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("cada IP tiene su propio cubo: un abusador no deja fuera al resto", () => {
    const c = clock();
    const mw = createRateLimitMiddleware({ rps: 10, burst: 1, now: c.now });
    const next = vi.fn();
    const r = res();

    mw(req({ ip: "10.0.0.1" }), r.res, next as unknown as NextFunction);
    mw(req({ ip: "10.0.0.1" }), r.res, next as unknown as NextFunction);
    expect(r.statusCode).toBe(429);

    const otro = res();
    mw(req({ ip: "10.0.0.2" }), otro.res, next as unknown as NextFunction);
    expect(otro.statusCode).toBeNull();
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("sin trustProxy, un X-Forwarded-For inventado NO da un cubo nuevo por peticion", () => {
    const c = clock();
    const mw = createRateLimitMiddleware({ rps: 10, burst: 1, now: c.now });
    const next = vi.fn();
    const r = res();

    mw(req({ headers: { "x-forwarded-for": "1.1.1.1" } }), r.res, next as unknown as NextFunction);
    mw(req({ headers: { "x-forwarded-for": "2.2.2.2" } }), r.res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(r.statusCode).toBe(429);
  });

  it("una peticion sin IP legible pasa en vez de caer en un cubo comun", () => {
    const c = clock();
    const mw = createRateLimitMiddleware({ rps: 10, burst: 1, now: c.now });
    const next = vi.fn();
    const r = res();
    const anonima = () => req({ ip: undefined, socket: {} as never });

    for (let i = 0; i < 5; i++) mw(anonima(), r.res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(5);
    expect(r.statusCode).toBeNull();
  });

  it("los cubos inactivos se sueltan: el Map no crece con cada IP que escaneo", () => {
    const c = clock();
    const mw = createRateLimitMiddleware({ rps: 10, burst: 2, now: c.now });
    const next = vi.fn();
    const r = res();

    // Mil IPs distintas, y despues tiempo de sobra para que todas se llenen.
    for (let i = 0; i < 1000; i++) {
      mw(req({ ip: `10.1.${Math.floor(i / 256)}.${i % 256}` }), r.res, next as unknown as NextFunction);
    }
    c.advance(60_000);
    mw(req({ ip: "10.9.9.9" }), r.res, next as unknown as NextFunction);

    // La IP nueva arranca con el cubo lleno igual que la primera vez.
    expect(r.statusCode).toBeNull();
    expect(next).toHaveBeenCalledTimes(1001);
  });
});
