/** @vitest-environment jsdom */
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RecurringCard from "./RecurringCard.vue";
import type { RecurringProposalRow } from "../api/types";

function propuesta(overrides: Partial<RecurringProposalRow> = {}): RecurringProposalRow {
  return {
    pattern: "servicio de ejemplo a",
    counterparty: "Servicio de Ejemplo A",
    monto_estimado: 42.5,
    dia_tipico: 8,
    sample_size: 5,
    count: 6,
    total: 255,
    last_ts: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function montar(props: Record<string, unknown> = {}) {
  return mount(RecurringCard, { props: { propuesta: propuesta(), posicion: 1, total: 10, ...props } as never });
}

describe("RecurringCard — una propuesta de gasto fijo", () => {
  it("muestra la contraparte y la mediana mensual", () => {
    const w = montar();

    expect(w.get('[data-testid="recurring-contraparte"]').text()).toBe("Servicio de Ejemplo A");
    expect(w.get('[data-testid="recurring-monto"]').text()).toBe("42,50");
  });

  // Criterio 3: no se promete más de lo que hay.
  it("dice el TAMAÑO DE LA MUESTRA junto a la cifra, no en una nota al pie", () => {
    const muestra = montar().get('[data-testid="recurring-muestra"]').text();

    expect(muestra).toContain("mediana");
    expect(muestra).toContain("5 meses distintos");
    expect(muestra).toContain("6 movimientos");
  });

  it("dice el día típico", () => {
    expect(montar().get('[data-testid="recurring-dia"]').text()).toContain("8 de cada mes");
  });

  /**
   * Wargaming del MVP (W2). Cuando el motor no encuentra un día —los cargos
   * están repartidos por todo el mes— la tarjeta lo dice, no rellena con un
   * número. Sobre el ledger real le toca a la mitad de las propuestas.
   */
  it("sin día típico no inventa uno", () => {
    const dia = montar({ propuesta: propuesta({ dia_tipico: null }) }).get('[data-testid="recurring-dia"]').text();

    expect(dia).toBe("no cae siempre el mismo día");
    expect(dia).not.toMatch(/\d/);
  });

  it("con un solo mes de muestra no dice 'meses'", () => {
    const w = montar({ propuesta: propuesta({ sample_size: 1, count: 1 }) });
    const muestra = w.get('[data-testid="recurring-muestra"]').text();

    expect(muestra).toContain("1 mes ");
    expect(muestra).toContain("1 movimiento ");
  });

  it("dice su lugar en la lista de diez", () => {
    expect(montar({ posicion: 3 }).text()).toContain("3 de 10");
  });

  // Criterio 4: confirmar es explícito y por ítem.
  it("no se puede confirmar sin elegir categoría", async () => {
    const w = montar();
    const boton = w.get('[data-testid="recurring-confirmar"]');

    expect(boton.attributes("disabled")).toBeDefined();
    await boton.trigger("click");
    expect(w.emitted("confirmar")).toBeUndefined();
  });

  it("confirmar emite la categoría elegida", async () => {
    const w = montar();
    await w.get('[data-testid="recurring-selector"]').setValue("servicios");
    await w.get('[data-testid="recurring-confirmar"]').trigger("click");

    expect(w.emitted("confirmar")).toEqual([["servicios"]]);
  });

  it("descartar no manda categoría: no se guarda nada", async () => {
    const w = montar();
    await w.get('[data-testid="recurring-descartar"]').trigger("click");

    expect(w.emitted("descartar")).toHaveLength(1);
    expect(w.emitted("confirmar")).toBeUndefined();
  });

  it("no ofrece los dos fallbacks del motor: 'otros' no es una respuesta", () => {
    const opciones = montar()
      .findAll('[data-testid="recurring-selector"] option')
      .map((opcion) => opcion.attributes("value"));

    expect(opciones).not.toContain("otros");
    expect(opciones).not.toContain("transferencia_persona");
    expect(opciones).toContain("servicios");
  });

  it("con una escritura en vuelo no se puede pulsar dos veces", () => {
    const w = montar({ ocupada: true });

    expect(w.get('[data-testid="recurring-descartar"]').attributes("disabled")).toBeDefined();
    expect(w.get('[data-testid="recurring-selector"]').attributes("disabled")).toBeDefined();
  });

  it("dice qué pasa al confirmar y qué al descartar", () => {
    const texto = montar().text();

    expect(texto).toContain("escribe una regla");
    expect(texto).toContain("Descartar no guarda nada");
  });
});
