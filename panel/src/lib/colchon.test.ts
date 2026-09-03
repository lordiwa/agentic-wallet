import { describe, expect, it } from "vitest";
import { SIN_FIJAR, vistaColchon } from "./colchon";

/** Lo que devuelve el motor cuando nadie fijó un objetivo: `0 >= 0` es
 * verdadero, así que llega `financiado: true` con todo en cero. */
const SIN_CONFIGURAR = { objetivo: 0, reservado: 0, financiado: true, faltante: 0 };

describe("vistaColchon — R25", () => {
  it("un objetivo en cero es SIN FIJAR, no financiado", () => {
    const vista = vistaColchon(SIN_CONFIGURAR);

    expect(vista.fijado).toBe(false);
    expect(vista.financiado).toBe(false);
    expect(vista.etiqueta).toBe(SIN_FIJAR);
    expect(vista.ancho).toBe(0);
  });

  // El caso que R25 describe: las dos respuestas del motor son idénticas salvo
  // por el objetivo, y la pantalla las tiene que dibujar distinto.
  it("distingue 'no fijé objetivo' de 'cumplí mi objetivo'", () => {
    const cumplido = vistaColchon({ objetivo: 500, reservado: 500, financiado: true, faltante: 0 });

    expect(vistaColchon(SIN_CONFIGURAR).etiqueta).toBe(SIN_FIJAR);
    expect(cumplido.etiqueta).toBe("Financiado");
    expect(cumplido.ancho).toBe(100);
  });

  it("con objetivo y sin reservar dice que falta, no que está sin fijar", () => {
    const vista = vistaColchon({ objetivo: 500, reservado: 0, financiado: false, faltante: 500 });

    expect(vista).toMatchObject({ fijado: true, financiado: false, ancho: 0, etiqueta: "Sin financiar", tag: "warn" });
  });

  it("dibuja el avance parcial", () => {
    expect(vistaColchon({ objetivo: 500, reservado: 300, financiado: false, faltante: 200 }).ancho).toBe(60);
  });

  it("no pasa del 100 % aunque haya reservado de más", () => {
    expect(vistaColchon({ objetivo: 100, reservado: 250, financiado: true, faltante: 0 }).ancho).toBe(100);
  });

  it("sin respuesta del motor no inventa un anillo lleno", () => {
    expect(vistaColchon(null)).toMatchObject({ fijado: false, ancho: 0, etiqueta: SIN_FIJAR });
    expect(vistaColchon(undefined).fijado).toBe(false);
  });

  it("un objetivo negativo —un dato imposible— tampoco dibuja una meta", () => {
    expect(vistaColchon({ objetivo: -100, reservado: 0, financiado: true, faltante: 0 }).fijado).toBe(false);
  });
});
