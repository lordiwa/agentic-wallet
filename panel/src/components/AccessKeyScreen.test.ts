/** @vitest-environment jsdom */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccessKeyScreen from "./AccessKeyScreen.vue";
import { getAccessToken, setAccessToken } from "../api/base";
import type { HealthResponse } from "../api/client";

function stubHealth(body: HealthResponse) {
  const fake = vi.fn(async () => ({ ok: true, json: async () => body }));
  vi.stubGlobal("fetch", fake);
  return fake;
}

async function entrarCon(wrapper: ReturnType<typeof mount>, llave: string) {
  await wrapper.get('[data-testid="acceso-llave"]').setValue(llave);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("P0-b — Acceso por llave", () => {
  it("no tiene botón de Google: la decisión M3 saca Firebase del MVP", () => {
    const wrapper = mount(AccessKeyScreen);
    expect(wrapper.text()).not.toContain("Google");
    expect(wrapper.find("svg").exists()).toBe(false);
  });

  it("es un campo, un botón primario y el texto de ayuda", () => {
    const wrapper = mount(AccessKeyScreen);
    expect(wrapper.findAll("input")).toHaveLength(1);
    const boton = wrapper.get('[data-testid="acceso-entrar"]');
    expect(boton.classes()).toContain("pri");
    expect(wrapper.find(".hint").exists()).toBe(true);
  });

  it("la llave no se muestra en claro", () => {
    const wrapper = mount(AccessKeyScreen);
    expect(wrapper.get('[data-testid="acceso-llave"]').attributes("type")).toBe("password");
  });

  it("dice a qué servidor va a viajar la llave", () => {
    const wrapper = mount(AccessKeyScreen);
    expect(wrapper.get('[data-testid="acceso-servidor"]').text()).toBe("este mismo servidor");
  });

  it("el botón está deshabilitado hasta que hay algo escrito", async () => {
    const wrapper = mount(AccessKeyScreen);
    expect(wrapper.get('[data-testid="acceso-entrar"]').attributes("disabled")).toBeDefined();
    await wrapper.get('[data-testid="acceso-llave"]').setValue("algo");
    expect(wrapper.get('[data-testid="acceso-entrar"]').attributes("disabled")).toBeUndefined();
  });

  it("una llave que abre se guarda y avisa al shell", async () => {
    stubHealth({ status: "ok", auth_required: true, authenticated: true });
    const wrapper = mount(AccessKeyScreen);
    await entrarCon(wrapper, "llave-buena");
    expect(getAccessToken()).toBe("llave-buena");
    expect(wrapper.emitted("acceso")).toHaveLength(1);
  });

  it("una llave que NO abre no se queda guardada, y el motivo se explica", async () => {
    stubHealth({ status: "ok", auth_required: true, authenticated: false });
    const wrapper = mount(AccessKeyScreen);
    await entrarCon(wrapper, "llave-mala");
    expect(getAccessToken()).toBeNull();
    expect(wrapper.emitted("acceso")).toBeUndefined();
    expect(wrapper.get('[data-testid="acceso-error"]').text()).toContain("rechazó");
  });

  it("un fallo de llave no borra la que ya funcionaba", async () => {
    setAccessToken("la-que-anda");
    stubHealth({ status: "ok", auth_required: true, authenticated: false });
    const wrapper = mount(AccessKeyScreen);
    await entrarCon(wrapper, "llave-mala");
    expect(getAccessToken()).toBe("la-que-anda");
  });

  it("un server que no responde se explica como tal, no como llave equivocada", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const wrapper = mount(AccessKeyScreen);
    await entrarCon(wrapper, "llave");
    expect(wrapper.get('[data-testid="acceso-error"]').text()).toContain("No respondió");
  });

  it("no dibuja ningún hex: hereda el lienzo por variables", () => {
    const wrapper = mount(AccessKeyScreen);
    expect(wrapper.html()).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
