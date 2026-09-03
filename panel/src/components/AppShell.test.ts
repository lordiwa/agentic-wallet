/** @vitest-environment jsdom */
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import AppShell from "./AppShell.vue";
import { API_BASE_STORAGE_KEY } from "../api/base";

afterEach(() => {
  window.localStorage.clear();
});

function montar(pantalla: "resumen" | "preguntas" | "movimientos" = "resumen") {
  return mount(AppShell, { props: { pantalla } });
}

describe("la navegación recortada", () => {
  it("son tres, y son estas tres", () => {
    const enlaces = montar().findAll('[data-testid="nav"] a');
    expect(enlaces.map((a) => a.text())).toEqual(["Resumen", "Preguntas", "Movimientos"]);
  });

  /**
   * El sistema dibuja nueve enlaces. Los otros seis no están y no es un
   * olvido: lo que no tiene backend, o no entra al MVP, no se dibuja.
   */
  it("no hay enlace a una pantalla que el MVP no construye", () => {
    const texto = montar().text();
    for (const ausente of ["Sincronización", "Reglas", "Estrategia", "Ahorro", "Chat", "Configuración"]) {
      expect(texto).not.toContain(ausente);
    }
  });

  it("Sincronización no está porque el ciclo entero vive en el chip del Resumen", () => {
    const hrefs = montar()
      .findAll('[data-testid="nav"] a')
      .map((a) => a.attributes("href"));
    expect(hrefs).toEqual(["#/resumen", "#/preguntas", "#/movimientos"]);
  });

  it("marca la pantalla activa, y sólo una", () => {
    const wrapper = montar("movimientos");
    const activos = wrapper.findAll('[data-testid="nav"] a.on');
    expect(activos).toHaveLength(1);
    expect(activos[0].text()).toBe("Movimientos");
    expect(activos[0].attributes("aria-current")).toBe("page");
  });
});

describe("el pie de la barra", () => {
  it("con un backend de verdad no anuncia una demostración que no está pasando", () => {
    expect(montar().find('[data-testid="nav-demo"]').exists()).toBe(false);
  });

  it("en modo demo lo dice, como en el sistema", () => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, "demo");
    expect(montar().get('[data-testid="nav-demo"]').text()).toContain("Modo demostración");
  });
});
