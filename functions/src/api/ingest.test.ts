/**
 * `POST /ingest` contra el emulador, con Google y Gmail mockeados.
 *
 * Nunca se llama al Gmail de nadie: `fetchImpl` contesta el canje del refresh
 * token y las dos rutas de la API de Gmail. Lo que se prueba acá es el ORDEN y
 * las decisiones del borde —quién puede llamar, qué pasa cuando el permiso ya
 * no existe, cuándo se avanza `lastSyncTs`— y no el parseo, que tiene sus
 * propios tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "firebase-admin/auth";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../test-support/emulator.js";
import { masterKeyFromEnv } from "../oauth/crypto.js";
import { guardarRefreshToken } from "../oauth/gmail-tokens.js";
import * as paths from "../ledger/paths.js";
import type { OAuthConfig } from "../oauth/config.js";
import { ingestHandler, resolverSinceTs } from "./ingest.js";

/** Una clave maestra de prueba. 32 bytes de ceros: no protege nada real. */
const MASTER = masterKeyFromEnv({
  WALLET_TOKEN_KEK: Buffer.alloc(32).toString("base64"),
  WALLET_TOKEN_KEK_VERSION: "1",
});

const CONFIG: OAuthConfig = {
  clientId: "cliente-de-prueba",
  clientSecret: "secreto-de-prueba",
  redirectUri: "https://ejemplo.test/callback",
  panelOrigin: "https://ejemplo.test",
  master: MASTER,
  clavesDeLectura: [MASTER],
};

function authQueDevuelve(uid: string): Auth {
  return {
    verifyIdToken: vi.fn(async () => ({ uid, email: `${uid}@ejemplo.test`, email_verified: true })),
  } as unknown as Auth;
}

function parHttp(overrides: { method?: string; body?: unknown } = {}) {
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
    method: overrides.method ?? "POST",
    headers: { authorization: "Bearer un-id-token" },
    body: overrides.body ?? {},
  };
  return { req: req as never, res: res as never, estado };
}

function respuesta(cuerpo: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => cuerpo } as unknown as Response;
}

/**
 * Un `fetch` que contesta las tres llamadas del flujo: el canje del refresh
 * token, el `messages.list` y el `messages.get`.
 */
function fetchDeGoogle(opciones: { canje?: Response; ids?: string[] } = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes("oauth2.googleapis.com") || url.includes("/token")) {
      return opciones.canje ?? respuesta({ access_token: "access-de-prueba", expires_in: 3599, scope: "" });
    }
    if (url.includes("/messages?")) {
      return respuesta({ messages: (opciones.ids ?? []).map((id) => ({ id })) });
    }
    return respuesta({
      id: "msg-1",
      threadId: "hilo-1",
      internalDate: "1788700000000",
      payload: { headers: [{ name: "Subject", value: "Aviso" }], mimeType: "text/plain", body: {} },
    });
  });
}

describe.skipIf(!hayEmulador)("ingestHandler (emulador)", () => {
  const handle = hayEmulador ? conectarEmulador() : null;
  const tenants: string[] = [];

  afterEach(async () => {
    if (handle === null) return;
    for (const uid of tenants.splice(0)) await limpiarTenant(handle.db, uid);
  });

  function nuevoTenant(etiqueta: string): string {
    const uid = uidDePrueba(etiqueta);
    tenants.push(uid);
    return uid;
  }

  async function conGmailConectado(uid: string): Promise<void> {
    await guardarRefreshToken({
      db: handle!.db,
      uid,
      refreshToken: "refresh-de-prueba",
      master: MASTER,
      email: `${uid}@ejemplo.test`,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    });
  }

  it("un metodo que no es POST se rechaza: esto escribe, no es una lectura", async () => {
    const { req, res, estado } = parHttp({ method: "GET" });
    await ingestHandler({ auth: authQueDevuelve("x"), db: handle!.db, config: CONFIG })(req, res);
    expect(estado.status).toBe(405);
  });

  it("sin Gmail conectado contesta 409 y NO habla con Google", async () => {
    const uid = nuevoTenant("sin-gmail");
    const fetchImpl = fetchDeGoogle();
    const { req, res, estado } = parHttp({ body: { sinceTs: "2026-09-01T00:00:00.000Z" } });

    await ingestHandler({ auth: authQueDevuelve(uid), db: handle!.db, config: CONFIG, fetchImpl })(req, res);

    expect(estado.status).toBe(409);
    expect((estado.body as { error: string }).error).toBe("gmail_no_conectado");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  /**
   * CLAUDE.md regla 3: nada precargado. Elegir "los ultimos 90 dias" por el
   * usuario seria decidir cuanta de su historia existe.
   */
  it("sin lastSyncTs y sin sinceTs contesta 400 en vez de inventar una fecha", async () => {
    const uid = nuevoTenant("sin-since");
    await conGmailConectado(uid);
    const { req, res, estado } = parHttp({ body: {} });

    await ingestHandler({
      auth: authQueDevuelve(uid),
      db: handle!.db,
      config: CONFIG,
      fetchImpl: fetchDeGoogle(),
    })(req, res);

    expect(estado.status).toBe(400);
    expect((estado.body as { error: string }).error).toBe("falta_since_ts");
  });

  it("un lote vacio devuelve el resumen en cero y no avanza lastSyncTs", async () => {
    const uid = nuevoTenant("vacio");
    await conGmailConectado(uid);
    const { req, res, estado } = parHttp({ body: { sinceTs: "2026-09-01T00:00:00.000Z" } });

    await ingestHandler({
      auth: authQueDevuelve(uid),
      db: handle!.db,
      config: CONFIG,
      fetchImpl: fetchDeGoogle({ ids: [] }),
    })(req, res);

    expect(estado.status).toBe(200);
    expect(estado.body).toMatchObject({ vistos: 0, insertados: 0 });
    const sync = await paths.configDoc(handle!.db, uid, "sync").get();
    expect(sync.exists).toBe(false);
  });

  it("despues de leer avanza lastSyncTs al ts del correo mas nuevo, no al reloj", async () => {
    const uid = nuevoTenant("avanza");
    await conGmailConectado(uid);
    const { req, res, estado } = parHttp({ body: { sinceTs: "2026-09-01T00:00:00.000Z" } });

    await ingestHandler({
      auth: authQueDevuelve(uid),
      db: handle!.db,
      config: CONFIG,
      fetchImpl: fetchDeGoogle({ ids: ["msg-1"] }),
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    })(req, res);

    expect(estado.status).toBe(200);
    const sync = await paths.configDoc(handle!.db, uid, "sync").get();
    expect(sync.data()!.lastSyncTs).toBe(new Date(1788700000000).toISOString());
  });

  /**
   * `invalid_grant` es el permiso que ya no existe. Se marca y se pide
   * reconectar; cualquier otro error de Google es transitorio y NO puede
   * desconectar al usuario.
   */
  it("invalid_grant marca la conexion como invalida y pide reconectar", async () => {
    const uid = nuevoTenant("revocado");
    await conGmailConectado(uid);
    const { req, res, estado } = parHttp({ body: { sinceTs: "2026-09-01T00:00:00.000Z" } });

    await ingestHandler({
      auth: authQueDevuelve(uid),
      db: handle!.db,
      config: CONFIG,
      fetchImpl: fetchDeGoogle({ canje: respuesta({ error: "invalid_grant" }, false, 400) }),
    })(req, res);

    expect(estado.status).toBe(409);
    expect((estado.body as { error: string }).error).toBe("gmail_reconectar");
    const gmail = await paths.configDoc(handle!.db, uid, "gmail").get();
    expect(gmail.data()!.conectado).toBe(false);
    expect(gmail.data()!.invalidSince).toBeDefined();
  });

  it("un 500 de Google es 502 y NO desconecta al usuario", async () => {
    const uid = nuevoTenant("transitorio");
    await conGmailConectado(uid);
    const { req, res, estado } = parHttp({ body: { sinceTs: "2026-09-01T00:00:00.000Z" } });

    await ingestHandler({
      auth: authQueDevuelve(uid),
      db: handle!.db,
      config: CONFIG,
      fetchImpl: fetchDeGoogle({ canje: respuesta({}, false, 500) }),
    })(req, res);

    expect(estado.status).toBe(502);
    const gmail = await paths.configDoc(handle!.db, uid, "gmail").get();
    expect(gmail.data()!.conectado).toBe(true);
  });

  it("cada tenant lee su propio refresh token: el uid sale del token", async () => {
    const mio = nuevoTenant("mio");
    const ajeno = nuevoTenant("ajeno");
    await conGmailConectado(ajeno);
    const { req, res, estado } = parHttp({ body: { sinceTs: "2026-09-01T00:00:00.000Z" } });

    // El que llama es `mio`, que no conecto Gmail. Que `ajeno` si lo haya hecho
    // no le sirve de nada.
    await ingestHandler({
      auth: authQueDevuelve(mio),
      db: handle!.db,
      config: CONFIG,
      fetchImpl: fetchDeGoogle(),
    })(req, res);

    expect(estado.status).toBe(409);
  });
});

describe.skipIf(!hayEmulador)("resolverSinceTs", () => {
  const handle = hayEmulador ? conectarEmulador() : null;

  it("el sinceTs del body le gana al guardado", async () => {
    const uid = uidDePrueba("since");
    await paths.configDoc(handle!.db, uid, "sync").set({ lastSyncTs: "2026-01-01T00:00:00.000Z" });
    expect(await resolverSinceTs(handle!.db, uid, "2026-08-01T00:00:00.000Z")).toBe("2026-08-01T00:00:00.000Z");
    await limpiarTenant(handle!.db, uid);
  });

  it("sin body cae al lastSyncTs guardado", async () => {
    const uid = uidDePrueba("since2");
    await paths.configDoc(handle!.db, uid, "sync").set({ lastSyncTs: "2026-01-01T00:00:00.000Z" });
    expect(await resolverSinceTs(handle!.db, uid, undefined)).toBe("2026-01-01T00:00:00.000Z");
    await limpiarTenant(handle!.db, uid);
  });

  it("sin ninguno de los dos devuelve null y NO una fecha de conveniencia", async () => {
    const uid = uidDePrueba("since3");
    expect(await resolverSinceTs(handle!.db, uid, undefined)).toBeNull();
  });
});
