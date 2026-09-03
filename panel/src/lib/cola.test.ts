import { describe, expect, it } from "vitest";
import {
  TAMANO_PAGINA,
  contrapartesConMontoPendiente,
  normalizar,
  ordenarCola,
  paginar,
  vistaProgreso,
} from "./cola";
import type { ClassifyGroupRow, ClassifyProgressResponse } from "../api/types";

function grupo(overrides: Partial<ClassifyGroupRow> = {}): ClassifyGroupRow {
  return {
    pattern: "comercio de ejemplo a",
    counterparty: "Comercio de Ejemplo A",
    count: 3,
    total: 90,
    months: 2,
    category: "otros",
    last_ts: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function progreso(overrides: Partial<ClassifyProgressResponse> = {}): ClassifyProgressResponse {
  return {
    spending_total: 1000,
    baseline_total: 800,
    covered_total: 400,
    covered_ratio: 0.5,
    unclassified_total: 400,
    unclassified_ratio: 0.4,
    groups: 118,
    transactions: 260,
    target_ratio: 0.8,
    answers_to_target: 30,
    amount_to_target: 240,
    done: false,
    ...overrides,
  };
}

describe("ordenarCola — Saltar manda al final y no pierde nada", () => {
  const a = grupo({ pattern: "a", total: 300 });
  const b = grupo({ pattern: "b", total: 200 });
  const c = grupo({ pattern: "c", total: 100 });

  it("sin saltos respeta el orden por plata que manda el motor", () => {
    expect(ordenarCola([a, b, c]).map((g) => g.pattern)).toEqual(["a", "b", "c"]);
  });

  it("la salteada va al final y sigue estando", () => {
    const orden = ordenarCola([a, b, c], new Set(["a"]));
    expect(orden.map((g) => g.pattern)).toEqual(["b", "c", "a"]);
    expect(orden).toHaveLength(3);
  });

  it("saltar dos conserva el orden por plata entre ellas", () => {
    expect(ordenarCola([a, b, c], new Set(["a", "b"])).map((g) => g.pattern)).toEqual(["c", "a", "b"]);
  });

  it("saltar todo no vacía la cola: Saltar no descarta", () => {
    expect(ordenarCola([a, b, c], new Set(["a", "b", "c"]))).toHaveLength(3);
  });
});

describe("paginar — W5/R15, la cola se pagina desde el día 1", () => {
  const ciento51 = Array.from({ length: 151 }, (_, i) => grupo({ pattern: `p${i}` }));

  it("las 151 contrapartes del ledger real no entran en una página", () => {
    const primera = paginar(ciento51, 1);
    expect(primera.items).toHaveLength(TAMANO_PAGINA);
    expect(primera.paginas).toBe(8);
    expect(primera.desde).toBe(1);
    expect(primera.hasta).toBe(20);
    expect(primera.total).toBe(151);
  });

  it("la última página trae el resto", () => {
    const ultima = paginar(ciento51, 8);
    expect(ultima.items).toHaveLength(11);
    expect(ultima.desde).toBe(141);
    expect(ultima.hasta).toBe(151);
  });

  it("una página que ya no existe se acota a la última, no deja mirando la nada", () => {
    expect(paginar(ciento51, 99).numero).toBe(8);
    expect(paginar(ciento51, 0).numero).toBe(1);
    expect(paginar(ciento51, -3).numero).toBe(1);
  });

  it("cola vacía: una página, sin rango", () => {
    const vacia = paginar([], 1);
    expect(vacia.items).toEqual([]);
    expect(vacia.paginas).toBe(1);
    expect(vacia.desde).toBe(0);
    expect(vacia.hasta).toBe(0);
  });
});

describe("vistaProgreso — el progreso por plata, siempre visible (M1)", () => {
  it("dice cuánta plata queda y cuántas respuestas más", () => {
    const vista = vistaProgreso(progreso({ unclassified_ratio: 0.47, answers_to_target: 30 }));
    expect(vista.titulo).toContain("47 %");
    expect(vista.titulo).toContain("sin clasificar");
    expect(vista.detalle).toContain("30 respuestas más");
    expect(vista.celebra).toBe(false);
  });

  it("una sola respuesta se dice en singular", () => {
    expect(vistaProgreso(progreso({ answers_to_target: 1 })).detalle).toContain("1 respuesta más cubre");
  });

  it("celebra al 80 % de la plata cubierta, con la cola todavía llena", () => {
    const vista = vistaProgreso(progreso({ covered_ratio: 0.82, done: true, groups: 118 }));
    expect(vista.celebra).toBe(true);
    expect(vista.titulo).toContain("82 %");
    // El criterio de terminado NO es cero filas: quedan 118 y ya alcanza.
    expect(vista.detalle).toContain("118");
    expect(vista.detalle).toContain("ya alcanza");
  });

  it("cola realmente vacía: se dice, y sigue siendo el estado celebrado", () => {
    const vista = vistaProgreso(progreso({ covered_ratio: 1, done: true, groups: 0, unclassified_total: 0 }));
    expect(vista.celebra).toBe(true);
    expect(vista.detalle).toContain("No queda ninguna contraparte");
  });

  it("el ancho de la barra es la plata cubierta, acotada a 0..100", () => {
    expect(vistaProgreso(progreso({ covered_ratio: 0.473 })).ancho).toBe(47);
    expect(vistaProgreso(progreso({ covered_ratio: 1.4 })).ancho).toBe(100);
    expect(vistaProgreso(progreso({ covered_ratio: -0.2 })).ancho).toBe(0);
  });
});

describe("normalizar — reproduce toRulePattern del motor", () => {
  it("minúsculas, sin acentos y sin espacios en los bordes", () => {
    expect(normalizar("  FARMACIA SAN JOSÉ ")).toBe("farmacia san jose");
  });

  it("coincide con el `pattern` que manda la cola", () => {
    expect(normalizar("Comercio de Ejemplo A")).toBe(grupo().pattern);
  });
});

describe("contrapartesConMontoPendiente — el orden entre pestañas", () => {
  it("cuenta por contraparte normalizada", () => {
    const cuenta = contrapartesConMontoPendiente([
      { counterparty: "Comercio de Ejemplo A" },
      { counterparty: "COMERCIO DE EJEMPLO A" },
      { counterparty: "Otro Comercio" },
    ]);
    expect(cuenta.get("comercio de ejemplo a")).toBe(2);
    expect(cuenta.get("otro comercio")).toBe(1);
  });

  it("una fila sin contraparte no genera una clave vacía que matchearía todo", () => {
    const cuenta = contrapartesConMontoPendiente([{ counterparty: null }, { counterparty: "   " }]);
    expect(cuenta.size).toBe(0);
  });
});
