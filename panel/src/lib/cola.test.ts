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
    remaining_ratio: 0.5,
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
    const vista = vistaProgreso(progreso({ remaining_ratio: 0.47, answers_to_target: 30 }));
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

/**
 * Wargaming ronda 2 (W11). `classifyProgress` devuelve `covered_ratio: 1` y
 * `done: true` cuando no hay línea de base — es su guarda contra dividir por
 * cero, no una afirmación (`server/src/classify/progress.ts:109,117`). La
 * pantalla la leía como un logro y dibujaba *"Cubriste el 100 % de tu plata"*
 * en verde sobre una billetera recién instalada, antes del primer sync. Es W5
 * otra vez —celebrar sobre un ledger que no dice eso— sin necesidad de que el
 * backend se caiga.
 */
describe("vistaProgreso — sin línea de base no hay nada que celebrar (W11)", () => {
  const vacio: ClassifyProgressResponse = {
    spending_total: 0,
    baseline_total: 0,
    covered_total: 0,
    covered_ratio: 1,
    unclassified_total: 0,
    unclassified_ratio: 0,
    remaining_ratio: 0,
    groups: 0,
    transactions: 0,
    target_ratio: 0.8,
    answers_to_target: 0,
    amount_to_target: 0,
    done: true,
  };

  it("no dice que se cubrió el 100 % de una plata que no existe", () => {
    const vista = vistaProgreso(vacio);
    expect(vista.titulo).not.toContain("100");
    expect(vista.titulo.toLowerCase()).not.toContain("cubriste");
  });

  it("no celebra, y la barra no se dibuja llena", () => {
    const vista = vistaProgreso(vacio);
    expect(vista.celebra).toBe(false);
    expect(vista.ancho).toBe(0);
  });

  it("el 100 % de verdad —todo respondido sobre una base real— sí se celebra", () => {
    const vista = vistaProgreso({ ...vacio, baseline_total: 500, covered_total: 500 });
    expect(vista.celebra).toBe(true);
    expect(vista.titulo).toContain("100");
  });
});

/**
 * Wargaming ronda 3 (W19). W11 tapó `baseline_total === 0` y dejó viva la otra
 * mitad del mismo campo: **el porcentaje y su denominador no se decían juntos**.
 * `covered_ratio` es sobre `baseline_total` (la plata que alguna vez tuvo una
 * pregunta) y `unclassified_ratio` era sobre `spending_total` (todo el gasto), y
 * la tarjeta llamaba "tu plata" a las dos.
 *
 * Los dos síntomas, los dos con el motor real:
 *
 * 1. Con 240 de 300 respondidos sobre 1000 de gasto, la tarjeta celebraba
 *    *"Cubriste el 80 % de tu plata"* en verde. El usuario cubrió el 24 % de su
 *    plata. Es W11 otra vez —celebrar un logro que el ledger no dice— sin que el
 *    ledger tenga que estar vacío.
 * 2. Sobre el ledger real, la misma tarjeta imprimía a la vez un título del
 *    76 %, una barra al 16 % y un pie cuyos dos números dan 84 %. Tres cifras
 *    visibles al mismo tiempo que no cierran entre sí.
 *
 * La regla, y es la que este bloque protege: **la barra, el título y el pie
 * hablan del mismo denominador, y el texto lo nombra**.
 */
describe("vistaProgreso — el porcentaje se dice con su denominador (W19)", () => {
  it("no llama 'tu plata' a la plata que había para clasificar", () => {
    const vista = vistaProgreso(
      progreso({ spending_total: 1000, baseline_total: 300, covered_total: 240, covered_ratio: 0.8, done: true })
    );
    expect(vista.titulo).not.toBe("Cubriste el 80 % de tu plata");
    expect(vista.titulo).toContain("80 %");
    expect(vista.titulo).toContain("clasificar");
  });

  it("el título y la barra son complementarios: suman 100", () => {
    const vista = vistaProgreso(
      progreso({
        spending_total: 1000,
        baseline_total: 800,
        covered_total: 128,
        covered_ratio: 0.16,
        remaining_ratio: 0.84,
        unclassified_ratio: 0.76,
        unclassified_total: 672,
        done: false,
      })
    );
    expect(vista.ancho).toBe(16);
    expect(vista.titulo).toContain("84 %");
    expect(vista.titulo).not.toContain("76 %");
  });

  it("una sola contraparte no se dice en plural", () => {
    const vista = vistaProgreso(progreso({ done: true, groups: 1, covered_ratio: 0.9 }));
    expect(vista.detalle).toContain("1 contraparte por");
    expect(vista.detalle).not.toContain("1 contrapartes");
  });
});

/**
 * Wargaming ronda 3 (W20). W5 se cerró con *"el estado vacío sólo se dibuja
 * cuando hubo respuesta"* (`ledgerLeido`), y la clase era más ancha: **no
 * afirmes un hecho sobre un ledger que no leíste**. El estado **poblado** afirma
 * mucho más que el vacío, y no tenía esa guarda.
 *
 * Reproducción: escritura exitosa en la página 3, seguida de un refresco que
 * falla. En pantalla, al mismo tiempo, el cartel rojo *"El backend no
 * respondió"* y la tarjeta de avance en verde celebrando *"Cubriste el 80 %"*
 * con los montos de antes de la escritura. Es dato viejo dibujado con la cara
 * de dato fresco — y el 431 que produce un lote de más de 2700 ids llega
 * exactamente por acá.
 */
describe("vistaProgreso — un refresco que falló no celebra nada (W20)", () => {
  it("no celebra cuando los números son de antes del error", () => {
    const vista = vistaProgreso(progreso({ done: true, covered_ratio: 0.82 }), { vencido: true });
    expect(vista.celebra).toBe(false);
    expect(vista.detalle).toContain("no respondió");
  });

  it("y lo dice, en vez de dibujar el número viejo como si fuera de ahora", () => {
    const vista = vistaProgreso(progreso(), { vencido: true });
    expect(vista.detalle).toContain("antes");
  });

  it("sin error, nada cambia", () => {
    expect(vistaProgreso(progreso({ done: true, covered_ratio: 0.82 })).celebra).toBe(true);
  });
});
