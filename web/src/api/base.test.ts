/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_BASE_STORAGE_KEY, DEMO_BASE, apiUrl, getApiBase, isDemoMode, setApiBase } from "./base";

function setSearch(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

beforeEach(() => {
  window.localStorage.clear();
  setSearch("");
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

  it("?api= gana y queda guardado para las visitas siguientes", () => {
    setSearch("?api=https://server.ejemplo.ts.net/");
    expect(getApiBase()).toBe("https://server.ejemplo.ts.net");

    setSearch("");
    expect(getApiBase()).toBe("https://server.ejemplo.ts.net");
    expect(apiUrl("/api/overview")).toBe("https://server.ejemplo.ts.net/api/overview");
  });

  it("?api= vacio es una orden de volver al mismo origen, no un valor a ignorar", () => {
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
