/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE_STORAGE_KEY, setAccessToken, setApiBase } from "./base";
import {
  apiUrlFor,
  buildHeaders,
  etiquetaBackend,
  explicarEstado,
  panelFetch,
  probeHealth,
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
    expect(etiquetaBackend("https://maquina.tail1234.ts.net/algo")).toBe("maquina.tail1234.ts.net");
    expect(etiquetaBackend("http://127.0.0.1:3000")).toBe("127.0.0.1:3000");
  });
});

describe("el backend guardado se respeta entre recargas", () => {
  it("lo que quedó en storage manda sobre el default", () => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, "http://127.0.0.1:3000");
    expect(apiUrlFor("http://127.0.0.1:3000", "/api/health")).toBe("http://127.0.0.1:3000/api/health");
  });
});
