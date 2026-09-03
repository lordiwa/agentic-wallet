/** @vitest-environment jsdom */
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Preguntas from "./Preguntas.vue";
import type {
  ClassifyApplyResponse,
  ClassifyGroupRow,
  ClassifyProgressResponse,
  OverviewResponse,
  TransactionRow,
} from "../api/types";

const { endpoints, ErrorDelMotor } = vi.hoisted(() => {
  class ErrorDelMotor extends Error {
    constructor(
      readonly codigo: string,
      readonly status: number
    ) {
      super(codigo);
      this.name = "ErrorDelMotor";
    }
  }
  return {
    ErrorDelMotor,
    endpoints: {
      fetchClassifyQueue: vi.fn(),
      fetchClassifyProgress: vi.fn(),
      fetchReview: vi.fn(),
      fetchOverview: vi.fn(),
      postClassify: vi.fn(),
      postSilence: vi.fn(),
      postReviewResolve: vi.fn(),
    },
  };
});

vi.mock("../api/endpoints", () => ({ ...endpoints, ErrorDelMotor }));

function grupo(overrides: Partial<ClassifyGroupRow> = {}): ClassifyGroupRow {
  return {
    pattern: "comercio a",
    counterparty: "Comercio A",
    count: 6,
    total: 312.4,
    months: 3,
    category: "otros",
    last_ts: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

/** Las 151 contrapartes del ledger real, ordenadas por plata descendente. */
function cola151(): ClassifyGroupRow[] {
  return Array.from({ length: 151 }, (_, i) =>
    grupo({ pattern: `c${i}`, counterparty: `Comercio ${i}`, total: 1000 - i })
  );
}

function fila(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 1,
    gmail_msg_id: "m-1",
    gmail_thread_id: null,
    ts: "2026-09-01T10:00:00Z",
    direction: "out",
    type: "debito",
    amount: 34.5,
    currency: "USD",
    counterparty: "Comercio A",
    account: null,
    category: null,
    raw_subject: "Notificacion de consumo",
    is_reversed: 0,
    is_internal: 0,
    needs_review: 1,
    source: "parser",
    created_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

/** Las 4 filas de la pestaña Monto. */
function filas4(): TransactionRow[] {
  return [1, 2, 3, 4].map((id) => fila({ id, gmail_msg_id: `m-${id}`, counterparty: `Comercio ${id}` }));
}

function progreso(overrides: Partial<ClassifyProgressResponse> = {}): ClassifyProgressResponse {
  return {
    spending_total: 1000,
    baseline_total: 800,
    covered_total: 400,
    covered_ratio: 0.5,
    unclassified_total: 400,
    unclassified_ratio: 0.47,
    groups: 151,
    transactions: 334,
    target_ratio: 0.8,
    answers_to_target: 30,
    amount_to_target: 240,
    done: false,
    ...overrides,
  };
}

function overview(overrides: Partial<OverviewResponse> = {}): OverviewResponse {
  return {
    balance: { amount: 1840.25, currency: "USD", at: "2026-09-03" },
    card: null,
    counts: { total: 334, needs_review: 4 },
    safe_to_spend_hoy: 22.4,
    buffer_status: { objetivo: 500, reservado: 340, financiado: false, faltante: 160 },
    card_status: null,
    transfers_summary: { total: 0, tope: 0, restante: 0, sobrepasado: false, topContrapartes: [] },
    next_payday: null,
    spending_by_category: {},
    ...overrides,
  };
}

function clasificado(overrides: Partial<ClassifyApplyResponse> = {}): ClassifyApplyResponse {
  return {
    ok: true,
    pattern: "comercio a",
    counterparty: "Comercio A",
    category: "salud",
    reclassified: 14,
    reclassified_this_month: 2,
    ...overrides,
  };
}

async function montar(props: Record<string, unknown> = {}) {
  const wrapper = mount(Preguntas, { props: props as never });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  endpoints.fetchClassifyQueue.mockResolvedValue({ groups: cola151(), count: 151 });
  endpoints.fetchClassifyProgress.mockResolvedValue(progreso());
  endpoints.fetchReview.mockResolvedValue({ transactions: filas4(), count: 4 });
  endpoints.fetchOverview.mockResolvedValue(overview());
  endpoints.postClassify.mockResolvedValue(clasificado());
  endpoints.postSilence.mockResolvedValue({ ok: true, counterparty: "Comercio A" });
  endpoints.postReviewResolve.mockResolvedValue({
    ok: true,
    changed: true,
    action: "confirm",
    transaction: fila({ needs_review: 0 }),
    resolution: {
      id: 1,
      transaction_id: 1,
      gmail_msg_id: "m-1",
      action: "confirm",
      previous_amount: 34.5,
      new_amount: null,
      note: null,
      resolved_by: "http",
      resolved_at: "2026-09-03T10:00:00Z",
    },
  });
});

describe("las dos pestañas y su orden", () => {
  it("dibuja las dos, con su conteo", async () => {
    const w = await montar();
    expect(w.get('[data-testid="pestana-monto"]').text()).toContain("4");
    expect(w.get('[data-testid="pestana-que-es"]').text()).toContain("151");
  });

  it("sin pestaña pedida, el monto va primero cuando hay algo que confirmar", async () => {
    const w = await montar();
    expect(w.find('[data-testid="panel-monto"]').exists()).toBe(true);
    expect(w.text()).toContain("sin monto afirmado, decir qué es un movimiento no mueve ningún gráfico");
  });

  it("sin nada que confirmar, la pestaña por defecto es la de categoría", async () => {
    endpoints.fetchReview.mockResolvedValue({ transactions: [], count: 0 });
    const w = await montar();
    expect(w.find('[data-testid="panel-que-es"]').exists()).toBe(true);
  });

  it("el hash manda: ?pestana=que-es entra en la cola de categoría aunque haya montos", async () => {
    const w = await montar({ pestanaPedida: "que-es" });
    expect(w.find('[data-testid="panel-que-es"]').exists()).toBe(true);
  });

  it("se puede cambiar de pestaña a mano", async () => {
    const w = await montar({ pestanaPedida: "monto" });
    await w.get('[data-testid="pestana-que-es"]').trigger("click");
    expect(w.find('[data-testid="panel-que-es"]').exists()).toBe(true);
  });
});

describe("pestaña 'Qué es esto' — 151 grupos por plata", () => {
  it("las tarjetas salen en el orden que manda el motor, paginadas de a 20", async () => {
    const w = await montar({ pestanaPedida: "que-es" });
    const tarjetas = w.findAll('[data-testid="classify-card"]');
    expect(tarjetas).toHaveLength(20);
    expect(tarjetas[0].get('[data-testid="classify-contraparte"]').text()).toBe("Comercio 0");
    expect(w.get('[data-testid="pagina-rango"]').text()).toContain("1–20 de 151");
    expect(w.get('[data-testid="pagina-rango"]').text()).toContain("página 1 de 8");
  });

  it("se puede avanzar y volver de página (W5/R15)", async () => {
    const w = await montar({ pestanaPedida: "que-es" });
    await w.get('[data-testid="pagina-siguiente"]').trigger("click");
    expect(w.get('[data-testid="pagina-rango"]').text()).toContain("21–40 de 151");
    await w.get('[data-testid="pagina-anterior"]').trigger("click");
    expect(w.get('[data-testid="pagina-rango"]').text()).toContain("1–20 de 151");
  });

  it("elegir una categoría llama a POST /api/classify con la contraparte, no con un patrón", async () => {
    const w = await montar({ pestanaPedida: "que-es" });
    const tarjeta = w.findAll('[data-testid="classify-card"]')[0];
    await tarjeta.get('[data-testid="classify-selector"]').setValue("salud");
    await tarjeta.get('[data-testid="classify-responder"]').trigger("click");
    await flushPromises();

    expect(endpoints.postClassify).toHaveBeenCalledWith("Comercio 0", "salud");
    // Y se refresca la cola: bajan todas las filas de esa contraparte.
    expect(endpoints.fetchClassifyQueue).toHaveBeenCalledTimes(2);
  });

  it("F13/R19: al responder dice qué cambió, con el número", async () => {
    const w = await montar({ pestanaPedida: "que-es" });
    const tarjeta = w.findAll('[data-testid="classify-card"]')[0];
    await tarjeta.get('[data-testid="classify-selector"]').setValue("salud");
    await tarjeta.get('[data-testid="classify-responder"]').trigger("click");
    await flushPromises();

    const efecto = w.get('[data-testid="efecto"]').text();
    expect(efecto).toContain("14 movimientos");
    expect(efecto).toContain("2 de ellos de este mes");
  });

  it("F13/R19: si no cambió nada, dice por qué", async () => {
    endpoints.postClassify.mockResolvedValue(clasificado({ reclassified: 0, reclassified_this_month: 0 }));
    const w = await montar({ pestanaPedida: "que-es" });
    const tarjeta = w.findAll('[data-testid="classify-card"]')[0];
    await tarjeta.get('[data-testid="classify-selector"]').setValue("salud");
    await tarjeta.get('[data-testid="classify-responder"]').trigger("click");
    await flushPromises();

    const efecto = w.get('[data-testid="efecto"]').text();
    expect(efecto).toContain("no movió ningún movimiento");
    expect(efecto).toContain("su tipo la decida antes que cualquier regla");
  });

  it("Saltar manda la tarjeta al final y NO escribe nada", async () => {
    const w = await montar({ pestanaPedida: "que-es" });
    await w.findAll('[data-testid="classify-card"]')[0].get('[data-testid="classify-saltar"]').trigger("click");

    const primera = w.findAll('[data-testid="classify-card"]')[0];
    expect(primera.get('[data-testid="classify-contraparte"]').text()).toBe("Comercio 1");
    expect(endpoints.postClassify).not.toHaveBeenCalled();
    expect(endpoints.postSilence).not.toHaveBeenCalled();
    // No se perdió: sigue habiendo 151.
    expect(w.get('[data-testid="pagina-rango"]').text()).toContain("de 151");
    expect(w.get('[data-testid="efecto"]').text()).toContain("vuelve al final de la cola");
  });

  it("'No preguntarme más por esta' (M5) silencia la contraparte y refresca", async () => {
    const w = await montar({ pestanaPedida: "que-es" });
    await w.findAll('[data-testid="classify-card"]')[0].get('[data-testid="classify-silenciar"]').trigger("click");
    await flushPromises();

    expect(endpoints.postSilence).toHaveBeenCalledWith("Comercio 0");
    expect(w.get('[data-testid="efecto"]').text()).toContain("No se pregunta más por Comercio 0");
    expect(endpoints.fetchClassifyQueue).toHaveBeenCalledTimes(2);
  });

  it("el progreso por plata está SIEMPRE visible", async () => {
    const w = await montar({ pestanaPedida: "que-es" });
    const avance = w.get('[data-testid="avance"]').text();
    expect(avance).toContain("47 %");
    expect(avance).toContain("30 respuestas más");
  });

  it("celebra al 80 % de la plata, no al vacío (M1)", async () => {
    endpoints.fetchClassifyProgress.mockResolvedValue(progreso({ covered_ratio: 0.82, done: true, groups: 118 }));
    const w = await montar({ pestanaPedida: "que-es" });
    expect(w.get('[data-testid="avance"]').classes()).toContain("celebra");
    // Y sin embargo la cola sigue llena: el criterio de terminado no es cero.
    expect(w.findAll('[data-testid="classify-card"]').length).toBeGreaterThan(0);
  });

  it("el estado vacío sigue existiendo y se celebra", async () => {
    endpoints.fetchClassifyQueue.mockResolvedValue({ groups: [], count: 0 });
    endpoints.fetchClassifyProgress.mockResolvedValue(progreso({ groups: 0, done: true, covered_ratio: 1 }));
    const w = await montar({ pestanaPedida: "que-es" });
    expect(w.get('[data-testid="que-es-vacio"]').text()).toContain("No queda nada por clasificar");
  });

  it("el rechazo del motor se muestra con su motivo", async () => {
    endpoints.postClassify.mockRejectedValue(new ErrorDelMotor("counterparty_not_found", 400));
    const w = await montar({ pestanaPedida: "que-es" });
    const tarjeta = w.findAll('[data-testid="classify-card"]')[0];
    await tarjeta.get('[data-testid="classify-selector"]').setValue("salud");
    await tarjeta.get('[data-testid="classify-responder"]').trigger("click");
    await flushPromises();

    const efecto = w.get('[data-testid="efecto"]');
    expect(efecto.classes()).toContain("bad");
    expect(efecto.text()).toContain("no clasificaría una sola fila");
  });
});

describe("D7-b — el aviso post-sync entra filtrado por el lote", () => {
  it("con ?ids= pide la cola acotada a esos movimientos", async () => {
    const w = await montar({ pestanaPedida: "que-es", ids: "101,102,103" });
    expect(endpoints.fetchClassifyQueue).toHaveBeenCalledWith({ transactionIds: [101, 102, 103] });
    expect(w.get('[data-testid="filtro-lote"]').text()).toContain("3 movimientos nuevos");
  });

  it("dentro del lote el orden sigue siendo por plata", async () => {
    const w = await montar({ pestanaPedida: "que-es", ids: "101,102" });
    expect(w.get('[data-testid="filtro-lote"]').text()).toContain("el orden sigue siendo por plata");
    expect(w.findAll('[data-testid="classify-card"]')[0].get('[data-testid="classify-contraparte"]').text()).toBe(
      "Comercio 0"
    );
  });

  it("se puede soltar el filtro sin salir de la pantalla, y vuelve la cola entera", async () => {
    const w = await montar({ pestanaPedida: "que-es", ids: "101,102" });
    await w.get('[data-testid="soltar-lote"]').trigger("click");
    await flushPromises();
    expect(endpoints.fetchClassifyQueue).toHaveBeenLastCalledWith({});
    expect(w.find('[data-testid="filtro-lote"]').exists()).toBe(false);
  });

  it("sin ?ids= no hay filtro: la cola entera es el modo por defecto", async () => {
    const w = await montar({ pestanaPedida: "que-es" });
    expect(endpoints.fetchClassifyQueue).toHaveBeenCalledWith({});
    expect(w.find('[data-testid="filtro-lote"]').exists()).toBe(false);
  });
});

describe("pestaña 'Monto' — las 4 filas, sobre las rutas que ya existen", () => {
  it("dibuja una tarjeta por fila con needs_review", async () => {
    const w = await montar({ pestanaPedida: "monto" });
    expect(w.findAll('[data-testid="review-card"]')).toHaveLength(4);
  });

  it("Confirmar y Descartar llaman a la ruta con su acción", async () => {
    const w = await montar({ pestanaPedida: "monto" });
    await w.findAll('[data-testid="review-card"]')[0].get('[data-testid="review-confirmar"]').trigger("click");
    await flushPromises();
    expect(endpoints.postReviewResolve).toHaveBeenCalledWith(1, { action: "confirm" });

    await w.findAll('[data-testid="review-card"]')[1].get('[data-testid="review-descartar"]').trigger("click");
    await flushPromises();
    expect(endpoints.postReviewResolve).toHaveBeenLastCalledWith(2, { action: "discard" });
  });

  it("Corregir manda el monto tecleado", async () => {
    const w = await montar({ pestanaPedida: "monto" });
    const tarjeta = w.findAll('[data-testid="review-card"]')[0];
    await tarjeta.get('[data-testid="review-monto-nuevo"]').setValue("41,20");
    await tarjeta.get('[data-testid="review-corregir"]').trigger("click");
    await flushPromises();
    expect(endpoints.postReviewResolve).toHaveBeenCalledWith(1, { action: "correct", amount: 41.2 });
  });

  it("R12: descartar dice que el saldo no se movió", async () => {
    endpoints.postReviewResolve.mockResolvedValue({
      ok: true,
      changed: true,
      action: "discard",
      transaction: fila({ needs_review: 0 }),
      resolution: {
        id: 1,
        transaction_id: 1,
        gmail_msg_id: "m-1",
        action: "discard",
        previous_amount: 34.5,
        new_amount: null,
        note: null,
        resolved_by: "http",
        resolved_at: "2026-09-03T10:00:00Z",
      },
    });
    const w = await montar({ pestanaPedida: "monto" });
    await w.findAll('[data-testid="review-card"]')[0].get('[data-testid="review-descartar"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-testid="efecto"]').text()).toContain("el saldo no se mueve");
  });

  it("R13: changed:false no se festeja — se dice que ya estaba resuelto y se refresca", async () => {
    endpoints.postReviewResolve.mockResolvedValue({
      ok: true,
      changed: false,
      reason: "already_resolved",
      transaction: fila({ needs_review: 0 }),
    });
    const w = await montar({ pestanaPedida: "monto" });
    await w.findAll('[data-testid="review-card"]')[0].get('[data-testid="review-confirmar"]').trigger("click");
    await flushPromises();

    const efecto = w.get('[data-testid="efecto"]');
    expect(efecto.classes()).toContain("neu");
    expect(efecto.text()).toContain("ya lo resolviste en otro lado");
    expect(endpoints.fetchReview).toHaveBeenCalledTimes(2);
  });

  it("R14: la fila en otra moneda tiene Confirmar deshabilitado con su motivo", async () => {
    endpoints.fetchReview.mockResolvedValue({
      transactions: [fila({ id: 9, currency: "EUR", counterparty: "Tienda Extranjera" })],
      count: 1,
    });
    const w = await montar({ pestanaPedida: "monto" });
    const tarjeta = w.get('[data-testid="review-card"]');
    expect(tarjeta.get('[data-testid="review-confirmar"]').attributes("disabled")).toBeDefined();
    expect(tarjeta.get('[data-testid="review-otra-moneda"]').text()).toContain("EUR");
  });

  it("el rechazo del motor por moneda se muestra con su motivo", async () => {
    endpoints.postReviewResolve.mockRejectedValue(new ErrorDelMotor("foreign_currency", 400));
    const w = await montar({ pestanaPedida: "monto" });
    await w.findAll('[data-testid="review-card"]')[0].get('[data-testid="review-confirmar"]').trigger("click");
    await flushPromises();
    expect(w.get('[data-testid="efecto"]').text()).toContain("sin convertir");
  });

  it("el estado vacío de Monto también se celebra", async () => {
    endpoints.fetchReview.mockResolvedValue({ transactions: [], count: 0 });
    const w = await montar({ pestanaPedida: "monto" });
    expect(w.get('[data-testid="monto-vacio"]').text()).toContain("Nada esperando confirmación");
  });
});

describe("el orden entre pestañas se explica en la tarjeta", () => {
  it("la contraparte que está en las dos avisa que el monto va primero", async () => {
    endpoints.fetchClassifyQueue.mockResolvedValue({
      groups: [grupo({ pattern: "comercio a", counterparty: "Comercio A" })],
      count: 1,
    });
    endpoints.fetchReview.mockResolvedValue({
      transactions: [fila({ id: 1, counterparty: "COMERCIO A" }), fila({ id: 2, counterparty: "Comercio A" })],
      count: 2,
    });
    const w = await montar({ pestanaPedida: "que-es" });
    const aviso = w.get('[data-testid="classify-monto-primero"]').text();
    expect(aviso).toContain("2 movimientos esperando");
    expect(aviso).toContain("va primero");
  });
});

describe("M4 — acá no hay editor de reglas", () => {
  it("no se puede escribir un patrón a mano: sólo elegir del glosario del motor", async () => {
    const w = await montar({ pestanaPedida: "que-es" });
    const tarjeta = w.findAll('[data-testid="classify-card"]')[0];
    expect(tarjeta.findAll('input[type="text"]')).toHaveLength(0);
    expect(tarjeta.find('[data-testid="classify-selector"]').element.tagName).toBe("SELECT");
    expect(w.text()).not.toContain("Patrón");
  });
});

/**
 * Wargaming del MVP (W5). AC6 pide que el estado vacío "siga siendo
 * confiable". Con el backend caído —server apagado, llave vencida, CORS— el
 * `catch` dejaba las listas vacías y el `finally` apagaba `cargando`, así que
 * los dos estados vacíos se dibujaban **al lado del cartel de error**,
 * afirmando un hecho sobre un ledger que nunca se leyó. Y como no había filas
 * de monto, la pestaña por defecto era justamente la celebratoria.
 */
describe("el estado vacío no puede afirmar nada sobre un ledger que no se leyó (AC6)", () => {
  beforeEach(() => {
    endpoints.fetchClassifyQueue.mockRejectedValue(new Error("Failed to fetch"));
    endpoints.fetchClassifyProgress.mockRejectedValue(new Error("Failed to fetch"));
    endpoints.fetchReview.mockRejectedValue(new Error("Failed to fetch"));
    endpoints.fetchOverview.mockRejectedValue(new Error("Failed to fetch"));
  });

  it("con el backend caído no dice 'no queda nada por clasificar'", async () => {
    const w = await montar({ pestanaPedida: "que-es" });

    expect(w.find('[data-testid="preguntas-error"]').exists()).toBe(true);
    expect(w.find('[data-testid="que-es-vacio"]').exists()).toBe(false);
    expect(w.text()).not.toContain("No queda nada por clasificar");
  });

  it("con el backend caído tampoco dice 'nada esperando confirmación'", async () => {
    const w = await montar({ pestanaPedida: "monto" });

    expect(w.find('[data-testid="preguntas-error"]').exists()).toBe(true);
    expect(w.find('[data-testid="monto-vacio"]').exists()).toBe(false);
  });
});
