import { describe, expect, it } from "vitest";
import {
  ROTULO_SIN_CONFIRMAR,
  ROTULO_SIN_LEER,
  formatoEntero,
  formatoFecha,
  formatoPlata,
  formatoPorcentaje,
  parsePlata,
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

/**
 * Wargaming ronda 2 (W10). `parsePlata` resolvió el `NaN` silencioso de W3,
 * pero dejó abierta la otra mitad del mismo formato: en `es` el punto es
 * separador de miles, y "1.500" —que es como se escribe mil quinientos, y como
 * el propio panel lo imprime salvo por los decimales— entraba como 1,5. Un
 * colchón de mil quinientos guardado como uno con cinco no da error: da un
 * anillo verde y un objetivo cumplido que nadie fijó (R25).
 */
describe("parsePlata — el punto de miles de `es` (W10)", () => {
  it("un grupo de tres es miles, no decimales", () => {
    expect(parsePlata("1.234")).toBe(1234);
    expect(parsePlata("1.500")).toBe(1500);
  });

  it("dos grupos de tres también", () => {
    expect(parsePlata("1.234.567")).toBe(1234567);
  });

  it("el punto decimal de una cifra ya guardada se sigue leyendo como decimal", () => {
    expect(parsePlata("1234.5")).toBe(1234.5);
    expect(parsePlata("12.34")).toBe(12.34);
    expect(parsePlata("0.500")).toBe(0.5);
  });

  it("la coma sigue mandando cuando está", () => {
    expect(parsePlata("1.234,50")).toBe(1234.5);
    expect(parsePlata("1234,5")).toBe(1234.5);
  });

  it("lo que no es una cifra sigue sin serlo", () => {
    expect(parsePlata("0x10")).toBeNull();
    expect(parsePlata("1e5")).toBeNull();
    expect(parsePlata("1.23.4")).toBeNull();
    expect(parsePlata("")).toBeNull();
  });

  it("la ida y vuelta con `formatoPlata` no cambia la cifra", () => {
    for (const valor of [0, 1.5, 1234.5, 1500, 1234567.89]) {
      expect(parsePlata(formatoPlata(valor))).toBe(valor);
    }
  });
});

/**
 * Wargaming ronda 3 (W17). W10 cerró el formato `es` con punto de miles y dejó
 * abierto el tercero que un usuario puede tener delante: **coma de miles con
 * punto decimal**, que es como imprime la plata la plaza donde vive el ledger
 * de este proyecto. La rama de la coma asumía "hay coma ⇒ la coma es el
 * decimal", así que borraba el punto —que era el decimal de verdad— y devolvía
 * una cifra mil veces más chica. Exactamente el síntoma de W10, por la otra
 * mitad del mismo `if`.
 *
 * Con los dos separadores presentes la lectura no es única, y una cifra
 * ambigua no se adivina: manda el ÚLTIMO separador, que es la única regla que
 * las dos convenciones comparten.
 */
describe("parsePlata — los dos separadores a la vez (W17)", () => {
  it("con coma y punto manda el último separador: el punto es el decimal", () => {
    expect(parsePlata("1,234.56")).toBe(1234.56);
    expect(parsePlata("1,234,567.89")).toBe(1234567.89);
    expect(parsePlata("12,345.00")).toBe(12345);
  });

  it("y al revés sigue valiendo lo de siempre: la coma es el decimal", () => {
    expect(parsePlata("1.234,56")).toBe(1234.56);
    expect(parsePlata("1.234.567,89")).toBe(1234567.89);
  });

  it("un separador solo se sigue leyendo con la regla de W10", () => {
    expect(parsePlata("1.500")).toBe(1500);
    expect(parsePlata("1,5")).toBe(1.5);
    expect(parsePlata("1234.5")).toBe(1234.5);
  });

  it("los grupos que no son de tres siguen sin ser miles", () => {
    expect(parsePlata("1,23.456")).toBeNull();
    expect(parsePlata("1.2,3")).toBeNull();
  });
});
