/** @vitest-environment jsdom */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackendChip from "./BackendChip.vue";
import { API_BASE_STORAGE_KEY, getApiBase, setAccessToken, storedTrustedOrigins } from "../api/base";
import type { HealthResponse } from "../api/client";

const AJENO = "https://host-ajeno.example";

function setSearch(search: string) {
  window.history.replaceState({}, "", `/${search}`);
}

function stubHealth(body: HealthResponse) {
  const fake = vi.fn(async (_url: string) => ({ ok: true, json: async () => body }));
  vi.stubGlobal("fetch", fake);
  return fake;
}

async function montar() {
  const wrapper = mount(BackendChip);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  window.localStorage.clear();
  setSearch("");
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("BackendChip", () => {
  it("se ve siempre y dice a qué servidor apunta este navegador", async () => {
    stubHealth({ status: "ok", auth_required: false, authenticated: true });
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="backend-chip"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="backend-chip-servidor"]').text()).toBe("este mismo servidor");
  });

  it("prueba la conexión al montar y muestra el estado con una etiqueta del sistema", async () => {
    const fake = stubHealth({ status: "ok", auth_required: false, authenticated: true });
    const wrapper = await montar();
    expect(fake).toHaveBeenCalledOnce();
    expect(String(fake.mock.calls[0][0])).toBe("/api/health");
    const tag = wrapper.get('[data-testid="backend-chip-tag"]');
    expect(tag.text()).toBe("Conectado");
    expect(tag.classes()).toContain("ok");
  });

  it("'Probar conexión' vuelve a consultar health", async () => {
    const fake = stubHealth({ status: "ok", auth_required: false, authenticated: true });
    const wrapper = await montar();
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(fake).toHaveBeenCalledTimes(2);
  });

  it("un server que pide llave sin tenerla se rotula 'Sin llave', no 'Sin respuesta'", async () => {
    stubHealth({ status: "ok", auth_required: true, authenticated: false });
    const wrapper = await montar();
    const tag = wrapper.get('[data-testid="backend-chip-tag"]');
    expect(tag.text()).toBe("Sin llave");
    expect(tag.classes()).toContain("warn");
  });

  it("un server caído se distingue de una credencial rechazada (R27)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const wrapper = await montar();
    expect(wrapper.get('[data-testid="backend-chip-tag"]').text()).toBe("Sin respuesta");
    expect(wrapper.get('[data-testid="backend-chip-explicacion"]').text()).toContain("CORS");
  });

  it("rotula el modo demo en el mismo lugar que el estado", async () => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, "demo");
    const fake = stubHealth({ status: "ok" });
    const wrapper = await montar();
    expect(wrapper.get('[data-testid="backend-chip-tag"]').text()).toBe("Demostración");
    expect(fake).not.toHaveBeenCalled();
  });

  it("avisa cuando el backend en uso no puede recibir la llave", async () => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, AJENO);
    setAccessToken("llave");
    stubHealth({ status: "ok", auth_required: true, authenticated: false });
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="backend-chip-sin-credencial"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="backend-chip-explicacion"]').text()).toContain("no está autorizado");
  });

  it("no dibuja ningún hex: los colores salen de las clases del sistema", async () => {
    stubHealth({ status: "ok", auth_required: false, authenticated: true });
    const wrapper = await montar();
    expect(wrapper.html()).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe("BackendChip y el ?api= de un enlace (R1)", () => {
  beforeEach(() => {
    setSearch(`?api=${encodeURIComponent(AJENO)}`);
    stubHealth({ status: "ok", auth_required: false, authenticated: true });
  });

  it("muestra la propuesta y deja claro que no guardó nada", async () => {
    const wrapper = await montar();
    const aviso = wrapper.get('[data-testid="backend-chip-propuesta"]');
    expect(aviso.text()).toContain("host-ajeno.example");
    expect(aviso.text()).toContain("No se guardó nada todavía");
    expect(getApiBase()).toBe("");
  });

  it("descartar no guarda nada y saca el ?api= de la barra", async () => {
    const wrapper = await montar();
    await wrapper.get('[data-testid="backend-chip-propuesta"] .qui').trigger("click");
    expect(getApiBase()).toBe("");
    expect(window.location.search).toBe("");
    expect(wrapper.find('[data-testid="backend-chip-propuesta"]').exists()).toBe(false);
  });

  it("guardar sin autorizar cambia el backend pero no le da la llave", async () => {
    const wrapper = await montar();
    const botones = wrapper.findAll('[data-testid="backend-chip-propuesta"] button');
    await botones[0].trigger("click");
    expect(getApiBase()).toBe(AJENO);
    expect(storedTrustedOrigins()).toEqual([]);
  });

  it("guardar y autorizar es el botón aparte, y es el único que da la llave", async () => {
    const wrapper = await montar();
    await wrapper.get('[data-testid="backend-chip-propuesta"] .pri').trigger("click");
    expect(getApiBase()).toBe(AJENO);
    expect(storedTrustedOrigins()).toEqual([AJENO]);
  });
});
