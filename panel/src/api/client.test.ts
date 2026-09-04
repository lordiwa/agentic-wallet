/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE_STORAGE_KEY, setAccessToken, setApiBase } from "./base";
import { setProveedorIdToken } from "./gmail";
import {
  apiUrlFor,
  buildHeaders,
  etiquetaBackend,
  explicarEstado,
  panelFetch,
  probeHealth,
  rutaEnFunciones,
  tagDeEstado,
} from "./client";
import type { HealthResponse } from "./client";

const AJENO = "https://host-ajeno.example";
const LLAVE = "llave-de-prueba";

function healthFetch(body: HealthResponse, ok = true): typeof fetch {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("apiUrlFor", () => {
  it("el mismo origen y el demo dejan el path relativo", () => {
    expect(apiUrlFor("", "/api/health")).toBe("/api/health");
    expect(apiUrlFor("demo", "/api/health")).toBe("/api/health");
  });

  it("una base absoluta se antepone sin barra doble", () => {
    expect(apiUrlFor("https://a.example/", "/api/health")).toBe("https://a.example/api/health");
  });
});

describe("buildHeaders", () => {
  it("no manda Authorization si no hay llave cargada", () => {
    expect(buildHeaders().has("Authorization")).toBe(false);
  });

  it("manda la llave al mismo origen", () => {
    setAccessToken(LLAVE);
    expect(buildHeaders().get("Authorization")).toBe(`Bearer ${LLAVE}`);
  });

  it("NO manda la llave a un backend fuera de la lista blanca", () => {
    setAccessToken(LLAVE);
    setApiBase(AJENO);
    expect(buildHeaders().has("Authorization")).toBe(false);
  });

  it("conserva las cabeceras que ya traía el llamador", () => {
    const headers = buildHeaders({ headers: { "Content-Type": "application/json" } });
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});

describe("panelFetch", () => {
  it("un backend ajeno se llama IGUAL, pero pelado", async () => {
    setAccessToken(LLAVE);
    setApiBase(AJENO);
    const fake = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fake);

    await panelFetch("/api/overview");

    expect(fake).toHaveBeenCalledOnce();
    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${AJENO}/api/overview`);
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("en modo demo no toca la red: contesta la demo (T4)", async () => {
    setApiBase("demo");
    const fake = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fake);

    const res = await panelFetch("/api/overview");

    expect(fake).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    expect(await res.json()).toHaveProperty("safe_to_spend_hoy");
  });
});

/**
 * El modo demostracion gobierna SOLO mientras no hay sesion. Es la regla que ya
 * regia para Gmail (`api/gmail.ts`) y que hasta ahora el ledger no cumplia: en
 * el sitio publicado el build trae `VITE_API_BASE_URL=demo`, asi que quien
 * entraba con su cuenta seguia viendo movimientos inventados.
 */
describe("panelFetch con sesion — el ledger sale de las funciones, no del demo", () => {
  const FUNCIONES = "https://us-central1-proyecto-de-prueba.cloudfunctions.net";

  beforeEach(() => {
    vi.stubEnv("VITE_FUNCTIONS_BASE_URL", FUNCIONES);
    setApiBase("demo");
  });

  afterEach(() => {
    setProveedorIdToken(async () => null);
    vi.unstubAllEnvs();
  });

  it("/api/overview va a la funcion real con el ID token", async () => {
    setProveedorIdToken(async () => "id-token-de-prueba");
    const fake = vi.fn(async () => new Response('{"counts":{"total":1159}}'));
    vi.stubGlobal("fetch", fake);

    const res = await panelFetch("/api/overview");

    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    // `/api/*` lo sirve la funcion `api`, asi que el path viaja entero.
    expect(url).toBe(`${FUNCIONES}/api/overview`);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer id-token-de-prueba");
    expect((await res.json()).counts.total).toBe(1159);
  });

  it("sin sesion sigue contestando la demo", async () => {
    const fake = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fake);

    const res = await panelFetch("/api/overview");

    expect(fake).not.toHaveBeenCalled();
    expect(await res.json()).toHaveProperty("safe_to_spend_hoy");
  });

  /**
   * Esto contestaba `501 no_portado`: el pivot habia portado UNA ruta y el
   * resto se contestaba desde el cliente. Ya no queda ninguna sin portar (ver
   * `docs/portado-completo.md`), asi que el ledger entero sale de las
   * funciones y la query viaja con el path.
   */
  it("el resto del ledger tambien sale de las funciones, con su query", async () => {
    setProveedorIdToken(async () => "id-token-de-prueba");
    const fake = vi.fn(async () => new Response('{"transactions":[],"count":0}'));
    vi.stubGlobal("fetch", fake);

    const res = await panelFetch("/api/transactions?limit=50");

    const [url] = fake.mock.calls[0] as unknown as [string];
    expect(url).toBe(`${FUNCIONES}/api/transactions?limit=50`);
    expect((await res.json()).count).toBe(0);
  });

  /**
   * El sync NO va a la funcion `api`: es la unica que descifra el refresh
   * token, y tenerla aparte es lo que hace que el resto del backend no tenga la
   * clave maestra en su proceso.
   */
  it("el sync va a su propia funcion, que es la unica con la clave maestra", async () => {
    setProveedorIdToken(async () => "id-token-de-prueba");
    const fake = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fake);

    await panelFetch("/api/sync", { method: "POST" });

    const [url] = fake.mock.calls[0] as unknown as [string];
    expect(url).toBe(`${FUNCIONES}/ingest`);
  });

  it("un server propio le gana a la sesion: la eleccion explicita no se pisa", async () => {
    setProveedorIdToken(async () => "id-token-de-prueba");
    setApiBase(AJENO);
    const fake = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fake);

    await panelFetch("/api/overview");

    const [url] = fake.mock.calls[0] as unknown as [string];
    expect(url).toBe(`${AJENO}/api/overview`);
  });

  it("el chip deja de decir 'demostracion' cuando los numeros son reales", async () => {
    setProveedorIdToken(async () => "id-token-de-prueba");
    const fake = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as unknown as typeof fetch;

    const diag = await probeHealth(fake);

    expect(diag.estado).toBe("conectado");
  });
});

describe("rutaEnFunciones", () => {
  it("todo /api/* pasa derecho: no queda ninguna ruta sin portar", () => {
    expect(rutaEnFunciones("/api/overview")).toBe("/api/overview");
    expect(rutaEnFunciones("/api/transactions")).toBe("/api/transactions");
    expect(rutaEnFunciones("/api/classify/queue")).toBe("/api/classify/queue");
  });

  it("la query viaja con el path", () => {
    expect(rutaEnFunciones("/api/overview?x=1")).toBe("/api/overview?x=1");
    expect(rutaEnFunciones("/api/transactions?limit=50&from=2026-01-01")).toBe(
      "/api/transactions?limit=50&from=2026-01-01"
    );
  });

  it("las dos excepciones tienen su propia funcion, por su propio motivo", () => {
    expect(rutaEnFunciones("/api/sync")).toBe("/ingest");
    expect(rutaEnFunciones("/api/health")).toBe("/health");
    // `/api/sync/status` NO es `/api/sync`: la lee la funcion `api`, que no
    // necesita el refresh token para contestar cuando fue el ultimo lote.
    expect(rutaEnFunciones("/api/sync/status")).toBe("/api/sync/status");
  });
});

describe("probeHealth", () => {
  it("un server sin llave configurada está conectado", async () => {
    const diag = await probeHealth(healthFetch({ status: "ok", auth_required: false, authenticated: true }));
    expect(diag.estado).toBe("conectado");
    expect(diag.authRequired).toBe(false);
  });

  it("pide llave y no hay ninguna cargada -> sin-llave", async () => {
    const diag = await probeHealth(healthFetch({ status: "ok", auth_required: true, authenticated: false }));
    expect(diag.estado).toBe("sin-llave");
  });

  it("pide llave, mandamos una y la rechaza -> llave-rechazada", async () => {
    setAccessToken(LLAVE);
    const diag = await probeHealth(healthFetch({ status: "ok", auth_required: true, authenticated: false }));
    expect(diag.estado).toBe("llave-rechazada");
  });

  it("pide llave y la nuestra sirve -> conectado", async () => {
    setAccessToken(LLAVE);
    const diag = await probeHealth(healthFetch({ status: "ok", auth_required: true, authenticated: true }));
    expect(diag.estado).toBe("conectado");
  });

  /** El criterio 4 del ticket, dicho en un test: el 401 se explica en vez de
   * resolverse mandando la llave. */
  it("un backend ajeno que pide llave es 'no-autorizado', no 'sin-llave'", async () => {
    setAccessToken(LLAVE);
    setApiBase(AJENO);
    const diag = await probeHealth(healthFetch({ status: "ok", auth_required: true, authenticated: false }));
    expect(diag.estado).toBe("no-autorizado");
    expect(explicarEstado(diag)).toContain("no está autorizado");
  });

  it("a health tampoco le manda la llave si el backend es ajeno", async () => {
    setAccessToken(LLAVE);
    setApiBase(AJENO);
    const fake = healthFetch({ status: "ok", auth_required: true, authenticated: false });
    await probeHealth(fake);
    const [, init] = (fake as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("sin respuesta no se confunde con credencial rechazada (R27)", async () => {
    const cae = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const diag = await probeHealth(cae);
    expect(diag.estado).toBe("sin-respuesta");
    expect(explicarEstado(diag)).toContain("caído");
  });

  it("un 500 tampoco es 'conectado'", async () => {
    const diag = await probeHealth(healthFetch({ status: "ok" }, false));
    expect(diag.estado).toBe("sin-respuesta");
  });

  it("el modo demo no llama a nadie", async () => {
    setApiBase("demo");
    const fake = healthFetch({ status: "ok" });
    const diag = await probeHealth(fake);
    expect(diag.estado).toBe("demo");
    expect(fake).not.toHaveBeenCalled();
  });
});

describe("tagDeEstado", () => {
  it("usa sólo las etiquetas .tag del sistema", () => {
    expect(tagDeEstado("conectado").clase).toBe("ok");
    expect(tagDeEstado("sin-llave").clase).toBe("warn");
    expect(tagDeEstado("llave-rechazada").clase).toBe("bad");
    expect(tagDeEstado("no-autorizado").clase).toBe("bad");
    expect(tagDeEstado("sin-respuesta").clase).toBe("bad");
    expect(tagDeEstado("demo").clase).toBe("neu");
    expect(tagDeEstado(null)).toEqual({ clase: "neu", texto: "Sin probar" });
  });
});

describe("etiquetaBackend", () => {
  it("nombra el mismo origen sin inventar una URL", () => {
    expect(etiquetaBackend("")).toBe("este mismo servidor");
    expect(etiquetaBackend("demo")).toBe("sin servidor");
  });

  it("de un backend real muestra el host, no la URL entera", () => {
    expect(etiquetaBackend("https://maquina.tail-ejemplo.ts.net/algo")).toBe("maquina.tail-ejemplo.ts.net");
    expect(etiquetaBackend("http://127.0.0.1:3000")).toBe("127.0.0.1:3000");
  });
});

describe("el backend guardado se respeta entre recargas", () => {
  it("lo que quedó en storage manda sobre el default", () => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, "http://127.0.0.1:3000");
    expect(apiUrlFor("http://127.0.0.1:3000", "/api/health")).toBe("http://127.0.0.1:3000/api/health");
  });
});

/**
 * Wargaming ronda 2 (W13). `new URL("data:text/html,...")` y
 * `new URL("javascript:...")` parsean sin `host`, así que el chip mostraba una
 * cadena vacía. El cartel *"este enlace quiere cambiar tu backend a ___"* es la
 * mitigación de R1 entera: si no dice a qué, el usuario confirma a ciegas.
 */
describe("etiquetaBackend — el chip siempre dice a quién le habla (W13)", () => {
  it("una base sin host se muestra tal cual, no en blanco", () => {
    expect(etiquetaBackend("data:text/html,<h1>hola</h1>")).not.toBe("");
    expect(etiquetaBackend("javascript:alert(1)")).not.toBe("");
  });

  it("un host de verdad se sigue mostrando como el host", () => {
    expect(etiquetaBackend("https://ejemplo.invalid:8443/api")).toBe("ejemplo.invalid:8443");
  });

  it("los dos casos con nombre propio no cambian", () => {
    expect(etiquetaBackend("")).toBe("este mismo servidor");
    expect(etiquetaBackend("demo")).toBe("sin servidor");
  });
});
