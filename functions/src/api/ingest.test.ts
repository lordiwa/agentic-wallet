/**
 * `POST /api/sync` contra el emulador, con Google y Gmail mockeados.
 *
 * Nunca se llama al Gmail de nadie: `fetchImpl` contesta el canje del refresh
 * token y las dos rutas de la API de Gmail. Lo que se prueba acá es el ORDEN y
 * las decisiones del borde —quién puede llamar, qué pasa cuando el permiso ya
 * no existe, cuándo se avanza `lastSyncTs`, qué pasa con dos lotes a la vez— y
 * no el parseo, que tiene sus propios tests.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "firebase-admin/auth";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../test-support/emulator.js";
import { masterKeyFromEnv } from "../oauth/crypto.js";
import { guardarRefreshToken } from "../oauth/gmail-tokens.js";
import * as paths from "../ledger/paths.js";
import type { OAuthConfig } from "../oauth/config.js";
import { ingestHandler } from "./ingest.js";

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
 * token, el `messages.list` y el `messages.get`. Cada id devuelve un mensaje
 * con su propio `internalDate`, para poder afirmar sobre el orden.
 */
function fetchDeGoogle(opciones: { canje?: Response; ids?: string[] } = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes("oauth2.googleapis.com") || url.includes("/token")) {
      return opciones.canje ?? respuesta({ access_token: "access-de-prueba", expires_in: 3599, scope: "" });
    }
    if (url.includes("/messages?")) {
      return respuesta({ messages: (opciones.ids ?? []).map((id) => ({ id })) });
    }
    const id = decodeURIComponent(url.split("/messages/")[1]?.split("?")[0] ?? "msg-1");
    return respuesta({
      id,
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

  /**
   * 503 y `gmail_not_configured` no son un detalle de gusto: es el par exacto
   * que `panel/src/lib/sync-estado.ts` traduce a "Falta conectar Gmail". Con el
   * 409 que devolvía antes, la pantalla decía "ya hay un sync en curso" sobre
   * una billetera que nunca conectó nada.
   */
  it("sin Gmail conectado contesta 503 gmail_not_configured y NO habla con Google", async () => {
    const uid = nuevoTenant("sin-gmail");
    const fetchImpl = fetchDeGoogle();
    const { req, res, estado } = parHttp({ body: { sinceTs: "2026-09-01T00:00:00.000Z" } });

    await ingestHandler({ auth: authQueDevuelve(uid), db: handle!.db, config: CONFIG, fetchImpl })(req, res);

    expect(estado.status).toBe(503);
    expect((estado.body as { error: string }).error).toBe("gmail_not_configured");
    expect((estado.body as { detalle: string }).detalle).toBe("gmail_no_conectado");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  /**
   * Sin `lastSyncTs` se lee **desde la época**, que es "sin filtro" y no una
   * fecha de conveniencia (CLAUDE.md regla 3). Es seguro justamente por el
   * checkpoint: se drena por lotes en vez de intentar el buzón entero, así que
   * no hace falta pedirle al usuario que elija cuánta de su historia existe.
   */
  it("sin lastSyncTs y sin sinceTs lee desde la epoca en vez de exigir una fecha", async () => {
    const uid = nuevoTenant("sin-since");
    await conGmailConectado(uid);
    const fetchImpl = fetchDeGoogle({ ids: [] });
    const { req, res, estado } = parHttp({ body: {} });

    await ingestHandler({ auth: authQueDevuelve(uid), db: handle!.db, config: CONFIG, fetchImpl })(req, res);

    expect(estado.status).toBe(200);
    const busqueda = fetchImpl.mock.calls.map((c) => c[0]).find((u) => u.includes("/messages?"));
    // Un día antes de la época, por el `after:` que se corre un día (ver
    // `armarQuery`).
    expect(busqueda).toContain("after%3A1969%2F12%2F31");
  });

  it("un lote vacio devuelve el resumen en cero y cierra el backlog en el reloj del arranque", async () => {
    const uid = nuevoTenant("vacio");
    await conGmailConectado(uid);
    const { req, res, estado } = parHttp({ body: { sinceTs: "2026-09-01T00:00:00.000Z" } });

    await ingestHandler({
      auth: authQueDevuelve(uid),
      db: handle!.db,
      config: CONFIG,
      fetchImpl: fetchDeGoogle({ ids: [] }),
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    })(req, res);

    expect(estado.status).toBe(200);
    expect(estado.body).toMatchObject({
      summary: { vistos: 0, insertados: 0 },
      progress: { processed: 0, total: 0, remaining: 0, complete: true },
      inserted_ids: [],
    });
    const sync = await paths.configDoc(handle!.db, uid, "sync").get();
    // Miramos y no había nada nuevo: estamos al día a la hora de la consulta.
    expect(sync.data()!.lastSyncTs).toBe("2030-01-01T00:00:00.000Z");
    expect(sync.data()!.backlog).toBeNull();
  });

  /**
   * **El motivo por el que hay checkpoint.** Gmail devuelve del más nuevo al
   * más viejo. Sin drenado por lotes, procesar los N primeros y avanzar la
   * marca al `ts` del más nuevo deja los viejos fuera del alcance de toda
   * búsqueda futura, en silencio.
   */
  it("con mas correos que el lote deja backlog, NO avanza lastSyncTs, y la segunda llamada sigue por donde iba", async () => {
    const uid = nuevoTenant("backlog");
    await conGmailConectado(uid);
    const ids = ["a", "b", "c", "d", "e"];

    const primera = parHttp({ body: { sinceTs: "2026-09-01T00:00:00.000Z", batch_size: 2 } });
    const fetchPrimera = fetchDeGoogle({ ids });
    await ingestHandler({
      auth: authQueDevuelve(uid),
      db: handle!.db,
      config: CONFIG,
      fetchImpl: fetchPrimera,
      now: () => new Date("2030-01-01T00:00:00.000Z"),
    })(primera.req, primera.res);

    expect(primera.estado.body).toMatchObject({
      summary: { vistos: 2 },
      progress: { processed: 2, total: 5, remaining: 3, complete: false },
    });
    let sync = await paths.configDoc(handle!.db, uid, "sync").get();
    expect(sync.data()!.lastSyncTs).toBeUndefined();
    expect(sync.data()!.backlog).toMatchObject({ processed: 2, total: 5, remaining: 3 });

    // La segunda llamada NO vuelve a buscar: sigue el checkpoint. Se le da una
    // lista de ids distinta a propósito, y tiene que ignorarla.
    const segunda = parHttp({ body: { batch_size: 10 } });
    const fetchSegunda = fetchDeGoogle({ ids: ["z"] });
    await ingestHandler({
      auth: authQueDevuelve(uid),
      db: handle!.db,
      config: CONFIG,
      fetchImpl: fetchSegunda,
      now: () => new Date("2030-01-02T00:00:00.000Z"),
    })(segunda.req, segunda.res);

    expect(segunda.estado.body).toMatchObject({
      summary: { vistos: 3 },
      progress: { processed: 5, total: 5, remaining: 0, complete: true },
    });
    sync = await paths.configDoc(handle!.db, uid, "sync").get();
    // La marca es el "ahora" del ARRANQUE del backlog, no el del último lote:
    // guardar el segundo se comería lo que llegó en el medio.
    expect(sync.data()!.lastSyncTs).toBe("2030-01-01T00:00:00.000Z");

    // Los cinco ids se leyeron una vez cada uno, repartidos entre las dos
    // llamadas y sin repetir: eso es exactamente lo que el checkpoint garantiza
    // y lo que "buscá y procesá los primeros N" no garantizaba.
    const leidos = [...fetchPrimera.mock.calls, ...fetchSegunda.mock.calls]
      .map((c) => c[0])
      .filter((u) => u.includes("/messages/"))
      .map((u) => decodeURIComponent(u.split("/messages/")[1]!.split("?")[0]!));
    expect(leidos.sort()).toEqual(ids);
    // La segunda llamada no volvió a buscar: el checkpoint manda, y el `z` que
    // devolvería la búsqueda no aparece.
    expect(fetchSegunda.mock.calls.some((c) => c[0].includes("/messages?"))).toBe(false);
  });

  it("un segundo POST mientras hay uno corriendo recibe 409 sync_already_running", async () => {
    const uid = nuevoTenant("guarda");
    await conGmailConectado(uid);
    // La guarda vive en Firestore, no en memoria del proceso: es la única forma
    // de que dos INSTANCIAS de la función no lean el mismo buzón a la vez.
    await paths.configDoc(handle!.db, uid, "sync").set({ runningSince: new Date().toISOString() });

    const { req, res, estado } = parHttp({ body: {} });
    const fetchImpl = fetchDeGoogle();
    await ingestHandler({ auth: authQueDevuelve(uid), db: handle!.db, config: CONFIG, fetchImpl })(req, res);

    expect(estado.status).toBe(409);
    expect((estado.body as { error: string }).error).toBe("sync_already_running");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("una guarda vencida no bloquea para siempre: una funcion que muere no la suelta", async () => {
    const uid = nuevoTenant("guarda-vieja");
    await conGmailConectado(uid);
    await paths.configDoc(handle!.db, uid, "sync").set({
      runningSince: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    const { req, res, estado } = parHttp({ body: {} });
    await ingestHandler({
      auth: authQueDevuelve(uid),
      db: handle!.db,
      config: CONFIG,
      fetchImpl: fetchDeGoogle({ ids: [] }),
    })(req, res);

    expect(estado.status).toBe(200);
  });

  it("la guarda se suelta al terminar, tambien cuando la corrida falla", async () => {
    const uid = nuevoTenant("suelta");
    await conGmailConectado(uid);
    const { req, res, estado } = parHttp({ body: {} });

    await ingestHandler({
      auth: authQueDevuelve(uid),
      db: handle!.db,
      config: CONFIG,
      fetchImpl: fetchDeGoogle({ canje: respuesta({}, false, 500) }),
    })(req, res);

    expect(estado.status).toBe(502);
    const sync = await paths.configDoc(handle!.db, uid, "sync").get();
    expect(sync.data()!.runningSince).toBeNull();
  });

  /**
   * `invalid_grant` es el permiso que ya no existe. Se marca y se pide
   * reconectar; cualquier otro error de Google es transitorio y NO puede
   * desconectar al usuario. Comparte el 503 con "nunca conectaste" porque para
   * la pantalla del sync las dos son "falta la credencial"; el motivo exacto
   * viaja en `detalle` y quién tiene que reconectar lo dice el chip de Gmail.
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

    expect(estado.status).toBe(503);
    expect((estado.body as { detalle: string }).detalle).toBe("gmail_reconectar");
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

  it("un batch_size fuera de rango es 400 y no un lote de media hora", async () => {
    const uid = nuevoTenant("lote-absurdo");
    await conGmailConectado(uid);
    const fetchImpl = fetchDeGoogle();
    const { req, res, estado } = parHttp({ body: { batch_size: 5000 } });

    await ingestHandler({ auth: authQueDevuelve(uid), db: handle!.db, config: CONFIG, fetchImpl })(req, res);

    expect(estado.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
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

    expect(estado.status).toBe(503);
    expect((estado.body as { detalle: string }).detalle).toBe("gmail_no_conectado");
  });
});
