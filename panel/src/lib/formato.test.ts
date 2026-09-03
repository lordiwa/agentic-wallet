import { describe, expect, it } from "vitest";
import {
  ROTULO_SIN_CONFIRMAR,
  ROTULO_SIN_LEER,
  formatoEntero,
  formatoFecha,
  formatoPlata,
  formatoPorcentaje,
  plural,
} from "./formato";

describe("formatoPlata", () => {
  it("cero es una cifra, no un hueco", () => {
    expect(formatoPlata(0)).toBe("0,00");
  });

  it("siempre dos decimales, aunque el motor mande un entero", () => {
    expect(formatoPlata(1840)).toBe("1840,00");
    expect(formatoPlata(9.5)).toBe("9,50");
  });

  it("un negativo conserva su signo: un saldo en rojo no se dibuja como positivo", () => {
    expect(formatoPlata(-12.4)).toBe("-12,40");
  });

  it("no inventa un símbolo de moneda: la moneda llega en los datos", () => {
    expect(formatoPlata(10)).not.toContain("$");
  });
});

describe("formatoEntero", () => {
  it("un conteo no lleva decimales", () => {
    expect(formatoEntero(3800)).not.toContain(",");
    expect(formatoEntero(3)).toBe("3");
  });
});

describe("formatoPorcentaje", () => {
  it("una razón 0..1 del motor se dibuja como porcentaje entero", () => {
    expect(formatoPorcentaje(0.68)).toBe("68 %");
    expect(formatoPorcentaje(0)).toBe("0 %");
    expect(formatoPorcentaje(1)).toBe("100 %");
  });
});

describe("formatoFecha", () => {
  it("sin fecha devuelve null: acá no se inventa un día", () => {
    expect(formatoFecha(null)).toBeNull();
    expect(formatoFecha("")).toBeNull();
  });

  it("una fecha ilegible tampoco se inventa", () => {
    expect(formatoFecha("no-es-una-fecha")).toBeNull();
  });

  it("una fecha real se escribe corta", () => {
    expect(formatoFecha("2026-09-15T12:00:00Z")).toBeTruthy();
  });
});

describe("los dos rótulos que no son lo mismo (R6/X8/X11)", () => {
  it("'Sin leer' y 'Sin confirmar' son textos distintos", () => {
    expect(ROTULO_SIN_LEER).not.toBe(ROTULO_SIN_CONFIRMAR);
  });
});

describe("plural", () => {
  it("uno va en singular", () => {
    expect(plural(1, "movimiento", "movimientos")).toBe("1 movimiento");
  });

  it("cero va en plural, como se dice", () => {
    expect(plural(0, "movimiento", "movimientos")).toBe("0 movimientos");
  });
});
