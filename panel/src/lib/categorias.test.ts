import { describe, expect, it } from "vitest";
import { barrasDeCategoria, nombreCategoria } from "./categorias";

describe("nombreCategoria", () => {
  it("traduce las claves del glosario del motor", () => {
    expect(nombreCategoria("comida")).toBe("Comida");
    expect(nombreCategoria("transferencia_persona")).toBe("Transferencia a persona");
  });

  it("una clave que no conoce se dibuja tal cual, no con un nombre inventado", () => {
    expect(nombreCategoria("categoria_nueva_del_motor")).toBe("categoria_nueva_del_motor");
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
