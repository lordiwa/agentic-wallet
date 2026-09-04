/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import path from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AltaPerfil from "./AltaPerfil.vue";
import type { ProfileResponse, RecurringProposalRow, RecurringResponse } from "../api/types";

const { endpoints } = vi.hoisted(() => ({
  endpoints: {
    fetchProfile: vi.fn(),
    fetchRecurring: vi.fn(),
    postProfile: vi.fn(),
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
    ErrorNoPortado: class ErrorNoPortado extends Error {
      constructor(readonly ruta: string) {
        super(`no_portado: ${ruta}`);
        this.name = "ErrorNoPortado";
      }
    },
    esNoPortado: (err: unknown) => err instanceof Error && err.name === "ErrorNoPortado",
  },
}));

vi.mock("../api/endpoints", () => endpoints);

function propuesta(n: number, overrides: Partial<RecurringProposalRow> = {}): RecurringProposalRow {
  return {
    pattern: `servicio ficticio ${n}`,
    counterparty: `Servicio Ficticio ${n}`,
    monto_estimado: 20 * n,
    dia_tipico: 5,
    sample_size: 4,
    count: 4,
    total: 80 * n,
    last_ts: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function perfil(overrides: Partial<ProfileResponse> = {}): ProfileResponse {
  return {
    dias_pago: [],
    dia_de_pago_fijado: false,
    colchon_objetivo: 0,
    colchon_fijado: false,
    ...overrides,
  };
}

function analisis(overrides: Partial<RecurringResponse> = {}): RecurringResponse {
  return {
    propuestas: [propuesta(3), propuesta(2), propuesta(1)],
    candidatas: 3,
    en_la_cola: 0,
    meses_de_historial: 6.2,
    meses_minimos: 3,
    suficiente_historial: true,
    ...overrides,
  };
}

async function montar() {
  const wrapper = mount(AltaPerfil);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  window.location.hash = "";
  endpoints.fetchProfile.mockResolvedValue(perfil());
  endpoints.fetchRecurring.mockResolvedValue(analisis());
  endpoints.postProfile.mockResolvedValue({ ...perfil({ colchon_objetivo: 500, colchon_fijado: true }), ok: true, campos: [] });
  endpoints.postClassify.mockResolvedValue({
    ok: true,
    pattern: "servicio ficticio 3",
    counterparty: "Servicio Ficticio 3",
    category: "servicios",
    reclassified: 4,
    reclassified_this_month: 1,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("la pantalla dibuja el análisis del historial", () => {
  it("muestra una tarjeta por propuesta, en el orden que mandó el motor", async () => {
    const w = await montar();
    const tarjetas = w.findAll('[data-testid="recurring-card"]');

    expect(tarjetas).toHaveLength(3);
    expect(tarjetas[0].text()).toContain("Servicio Ficticio 3");
  });

  it("dice sobre cuánto historial se apoya", async () => {
    const w = await montar();

    expect(w.get('[data-testid="alta-alcance"]').text()).toContain("6,2 meses");
  });

  // H34: las que no entran al top 10 no se pierden, y la pantalla lo dice.
  it("dice cuántas candidatas quedaron en la cola cuando el recorte muerde", async () => {
    endpoints.fetchRecurring.mockResolvedValue(analisis({ candidatas: 37, en_la_cola: 27 }));
    const w = await montar();
    const texto = w.get('[data-testid="alta-alcance"]').text();

    expect(texto).toContain("37 candidatas");
    expect(texto).toContain("27");
    expect(texto).toContain("cola");
  });
});

describe("el freno de los tres meses (R33)", () => {
  it("con historial corto el análisis no se dibuja activo", async () => {
    endpoints.fetchRecurring.mockResolvedValue(
      analisis({ propuestas: [], suficiente_historial: false, meses_de_historial: 1.4, candidatas: 2 })
    );
    const w = await montar();

    expect(w.findAll('[data-testid="recurring-card"]')).toHaveLength(0);
    expect(w.find('[data-testid="alta-freno-caja"]').exists()).toBe(true);
  });

  it("dice cuánto lleva acumulado y cuánto hace falta", async () => {
    endpoints.fetchRecurring.mockResolvedValue(
      analisis({ propuestas: [], suficiente_historial: false, meses_de_historial: 1.4, candidatas: 2 })
    );
    const w = await montar();
    const freno = w.get('[data-testid="alta-freno"]').text();

    expect(freno).toContain("1,4 meses");
    expect(freno).toContain("3 meses");
  });

  it("los dos campos del perfil se siguen pudiendo escribir: no dependen del historial", async () => {
    endpoints.fetchRecurring.mockResolvedValue(
      analisis({ propuestas: [], suficiente_historial: false, meses_de_historial: 1 })
    );
    const w = await montar();

    expect(w.get('[data-testid="campo-dias-pago"]').attributes("disabled")).toBeUndefined();
    expect(w.get('[data-testid="campo-colchon"]').attributes("disabled")).toBeUndefined();
  });
});

describe("nada se guarda sin confirmación explícita (criterio 4)", () => {
  it("cargar la pantalla no escribe nada", async () => {
    await montar();

    expect(endpoints.postClassify).not.toHaveBeenCalled();
    expect(endpoints.postProfile).not.toHaveBeenCalled();
  });

  it("confirmar una propuesta escribe UNA regla, con el mismo escritor de la cola", async () => {
    const w = await montar();
    const primera = w.findAll('[data-testid="recurring-card"]')[0];
    await primera.get('[data-testid="recurring-selector"]').setValue("servicios");
    await primera.get('[data-testid="recurring-confirmar"]').trigger("click");
    await flushPromises();

    expect(endpoints.postClassify).toHaveBeenCalledTimes(1);
    expect(endpoints.postClassify).toHaveBeenCalledWith("Servicio Ficticio 3", "servicios");
  });

  it("la propuesta confirmada se va de la lista y la pantalla dice qué movió", async () => {
    const w = await montar();
    const primera = w.findAll('[data-testid="recurring-card"]')[0];
    await primera.get('[data-testid="recurring-selector"]').setValue("servicios");
    await primera.get('[data-testid="recurring-confirmar"]').trigger("click");
    await flushPromises();

    expect(w.findAll('[data-testid="recurring-card"]')).toHaveLength(2);
    expect(w.get('[data-testid="alta-efecto"]').text()).toContain("4 movimientos");
  });

  it("descartar NO escribe: saca la propuesta y lo dice", async () => {
    const w = await montar();
    await w.findAll('[data-testid="recurring-card"]')[0].get('[data-testid="recurring-descartar"]').trigger("click");
    await flushPromises();

    expect(endpoints.postClassify).not.toHaveBeenCalled();
    expect(w.findAll('[data-testid="recurring-card"]')).toHaveLength(2);
    expect(w.get('[data-testid="alta-efecto"]').text()).toContain("No se guardó nada");
  });

  it("si el motor rechaza, la propuesta se queda y se muestra el motivo", async () => {
    endpoints.postClassify.mockRejectedValue(new endpoints.ErrorDelMotor("counterparty_not_found", 400));
    const w = await montar();
    const primera = w.findAll('[data-testid="recurring-card"]')[0];
    await primera.get('[data-testid="recurring-selector"]').setValue("servicios");
    await primera.get('[data-testid="recurring-confirmar"]').trigger("click");
    await flushPromises();

    expect(w.findAll('[data-testid="recurring-card"]')).toHaveLength(3);
    expect(w.get('[data-testid="alta-efecto"]').text()).toContain("no encontró esa contraparte");
  });
});

describe("los dos campos del perfil (criterio 6)", () => {
  it("arrancan vacíos cuando nunca se fijó nada — nada precargado", async () => {
    const w = await montar();

    expect((w.get('[data-testid="campo-dias-pago"]').element as HTMLInputElement).value).toBe("");
    expect((w.get('[data-testid="campo-colchon"]').element as HTMLInputElement).value).toBe("");
  });

  // R25: un colchón en cero es SIN FIJAR, así que el campo no muestra "0".
  it("un colchón en cero no se dibuja como un 0 escrito", async () => {
    endpoints.fetchProfile.mockResolvedValue(perfil({ colchon_objetivo: 0, colchon_fijado: false }));
    const w = await montar();

    expect((w.get('[data-testid="campo-colchon"]').element as HTMLInputElement).value).toBe("");
    expect(w.get('[data-testid="alta-estado-perfil"]').text()).toContain("sin fijar");
  });

  it("arrancan con lo que ya está guardado, que el usuario confirmó alguna vez", async () => {
    endpoints.fetchProfile.mockResolvedValue(
      perfil({ dias_pago: ["15-15", "30-30"], dia_de_pago_fijado: true, colchon_objetivo: 500, colchon_fijado: true })
    );
    const w = await montar();

    expect((w.get('[data-testid="campo-dias-pago"]').element as HTMLInputElement).value).toBe("15-15, 30-30");
    // Con la coma puesta: es la forma que `parsePlata` vuelve a leer sin dos
    // lecturas posibles (W10).
    expect((w.get('[data-testid="campo-colchon"]').element as HTMLInputElement).value).toBe("500,00");
  });

  /**
   * Wargaming ronda 2 (W10): lo que la pantalla precarga tiene que volver a
   * entrar como lo mismo. Con `String()` un colchón de 12,345 se dibujaba
   * "12.345" y se guardaba como doce mil trescientos cuarenta y cinco.
   */
  it("la cifra precargada vuelve a guardarse como la misma cifra", async () => {
    endpoints.fetchProfile.mockResolvedValue(perfil({ colchon_objetivo: 1500, colchon_fijado: true }));
    const w = await montar();

    await w.get('[data-testid="alta-guardar-y-seguir"]').trigger("click");
    await flushPromises();

    expect(endpoints.postProfile).toHaveBeenCalledWith(expect.objectContaining({ colchonObjetivo: 1500 }));
  });

  it("guarda los dos campos y manda los días separados como los escribió el usuario", async () => {
    const w = await montar();
    await w.get('[data-testid="campo-dias-pago"]').setValue("15, 30");
    await w.get('[data-testid="campo-colchon"]').setValue("500");
    await w.get('[data-testid="alta-guardar-y-seguir"]').trigger("click");
    await flushPromises();

    expect(endpoints.postProfile).toHaveBeenCalledWith({ diasPago: ["15", "30"], colchonObjetivo: 500 });
  });

  it("un campo vacío no se manda: vacío es 'no lo toqué', no 'ponelo en cero'", async () => {
    const w = await montar();
    await w.get('[data-testid="campo-colchon"]').setValue("300");
    await w.get('[data-testid="alta-guardar-y-seguir"]').trigger("click");
    await flushPromises();

    expect(endpoints.postProfile).toHaveBeenCalledWith({ colchonObjetivo: 300 });
  });

  it("acepta la coma decimal, que es como se escribe la plata en es", async () => {
    const w = await montar();
    await w.get('[data-testid="campo-colchon"]').setValue("500,50");
    await w.get('[data-testid="alta-guardar-y-seguir"]').trigger("click");
    await flushPromises();

    expect(endpoints.postProfile).toHaveBeenCalledWith({ colchonObjetivo: 500.5 });
  });

  /**
   * Wargaming del MVP (W3). El panel imprime la plata con `formatoPlata`, o
   * sea punto de miles y coma decimal: "1.234,00". Copiar esa cifra al campo
   * —que es lo más natural del mundo, está impresa dos bloques más abajo— tiene
   * que guardar 1234, no perderse.
   */
  it("acepta la cifra tal como el propio panel la imprime, con punto de miles", async () => {
    const w = await montar();
    await w.get('[data-testid="campo-colchon"]').setValue("1.234,00");
    await w.get('[data-testid="alta-guardar-y-seguir"]').trigger("click");
    await flushPromises();

    expect(endpoints.postProfile).toHaveBeenCalledWith({ colchonObjetivo: 1234 });
  });

  /**
   * Wargaming del MVP (W3), la mitad grave. Un texto que no es una cifra se
   * caía del patch **sin decir nada** y el botón navegaba igual: el usuario
   * escribía su colchón, pulsaba "Guardar y seguir" y aterrizaba en la cola
   * creyendo que lo había guardado. Un campo que no se entiende se dice; no se
   * tira.
   */
  it("no tira en silencio un colchón que no se entiende, y no navega", async () => {
    const w = await montar();
    await w.get('[data-testid="campo-colchon"]').setValue("no me acuerdo");
    await w.get('[data-testid="alta-guardar-y-seguir"]').trigger("click");
    await flushPromises();

    expect(endpoints.postProfile).not.toHaveBeenCalled();
    expect(w.get('[data-testid="alta-error-perfil"]').text()).toContain("colchón");
    expect(window.location.hash).not.toContain("preguntas");
  });

  /** Un día de pago válido no se guarda a medias porque el otro campo falló. */
  it("tampoco guarda a medias: si un campo no se entiende, no se manda ninguno", async () => {
    const w = await montar();
    await w.get('[data-testid="campo-dias-pago"]').setValue("15");
    await w.get('[data-testid="campo-colchon"]').setValue("abc");
    await w.get('[data-testid="alta-guardar-y-seguir"]').trigger("click");
    await flushPromises();

    expect(endpoints.postProfile).not.toHaveBeenCalled();
  });

  /** `Number()` acepta literales que nadie escribiría como plata. */
  it("no acepta literales de programador como cifra de plata", async () => {
    const w = await montar();
    await w.get('[data-testid="campo-colchon"]').setValue("0x10");
    await w.get('[data-testid="alta-guardar-y-seguir"]').trigger("click");
    await flushPromises();

    expect(endpoints.postProfile).not.toHaveBeenCalled();
  });
});

describe("el flujo termina en la cola (criterio 8)", () => {
  it("hay UN solo botón de cierre, y dice Guardar y seguir", async () => {
    const w = await montar();
    const botones = w.findAll("button").filter((boton) => boton.text().includes("Guardar"));

    expect(botones).toHaveLength(1);
    expect(botones[0].text()).toBe("Guardar y seguir");
  });

  it("guarda y va a la cola, sin pantalla intermedia", async () => {
    const w = await montar();
    await w.get('[data-testid="campo-colchon"]').setValue("500");
    await w.get('[data-testid="alta-guardar-y-seguir"]').trigger("click");
    await flushPromises();

    expect(window.location.hash).toBe("#/preguntas?pestana=que-es");
  });

  it("sin nada escrito igual lleva a la cola, y no llama al server de más", async () => {
    const w = await montar();
    await w.get('[data-testid="alta-guardar-y-seguir"]').trigger("click");
    await flushPromises();

    expect(endpoints.postProfile).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/preguntas?pestana=que-es");
  });

  it("si el motor rechaza un campo NO navega: muestra el motivo y deja corregir", async () => {
    endpoints.postProfile.mockRejectedValue(new endpoints.ErrorDelMotor("dias_pago_invalidos", 400));
    const w = await montar();
    await w.get('[data-testid="campo-dias-pago"]').setValue("quincena");
    await w.get('[data-testid="alta-guardar-y-seguir"]').trigger("click");
    await flushPromises();

    expect(window.location.hash).not.toBe("#/preguntas?pestana=que-es");
    expect(w.get('[data-testid="alta-error-perfil"]').text()).toContain("no se puede leer");
  });

  it("se puede saltar al hogar sin escribir nada: P1 no bloquea", async () => {
    const w = await montar();

    expect(w.get('[data-testid="alta-saltar"]').attributes("href")).toBe("#/resumen");
  });
});

describe("réplica del design system", () => {
  const fuente = readFileSync(path.resolve(__dirname, "AltaPerfil.vue"), "utf8");

  // §2.5, criterio 1: ningún hex fuera de tokens.css.
  it("no escribe un solo color: todo sale de los tokens", () => {
    expect(fuente).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  // El recorte de p1 mantiene su rejilla de dos columnas.
  it("conserva la rejilla de dos columnas de p1-alta-perfil.html", () => {
    expect(fuente).toContain("grid-template-columns: 1fr 1.25fr");
  });

  // La verificación en un teléfono real no se puede hacer desde el server (no
  // hay navegador): lo que sí se puede es que el diseño chico no desaparezca
  // sin que nadie se entere.
  it("mantiene el diseño chico: en una columna por debajo de 900px", () => {
    expect(fuente).toContain("@media (max-width: 900px)");
  });
});

describe("una ruta que este backend todavía no sirve se dice distinto que una caída", () => {
  it("no enciende el cartel de desconexión ni dibuja el formulario vacío", async () => {
    endpoints.fetchProfile.mockRejectedValue(new endpoints.ErrorNoPortado("/api/onboarding/profile"));
    const w = await montar();

    expect(w.find('[data-testid="alta-error"]').exists()).toBe(false);
    expect(w.get('[data-testid="pendiente-alta"]').text()).toContain("No es un error");
    expect(w.find('[data-testid="alta-perfil"]').exists()).toBe(false);
  });
});
