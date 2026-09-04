/** @vitest-environment jsdom */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import Movimientos from "./Movimientos.vue";
import { provideRefresh } from "../composables/useRefresh";
import type { TransactionRow } from "../api/types";

const { endpoints } = vi.hoisted(() => ({
  endpoints: {
    fetchTransactions: vi.fn(),
    postClassify: vi.fn(),
    ErrorDelMotor: class ErrorDelMotor extends Error {
      constructor(
        readonly codigo: string,
        readonly status: number
      ) {
        super(codigo);
        this.name = "ErrorDelMotor";
      }
    },
    // La vista pregunta si el fallo es "esta ruta todavía no está en este
  },
}));

vi.mock("../api/endpoints", () => endpoints);

function fila(id: number, overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id,
    gmail_msg_id: `m${id}`,
    gmail_thread_id: null,
    ts: `2026-09-${String(id).padStart(2, "0")}T15:00:00.000Z`,
    direction: "out",
    type: "debito",
    amount: 10 * id,
    currency: "USD",
    counterparty: `Comercio ${id}`,
    account: null,
    category: "comida",
    raw_subject: "Notificacion de ejemplo",
    is_reversed: 0,
    is_internal: 0,
    needs_review: 0,
    source: "test",
    created_at: `2026-09-${String(id).padStart(2, "0")}T15:00:00.000Z`,
    ...overrides,
  };
}

function paginaDe(cuantas: number, desde = 1): TransactionRow[] {
  return Array.from({ length: cuantas }, (_, i) => fila(desde + i));
}

async function montar(props: Record<string, unknown> = {}) {
  const wrapper = mount(Movimientos, { props: props as never });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  endpoints.fetchTransactions.mockResolvedValue({ transactions: paginaDe(3), count: 3 });
  endpoints.postClassify.mockResolvedValue({
    ok: true,
    pattern: "comercio 1",
    counterparty: "Comercio 1",
    category: "salud",
    reclassified: 4,
    reclassified_this_month: 2,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("la lista sale de la ruta que ya existe", () => {
  it("pide `GET /api/transactions` y dibuja una fila por movimiento", async () => {
    const w = await montar();
    expect(endpoints.fetchTransactions).toHaveBeenCalledTimes(1);
    expect(w.findAll('[data-testid="fila-movimiento"]')).toHaveLength(3);
  });

  it("si el backend no responde, la tabla se vacía y se dice — no quedan filas viejas", async () => {
    endpoints.fetchTransactions.mockRejectedValue(new Error("ECONNREFUSED"));
    const w = await montar();
    expect(w.get('[data-testid="movimientos-error"]').text()).toContain("ECONNREFUSED");
    expect(w.findAll('[data-testid="fila-movimiento"]')).toHaveLength(0);
  });
});

describe("dos filtros, y nada más", () => {
  it("dibuja el rango de fechas y entrada/salida, y ningún otro control", async () => {
    const w = await montar();
    expect(w.find('[data-testid="filtro-desde"]').exists()).toBe(true);
    expect(w.find('[data-testid="filtro-hasta"]').exists()).toBe(true);
    expect(w.find('[data-testid="filtro-direccion"]').exists()).toBe(true);
    // Los cuatro controles que no tienen respaldo no se dibujan (H21 mal
    // planteado, H22, H23): el filtro por contraparte, el de tipo, "Interna"
    // como dirección y los interruptores de reversados/internas/descartados.
    const controles = w.get(".filters").text();
    expect(controles).not.toContain("Contraparte");
    expect(controles).not.toContain("Tipo");
    expect(controles).not.toContain("Interna");
    expect(w.text()).not.toContain("Mostrar reversados");
    // Un solo `select` en toda la pantalla: el de entrada/salida.
    expect(w.findAll("select")).toHaveLength(1);
  });

  it("cambiar un filtro es una consulta nueva al motor, no un recorte en el cliente", async () => {
    const w = await montar();
    await w.get('[data-testid="filtro-direccion"]').setValue("in");
    await flushPromises();

    expect(endpoints.fetchTransactions).toHaveBeenCalledTimes(2);
    expect(endpoints.fetchTransactions.mock.calls[1][0]).toMatchObject({ direction: "in", offset: 0 });
  });

  it("el rango viaja como día pelado: el día local lo resuelve el motor (W26)", async () => {
    const w = await montar();
    await w.get('[data-testid="filtro-hasta"]').setValue("2026-09-30");
    await flushPromises();

    expect(endpoints.fetchTransactions.mock.calls[1][0]).toMatchObject({ to: "2026-09-30" });
  });

  it("limpiar los filtros vuelve a la lista entera", async () => {
    const w = await montar();
    await w.get('[data-testid="filtro-direccion"]').setValue("out");
    await flushPromises();
    await w.get('[data-testid="limpiar-filtros"]').trigger("click");
    await flushPromises();

    expect(endpoints.fetchTransactions.mock.calls[2][0].direction).toBeUndefined();
  });
});

describe("llegar desde una barra del gráfico (H21)", () => {
  beforeEach(() => {
    endpoints.fetchTransactions.mockResolvedValue({
      transactions: paginaDe(3),
      count: 3,
      total: 12,
      amount: 180,
    });
  });

  it("pide la categoría recalculada, no un `WHERE category = ?`", async () => {
    await montar({ categoria: "salud" });
    expect(endpoints.fetchTransactions.mock.calls[0][0]).toMatchObject({ category: "salud" });
  });

  it("el conteo de la lista es el que contó la barra", async () => {
    const w = await montar({ categoria: "salud" });
    const conteo = w.get('[data-testid="conteo-filtros"]').text();

    expect(conteo).toContain("12 movimientos");
    expect(conteo).toContain("180,00");
    expect(conteo).toContain("Salud");
    expect(conteo).toContain("barra");
  });

  it("mientras la categoría está puesta, los dos filtros esperan — y se dice por qué", async () => {
    const w = await montar({ categoria: "salud" });
    expect(w.get('[data-testid="filtro-desde"]').attributes("disabled")).toBeDefined();
    expect(w.get('[data-testid="filtro-direccion"]').attributes("disabled")).toBeDefined();
    expect(w.get('[data-testid="nota-categoria"]').text()).toContain("dejaría de coincidir");
  });

  it("se puede soltar sin salir de la pantalla: vuelve la lista entera y los filtros", async () => {
    const w = await montar({ categoria: "salud" });
    await w.get('[data-testid="soltar-categoria"]').trigger("click");
    await flushPromises();

    expect(endpoints.fetchTransactions.mock.calls[1][0].category).toBeUndefined();
    expect(w.find('[data-testid="chip-categoria"]').exists()).toBe(false);
    expect(w.get('[data-testid="filtro-direccion"]').attributes("disabled")).toBeUndefined();
  });

  it("una categoría que no existe en el glosario se ignora, no se manda al server", async () => {
    const w = await montar({ categoria: "lo-que-sea" });
    expect(endpoints.fetchTransactions.mock.calls[0][0].category).toBeUndefined();
    expect(w.find('[data-testid="chip-categoria"]').exists()).toBe(false);
  });
});

describe("cargar más (H20)", () => {
  it("trae la página siguiente con `offset` y la agrega al final", async () => {
    endpoints.fetchTransactions.mockResolvedValueOnce({ transactions: paginaDe(50), count: 50 });
    const w = await montar();
    expect(w.findAll('[data-testid="fila-movimiento"]')).toHaveLength(50);

    endpoints.fetchTransactions.mockResolvedValueOnce({ transactions: paginaDe(20, 51), count: 20 });
    await w.get('[data-testid="cargar-mas"]').trigger("click");
    await flushPromises();

    expect(endpoints.fetchTransactions.mock.calls[1][0]).toMatchObject({ offset: 50, limit: 50 });
    expect(w.findAll('[data-testid="fila-movimiento"]')).toHaveLength(70);
  });

  it("con menos de una página no ofrece traer más, y no se pide ningún total", async () => {
    const w = await montar();
    expect(w.find('[data-testid="cargar-mas"]').exists()).toBe(false);
    expect(w.text()).not.toContain("de N");
  });
});

describe("`¿Qué es esto?` desde el detalle de una fila (H28)", () => {
  it("escribe con el mismo escritor que la cola: `POST /api/classify` con la contraparte", async () => {
    const w = await montar();
    await w.findAll('[data-testid="fila-detalle"]')[0].trigger("click");
    await w.get('[data-testid="detalle-selector"]').setValue("salud");
    await w.get('[data-testid="detalle-responder"]').trigger("click");
    await flushPromises();

    expect(endpoints.postClassify).toHaveBeenCalledWith("Comercio 1", "salud");
  });

  it("después de responder, el detalle dice qué cambió con el número (F13/R19)", async () => {
    const w = await montar();
    await w.findAll('[data-testid="fila-detalle"]')[0].trigger("click");
    await w.get('[data-testid="detalle-selector"]').setValue("salud");
    await w.get('[data-testid="detalle-responder"]').trigger("click");
    await flushPromises();

    const efecto = w.get('[data-testid="detalle-efecto"]').text();
    expect(efecto).toContain("4 movimientos");
    expect(efecto).toContain("2 de ellos de este mes");
  });

  it("si no cambió nada en el gráfico del mes, dice por qué (R19)", async () => {
    endpoints.postClassify.mockResolvedValue({
      ok: true,
      pattern: "comercio 1",
      counterparty: "Comercio 1",
      category: "salud",
      reclassified: 14,
      reclassified_this_month: 0,
    });
    const w = await montar();
    await w.findAll('[data-testid="fila-detalle"]')[0].trigger("click");
    await w.get('[data-testid="detalle-selector"]').setValue("salud");
    await w.get('[data-testid="detalle-responder"]').trigger("click");
    await flushPromises();

    const efecto = w.get('[data-testid="detalle-efecto"]').text();
    expect(efecto).toContain("ninguno de este mes");
    expect(efecto).toContain("sólo del mes en curso");
  });

  it("el rechazo del motor se muestra con su motivo, no con un rojo genérico", async () => {
    endpoints.postClassify.mockRejectedValue(new endpoints.ErrorDelMotor("counterparty_not_found", 400));
    const w = await montar();
    await w.findAll('[data-testid="fila-detalle"]')[0].trigger("click");
    await w.get('[data-testid="detalle-selector"]').setValue("salud");
    await w.get('[data-testid="detalle-responder"]').trigger("click");
    await flushPromises();

    expect(w.get('[data-testid="detalle-efecto"]').text()).toContain("no encontró esa contraparte");
  });

  it("responder refresca la lista: es la lista la que dice cómo quedó, no el mensaje", async () => {
    const w = await montar();
    await w.findAll('[data-testid="fila-detalle"]')[0].trigger("click");
    await w.get('[data-testid="detalle-selector"]').setValue("salud");
    await w.get('[data-testid="detalle-responder"]').trigger("click");
    await flushPromises();

    expect(endpoints.fetchTransactions).toHaveBeenCalledTimes(2);
  });

  it("si la fila salió de la lista de la barra, se dice ahí mismo por qué", async () => {
    endpoints.fetchTransactions.mockResolvedValue({
      transactions: paginaDe(3),
      count: 3,
      total: 12,
      amount: 180,
    });
    const w = await montar({ categoria: "comida" });
    await w.findAll('[data-testid="fila-detalle"]')[0].trigger("click");
    await w.get('[data-testid="detalle-selector"]').setValue("salud");

    // Al recargar, la fila respondida ya no cae en esta categoría.
    endpoints.fetchTransactions.mockResolvedValue({
      transactions: paginaDe(2, 2),
      count: 2,
      total: 11,
      amount: 170,
    });
    await w.get('[data-testid="detalle-responder"]').trigger("click");
    await flushPromises();

    const cartel = w.get('[data-testid="efecto-huerfano"]').text();
    expect(cartel).toContain("4 movimientos");
    expect(cartel).toContain("ya no cae en esta categoría");
    expect(w.find('[data-testid="detalle-fila"]').exists()).toBe(false);
  });
});

describe("lo que NO se construye, y es una decisión escrita", () => {
  it("no hay `Mandar a revisión` (H26) ni `Recuperar contraparte` (H25) en ningún lado", async () => {
    const w = await montar({ filas: [fila(1, { counterparty: null })] });
    await w.findAll('[data-testid="fila-detalle"]')[0].trigger("click");
    const texto = w.text();

    expect(texto).not.toContain("Mandar a revisión");
    expect(texto).not.toContain("Recuperar contraparte");
  });
});

/**
 * Wargaming ronda 4, W31 — la misma clase que en el Resumen. El rótulo salía de
 * `lastRefreshAt`, la hora del **tick**: con el backend caído el reloj late
 * igual, así que la cabecera decía *"actualizado recién"* arriba del cartel rojo
 * y de una tabla vacía. Frescura es la hora de la última lectura buena.
 */
describe("el rótulo de frescura (W31)", () => {
  it("no dice 'recién' cuando el último refresco falló", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T12:00:00Z"));

    const padre = defineComponent({
      components: { Movimientos },
      setup: () => ({ reloj: provideRefresh(0) }),
      template: "<Movimientos />",
    });
    const w = mount(padre);
    await flushPromises();
    expect(w.get('[data-testid="movimientos-actualizado"]').text()).toContain("recien");

    vi.setSystemTime(new Date("2026-09-03T12:10:00Z"));
    endpoints.fetchTransactions.mockRejectedValue(new Error("ECONNREFUSED"));
    (w.vm as unknown as { reloj: { refreshNow: () => void } }).reloj.refreshNow();
    await flushPromises();

    expect(w.find('[data-testid="movimientos-error"]').exists()).toBe(true);
    expect(w.get('[data-testid="movimientos-actualizado"]').text()).toContain("hace 10 minutos");

    vi.useRealTimers();
  });
});

/**
 * Con el ledger entero portado (ver `docs/portado-completo.md`), un fallo de
 * `/api/transactions` vuelve a ser lo único que puede ser: el backend no
 * respondió. Se dice con el cartel, y **no se dejan filas viejas con cara de
 * actuales**.
 */
describe("cuando el backend no responde se dice, y no se miente con datos viejos", () => {
  it("enciende el cartel con el motivo, sin tabla", async () => {
    endpoints.fetchTransactions.mockRejectedValue(new Error("Failed to fetch"));
    const w = await montar();

    expect(w.get('[data-testid="movimientos-error"]').text()).toContain("Failed to fetch");
    expect(w.findAll('[data-testid="fila-movimiento"]')).toHaveLength(0);
  });
});
