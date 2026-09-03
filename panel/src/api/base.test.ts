/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_STORAGE_KEY,
  API_BASE_STORAGE_KEY,
  TRUSTED_ORIGINS_STORAGE_KEY,
  confirmPendingApiBase,
  credentialAllowed,
  currentBackendVerdict,
  dismissPendingApiBase,
  getAccessToken,
  getApiBase,
  pendingApiBase,
  setAccessToken,
  setApiBase,
  storedTrustedOrigins,
  trustBackendOrigin,
} from "./base";

const AJENO = "https://host-ajeno.example";

function setSearch(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

beforeEach(() => {
  window.localStorage.clear();
  setSearch("");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("getApiBase", () => {
  it("sin nada configurado usa el mismo origen", () => {
    expect(getApiBase()).toBe("");
  });

  it("usa lo guardado por una confirmación anterior", () => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, "https://guardado.example/");
    expect(getApiBase()).toBe("https://guardado.example");
  });
});

/**
 * El corazón de R1. El bug que estos casos cierran vive hoy en
 * `web/src/api/base.ts:62-70`: `takeFromQuery` escribía en `localStorage`
 * dentro del mismo `getApiBase()` que lo leía.
 */
describe("?api= no se guarda sin confirmación", () => {
  it("un enlace con ?api= NO cambia el backend en uso", () => {
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    expect(getApiBase()).toBe("");
    expect(window.localStorage.getItem(API_BASE_STORAGE_KEY)).toBeNull();
  });

  it("queda como propuesta pendiente, visible pero sin aplicar", () => {
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    expect(pendingApiBase()).toBe(AJENO);
    expect(window.localStorage.getItem(API_BASE_STORAGE_KEY)).toBeNull();
  });

  it("leer la propuesta muchas veces nunca la guarda", () => {
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    pendingApiBase();
    pendingApiBase();
    getApiBase();
    expect(window.localStorage.getItem(API_BASE_STORAGE_KEY)).toBeNull();
  });

  it("no propone lo que ya está en uso", () => {
    setApiBase(AJENO);
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    expect(pendingApiBase()).toBeNull();
  });

  it("?api= vacío es una propuesta válida: volver al mismo origen", () => {
    setApiBase("https://otro.example");
    setSearch("?api=");
    expect(pendingApiBase()).toBe("");
    confirmPendingApiBase();
    expect(getApiBase()).toBe("");
  });

  it("confirmar es el único camino por el que un enlace llega a guardarse", () => {
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    expect(confirmPendingApiBase()).toBe(AJENO);
    expect(getApiBase()).toBe(AJENO);
  });

  it("confirmar sin autorizar guarda el backend pero NO le da la llave", () => {
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    confirmPendingApiBase();
    // `denied` desde la ronda 3: confirmar sin autorizar dejó de ser un no-op y
    // ahora anota la negación, que gana sobre cualquier veredicto (W27).
    expect(currentBackendVerdict()).toBe("denied");
    expect(credentialAllowed()).toBe(false);
    expect(storedTrustedOrigins()).toEqual([]);
  });

  it("autorizar es una segunda decisión explícita", () => {
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    confirmPendingApiBase({ trust: true });
    expect(currentBackendVerdict()).toBe("trusted");
    expect(credentialAllowed()).toBe(true);
  });

  it("sin propuesta pendiente confirmar no hace nada", () => {
    expect(confirmPendingApiBase({ trust: true })).toBeNull();
    expect(getApiBase()).toBe("");
    expect(storedTrustedOrigins()).toEqual([]);
  });

  it("descartar limpia el ?api= de la barra sin guardar nada", () => {
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    dismissPendingApiBase();
    expect(window.location.search).toBe("");
    expect(pendingApiBase()).toBeNull();
    expect(window.localStorage.getItem(API_BASE_STORAGE_KEY)).toBeNull();
  });
});

describe("la lista blanca decide quién recibe la llave", () => {
  it("el mismo origen y el loopback la reciben sin configurar nada", () => {
    expect(credentialAllowed("")).toBe(true);
    expect(credentialAllowed("http://127.0.0.1:3000")).toBe(true);
  });

  it("un backend ajeno no la recibe", () => {
    expect(credentialAllowed(AJENO)).toBe(false);
  });

  it("trustBackendOrigin sólo anota orígenes ajenos, y no repite", () => {
    trustBackendOrigin(AJENO);
    trustBackendOrigin(`${AJENO}/otra/ruta`);
    trustBackendOrigin("http://127.0.0.1:3000");
    expect(storedTrustedOrigins()).toEqual([AJENO]);
  });

  it("una URL basura no ensucia la lista", () => {
    trustBackendOrigin("javascript:alert(1)");
    expect(window.localStorage.getItem(TRUSTED_ORIGINS_STORAGE_KEY)).toBeNull();
  });
});

describe("la llave", () => {
  it("se guarda recortada y vacía significa borrarla", () => {
    setAccessToken("  llave-secreta  ");
    expect(getAccessToken()).toBe("llave-secreta");
    setAccessToken("   ");
    expect(window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it("nunca viaja en la URL: no se lee de la query", () => {
    setSearch("?token=llave-en-la-url");
    expect(getAccessToken()).toBeNull();
  });
});

/**
 * Wargaming ronda 3 (W27). El cartel de R1 ofrece dos botones —*"Guardar sin
 * darle la llave"* y *"Guardar y autorizar"*— y el primero **no hacía lo que
 * dice**: `trustBackendOrigin` cortaba en `verdict !== "foreign"`, así que para
 * cualquier backend que ya entrara solo (loopback, configured) los dos botones
 * eran el mismo, y la llave salía igual.
 *
 * El vector: `?api=http://ajeno.localhost:8787` (W13b lo cerró por otra puerta)
 * o, sin subdominios, un proceso cualquiera escuchando en `127.0.0.1:9999` —
 * que sigue siendo `loopback` y sigue entrando solo. El usuario que hace
 * exactamente lo prudente entrega el `WALLET_ACCESS_TOKEN`.
 *
 * El botón no puede ser un no-op: guardar sin dar la llave tiene que **negar**
 * el origen, y la negación gana sobre cualquier veredicto.
 */
describe("W27 — 'Guardar sin darle la llave' niega el origen de verdad", () => {
  it("un loopback guardado sin llave deja de recibirla", () => {
    setSearch("?api=http://127.0.0.1:9999");
    confirmPendingApiBase({ trust: false });
    expect(getApiBase()).toBe("http://127.0.0.1:9999");
    expect(credentialAllowed()).toBe(false);
    expect(currentBackendVerdict()).toBe("denied");
  });

  it("el mismo backend guardado CON llave sí la recibe", () => {
    setSearch("?api=http://127.0.0.1:9999");
    confirmPendingApiBase({ trust: true });
    expect(credentialAllowed()).toBe(true);
  });

  it("autorizar después levanta la negación: la última decisión manda", () => {
    setSearch("?api=http://127.0.0.1:9999");
    confirmPendingApiBase({ trust: false });
    expect(credentialAllowed()).toBe(false);
    trustBackendOrigin("http://127.0.0.1:9999");
    expect(credentialAllowed()).toBe(true);
  });

  it("negar un origen no toca a los demás", () => {
    setSearch("?api=http://127.0.0.1:9999");
    confirmPendingApiBase({ trust: false });
    expect(credentialAllowed("http://localhost:8787")).toBe(true);
  });
});
