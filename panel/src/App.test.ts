/** @vitest-environment jsdom */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.vue";
import { API_BASE_STORAGE_KEY, setAccessToken } from "./api/base";
import type { HealthResponse } from "./api/client";

function stubHealth(body: HealthResponse) {
  const fake = vi.fn(async (_url: string) => ({ ok: true, json: async () => body }));
  vi.stubGlobal("fetch", fake);
  return fake;
}

async function montar() {
  const wrapper = mount(App);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("el andamio de N0", () => {
  it("el chip está en la barra pase lo que pase", async () => {
    stubHealth({ status: "ok", auth_required: false, authenticated: true });
    const wrapper = await montar();
    expect(wrapper.find(".barra [data-testid='backend-chip']").exists()).toBe(true);
  });

  it("pide la llave cuando el server la pide y este navegador no la tiene", async () => {
    stubHealth({ status: "ok", auth_required: true, authenticated: false });
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="acceso-llave"]').exists()).toBe(true);
    // Y el chip sigue arriba: un ?api= hostil se puede rechazar ANTES de
    // escribir la llave.
    expect(wrapper.find(".barra [data-testid='backend-chip']").exists()).toBe(true);
  });

  it("no pide llave si el server no la pide", async () => {
    stubHealth({ status: "ok", auth_required: false, authenticated: true });
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="acceso-llave"]').exists()).toBe(false);
  });

  it("no pide llave si la que hay ya sirve", async () => {
    setAccessToken("la-que-anda");
    stubHealth({ status: "ok", auth_required: true, authenticated: true });
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="acceso-llave"]').exists()).toBe(false);
  });

  it("un backend ajeno no manda a la pantalla de llave: el problema es otro", async () => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, "https://host-ajeno.example");
    stubHealth({ status: "ok", auth_required: true, authenticated: false });
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="acceso-llave"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="backend-chip-tag"]').text()).toBe("No autorizado");
  });

  it("un server caído tampoco manda a la pantalla de llave", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="acceso-llave"]').exists()).toBe(false);
  });
});
