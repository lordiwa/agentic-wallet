/**
 * Los dos handlers de muestra, contra el emulador de Firestore de verdad.
 *
 * Firestore se emula y Auth se inyecta. No es una comodidad: son dos cosas
 * distintas y conviene testear cada una donde duele. Lo que puede fallar en
 * Firestore es la CONSULTA (un índice que falta, un filtro que no devuelve lo
 * que uno cree, la agregación `count()`), y eso sólo se ve contra un Firestore
 * real. Lo que puede fallar en Auth es la DECISIÓN (de qué uid es esta
 * petición), y eso se ve mejor con un doble que puede devolver a voluntad el
 * token de otra persona — que es justo el caso que hay que probar y que un
 * emulador de Auth hace más difícil de montar.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../test-support/emulator.js";
import { toTransactionDoc, type RawTransaction } from "../ledger/derive.js";
import * as paths from "../ledger/paths.js";
import { applyCors, healthHandler, overviewHandler } from "./handlers.js";

function authQueDevuelve(uid: string, extra: Record<string, unknown> = {}): Auth {
  return {
    verifyIdToken: vi.fn(async () => ({ uid, email: `${uid}@ejemplo.test`, email_verified: true, ...extra })),
  } as unknown as Auth;
}

/** Un par req/res mínimo: lo que los handlers realmente tocan. */
function parHttp(overrides: { method?: string; headers?: Record<string, string> } = {}) {
  const estado = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) {
      estado.status = code;
      return res;
    },
    json(payload: unknown) {
      estado.body = payload;
      return res;
    },
    send(payload: unknown) {
      estado.body = payload;
      return res;
    },
    set(key: string, value: string) {
      estado.headers[key] = value;
      return res;
    },
  };
  const req = {
    method: overrides.method ?? "GET",
    headers: overrides.headers ?? {},
  };
  return { req: req as never, res: res as never, estado };
}

function fila(overrides: Partial<RawTransaction> & { gmail_msg_id: string }): RawTransaction {
  return {
    gmail_thread_id: null,
    ts: "2026-05-15T14:00:00.000Z",
    direction: "out",
    type: "debito",
    amount: 10,
    currency: "USD",
    counterparty: "Comercio Ejemplo",
    account: null,
    account_holder: null,
    category: null,
    raw_subject: null,
    is_reversed: 0,
    is_internal: 0,
    needs_review: 0,
    is_discarded: 0,
    source: "parser",
    created_at: "2026-05-15T14:05:00.000Z",
    ...overrides,
  };
}

describe("healthHandler", () => {
  it("responde 200 sin auth", () => {
    const { req, res, estado } = parHttp();
    healthHandler("9.9.9")(req, res);
    expect(estado.status).toBe(200);
    expect(estado.body).toMatchObject({ ok: true, service: "agentic-wallet-functions", version: "9.9.9" });
  });

  it("no filtra nada del negocio", () => {
    const { req, res, estado } = parHttp();
    healthHandler("9.9.9")(req, res);
    const claves = Object.keys(estado.body as object).sort();
    // Un healthcheck publico que sepa cuantos usuarios hay es un contador de
    // clientes gratis para cualquiera.
    expect(claves).toEqual(["ok", "service", "ts", "version"]);
  });

  it("405 en POST", () => {
    const { req, res, estado } = parHttp({ method: "POST" });
    healthHandler("9.9.9")(req, res);
    expect(estado.status).toBe(405);
  });
});

describe("applyCors", () => {
  it("refleja un origen conocido", () => {
    const { req, res, estado } = parHttp({ headers: { origin: "https://agentic-wallet-71314.web.app" } });
    expect(applyCors(req, res)).toBe(false);
    expect(estado.headers["Access-Control-Allow-Origin"]).toBe("https://agentic-wallet-71314.web.app");
    expect(estado.headers.Vary).toBe("Origin");
  });

  it("no le da la cabecera a un origen desconocido", () => {
    const { req, res, estado } = parHttp({ headers: { origin: "https://sitio-de-otro.example" } });
    applyCors(req, res);
    expect(estado.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("nunca responde con comodin", () => {
    const { req, res, estado } = parHttp({ headers: { origin: "https://agentic-wallet-71314.web.app" } });
    applyCors(req, res);
    expect(estado.headers["Access-Control-Allow-Origin"]).not.toBe("*");
  });

  it("corta el preflight con 204", () => {
    const { req, res, estado } = parHttp({ method: "OPTIONS" });
    expect(applyCors(req, res)).toBe(true);
    expect(estado.status).toBe(204);
  });
});

describe("overviewHandler sin auth valida", () => {
  it("401 sin header, sin tocar Firestore", async () => {
    const db = { collection: vi.fn() } as unknown as Firestore;
    const { req, res, estado } = parHttp();
    await overviewHandler({ auth: authQueDevuelve("cualquiera"), db })(req, res);
    expect(estado.status).toBe(401);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("401 si el token no verifica", async () => {
    const auth = {
      verifyIdToken: vi.fn(async () => {
        throw new Error("bad signature");
      }),
    } as unknown as Auth;
    const db = { collection: vi.fn() } as unknown as Firestore;
    const { req, res, estado } = parHttp({ headers: { authorization: "Bearer falso" } });
    await overviewHandler({ auth, db })(req, res);
    expect(estado.status).toBe(401);
    expect(db.collection).not.toHaveBeenCalled();
  });
});

describe.skipIf(!hayEmulador)("overviewHandler contra Firestore", () => {
  const handle = hayEmulador ? conectarEmulador() : null;
  const db = handle?.db as Firestore;
  const uidA = uidDePrueba("a");
  const uidB = uidDePrueba("b");

  beforeAll(async () => {
    // Tenant A: tres gastos de mayo y uno pendiente de revision.
    const filas: RawTransaction[] = [
      fila({ gmail_msg_id: "a-1", amount: 10, counterparty: "Farmacia Ejemplo" }),
      fila({ gmail_msg_id: "a-2", amount: 5.5, type: "servicio", counterparty: "Luz Ejemplo" }),
      fila({ gmail_msg_id: "a-3", amount: 20, type: "retiro", counterparty: null }),
      fila({ gmail_msg_id: "a-4", amount: 999, needs_review: 1 }),
      // Junio: no tiene que aparecer en el gasto de mayo.
      fila({ gmail_msg_id: "a-5", amount: 777, ts: "2026-06-10T14:00:00.000Z" }),
    ];
    const batch = db.batch();
    for (const f of filas) {
      batch.set(paths.transactions(db, uidA).doc(f.gmail_msg_id), toTransactionDoc(f, -5) as never);
    }
    batch.set(paths.configDoc(db, uidA, "strategy"), {
      moneda: "USD",
      utcOffsetHours: -5,
      colchonObjetivo: 300,
      balanceSnapshot: { amount: 1000, at: "2026-05-01" },
    } as never);
    batch.set(paths.savings(db, uidA).doc("colchon"), { label: "colchon", reservedCents: 12_000 } as never);
    batch.set(paths.rules(db, uidA).doc("farmacia"), {
      pattern: "farmacia",
      category: "salud",
      createdAt: "2026-05-01T00:00:00.000Z",
    } as never);

    // Tenant B: un solo movimiento, de otro monto y otra contraparte.
    batch.set(
      paths.transactions(db, uidB).doc("b-1"),
      toTransactionDoc(fila({ gmail_msg_id: "b-1", amount: 44, counterparty: "Solo De B" }), -5) as never
    );
    await batch.commit();
  });

  afterAll(async () => {
    if (!handle) return;
    await limpiarTenant(db, uidA);
    await limpiarTenant(db, uidB);
    await handle.cerrar();
  });

  it("devuelve el resumen del tenant del token", async () => {
    const { req, res, estado } = parHttp({ headers: { authorization: "Bearer t" } });
    await overviewHandler({
      auth: authQueDevuelve(uidA),
      db,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    })(req, res);

    expect(estado.status).toBe(200);
    const body = estado.body as Record<string, never>;
    expect(body.counts).toEqual({ total: 5, needs_review: 1 });
    expect(body.balance).toEqual({ amount: 1000, currency: "USD", at: "2026-05-01" });
    expect(body.buffer_status).toEqual({
      objetivo: 300,
      reservado: 120,
      financiado: false,
      faltante: 180,
      fijado: true,
    });
  });

  it("la regla del usuario mueve la barra sin backfill: 10 va a salud, no a otros", async () => {
    const { req, res, estado } = parHttp({ headers: { authorization: "Bearer t" } });
    await overviewHandler({
      auth: authQueDevuelve(uidA),
      db,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    })(req, res);
    // La columna `category` de esas filas es null en Firestore; la categoria
    // que se muestra sale de recalcular con las reglas de hoy.
    expect((estado.body as Record<string, unknown>).spending_by_category).toEqual({
      salud: 10,
      servicios: 5.5,
      efectivo: 20,
    });
  });

  it("el mes es el LOCAL: junio no se cuela en mayo", async () => {
    const { req, res, estado } = parHttp({ headers: { authorization: "Bearer t" } });
    await overviewHandler({
      auth: authQueDevuelve(uidA),
      db,
      now: () => new Date("2026-06-15T12:00:00.000Z"),
    })(req, res);
    expect((estado.body as Record<string, unknown>).spending_by_category).toEqual({ otros: 777 });
  });

  it("la fila en revision no suma en el gasto (invariante 1)", async () => {
    const { req, res, estado } = parHttp({ headers: { authorization: "Bearer t" } });
    await overviewHandler({
      auth: authQueDevuelve(uidA),
      db,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    })(req, res);
    const gasto = (estado.body as { spending_by_category: Record<string, number> }).spending_by_category;
    expect(Object.values(gasto)).not.toContain(999);
  });

  it("AISLAMIENTO: con el token de B no se ve nada de A", async () => {
    const { req, res, estado } = parHttp({ headers: { authorization: "Bearer t" } });
    await overviewHandler({
      auth: authQueDevuelve(uidB),
      db,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    })(req, res);
    const body = estado.body as Record<string, never>;
    expect(body.counts).toEqual({ total: 1, needs_review: 0 });
    // El colchon y el balance de A no se filtran: B no configuro nada.
    expect(body.balance).toBeNull();
    expect(body.buffer_status).toMatchObject({ objetivo: 0, reservado: 0, fijado: false });
    expect(body.spending_by_category).toEqual({ otros: 44 });
  });

  it("un tenant que no existe devuelve una billetera vacia, no un error", async () => {
    const { req, res, estado } = parHttp({ headers: { authorization: "Bearer t" } });
    await overviewHandler({ auth: authQueDevuelve(uidDePrueba("nuevo")), db })(req, res);
    expect(estado.status).toBe(200);
    const body = estado.body as Record<string, never>;
    expect(body.counts).toEqual({ total: 0, needs_review: 0 });
    expect(body.spending_by_category).toEqual({});
    // "No fije objetivo" y "cumpli mi objetivo" no pueden contestar igual (R25).
    expect(body.buffer_status).toMatchObject({ financiado: true, fijado: false });
  });

  /**
   * El overview ya no lleva `pendiente`: los cuatro campos que faltaban están
   * calculados por el motor portado. Que el array haya desaparecido es parte
   * del contrato — mientras estuvo, el panel decidía NO dibujar esas tarjetas,
   * y si volviera a aparecer las escondería sobre cifras que hoy existen.
   */
  it("ya no declara nada pendiente: los nueve campos del motor estan", async () => {
    const { req, res, estado } = parHttp({ headers: { authorization: "Bearer t" } });
    await overviewHandler({ auth: authQueDevuelve(uidA), db })(req, res);
    const body = estado.body as Record<string, unknown>;
    expect(body.pendiente).toBeUndefined();
    for (const campo of [
      "balance",
      "card",
      "counts",
      "safe_to_spend_hoy",
      "buffer_status",
      "card_status",
      "transfers_summary",
      "next_payday",
      "spending_by_category",
    ]) {
      expect(Object.hasOwn(body, campo)).toBe(true);
    }
  });

  /**
   * **R7 dicho en dos campos.** `safe_to_spend_hoy: 0` sin día de pago
   * configurado NO es "tenés cero pesos": es "no hay próximo cobro contra el
   * que dividir". Lo que lo distingue es `next_payday: null`, y por eso los dos
   * viajan juntos.
   */
  it("sin dia de pago configurado el safe-to-spend es 0 con next_payday en null", async () => {
    const { req, res, estado } = parHttp({ headers: { authorization: "Bearer t" } });
    await overviewHandler({ auth: authQueDevuelve(uidA), db })(req, res);
    const body = estado.body as Record<string, unknown>;
    expect(body.next_payday).toBeNull();
    expect(body.safe_to_spend_hoy).toBe(0);
  });
});
