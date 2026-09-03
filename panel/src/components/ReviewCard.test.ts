/** @vitest-environment jsdom */
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ReviewCard from "./ReviewCard.vue";
import type { TransactionRow } from "../api/types";

function fila(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 7,
    gmail_msg_id: "m-7",
    gmail_thread_id: null,
    ts: "2026-09-01T10:00:00Z",
    direction: "out",
    type: "debito",
    amount: 34.5,
    currency: "USD",
    counterparty: "Comercio de Ejemplo A",
    account: null,
    category: null,
    raw_subject: "Notificacion de consumo",
    is_reversed: 0,
    is_internal: 0,
    needs_review: 1,
    source: "parser",
    created_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function montar(props: Partial<InstanceType<typeof ReviewCard>["$props"]> = {}) {
  return mount(ReviewCard, {
    props: { fila: fila(), posicion: 1, total: 4, ...props } as never,
  });
}

describe("ReviewCard — la versión honesta de c2-tarjeta-revision.html", () => {
  it("muestra contraparte, monto del ledger y asunto del correo", () => {
    const w = montar();
    expect(w.get('[data-testid="review-contraparte"]').text()).toBe("Comercio de Ejemplo A");
    expect(w.get('[data-testid="review-monto"]').text()).toBe("34,50");
    expect(w.get('[data-testid="review-asunto"]').text()).toBe("Notificacion de consumo");
  });

  it("NO dibuja el panel 'lo que leyó Claude' ni la línea de motivo (H10/H9)", () => {
    const texto = montar().text();
    expect(texto).not.toContain("Claude");
    expect(texto).not.toContain("discrepancia");
    expect(texto).not.toContain("Cayó acá porque");
  });

  it("la etiqueta es 'Sin confirmar', no 'Sin leer': la fila tiene monto", () => {
    const w = montar();
    expect(w.text()).toContain("Sin confirmar");
    expect(w.text()).not.toContain("Sin leer");
  });

  it("cero es un monto válido y se dibuja como cifra", () => {
    expect(montar({ fila: fila({ amount: 0 }) }).get('[data-testid="review-monto"]').text()).toBe("0,00");
  });

  it("R12: dice qué hace cada acción con el total, antes de tocar el botón", () => {
    const texto = montar().get('[data-testid="review-que-hace"]').text();
    expect(texto).toContain("descartar no mueve el saldo");
    expect(texto).toContain("entra a los totales");
  });

  it("las tres acciones existen y emiten lo suyo", async () => {
    const w = montar();
    await w.get('[data-testid="review-confirmar"]').trigger("click");
    await w.get('[data-testid="review-descartar"]').trigger("click");
    expect(w.emitted("confirmar")).toHaveLength(1);
    expect(w.emitted("descartar")).toHaveLength(1);
  });

  it("Guardar corrección está apagado hasta que haya un monto escribible", async () => {
    const w = montar();
    const boton = w.get('[data-testid="review-corregir"]');
    expect(boton.attributes("disabled")).toBeDefined();

    await w.get('[data-testid="review-monto-nuevo"]').setValue("no es un numero");
    expect(boton.attributes("disabled")).toBeDefined();

    await w.get('[data-testid="review-monto-nuevo"]').setValue("41,20");
    expect(boton.attributes("disabled")).toBeUndefined();
    await boton.trigger("click");
    expect(w.emitted("corregir")?.[0]).toEqual([41.2]);
  });

  it("corregir a cero es una corrección válida: cero es un monto", async () => {
    const w = montar();
    await w.get('[data-testid="review-monto-nuevo"]').setValue("0");
    await w.get('[data-testid="review-corregir"]').trigger("click");
    expect(w.emitted("corregir")?.[0]).toEqual([0]);
  });
});

describe("R14 — una fila en otra moneda no ofrece Confirmar", () => {
  it("Confirmar queda deshabilitado CON SU MOTIVO", () => {
    const w = montar({ fila: fila({ currency: "EUR" }), monedaPerfil: "USD" });
    expect(w.get('[data-testid="review-confirmar"]').attributes("disabled")).toBeDefined();
    const motivo = w.get('[data-testid="review-otra-moneda"]').text();
    expect(motivo).toContain("EUR");
    expect(motivo).toContain("USD");
    expect(motivo).toContain("sin convertir");
  });

  it("las otras dos salidas siguen abiertas: Corregir y Descartar", async () => {
    const w = montar({ fila: fila({ currency: "EUR" }), monedaPerfil: "USD" });
    expect(w.get('[data-testid="review-descartar"]').attributes("disabled")).toBeUndefined();
    await w.get('[data-testid="review-monto-nuevo"]').setValue("30");
    expect(w.get('[data-testid="review-corregir"]').attributes("disabled")).toBeUndefined();
  });

  it("misma moneda: Confirmar habilitado y sin aviso", () => {
    const w = montar({ fila: fila({ currency: "USD" }), monedaPerfil: "USD" });
    expect(w.get('[data-testid="review-confirmar"]').attributes("disabled")).toBeUndefined();
    expect(w.find('[data-testid="review-otra-moneda"]').exists()).toBe(false);
  });

  it("sin moneda de perfil conocida no se apaga nada: la última palabra la tiene el motor", () => {
    const w = montar({ fila: fila({ currency: "EUR" }), monedaPerfil: null });
    expect(w.get('[data-testid="review-confirmar"]').attributes("disabled")).toBeUndefined();
    expect(w.find('[data-testid="review-otra-moneda"]').exists()).toBe(false);
  });
});
