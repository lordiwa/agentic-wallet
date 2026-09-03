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

/**
 * Wargaming ronda 3 (W23). En modo lote la tarjeta contaba el lote y el
 * escritor mueve el ledger entero: "2 movimientos" arriba, "reclasificaste 47"
 * un segundo después. El pie afirmaba, textual, que la regla vale para "los 2
 * movimientos de esta contraparte", que era falso por construcción.
 */
describe("W23 — en modo lote la tarjeta dice lo que hay fuera del lote", () => {
  it("cuando el ledger tiene más que el lote, lo dice con el número", () => {
    const w = montar({ grupo: grupo({ count: 2, total: 40, count_en_ledger: 47, total_en_ledger: 900 }) });
    const alcance = w.get('[data-testid="classify-alcance-lote"]').text();
    expect(alcance).toContain("47");
    expect(alcance).toContain("900,00");
  });

  it("el pie deja de prometer el número del lote", () => {
    const w = montar({ grupo: grupo({ count: 2, total: 40, count_en_ledger: 47, total_en_ledger: 900 }) });
    expect(w.get('[data-testid="classify-pie"]').text()).not.toContain("los 2 movimientos");
  });

  it("sin lote, o con el lote completo, no hay nada que aclarar", () => {
    expect(montar({ grupo: grupo({ count: 2 }) }).find('[data-testid="classify-alcance-lote"]').exists()).toBe(false);
    expect(
      montar({ grupo: grupo({ count: 2, total: 40, count_en_ledger: 2, total_en_ledger: 40 }) })
        .find('[data-testid="classify-alcance-lote"]')
        .exists()
    ).toBe(false);
  });
});
