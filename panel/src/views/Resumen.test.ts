/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import path from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { provideRefresh } from "../composables/useRefresh";
import Resumen from "./Resumen.vue";
import { ROTULO_SIN_LEER } from "../lib/formato";
import { CATEGORIAS_ELEGIBLES, nombreCategoria } from "../lib/categorias";
import type {
  ClassifyProgressResponse,
  OverviewResponse,
  RecurringResponse,
  SyncStatusResponse,
  SyncTriggerResponse,
} from "../api/types";

const { endpoints } = vi.hoisted(() => ({
  endpoints: {
    fetchOverview: vi.fn(),
    fetchSyncStatus: vi.fn(),
    fetchClassifyProgress: vi.fn(),
    fetchRecurring: vi.fn(),
    postSync: vi.fn(),
  },
}));

vi.mock("../api/endpoints", () => endpoints);

/**
 * Las funciones del consentimiento, mockeadas: el hogar ahora monta la tarjeta
 * de Gmail (`useGmail`), y sin esto todo test correría contra un panel "sin
 * configurar", que es justo el estado en el que la tarjeta no se dibuja.
 */
const { gmailApi } = vi.hoisted(() => ({
  gmailApi: {
    gmailConfigurado: vi.fn(() => true),
    obtenerIdToken: vi.fn(async () => "id-token-de-prueba"),
    consultarEstadoGmail: vi.fn(),
    iniciarConexionGmail: vi.fn(),
  },
}));

vi.mock("../api/gmail", () => ({
  ...gmailApi,
  GmailApiError: class GmailApiError extends Error {},
}));

function estadoGmail(conectado: boolean, necesitaReconectar = false) {
  return {
    conectado,
    email: conectado ? "cuenta@ejemplo.test" : null,
    scopes: conectado ? ["https://www.googleapis.com/auth/gmail.readonly"] : [],
    grantedAt: conectado ? "2026-09-01T10:00:00Z" : null,
    necesitaReconectar,
  };
}

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
    remaining_ratio: 0.7,
    groups: 12,
    transactions: 34,
    target_ratio: 0.8,
    answers_to_target: 5,
    amount_to_target: 165,
    done: false,
    ...overrides,
  };
}

/** El análisis del historial de N4 (`GET /api/onboarding/recurring`). */
function recurring(overrides: Partial<RecurringResponse> = {}): RecurringResponse {
  return {
    propuestas: [
      {
        pattern: "servicio ficticio",
        counterparty: "Servicio Ficticio",
        monto_estimado: 40,
        dia_tipico: 8,
        sample_size: 5,
        count: 5,
        total: 200,
        last_ts: "2026-09-01T10:00:00Z",
      },
    ],
    candidatas: 1,
    en_la_cola: 0,
    meses_de_historial: 6.2,
    meses_minimos: 3,
    suficiente_historial: true,
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
  endpoints.fetchRecurring.mockResolvedValue(recurring());
  endpoints.postSync.mockResolvedValue({
    progress: { processed: 10, total: 10, remaining: 0, complete: true },
    inserted_ids: [],
  } as SyncTriggerResponse);
  gmailApi.gmailConfigurado.mockReturnValue(true);
  gmailApi.obtenerIdToken.mockResolvedValue("id-token-de-prueba");
  gmailApi.consultarEstadoGmail.mockResolvedValue(estadoGmail(true));
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

  /**
   * Lo que Mato reportó: "en las barras no salen las categorías". La barra ya
   * se dibujaba —eso lo cubría el test de arriba, que sólo mira `href` y
   * monto—, así que el nombre visible no lo cubría nadie. Este recorre el
   * glosario **entero**, incluidas las siete nuevas, para que agregar una
   * octava sin nombrarla falle acá y no en la pantalla de alguien.
   */
  it("cada barra muestra el nombre de su categoría, para las 17 del glosario (incluidas las nuevas)", async () => {
    const todas = [...CATEGORIAS_ELEGIBLES, "transferencia_persona", "otros"] as const;
    // Montos distintos para que ninguna barra quede fuera por empate ni por cero.
    const gasto = Object.fromEntries(todas.map((clave, i) => [clave, (i + 1) * 10]));
    endpoints.fetchOverview.mockResolvedValue(overview({ spending_by_category: gasto }));

    const wrapper = await montar();
    const barras = wrapper.findAll('[data-testid="barra-categoria"]');
    expect(barras).toHaveLength(todas.length);

    const textos = barras.map((b) => b.get(".bar-nombre").text());
    for (const clave of todas) {
      const nombre = nombreCategoria(clave);
      // Que el nombre esté, y que NO sea la clave cruda: el fallback de
      // `nombreCategoria` dibuja la clave, y eso es justo lo que no queremos ver.
      expect(textos).toContain(nombre);
      expect(nombre).not.toBe(clave);
    }
  });

  it("una categoría que el panel todavía no nombra se dibuja con su clave, no en blanco", async () => {
    // El motor puede sumar una categoría antes que el panel la nombre. Verla
    // fea es aceptable; verla vacía es una barra sin dueño.
    endpoints.fetchOverview.mockResolvedValue(
      overview({ spending_by_category: { categoria_del_futuro: 50 } as never })
    );

    const wrapper = await montar();
    const barras = wrapper.findAll('[data-testid="barra-categoria"]');
    expect(barras).toHaveLength(1);
    expect(barras[0].get(".bar-nombre").text()).toBe("categoria_del_futuro");
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

  /**
   * El 503 era un callejón sin salida: la tarjeta del consentimiento vivía sólo
   * en `#/conectado`, una ruta a la que no se navega —se aterriza viniendo de
   * Google—, así que quien nunca autorizó su correo leía "falta conectar Gmail"
   * y no tenía dónde hacerlo. Éstos son los tests de que el camino existe.
   */
  it("un 503 ofrece conectar Gmail en la misma pantalla", async () => {
    gmailApi.consultarEstadoGmail.mockResolvedValue(estadoGmail(false));
    endpoints.postSync.mockRejectedValue(new Error("gmail_not_configured: gmail_no_conectado"));
    const wrapper = await montar();

    await wrapper.get('[data-testid="sync-button-accion"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="sync-button-titulo"]').text()).toBe("Falta conectar Gmail");
    // El texto viejo culpaba al server; el nuevo dice de quién es la acción.
    expect(wrapper.get('[data-testid="sync-button-detalle"]').text()).not.toContain("server");
    const tarjeta = wrapper.get('[data-testid="conectar-gmail"]');
    expect(tarjeta.attributes("data-estado")).toBe("desconectado");
    expect(wrapper.get('[data-testid="conectar-gmail-accion"]').text()).toContain("Conectar");
  });

  it("el permiso vencido no se dibuja igual que el que nunca se dio", async () => {
    gmailApi.consultarEstadoGmail.mockResolvedValue(estadoGmail(true, true));
    endpoints.postSync.mockRejectedValue(new Error("gmail_not_configured: gmail_reconectar"));
    const wrapper = await montar();

    await wrapper.get('[data-testid="sync-button-accion"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="sync-button-titulo"]').text()).toBe("Hay que reconectar Gmail");
    expect(wrapper.get('[data-testid="conectar-gmail"]').attributes("data-estado")).toBe("reconectar");
  });

  it("con el buzón conectado la tarjeta no está: el hogar no repite lo que ya funciona", async () => {
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="conectar-gmail"]').exists()).toBe(false);
  });

  // El server local también contesta 503 con `gmail_not_configured`, pero ahí la
  // credencial que falta es SUYA (`server/src/api/sync-route.ts`) y esta tarjeta
  // no la puede arreglar: no se ofrece una acción que no hace nada.
  it("un 503 sin causa —el server local— no ofrece conectar nada", async () => {
    endpoints.postSync.mockRejectedValue(new Error("gmail_not_configured"));
    const wrapper = await montar();

    await wrapper.get('[data-testid="sync-button-accion"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="sync-button-titulo"]').text()).toBe("Falta conectar Gmail");
    expect(wrapper.find('[data-testid="conectar-gmail"]').exists()).toBe(false);
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
 * Que una ruta falle no puede vaciar las otras tres, y por qué es un test y no
 * un comentario.
 *
 * El hogar cargaba sus pedidos con un `Promise.all`, así que el fallo de
 * `/api/sync/status` —una ruta secundaria— rechazaba también el
 * `/api/overview`, que es el que trae las cifras de verdad. Resultado: el
 * cartel rojo de desconexión arriba de cuatro tarjetas vacías, sobre un backend
 * que había contestado. Con `allSettled` cada pedido falla solo.
 */
describe("una ruta que falla no tumba a las demás", () => {
  it("el overview real se sigue dibujando aunque el estado del sync falle", async () => {
    endpoints.fetchSyncStatus.mockRejectedValue(new Error("Failed to fetch"));
    const wrapper = await montar();

    // La cifra que vino de verdad, dibujada.
    expect(wrapper.get('[data-testid="overview-card-cifra"]').text()).toBe("1840,25");
    // Y ningún cartel de desconexión: el overview contestó.
    expect(wrapper.find('[data-testid="resumen-error"]').exists()).toBe(false);
    // El chip del sync se dibuja igual, en su estado "nunca sincronizaste":
    // sin respuesta no se inventa una fecha (regla 2 de §2.3).
    expect(wrapper.find('[data-testid="chip-sync"]').exists()).toBe(true);
  });

  /**
   * Al revés: si el que falla es el overview, ESO sí es el cartel rojo. Ya no
   * hay un tercer estado entre "contestó" y "se cayó" — no queda ninguna ruta
   * sin portar (ver `docs/portado-completo.md`).
   */
  it("si falla el overview se enciende el cartel, y no se dibujan cifras viejas", async () => {
    endpoints.fetchOverview.mockRejectedValue(new Error("Failed to fetch"));
    const wrapper = await montar();

    expect(wrapper.get('[data-testid="resumen-error"]').text()).toContain("Failed to fetch");
    // Ni una cifra: sin overview no hay número que dibujar, y el rótulo dice
    // "Sin leer" en vez de un cero que alguien podría creer.
    expect(wrapper.find('[data-testid="overview-card-cifra"]').exists()).toBe(false);
    expect(wrapper.text()).toContain(ROTULO_SIN_LEER);
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

/**
 * N4 — la entrada al análisis del historial y el arreglo de R25.
 *
 * La tarjeta es una `OverviewCard` (criterio 11) y no una bifurcación antes del
 * hogar (criterio 9): P1 nunca bloqueó a nadie.
 */
describe("la entrada al análisis del historial (N4)", () => {
  it("es una OverviewCard del Resumen y lleva a la pantalla de alta", async () => {
    const wrapper = await montar();
    const entrada = wrapper.get('[data-testid="entrada-gastos-fijos"]');

    expect(entrada.attributes("href")).toBe("#/alta");
    expect(entrada.text()).toContain("Todavía no leí tus gastos fijos");
  });

  it("dice cuántos gastos fijos encontró", async () => {
    const wrapper = await montar();

    expect(wrapper.get('[data-testid="entrada-gastos-fijos"]').text()).toContain("1 gasto fijo");
  });

  it("con historial corto anuncia el freno de los tres meses (R33)", async () => {
    endpoints.fetchRecurring.mockResolvedValue(
      recurring({ propuestas: [], suficiente_historial: false, meses_de_historial: 1.4 })
    );
    const wrapper = await montar();

    expect(wrapper.get('[data-testid="entrada-gastos-fijos"]').text()).toContain("1,4 meses");
  });

  // §2.5, regla 4: lo que no tiene backend no se dibuja. Un server anterior a
  // N4 no tiene la ruta, y una tarjeta que lleva a una pantalla que va a fallar
  // es peor que ninguna tarjeta.
  it("si el server no tiene la ruta, la tarjeta no se dibuja y el hogar sigue en pie", async () => {
    endpoints.fetchRecurring.mockRejectedValue(new Error("404"));
    const wrapper = await montar();

    expect(wrapper.find('[data-testid="entrada-gastos-fijos"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="resumen-error"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("1840,25");
  });

  it("con el trabajo hecho y el perfil completo la tarjeta se va", async () => {
    endpoints.fetchRecurring.mockResolvedValue(recurring({ propuestas: [], candidatas: 0 }));
    const wrapper = await montar();

    expect(wrapper.find('[data-testid="entrada-gastos-fijos"]').exists()).toBe(false);
  });
});

/**
 * R25 — `colchonStatus` calcula `financiado = reservado >= objetivo`, y
 * `0 >= 0` es verdadero: un usuario nuevo veía el anillo lleno y en verde sin
 * haber reservado un peso. La respuesta del motor no cambia; lo que cambia es
 * que el panel distingue el objetivo en cero.
 */
describe("R25: un colchón sin objetivo no está financiado", () => {
  const SIN_OBJETIVO = { objetivo: 0, reservado: 0, financiado: true, faltante: 0 };

  it("dice 'Sin fijar' y no 'Financiado'", async () => {
    endpoints.fetchOverview.mockResolvedValue(overview({ buffer_status: SIN_OBJETIVO }));
    const wrapper = await montar();

    expect(wrapper.get('[data-testid="colchon-etiqueta"]').text()).toBe("Sin fijar");
    expect(wrapper.text()).not.toContain("Financiado");
  });

  it("no dibuja un porcentaje ni un 'falta 0,00', que se leerían como 'ya está'", async () => {
    endpoints.fetchOverview.mockResolvedValue(overview({ buffer_status: SIN_OBJETIVO }));
    const wrapper = await montar();
    const texto = wrapper.get('[data-testid="colchon-sin-fijar"]').text();

    expect(texto).toContain("Todavía no fijaste un objetivo");
    expect(texto).not.toContain("falta");
  });

  it("ofrece dónde fijarlo", async () => {
    endpoints.fetchOverview.mockResolvedValue(overview({ buffer_status: SIN_OBJETIVO }));
    const wrapper = await montar();

    expect(wrapper.get('[data-testid="colchon-sin-fijar"]').find("a").attributes("href")).toBe("#/alta");
  });

  it("con objetivo cumplido sigue diciendo Financiado: no se rompió el caso bueno", async () => {
    endpoints.fetchOverview.mockResolvedValue(
      overview({ buffer_status: { objetivo: 500, reservado: 500, financiado: true, faltante: 0 } })
    );
    const wrapper = await montar();

    expect(wrapper.get('[data-testid="colchon-etiqueta"]').text()).toBe("Financiado");
    expect(wrapper.text()).toContain("objetivo 500,00");
  });
});

/**
 * Wargaming del MVP (W6). `tarjetaStatus` rellena con cero un resumen cuyo
 * saldo no se pudo leer (`server/src/strategy/card.ts`: `statement.balance ?? 0`),
 * y la tarjeta del Resumen dibujaba ese cero con el peso de una cifra: un
 * resumen ilegible quedaba indistinguible de una tarjeta pagada. Es
 * exactamente lo que R6/X8/X11 prohíben — "todavía no sé" convertido en "no hay
 * nada"— y el dato honesto ya viene en la respuesta (`card.balance === null`),
 * que la misma pantalla usa bien en el calendario.
 */
describe("R6/X8/X11 — un saldo de tarjeta que no se pudo leer no es un cero", () => {
  it("dibuja 'Sin leer', no 0,00, cuando el resumen no trae saldo", async () => {
    endpoints.fetchOverview.mockResolvedValue(
      overview({
        card: { card_mask: null, balance: null, min_payment: null, issue_date: null, due_date: "2026-09-20" },
        card_status: {
          saldoCorte: 0,
          minimo: 0,
          fechaMaxima: "2026-09-20",
          saldoActualEstimado: 0,
          aTiempo: true,
          requeridoPorQuincena: 0,
        },
      })
    );
    const w = await montar();
    const tarjeta = w.findAll('[data-testid="overview-card"]').find((c) => c.text().includes("Tarjeta"));

    expect(tarjeta?.text()).toContain(ROTULO_SIN_LEER);
    expect(tarjeta?.text()).not.toContain("0,00");
  });
});

/**
 * Wargaming ronda 4, W31 — la clase de W20 en la pantalla principal.
 *
 * El rótulo *"actualizado hace X"* salía de `lastRefreshAt`, que es la hora del
 * **tick del reloj**, no la de la última lectura que salió bien. Con el backend
 * caído el reloj sigue latiendo cada 30 segundos, así que el Resumen decía
 * *"actualizado recién"* al lado del cartel rojo, sobre cifras de hace diez
 * minutos: el mismo *dato viejo con cara de dato fresco* que W20 cerró en la
 * tarjeta de avance de Preguntas, en la superficie que se mira todo el día.
 *
 * El rótulo dice **cuándo se leyó bien**. Nada más puede decir.
 */
describe("el rótulo de frescura no puede envejecer solo (W31)", () => {
  it("no dice 'recién' cuando el último refresco falló", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T12:00:00Z"));

    const padre = defineComponent({
      components: { Resumen },
      setup: () => ({ reloj: provideRefresh(0) }),
      template: "<Resumen />",
    });
    const wrapper = mount(padre);
    await flushPromises();
    expect(wrapper.get(".topr").text()).toContain("recien");

    // Diez minutos después el backend se cae y el reloj late igual.
    vi.setSystemTime(new Date("2026-09-03T12:10:00Z"));
    endpoints.fetchOverview.mockRejectedValue(new Error("Failed to fetch"));
    (wrapper.vm as unknown as { reloj: { refreshNow: () => void } }).reloj.refreshNow();
    await flushPromises();

    expect(wrapper.find('[data-testid="resumen-error"]').exists()).toBe(true);
    expect(wrapper.get(".topr").text()).toContain("hace 10 minutos");
    expect(wrapper.get(".topr").text()).not.toContain("recien");

    vi.useRealTimers();
  });
});
