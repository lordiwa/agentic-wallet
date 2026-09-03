/** @vitest-environment jsdom */
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SyncButton from "./SyncButton.vue";
import type { EntradaSync } from "../lib/sync-estado";

const AHORA = new Date("2026-09-03T12:00:00Z");

function entrada(overrides: Partial<EntradaSync> = {}): EntradaSync {
  return { lastSyncTs: null, backlog: null, running: false, enVuelo: false, falla: null, ...overrides };
}

function montar(overrides: Partial<EntradaSync> = {}) {
  return mount(SyncButton, { props: { entrada: entrada(overrides), ahora: AHORA } });
}

describe("SyncButton", () => {
  it("nunca sincronizado: lo dice, sin inventar una fecha", () => {
    const wrapper = montar();
    expect(wrapper.get('[data-testid="sync-button-titulo"]').text()).toBe("Nunca sincronizaste");
    expect(wrapper.get('[data-testid="sync-button-accion"]').text()).toContain("por primera vez");
  });

  it("al pulsarlo avisa hacia afuera: el componente no llama a la API", async () => {
    const wrapper = montar();
    await wrapper.get('[data-testid="sync-button-accion"]').trigger("click");
    expect(wrapper.emitted("sincronizar")).toHaveLength(1);
  });

  it("mientras corre, el botón está deshabilitado", () => {
    const wrapper = montar({ enVuelo: true });
    expect(wrapper.get<HTMLButtonElement>('[data-testid="sync-button-accion"]').element.disabled).toBe(true);
  });

  it("la barra de progreso vive DENTRO del chip, no en una pantalla P3", () => {
    const wrapper = montar({ backlog: { processed: 1240, total: 3800, remaining: 2560 } });

    const fill = wrapper.get(".fill");
    expect(fill.attributes("style")).toContain("width: 33%");
    expect(wrapper.get('[data-testid="sync-button-progreso"]').text()).toBe("1240 de 3800");
  });

  it("a medias: el botón dice Seguir y se puede pulsar", async () => {
    const wrapper = montar({ backlog: { processed: 1240, total: 3800, remaining: 2560 } });

    const boton = wrapper.get<HTMLButtonElement>('[data-testid="sync-button-accion"]');
    expect(boton.text()).toBe("Seguir");
    expect(boton.element.disabled).toBe(false);

    await boton.trigger("click");
    expect(wrapper.emitted("sincronizar")).toHaveLength(1);
  });

  it("no dibuja un botón Detener: el runner escribe el progreso al final del lote (H18)", () => {
    const wrapper = montar({ enVuelo: true, backlog: { processed: 10, total: 100, remaining: 90 } });
    expect(wrapper.text()).not.toContain("Detener");
  });

  it("el 409 y el 503 comparten el cartel pero no el texto", () => {
    const conflicto = montar({ falla: { codigo: 409, mensaje: "sync_already_running" } });
    const sinGmail = montar({ falla: { codigo: 503, mensaje: "gmail_not_configured" } });

    expect(conflicto.get('[data-testid="sync-button"]').attributes("data-estado")).toBe("fallo");
    expect(sinGmail.get('[data-testid="sync-button"]').attributes("data-estado")).toBe("fallo");
    expect(conflicto.get('[data-testid="sync-button-titulo"]').text()).not.toBe(
      sinGmail.get('[data-testid="sync-button-titulo"]').text()
    );
  });

  it("los cinco estados del MVP se dibujan, y cada uno se distingue", () => {
    const estados = [
      montar(),
      montar({ lastSyncTs: "2026-09-03T11:00:00Z" }),
      montar({ lastSyncTs: "2026-08-01T11:00:00Z" }),
      montar({ enVuelo: true }),
      montar({ falla: { codigo: "otro", mensaje: "boom" } }),
    ].map((w) => w.get('[data-testid="sync-button"]').attributes("data-estado"));

    expect(estados).toEqual(["nunca", "al-dia", "atrasado", "corriendo", "fallo"]);
  });
});
