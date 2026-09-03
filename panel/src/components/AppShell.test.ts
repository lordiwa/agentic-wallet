/** @vitest-environment jsdom */
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import AppShell from "./AppShell.vue";
import { API_BASE_STORAGE_KEY, DEMO_BASE, setApiBase } from "../api/base";

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

/**
 * Wargaming ronda 3 (W25). El único lugar donde el panel dice *"estos números
 * son ficción"* era `const demo = isDemoMode()`: una foto tomada al montar, que
 * no se volvía a mirar nunca. Y el backend **se puede cambiar sin recargar** —
 * `BackendChip` acepta la propuesta de `?api=`, escribe `localStorage` y sigue.
 *
 * El ataque es un enlace: `https://<panel>/?api=demo`. El cartel dice *"Este
 * enlace quiere cambiar tu backend a `sin servidor`"*, el usuario aprieta el
 * botón que parece prudente, y a partir del próximo tick del reloj el saldo, el
 * *safe to spend*, las deudas y el gráfico salen de `demoFetch` — **inventados,
 * presentados como su ledger, sin un solo cartel**. Al revés pasa lo mismo: se
 * queda el cartel de demostración mientras el panel muestra el ledger real.
 *
 * Todo el aparato de "lo que no se leyó no se dibuja" (W5) no sirve de nada si
 * el rótulo que dice de dónde salen los datos es un `const`.
 */
describe("W25 — el cartel de demostración no es una foto", () => {
  it("aparece cuando el backend pasa a demo sin recargar la página", async () => {
    const w = montar();
    expect(w.find('[data-testid="nav-demo"]').exists()).toBe(false);

    setApiBase(DEMO_BASE);
    await w.vm.$nextTick();

    expect(w.find('[data-testid="nav-demo"]').exists()).toBe(true);
  });

  it("y desaparece cuando se sale de demo, también sin recargar", async () => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, DEMO_BASE);
    const w = montar();
    expect(w.find('[data-testid="nav-demo"]').exists()).toBe(true);

    setApiBase("http://localhost:8787");
    await w.vm.$nextTick();

    expect(w.find('[data-testid="nav-demo"]').exists()).toBe(false);
  });
});
