/** @vitest-environment jsdom */
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import OverviewCard from "./OverviewCard.vue";

describe("OverviewCard", () => {
  it("dibuja la etiqueta, la cifra y la nota de `c3`", () => {
    const wrapper = mount(OverviewCard, {
      props: { etiqueta: "Saldo", valor: 1840.25, nota: "al corte del último sync" },
    });

    expect(wrapper.get(".label").text()).toBe("Saldo");
    expect(wrapper.get('[data-testid="overview-card-cifra"]').text()).toBe("1840,25");
    expect(wrapper.text()).toContain("al corte del último sync");
  });

  it("cero es una cifra, con el peso de un número", () => {
    const wrapper = mount(OverviewCard, { props: { etiqueta: "Gasto del mes", valor: 0 } });

    const cifra = wrapper.get('[data-testid="overview-card-cifra"]');
    expect(cifra.text()).toBe("0,00");
    // La clase `.num` es la de 26px tabular; `.sm` es la del texto apagado.
    expect(cifra.classes()).toContain("num");
    expect(cifra.classes()).not.toContain("sm");
    expect(wrapper.find('[data-testid="overview-card-sin-dato"]').exists()).toBe(false);
  });

  it("sin dato se dibuja distinto de un cero: texto apagado, no cifra", () => {
    const wrapper = mount(OverviewCard, { props: { etiqueta: "Próximo pago", sinDato: "Sin leer" } });

    const sinDato = wrapper.get('[data-testid="overview-card-sin-dato"]');
    expect(sinDato.text()).toBe("Sin leer");
    expect(sinDato.classes()).toContain("sm");
    expect(wrapper.find('[data-testid="overview-card-cifra"]').exists()).toBe(false);
  });

  it("un valor que no es plata se dibuja como dato, no como hueco", () => {
    const wrapper = mount(OverviewCard, { props: { etiqueta: "Próximo pago", texto: "15 sept", sinDato: "Sin leer" } });

    expect(wrapper.get('[data-testid="overview-card-texto"]').text()).toBe("15 sept");
    expect(wrapper.find('[data-testid="overview-card-sin-dato"]').exists()).toBe(false);
  });

  it("con destino es un enlace; sin destino NO lo es (R4)", () => {
    const conDestino = mount(OverviewCard, { props: { etiqueta: "Saldo", valor: 10, destino: "#/movimientos" } });
    expect(conDestino.get('[data-testid="overview-card"]').element.tagName).toBe("A");
    expect(conDestino.get("a").attributes("href")).toBe("#/movimientos");

    const sinDestino = mount(OverviewCard, { props: { etiqueta: "Tarjeta", valor: 320 } });
    expect(sinDestino.get('[data-testid="overview-card"]').element.tagName).toBe("DIV");
    expect(sinDestino.find("a").exists()).toBe(false);
  });

  it("la etiqueta de estado usa una clase del sistema, no un color propio", () => {
    const wrapper = mount(OverviewCard, {
      props: { etiqueta: "Tarjeta", valor: 320, tag: { clase: "warn", texto: "vence pronto" } },
    });

    const tag = wrapper.get(".tag");
    expect(tag.classes()).toContain("warn");
    expect(tag.text()).toBe("vence pronto");
  });

  it("mientras carga no muestra una cifra vieja con cara de actual", () => {
    const wrapper = mount(OverviewCard, { props: { etiqueta: "Saldo", valor: 999, cargando: true } });

    expect(wrapper.find('[data-testid="overview-card-cifra"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("cargando");
  });
});
