import { describe, expect, it } from "vitest";
import type { Sobre } from "../api/types";
import { SIN_META, mensajeDeError, vistaSobre, vistaSobres } from "./sobres";

function sobre(parcial: Partial<Sobre> = {}): Sobre {
  return {
    id: "viaje",
    nombre: "Viaje",
    monto: 0,
    objetivo: null,
    sistema: false,
    creado_en: null,
    actualizado_en: null,
    ...parcial,
  };
}

describe("vistaSobre", () => {
  it("R25: sin meta no hay porcentaje, y la barra no se dibuja llena", () => {
    const vista = vistaSobre(sobre({ monto: 500, objetivo: null }));
    expect(vista).toMatchObject({ fijado: false, ancho: 0, faltante: 0, fill: "neu" });
  });

  it("un objetivo en cero es lo mismo que ninguno, no una meta cumplida", () => {
    // El motor ya manda `null`, pero un backend viejo puede mandar 0 y eso NO
    // puede pintar el sobre de verde.
    expect(vistaSobre(sobre({ monto: 0, objetivo: 0 }))).toMatchObject({ fijado: false, fill: "neu" });
  });

  it("con meta: porcentaje, faltante y el verde recién al llegar", () => {
    expect(vistaSobre(sobre({ monto: 250, objetivo: 1000 }))).toMatchObject({
      fijado: true,
      ancho: 25,
      faltante: 750,
      fill: "neu",
    });
    expect(vistaSobre(sobre({ monto: 1000, objetivo: 1000 }))).toMatchObject({
      ancho: 100,
      faltante: 0,
      fill: "ok",
    });
  });

  it("pasarse de la meta no desborda la barra ni deja un faltante negativo", () => {
    expect(vistaSobre(sobre({ monto: 3000, objetivo: 1000 }))).toMatchObject({
      ancho: 100,
      faltante: 0,
      fill: "ok",
    });
  });

  it("el colchon viaja marcado como del sistema", () => {
    expect(vistaSobre(sobre({ id: "colchon", nombre: "Emergencia", sistema: true })).sistema).toBe(true);
  });
});

describe("vistaSobres", () => {
  it("respeta el orden que mandó el motor", () => {
    const lista = vistaSobres([
      sobre({ id: "colchon", nombre: "Emergencia", sistema: true }),
      sobre({ id: "flexiahorro", nombre: "FlexiAhorro", monto: 1105.73 }),
    ]);
    expect(lista.map((s) => s.id)).toEqual(["colchon", "flexiahorro"]);
  });
});

describe("mensajeDeError", () => {
  it("cada rechazo del motor tiene su frase", () => {
    expect(mensajeDeError("sobre_duplicado")).toContain("Ya tenés un sobre");
    expect(mensajeDeError("sobre_reservado")).toContain("colchón");
  });

  it("un codigo que no conoce se muestra tal cual, no como 'algo salio mal'", () => {
    expect(mensajeDeError("codigo_nuevo_del_motor")).toBe("codigo_nuevo_del_motor");
  });
});

describe("SIN_META", () => {
  it("es el rótulo, y existe para que la vista no lo escriba dos veces", () => {
    expect(SIN_META).toBe("Sin meta");
  });
});
