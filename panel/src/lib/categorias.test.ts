import { describe, expect, it } from "vitest";
import { barrasDeCategoria, nombreCategoria, opcionesDeCategoria, CATEGORIAS_ELEGIBLES } from "./categorias";

describe("nombreCategoria", () => {
  it("traduce las claves del glosario del motor", () => {
    expect(nombreCategoria("comida")).toBe("Comida");
    expect(nombreCategoria("transferencia_persona")).toBe("Transferencia a persona");
  });

  it("una clave que no conoce se dibuja tal cual, no con un nombre inventado", () => {
    expect(nombreCategoria("categoria_nueva_del_motor")).toBe("categoria_nueva_del_motor");
  });

  it("salud se lee nombrando también la palabra que la gente busca", () => {
    // La clave no cambió — las reglas ya escritas siguen diciendo `salud` — y
    // la etiqueta nombra las dos cosas para que "medicina" se encuentre.
    expect(nombreCategoria("salud")).toBe("Salud y medicina");
  });
});

describe("las categorías que la pregunta puede ofrecer", () => {
  it("ofrece las seis que faltaban, con su nombre", () => {
    const porClave = new Map(opcionesDeCategoria().map((o) => [o.clave, o.nombre]));
    expect(porClave.get("vivienda")).toBe("Vivienda");
    expect(porClave.get("entretenimiento")).toBe("Entretenimiento");
    expect(porClave.get("limpieza")).toBe("Limpieza");
    expect(porClave.get("deuda")).toBe("Deuda");
    expect(porClave.get("prestamo")).toBe("Préstamo");
    expect(porClave.get("regalo")).toBe("Regalo");
  });

  it("no ofrece los dos fallbacks: responder con ellos deja el grupo en la cola para siempre", () => {
    expect(CATEGORIAS_ELEGIBLES).not.toContain("otros");
    expect(CATEGORIAS_ELEGIBLES).not.toContain("transferencia_persona");
  });

  it("ninguna opción se dibuja con su clave: todas tienen nombre", () => {
    for (const { clave, nombre } of opcionesDeCategoria()) {
      expect(nombre).not.toBe(clave);
    }
  });
});

describe("barrasDeCategoria", () => {
  it("ordena de la que más plata mueve a la que menos", () => {
    const barras = barrasDeCategoria({ comida: 10, salud: 50, transporte: 30 });
    expect(barras.map((b) => b.clave)).toEqual(["salud", "transporte", "comida"]);
  });

  it("el ancho es relativo a la más grande, que ocupa todo", () => {
    const barras = barrasDeCategoria({ salud: 50, comida: 25 });
    expect(barras[0].ancho).toBe(100);
    expect(barras[1].ancho).toBe(50);
  });

  it("una categoría en cero se dibuja: cero es un valor real", () => {
    const barras = barrasDeCategoria({ salud: 50, mascota: 0 });
    expect(barras).toHaveLength(2);
    expect(barras[1]).toMatchObject({ clave: "mascota", total: 0, ancho: 0 });
  });

  it("sin gasto no hay barras, y no se divide por cero", () => {
    expect(barrasDeCategoria({})).toEqual([]);
    expect(barrasDeCategoria({ comida: 0 })[0].ancho).toBe(0);
  });

  it("el total que dibuja es exactamente el que llegó: el panel no recalcula", () => {
    const barras = barrasDeCategoria({ comida: 77.5 });
    expect(barras[0].total).toBe(77.5);
  });
});
