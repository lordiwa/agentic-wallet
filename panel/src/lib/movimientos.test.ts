import { describe, expect, it } from "vitest";
import type { TransactionRow } from "../api/types";
import {
  LIMITE_MAXIMO,
  SIN_FILTROS,
  TAMANO_MOVIMIENTOS,
  categoriaPedida,
  consultaDe,
  filtrosAplicados,
  hayFiltros,
  hayMas,
  motivoSinPregunta,
  vistaDeFila,
} from "./movimientos";

function fila(patch: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 1,
    gmail_msg_id: "m1",
    gmail_thread_id: null,
    ts: "2026-09-01T15:00:00.000Z",
    direction: "out",
    type: "debito",
    amount: 12.5,
    currency: "USD",
    counterparty: "Comercio de Prueba",
    account: null,
    category: "comida",
    raw_subject: "Asunto de prueba",
    is_reversed: 0,
    is_internal: 0,
    needs_review: 0,
    source: "test",
    created_at: "2026-09-01T15:00:00.000Z",
    ...patch,
  };
}

describe("los dos filtros, y nada más", () => {
  it("sin filtros no manda ni rango ni dirección", () => {
    const q = consultaDe(SIN_FILTROS);
    expect(q.from).toBeUndefined();
    expect(q.to).toBeUndefined();
    expect(q.direction).toBeUndefined();
    expect(q.limit).toBe(TAMANO_MOVIMIENTOS);
    expect(q.offset).toBe(0);
  });

  /**
   * Las dos fechas viajan como días pelados desde la ronda 3 (W26). El extremo
   * de arriba se cerraba acá con `T23:59:59.999Z`, que arreglaba el corte del
   * día 30 y creaba el otro: ese instante es UTC y el motor cuenta en día
   * local, así que la ventana quedaba corrida las horas del offset. Quién
   * decide qué es un día es el motor, no esta función.
   */
  it("las dos fechas viajan como días, y el motor las resuelve", () => {
    const q = consultaDe({ desde: "2026-09-01", hasta: "2026-09-30", direccion: "" });
    expect(q.from).toBe("2026-09-01");
    expect(q.to).toBe("2026-09-30");
  });

  it("entrada/salida viaja como `direction`", () => {
    expect(consultaDe({ ...SIN_FILTROS, direccion: "in" }).direction).toBe("in");
    expect(consultaDe({ ...SIN_FILTROS, direccion: "out" }).direction).toBe("out");
  });

  it("no manda ningún otro filtro: tipo, contraparte y los include_* no existen en esta pantalla", () => {
    const q = consultaDe({ desde: "2026-09-01", hasta: "2026-09-30", direccion: "out" });
    expect(Object.keys(q).sort()).toEqual(["direction", "from", "limit", "offset", "to"]);
  });

  it("el rango cuenta como UN filtro aunque tenga dos campos", () => {
    expect(filtrosAplicados(SIN_FILTROS)).toBe(0);
    expect(filtrosAplicados({ desde: "2026-09-01", hasta: "", direccion: "" })).toBe(1);
    expect(filtrosAplicados({ desde: "2026-09-01", hasta: "2026-09-30", direccion: "" })).toBe(1);
    expect(filtrosAplicados({ desde: "2026-09-01", hasta: "2026-09-30", direccion: "out" })).toBe(2);
    expect(hayFiltros(SIN_FILTROS)).toBe(false);
    expect(hayFiltros({ ...SIN_FILTROS, direccion: "out" })).toBe(true);
  });
});

describe("la categoría recalculada manda sola (H21)", () => {
  it("con categoría no se mandan los dos filtros: otro conjunto no coincidiría con la barra", () => {
    const q = consultaDe(
      { desde: "2026-01-01", hasta: "2026-01-31", direccion: "in" },
      { categoria: "salud" }
    );
    expect(q).toEqual({ category: "salud", limit: TAMANO_MOVIMIENTOS, offset: 0 });
  });

  it("el límite nunca pasa el tope del schema del server", () => {
    expect(consultaDe(SIN_FILTROS, { limite: 5000 }).limit).toBe(LIMITE_MAXIMO);
  });

  it("una categoría que no está en el glosario del motor no es una categoría", () => {
    expect(categoriaPedida("salud")).toBe("salud");
    expect(categoriaPedida("transferencia_persona")).toBe("transferencia_persona");
    expect(categoriaPedida("lo-que-sea")).toBeNull();
    expect(categoriaPedida("")).toBeNull();
    expect(categoriaPedida(undefined)).toBeNull();
  });
});

describe("cargar más, sin total y sin paginador (H20)", () => {
  it("con el total de la barra la respuesta es exacta", () => {
    expect(hayMas(50, 50, 120)).toBe(true);
    expect(hayMas(120, 50, 120)).toBe(false);
    expect(hayMas(0, 50, 0)).toBe(false);
  });

  it("sin total, la señal es que la última página vino llena", () => {
    expect(hayMas(50, 50)).toBe(true);
    expect(hayMas(100, 50)).toBe(true);
    expect(hayMas(37, 50)).toBe(false);
    expect(hayMas(0, 50)).toBe(false);
  });
});

describe("cómo se lee una fila", () => {
  it("una salida normal: sin marcas, monto tabular sin color", () => {
    const vista = vistaDeFila(fila());
    expect(vista.marcas).toEqual([]);
    expect(vista.montoClase).toBe("");
    expect(vista.direccion).toBe("salida");
    expect(vista.categoria).toBe("Comida");
    expect(vista.atenuada).toBe(false);
  });

  it("una entrada se dibuja con la cifra en verde", () => {
    expect(vistaDeFila(fila({ direction: "in", type: "sueldo" })).montoClase).toBe("in");
  });

  it("en revisión: monto real con etiqueta `sin confirmar`, nunca `Sin leer`", () => {
    const vista = vistaDeFila(fila({ needs_review: 1, amount: 34 }));
    expect(vista.monto).toBe("34,00");
    expect(vista.marcas).toContainEqual({ clase: "warn", texto: "sin confirmar" });
    expect(vista.marcada).toBe(true);
    expect(vista.sinConfirmar).toBe(true);
  });

  it("cero es un monto válido y se dice: no es `no pude leerlo`", () => {
    const vista = vistaDeFila(fila({ amount: 0 }));
    expect(vista.monto).toBe("0,00");
    expect(vista.marcas).toContainEqual({ clase: "neu", texto: "monto cero válido" });
  });

  it("reverso e interna: la fila se atenúa y se rotula, no se reinterpreta", () => {
    const reverso = vistaDeFila(fila({ is_reversed: 1 }));
    expect(reverso.atenuada).toBe(true);
    expect(reverso.montoClase).toBe("rev");
    expect(reverso.marcas).toContainEqual({ clase: "neu", texto: "reverso" });

    const interna = vistaDeFila(fila({ is_internal: 1, type: "transferencia" }));
    expect(interna.atenuada).toBe(true);
    expect(interna.direccion).toBe("interna");
    expect(interna.marcas).toContainEqual({ clase: "acc", texto: "interna" });
  });

  it("sin contraparte se rotula y no se inventa un nombre", () => {
    const vista = vistaDeFila(fila({ counterparty: null }));
    expect(vista.sinContraparte).toBe(true);
    expect(vista.contraparte).toBe("sin contraparte");
    expect(vista.marcas).toContainEqual({ clase: "neu", texto: "sin contraparte" });
  });

  it("sin categoría se dice, no se rellena con `otros`", () => {
    const vista = vistaDeFila(fila({ category: null }));
    expect(vista.sinCategoria).toBe(true);
    expect(vista.categoria).toBe("sin categoría");
  });

  it("la categoría recalculada gana sobre la columna, que puede estar vieja", () => {
    // El caso que H21 existe para evitar: la barra contó esta fila como salud
    // porque una regla del usuario lo dice, y la columna todavía dice `otros`.
    const vista = vistaDeFila(fila({ category: "otros" }), "salud");
    expect(vista.categoria).toBe("Salud");
    expect(vista.sinCategoria).toBe(false);
  });
});

describe("qué fila NO se puede preguntar", () => {
  it("una con contraparte se puede", () => {
    expect(motivoSinPregunta(fila())).toBeNull();
  });

  it("sin contraparte no hay nombre sobre el que escribir una regla (H25)", () => {
    const motivo = motivoSinPregunta(fila({ counterparty: null }));
    expect(motivo).toContain("no tiene contraparte");
    // Y se dice que recuperarla es por lote: no hay un botón por fila.
    expect(motivo).toContain("por lote");
    expect(motivoSinPregunta(fila({ counterparty: "   " }))).not.toBeNull();
  });
});
