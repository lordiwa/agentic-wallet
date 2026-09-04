/** @vitest-environment jsdom */
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TransactionsTable from "./TransactionsTable.vue";
import type { TransactionRow } from "../api/types";

function fila(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 1,
    gmail_msg_id: "m1",
    gmail_thread_id: null,
    ts: "2026-09-01T15:00:00.000Z",
    direction: "out",
    type: "debito",
    amount: 12.5,
    currency: "USD",
    counterparty: "Comercio de Ejemplo A",
    account: null,
    category: "comida",
    raw_subject: "Notificacion de ejemplo",
    is_reversed: 0,
    is_internal: 0,
    needs_review: 0,
    source: "test",
    created_at: "2026-09-01T15:00:00.000Z",
    ...overrides,
  };
}

function montar(props: Record<string, unknown> = {}) {
  return mount(TransactionsTable, { props: { filas: [fila()], ...props } as never });
}

describe("TransactionsTable — las columnas del sistema", () => {
  it("dibuja las columnas de `c4`, con Monto y Acciones a la derecha", () => {
    const w = montar();
    const cabeceras = w.findAll("th").map((th) => th.text());

    expect(cabeceras).toEqual([
      // La flecha de orden de `c4`. Es fija: el motor devuelve los más
      // recientes primero y esta pantalla no ordena por otra columna.
      "Fecha ↓",
      "Contraparte",
      "Tipo",
      "Dirección",
      "Categoría",
      "Monto",
      "Marcas",
      "Acciones",
    ]);
    // Alineadas a la derecha: la clase `.r` del sistema.
    const alineadas = w.findAll("th").filter((th) => th.classes("r")).map((th) => th.text());
    expect(alineadas).toEqual(["Monto", "Acciones"]);
  });

  it("la cifra es tabular y va en la celda de la derecha", () => {
    const monto = montar().get('[data-testid="fila-monto"]');
    expect(monto.classes()).toContain("amt");
    expect(monto.classes()).toContain("r");
    expect(monto.text()).toBe("12,50");
  });

  it("una fila por movimiento, con sus marcas", () => {
    const w = montar({
      filas: [fila(), fila({ id: 2, needs_review: 1 }), fila({ id: 3, is_reversed: 1 })],
    });
    expect(w.findAll('[data-testid="fila-movimiento"]')).toHaveLength(3);
    expect(w.text()).toContain("sin confirmar");
    expect(w.text()).toContain("reverso");
  });

  it("la categoría recalculada gana sobre la columna vieja de la fila (H21)", () => {
    const w = montar({ filas: [fila({ category: "otros" })], categoria: "salud" });
    expect(w.get('[data-testid="fila-movimiento"]').text()).toContain("Salud");
    expect(w.get('[data-testid="fila-movimiento"]').text()).not.toContain("Otros");
  });
});

describe("el detalle: UNA sola acción nueva", () => {
  it("la fila se abre y se cierra desde su única acción", async () => {
    const w = montar({ abierta: null });
    expect(w.find('[data-testid="detalle-fila"]').exists()).toBe(false);

    await w.get('[data-testid="fila-detalle"]').trigger("click");
    expect(w.emitted("abrir")?.[0]).toEqual([1]);

    await w.setProps({ abierta: 1 });
    expect(w.find('[data-testid="detalle-fila"]').exists()).toBe(true);
    await w.get('[data-testid="fila-detalle"]').trigger("click");
    expect(w.emitted("abrir")?.[1]).toEqual([null]);
  });

  it("`¿Qué es esto?` es la única acción del detalle: no hay `Mandar a revisión` (H26), ni regla, ni chat", async () => {
    const w = montar({ abierta: 1 });
    const detalle = w.get('[data-testid="detalle-fila"]');

    expect(detalle.text()).toContain("¿Qué es esto?");
    const botones = detalle.findAll("button").map((b) => b.text());
    expect(botones).toEqual(["Es esto"]);
    expect(detalle.text()).not.toContain("revisión");
    expect(detalle.text()).not.toContain("Recuperar");
  });

  it("no se responde sin elegir, y elegir emite la fila con su categoría", async () => {
    const w = montar({ abierta: 1 });
    expect(w.get('[data-testid="detalle-responder"]').attributes("disabled")).toBeDefined();

    await w.get('[data-testid="detalle-selector"]').setValue("salud");
    await w.get('[data-testid="detalle-responder"]').trigger("click");

    const emitido = w.emitted("clasificar")?.[0] as [TransactionRow, string];
    expect(emitido[0].id).toBe(1);
    expect(emitido[1]).toBe("salud");
  });

  it("una fila sin contraparte dice por qué no se puede preguntar, y no ofrece recuperarla (H25)", () => {
    const w = montar({ filas: [fila({ counterparty: null })], abierta: 1 });
    expect(w.find('[data-testid="detalle-selector"]').exists()).toBe(false);
    expect(w.get('[data-testid="detalle-sin-pregunta"]').text()).toContain("por lote");
  });

  it("una fila sin confirmar avisa que el monto va primero", () => {
    const w = montar({ filas: [fila({ needs_review: 1 })], abierta: 1 });
    const aviso = w.get('[data-testid="detalle-sin-confirmar"]');
    expect(aviso.text()).toContain("no entra a ningún total");
    expect(aviso.get("a").attributes("href")).toBe("#/preguntas?pestana=monto");
  });

  it("después de responder, el detalle dice qué cambió — con el número (F13/R19)", () => {
    const w = montar({
      abierta: 1,
      efecto: { tono: "ok", titulo: "Reclasificaste 4 movimientos a Salud, 2 de ellos de este mes.", detalle: "…" },
    });
    expect(w.get('[data-testid="detalle-efecto"]').text()).toContain("4 movimientos");
  });

  it("el efecto se dibuja adentro del detalle, no como un cartel suelto", () => {
    const w = montar({ abierta: null, efecto: { tono: "ok", titulo: "algo", detalle: "…" } });
    expect(w.find('[data-testid="detalle-efecto"]').exists()).toBe(false);
  });
});

describe("cargar más, sin total y sin paginador (H20)", () => {
  it("no hay `Anterior`/`Siguiente` ni un `de N`", () => {
    const w = montar({ hayMas: true });
    const botones = w.findAll("button").map((b) => b.text());
    expect(botones).not.toContain("Anterior");
    expect(botones).not.toContain("Siguiente");
    expect(w.get('[data-testid="tabla-conteo"]').text()).toBe("1 movimiento a la vista");
  });

  it("el botón pide la página siguiente", async () => {
    const w = montar({ hayMas: true });
    await w.get('[data-testid="cargar-mas"]').trigger("click");
    expect(w.emitted("cargarMas")).toHaveLength(1);
  });

  it("sin nada más para traer, se dice en vez de dejar un botón que no hace nada", () => {
    const w = montar({ hayMas: false });
    expect(w.find('[data-testid="cargar-mas"]').exists()).toBe(false);
    expect(w.get('[data-testid="tabla-fin"]').text()).toContain("No queda nada más");
  });

  it("mientras trae, el botón lo dice y no se pulsa dos veces", () => {
    const w = montar({ hayMas: true, cargandoMas: true });
    expect(w.get('[data-testid="cargar-mas"]').attributes("disabled")).toBeDefined();
  });
});

describe("los estados de la tabla", () => {
  it("cargando dibuja el esqueleto del sistema, no una tabla vacía", () => {
    const w = montar({ filas: [], cargando: true });
    expect(w.find('[data-testid="tabla-cargando"]').exists()).toBe(true);
    expect(w.find('[data-testid="tabla-vacia"]').exists()).toBe(false);
  });

  it("sin resultados se dice, sin un cero engañoso", () => {
    const w = montar({ filas: [], cargando: false });
    expect(w.get('[data-testid="tabla-vacia"]').text()).toContain("Sin resultados");
    expect(w.find('[data-testid="cargar-mas"]').exists()).toBe(false);
  });
});
