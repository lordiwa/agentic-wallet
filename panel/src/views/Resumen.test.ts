/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import path from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Resumen from "./Resumen.vue";
import type {
  ClassifyProgressResponse,
  OverviewResponse,
  SyncStatusResponse,
  SyncTriggerResponse,
} from "../api/types";

const { endpoints } = vi.hoisted(() => ({
  endpoints: {
    fetchOverview: vi.fn(),
    fetchSyncStatus: vi.fn(),
    fetchClassifyProgress: vi.fn(),
    postSync: vi.fn(),
  },
}));

vi.mock("../api/endpoints", () => endpoints);

function overview(overrides: Partial<OverviewResponse> = {}): OverviewResponse {
  return {
    balance: { amount: 1840.25, currency: "USD", at: "2026-09-03" },
    card: { card_mask: null, issue_date: "2026-09-10", balance: 320, min_payment: 32, due_date: "2026-09-20" },
    counts: { total: 120, needs_review: 3 },
    safe_to_spend_hoy: 22.4,
    buffer_status: { objetivo: 500, reservado: 340, financiado: false, faltante: 160 },
    card_status: {
      saldoCorte: 320,
      minimo: 32,
      fechaMaxima: "2026-09-20",
      saldoActualEstimado: 320,
      aTiempo: true,
      requeridoPorQuincena: 160,
    },
    transfers_summary: { total: 100, tope: 500, restante: 400, sobrepasado: false, topContrapartes: [] },
    next_payday: "2026-09-15",
    spending_by_category: { comida: 77.5, salud: 25, transporte: 18 },
    ...overrides,
  };
}

function syncStatus(overrides: Partial<SyncStatusResponse> = {}): SyncStatusResponse {
  return { last_sync_ts: "2026-09-03T11:00:00Z", running: false, backlog: null, ...overrides };
}

function cola(overrides: Partial<ClassifyProgressResponse> = {}): ClassifyProgressResponse {
  return {
    spending_total: 365.5,
    baseline_total: 245,
    covered_total: 0,
    covered_ratio: 0,
    unclassified_total: 245,
    unclassified_ratio: 0.67,
    groups: 12,
    transactions: 34,
    target_ratio: 0.8,
    answers_to_target: 5,
    amount_to_target: 165,
    done: false,
    ...overrides,
  };
}

async function montar() {
  const wrapper = mount(Resumen);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  endpoints.fetchOverview.mockResolvedValue(overview());
  endpoints.fetchSyncStatus.mockResolvedValue(syncStatus());
  endpoints.fetchClassifyProgress.mockResolvedValue(cola());
  endpoints.postSync.mockResolvedValue({
    progress: { processed: 10, total: 10, remaining: 0, complete: true },
    inserted_ids: [],
  } as SyncTriggerResponse);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("el hogar dibuja lo que el motor calculó", () => {
  it("el saldo, y lleva a Movimientos", async () => {
    const wrapper = await montar();
    const tarjetas = wrapper.findAll('[data-testid="overview-card"]');
    expect(tarjetas[0].text()).toContain("1840,25");
    expect(tarjetas[0].attributes("href")).toBe("#/movimientos");
  });

  it("Tarjeta y Colchón muestran su cifra y NO navegan: sus pantallas no existen (R4)", async () => {
    const wrapper = await montar();
    const tarjeta = wrapper.findAll('[data-testid="overview-card"]')[2];
    expect(tarjeta.text()).toContain("320,00");
    expect(tarjeta.element.tagName).toBe("DIV");

    // El colchón vive en su propia tarjeta de la columna derecha, y tampoco
    // es un enlace.
    expect(wrapper.text()).toContain("objetivo 500,00");
    expect(wrapper.findAll("a").every((a) => a.attributes("href") !== "#/ahorro")).toBe(true);
  });

  it("cada barra del gráfico lleva a Movimientos filtrado por su categoría (H21)", async () => {
    const wrapper = await montar();
    const barras = wrapper.findAll('[data-testid="barra-categoria"]');

    expect(barras).toHaveLength(3);
    // Ordenadas de la que más plata mueve a la que menos.
    expect(barras[0].attributes("href")).toBe("#/movimientos?categoria=comida");
    expect(barras[0].text()).toContain("77,50");
    expect(barras[2].attributes("href")).toBe("#/movimientos?categoria=transporte");
  });

  it("el calendario dice 'Sin leer' donde el campo puede venir nulo, sin inventar una fecha", async () => {
    endpoints.fetchOverview.mockResolvedValue(overview({ card: null, card_status: null, next_payday: null }));
    const wrapper = await montar();

    expect(wrapper.text()).toContain("Sin leer");
  });
});

describe("R7: no se dice 'podés gastar 0,00 hoy' cuando el dato es 'todavía no sé'", () => {
  it("sin día de pago, el safe-to-spend no es una cifra", async () => {
    // El motor devuelve 0 sin día de pago conocido: es un guardia contra
    // dividir por cero, no una afirmación.
    endpoints.fetchOverview.mockResolvedValue(overview({ next_payday: null, safe_to_spend_hoy: 0 }));
    const wrapper = await montar();

    const safe = wrapper.findAll('[data-testid="overview-card"]')[1];
    expect(safe.find('[data-testid="overview-card-cifra"]').exists()).toBe(false);
    expect(safe.text()).toContain("Todavía no sé");
    expect(safe.text()).toContain("falta el día de pago");
  });

  it("CON día de pago, un cero SÍ es una cifra: cero es un valor real", async () => {
    endpoints.fetchOverview.mockResolvedValue(overview({ next_payday: "2026-09-15", safe_to_spend_hoy: 0 }));
    const wrapper = await montar();

    const safe = wrapper.findAll('[data-testid="overview-card"]')[1];
    expect(safe.get('[data-testid="overview-card-cifra"]').text()).toBe("0,00");
  });
});

describe("los dos avisos son dos, y llevan a lugares distintos", () => {
  it("el del monto pregunta por filas sin confirmar y lleva a la pestaña Monto", async () => {
    const wrapper = await montar();
    const aviso = wrapper.get('[data-testid="aviso-monto"]');

    expect(aviso.text()).toContain("3 movimientos necesitan tu confirmación");
    expect(aviso.get("a").attributes("href")).toBe("#/preguntas?pestana=monto");
  });

  it("el de la categoría pregunta por comercios y lleva a la otra pestaña", async () => {
    const wrapper = await montar();
    const aviso = wrapper.get('[data-testid="aviso-categoria"]');

    expect(aviso.text()).toContain("34 sin clasificar en 12 comercios");
    expect(aviso.get("a").attributes("href")).toBe("#/preguntas?pestana=que-es");
  });

  it("no se mezclan: dos avisos, dos destinos", async () => {
    const wrapper = await montar();
    const monto = wrapper.get('[data-testid="aviso-monto"]').get("a").attributes("href");
    const categoria = wrapper.get('[data-testid="aviso-categoria"]').get("a").attributes("href");
    expect(monto).not.toBe(categoria);
  });

  it("cada uno aparece sólo si tiene algo que preguntar", async () => {
    endpoints.fetchOverview.mockResolvedValue(overview({ counts: { total: 120, needs_review: 0 } }));
    endpoints.fetchClassifyProgress.mockResolvedValue(cola({ groups: 0, transactions: 0 }));
    const wrapper = await montar();

    expect(wrapper.find('[data-testid="aviso-monto"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="aviso-categoria"]').exists()).toBe(false);
  });

  it("después de un sync, el de categoría se acota al lote que entró (D7-b)", async () => {
    endpoints.postSync.mockResolvedValue({
      progress: { processed: 1240, total: 3800, remaining: 2560, complete: false },
      inserted_ids: [7, 9, 11],
    } as SyncTriggerResponse);
    const wrapper = await montar();

    await wrapper.get('[data-testid="sync-button-accion"]').trigger("click");
    await flushPromises();

    const aviso = wrapper.get('[data-testid="aviso-categoria"]');
    expect(aviso.get("a").attributes("href")).toBe("#/preguntas?pestana=que-es&ids=7%2C9%2C11");
    expect(aviso.text()).toContain("lo que acaba de entrar");
    // Y el del monto sigue llevando a donde llevaba: responder uno no puede
    // parecer haber respondido el otro.
    expect(wrapper.get('[data-testid="aviso-monto"]').get("a").attributes("href")).toBe("#/preguntas?pestana=monto");
  });
});

describe("el sync vive adentro del chip", () => {
  it("no hay una pantalla de sincronización: el ciclo entero está acá", async () => {
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="chip-sync"] [data-testid="sync-button"]').exists()).toBe(true);
  });

  it("al pulsar, dispara un lote", async () => {
    const wrapper = await montar();
    await wrapper.get('[data-testid="sync-button-accion"]').trigger("click");
    await flushPromises();

    expect(endpoints.postSync).toHaveBeenCalledTimes(1);
  });

  it("un lote que no termina deja 'Seguir' con su conteo — y NO se encadena solo", async () => {
    endpoints.postSync.mockResolvedValue({
      progress: { processed: 1240, total: 3800, remaining: 2560, complete: false },
      inserted_ids: [],
    } as SyncTriggerResponse);
    endpoints.fetchSyncStatus.mockResolvedValue(
      syncStatus({ backlog: { processed: 1240, total: 3800, remaining: 2560, updated_at: "2026-09-03T11:05:00Z" } })
    );

    const wrapper = await montar();
    await wrapper.get('[data-testid="sync-button-accion"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="sync-button-accion"]').text()).toBe("Seguir");
    expect(wrapper.get('[data-testid="sync-button-progreso"]').text()).toBe("1240 de 3800");
    // Una sola llamada: el encadenado lo decide una persona.
    expect(endpoints.postSync).toHaveBeenCalledTimes(1);
  });

  it("un 409 se dibuja como falla y no se reintenta solo", async () => {
    endpoints.postSync.mockRejectedValue(new Error("sync_already_running"));
    const wrapper = await montar();

    await wrapper.get('[data-testid="sync-button-accion"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="sync-button-titulo"]').text()).toBe("Ya hay un sync en curso");
    expect(endpoints.postSync).toHaveBeenCalledTimes(1);
  });

  it("R9: si el server dice que hay un lote corriendo, el chip no arranca limpio", async () => {
    // Es exactamente el estado después de un F5 en medio de un lote: esta
    // pestaña no disparó nada.
    endpoints.fetchSyncStatus.mockResolvedValue(syncStatus({ running: true }));
    const wrapper = await montar();

    const boton = wrapper.get<HTMLButtonElement>('[data-testid="sync-button-accion"]');
    expect(boton.element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="resumen-estado"]').text()).toBe("Sincronizando");
  });
});

describe("cuando el backend no responde", () => {
  it("lo dice, en vez de mostrar el último valor conocido con cara de actual", async () => {
    endpoints.fetchOverview.mockRejectedValue(new Error("Failed to fetch"));
    const wrapper = await montar();

    expect(wrapper.get('[data-testid="resumen-error"]').text()).toContain("Failed to fetch");
  });
});

/**
 * D6, opción A: el teléfono se atiende con un diseño chico **del Resumen**,
 * porque es la superficie que se mira desde el teléfono; las demás quedan
 * usables sin uno propio.
 *
 * Esto se comprueba leyendo el propio archivo. Es una prueba pobre y se sabe:
 * jsdom no hace layout, así que no puede decir si algo se corta a 360px. Lo que
 * sí evita es que el diseño chico se borre en un refactor sin que nadie se
 * entere. La verificación en un teléfono real es manual y está anotada como
 * deuda en el ticket.
 */
describe("D6: el Resumen tiene diseño chico propio", () => {
  const fuente = readFileSync(path.join(import.meta.dirname, "Resumen.vue"), "utf8");

  it("trae sus propias reglas de pantalla chica", () => {
    expect(fuente).toContain("@media (max-width: 900px)");
    expect(fuente).toContain("@media (max-width: 560px)");
  });

  it("las cuatro tarjetas dejan de ser cuatro columnas en un teléfono", () => {
    const chico = fuente.slice(fuente.indexOf("@media (max-width: 560px)"));
    expect(chico).toContain("grid-template-columns: 1fr");
  });
});
