/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_TOKEN_STORAGE_KEY,
  API_BASE_STORAGE_KEY,
  DEMO_BASE,
  TRUSTED_ORIGINS_STORAGE_KEY,
  apiFetch,
  apiUrl,
  confirmPendingApiBase,
  credentialAllowed,
  getApiBase,
  isDemoMode,
  pendingApiBase,
  resetQueryPrompt,
  setApiBase,
} from "./base";

const AJENO = "https://host-ajeno.example";

function setSearch(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

/** `window.confirm` no esta implementado en jsdom; cada caso declara que
 * respondio la persona. */
function responder(respuesta: boolean) {
  const spy = vi.fn((_mensaje: string) => respuesta);
  vi.stubGlobal("confirm", spy);
  return spy;
}

beforeEach(() => {
  window.localStorage.clear();
  setSearch("");
  resetQueryPrompt();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("getApiBase", () => {
  it("sin nada configurado usa el mismo origen", () => {
    expect(getApiBase()).toBe("");
    expect(apiUrl("/api/overview")).toBe("/api/overview");
  });

  it("?api= confirmado gana y queda guardado para las visitas siguientes", () => {
    responder(true);
    setSearch("?api=https://server.ejemplo.ts.net/");
    expect(getApiBase()).toBe("https://server.ejemplo.ts.net");

    setSearch("");
    expect(getApiBase()).toBe("https://server.ejemplo.ts.net");
    expect(apiUrl("/api/overview")).toBe("https://server.ejemplo.ts.net/api/overview");
  });

  it("?api= vacio confirmado es una orden de volver al mismo origen", () => {
    responder(true);
    window.localStorage.setItem(API_BASE_STORAGE_KEY, "https://viejo.ejemplo");
    setSearch("?api=");
    expect(getApiBase()).toBe("");
    expect(window.localStorage.getItem(API_BASE_STORAGE_KEY)).toBeNull();
  });

  it("lee lo guardado cuando no hay parametro", () => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, "https://guardado.ejemplo");
    expect(getApiBase()).toBe("https://guardado.ejemplo");
  });
});

/**
 * R1 — el agujero que cerraba esta fase. Hasta N0, `?api=` se guardaba solo
 * dentro del mismo `getApiBase()` que lo leia: un enlace alcanzaba para
 * redirigir todas las consultas del dashboard (y, con la llave en la
 * cabecera, para entregarla) sin preguntarle nada a nadie.
 */
describe("?api= no se guarda sin confirmacion explicita", () => {
  it("un enlace con ?api= pregunta antes de guardar", () => {
    const spy = responder(true);
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    getApiBase();
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).toContain(AJENO);
  });

  it("si la persona cancela, no se guarda ni se aplica nada", () => {
    responder(false);
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    expect(getApiBase()).toBe("");
    expect(window.localStorage.getItem(API_BASE_STORAGE_KEY)).toBeNull();
  });

  it("pregunta una sola vez por carga, no una vez por render", () => {
    const spy = responder(false);
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    getApiBase();
    getApiBase();
    getApiBase();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("pendingApiBase deja ver la propuesta sin guardarla", () => {
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    expect(pendingApiBase()).toBe(AJENO);
    expect(window.localStorage.getItem(API_BASE_STORAGE_KEY)).toBeNull();
  });

  it("no pregunta por lo que ya esta en uso", () => {
    const spy = responder(true);
    setApiBase(AJENO);
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    getApiBase();
    expect(spy).not.toHaveBeenCalled();
  });

  it("sin propuesta pendiente, confirmar no hace nada", () => {
    const spy = responder(true);
    expect(confirmPendingApiBase()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

/** R2 — la llave sale sólo hacia la lista blanca. */
describe("lista blanca de origenes", () => {
  it("el mismo origen y el loopback pueden recibir la llave", () => {
    expect(credentialAllowed("")).toBe(true);
    expect(credentialAllowed("http://127.0.0.1:3000")).toBe(true);
  });

  it("un backend ajeno no la recibe, ni aunque este guardado", () => {
    setApiBase(AJENO);
    expect(credentialAllowed()).toBe(false);
  });

  it("un origen confirmado a mano si la recibe", () => {
    window.localStorage.setItem(TRUSTED_ORIGINS_STORAGE_KEY, AJENO);
    setApiBase(AJENO);
    expect(credentialAllowed()).toBe(true);
  });

  it("apiFetch manda la llave al backend autorizado", async () => {
    const fake = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fake);
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, "llave-secreta");

    await apiFetch("/api/overview");

    const [, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer llave-secreta");
  });

  it("apiFetch llama IGUAL al backend ajeno, pero sin credencial", async () => {
    const fake = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fake);
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, "llave-secreta");
    setApiBase(AJENO);

    await apiFetch("/api/overview");

    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${AJENO}/api/overview`);
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });
});

describe("setApiBase", () => {
  it("null limpia la configuracion", () => {
    setApiBase("https://algo.ejemplo");
    expect(getApiBase()).toBe("https://algo.ejemplo");
    setApiBase(null);
    expect(getApiBase()).toBe("");
  });
});

describe("modo demostracion", () => {
  it("se activa con la base 'demo' y no arma una URL absoluta", () => {
    setApiBase(DEMO_BASE);
    expect(isDemoMode()).toBe(true);
    expect(apiUrl("/api/overview")).toBe("/api/overview");
  });

  it("no esta activo por defecto: un build local habla con su propio server", () => {
    expect(isDemoMode()).toBe(false);
  });
});
