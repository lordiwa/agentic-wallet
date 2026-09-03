/** @vitest-environment jsdom */
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ClassifyCard from "./ClassifyCard.vue";
import type { ClassifyGroupRow } from "../api/types";

function grupo(overrides: Partial<ClassifyGroupRow> = {}): ClassifyGroupRow {
  return {
    pattern: "comercio de ejemplo a",
    counterparty: "Comercio de Ejemplo A",
    count: 6,
    total: 312.4,
    months: 3,
    category: "otros",
    last_ts: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function montar(props: Record<string, unknown> = {}) {
  return mount(ClassifyCard, { props: { grupo: grupo(), posicion: 1, total: 151, ...props } as never });
}

describe("ClassifyCard — la tarjeta de una contraparte", () => {
  it("muestra contraparte, cuántos movimientos, cuánta plata y en cuántos meses", () => {
    const w = montar();
    expect(w.get('[data-testid="classify-contraparte"]').text()).toBe("Comercio de Ejemplo A");
    expect(w.get('[data-testid="classify-total"]').text()).toBe("312,40");
    const texto = w.text();
    expect(texto).toContain("6 movimientos");
    expect(texto).toContain("3 meses");
  });

  it("dice su lugar en la cola de 151", () => {
    expect(montar({ posicion: 3 }).text()).toContain("3 de 151");
  });

  it("elegir una categoría emite la respuesta, sin una segunda pregunta", async () => {
    const w = montar();
    // El botón no se puede pulsar sin haber elegido: no se responde por
    // accidente sobre 6 movimientos.
    expect(w.get('[data-testid="classify-responder"]').attributes("disabled")).toBeDefined();

    await w.get('[data-testid="classify-selector"]').setValue("salud");
    await w.get('[data-testid="classify-responder"]').trigger("click");
    expect(w.emitted("clasificar")?.[0]).toEqual(["salud"]);

    // Nada de "hay 6 más de esta persona, ¿son todos salud?": preguntando por
    // contraparte esa pregunta no existe.
    expect(w.text()).toContain("No hay una segunda pregunta");
  });

  it("el selector no ofrece los dos fallbacks del motor: son la pregunta, no la respuesta", () => {
    const opciones = montar()
      .findAll('[data-testid="classify-selector"] option')
      .map((o) => o.attributes("value"));
    expect(opciones).not.toContain("otros");
    expect(opciones).not.toContain("transferencia_persona");
    expect(opciones).toContain("salud");
    expect(opciones).toContain("comida");
  });

  it("Saltar y No preguntarme más son dos acciones distintas", async () => {
    const w = montar();
    await w.get('[data-testid="classify-saltar"]').trigger("click");
    await w.get('[data-testid="classify-silenciar"]').trigger("click");
    expect(w.emitted("saltar")).toHaveLength(1);
    expect(w.emitted("silenciar")).toHaveLength(1);
    expect(w.emitted("clasificar")).toBeUndefined();
  });

  it("una tarjeta salteada se marca, y sigue siendo respondible", async () => {
    const w = montar({ salteada: true });
    expect(w.get('[data-testid="classify-salteada"]').text()).toBe("salteada");
    await w.get('[data-testid="classify-selector"]').setValue("comida");
    expect(w.get('[data-testid="classify-responder"]').attributes("disabled")).toBeUndefined();
  });

  it("con una escritura en vuelo no se puede responder dos veces", async () => {
    const w = montar({ ocupada: true });
    expect(w.get('[data-testid="classify-saltar"]').attributes("disabled")).toBeDefined();
    expect(w.get('[data-testid="classify-silenciar"]').attributes("disabled")).toBeDefined();
    expect(w.get('[data-testid="classify-selector"]').attributes("disabled")).toBeDefined();
  });
});

describe("el orden entre pestañas, dicho en la tarjeta", () => {
  it("sin monto pendiente no se dice nada", () => {
    expect(montar().find('[data-testid="classify-monto-primero"]').exists()).toBe(false);
  });

  it("con monto pendiente avisa que esa pregunta va primero y por qué", () => {
    const aviso = montar({ montosPendientes: 2 }).get('[data-testid="classify-monto-primero"]').text();
    expect(aviso).toContain("2 movimientos esperando");
    expect(aviso).toContain("Monto");
    expect(aviso).toContain("va primero");
    expect(aviso).toContain("no entra a ningún total");
  });
});
