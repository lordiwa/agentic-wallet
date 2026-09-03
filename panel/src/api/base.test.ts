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
    expect(currentBackendVerdict()).toBe("foreign");
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
