/** @vitest-environment jsdom */
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sobre, SobresResponse } from "../api/types";
import { formatoPlata } from "../lib/formato";
import Sobres from "./Sobres.vue";

/**
 * `ErrorDelMotor` va DENTRO del `vi.hoisted` junto a los mocks, y no como una
 * clase de arriba: `vi.mock` se iza al tope del archivo y una clase declarada
 * después todavía no existe cuando la fábrica corre. Tiene que estar porque la
 * vista la usa para distinguir un rechazo con nombre (`sobre_duplicado`) de una
 * caída — sin ella el `instanceof` sería siempre falso y el test verde estaría
 * midiendo el cartel genérico.
 */
const { endpoints, ErrorDelMotorFalso } = vi.hoisted(() => ({
  endpoints: {
    fetchSobres: vi.fn(),
    crearSobre: vi.fn(),
    ajustarSobre: vi.fn(),
  },
  ErrorDelMotorFalso: class ErrorDelMotorFalso extends Error {
    constructor(
      readonly codigo: string,
      readonly status: number
    ) {
      super(codigo);
    }
  },
}));

vi.mock("../api/endpoints", () => ({ ...endpoints, ErrorDelMotor: ErrorDelMotorFalso }));

function sobre(parcial: Partial<Sobre> & { id: string; nombre: string }): Sobre {
  return {
    monto: 0,
    objetivo: null,
    sistema: false,
    creado_en: null,
    actualizado_en: null,
    ...parcial,
  };
}

const COLCHON = sobre({ id: "colchon", nombre: "Emergencia", monto: 300, objetivo: 500, sistema: true });

function respuesta(overrides: Partial<SobresResponse> = {}): SobresResponse {
  const sobres = overrides.sobres ?? [COLCHON];
  return {
    sobres,
    total: sobres.reduce((suma, s) => suma + s.monto, 0),
    moneda: "USD",
    ...overrides,
  };
}

async function montar() {
  const wrapper = mount(Sobres);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  endpoints.fetchSobres.mockReset();
  endpoints.crearSobre.mockReset();
  endpoints.ajustarSobre.mockReset();
  endpoints.fetchSobres.mockResolvedValue(respuesta());
  endpoints.crearSobre.mockResolvedValue({ ok: true, sobre: sobre({ id: "viaje", nombre: "Viaje" }) });
  endpoints.ajustarSobre.mockResolvedValue({ ok: true, sobre: COLCHON });
});

describe("lo que se ve", () => {
  it("el colchon se dibuja como el sobre Emergencia, con su cifra", async () => {
    const wrapper = await montar();
    const tarjeta = wrapper.get('[data-testid="tarjeta-colchon"]');
    expect(tarjeta.text()).toContain("Emergencia");
    expect(wrapper.get('[data-testid="colchon-reservado"]').text()).toContain("300");
    // 300 de 500: el anillo dice 60 %, no "financiado".
    expect(tarjeta.text()).toContain("60%");
    expect(tarjeta.text()).toContain("parcialmente financiado");
  });

  it("dice en voz alta que es la misma plata que el Resumen descuenta", async () => {
    const wrapper = await montar();
    expect(wrapper.text()).toContain("el colchón");
    expect(wrapper.get('[data-testid="tarjeta-colchon"]').text()).toContain("El colchón es el piso");
  });

  it("R25: sin objetivo no se dibuja un porcentaje ni un anillo lleno", async () => {
    endpoints.fetchSobres.mockResolvedValue(
      respuesta({ sobres: [sobre({ id: "colchon", nombre: "Emergencia", monto: 300, sistema: true })] })
    );
    const wrapper = await montar();
    const tarjeta = wrapper.get('[data-testid="tarjeta-colchon"]');
    expect(tarjeta.text()).toContain("sin meta");
    expect(tarjeta.text()).not.toContain("%");
    expect(tarjeta.text()).toContain("sin fijar");
  });

  it("cada sobre muestra su monto, su meta y su barra", async () => {
    endpoints.fetchSobres.mockResolvedValue(
      respuesta({
        sobres: [
          COLCHON,
          sobre({ id: "flexiahorro", nombre: "FlexiAhorro", monto: 1105.73, objetivo: 2000 }),
          sobre({ id: "regalos", nombre: "Regalos", monto: 25 }),
        ],
      })
    );
    const wrapper = await montar();
    const filas = wrapper.findAll('[data-testid="sobre"]');
    expect(filas).toHaveLength(2);
    expect(filas[0]!.text()).toContain("FlexiAhorro");
    // Con `formatoPlata` y no con la cadena a mano: el separador de miles
    // depende del ICU que traiga el runtime, y un test que lo fije estaría
    // midiendo el entorno en vez de la pantalla.
    expect(filas[0]!.text()).toContain(formatoPlata(1105.73));
    expect(filas[0]!.text()).toContain(formatoPlata(2000));
    // Sin meta se dice, no se dibuja una barra llena.
    expect(filas[1]!.text()).toContain("sin meta");
    expect(filas[1]!.get(".fill").attributes("style")).toContain("width: 0%");
    expect(filas[0]!.get(".fill").attributes("style")).toContain("width: 55%");
  });

  it("el total apartado sale del motor, no de una suma del panel", async () => {
    endpoints.fetchSobres.mockResolvedValue(
      respuesta({ sobres: [COLCHON, sobre({ id: "viaje", nombre: "Viaje", monto: 100 })], total: 400 })
    );
    const wrapper = await montar();
    expect(wrapper.get('[data-testid="sobres-total"]').text()).toContain(formatoPlata(400));
  });

  it("sin sobres propios lo dice, y no muestra ninguno de ejemplo", async () => {
    const wrapper = await montar();
    expect(wrapper.get('[data-testid="sobres-vacio"]').text()).toContain("Todavía no creaste");
    expect(wrapper.findAll('[data-testid="sobre"]')).toHaveLength(0);
  });

  it("si el backend no responde se dice, no se dibuja un cero", async () => {
    endpoints.fetchSobres.mockRejectedValue(new Error("Failed to fetch"));
    const wrapper = await montar();
    expect(wrapper.get('[data-testid="sobres-error"]').text()).toContain("no respondió");
  });
});

describe("crear un sobre", () => {
  it("manda el nombre y vuelve a leer la lista", async () => {
    const wrapper = await montar();
    await wrapper.get("#sobre-nombre").setValue("FlexiAhorro");
    await wrapper.get("#sobre-monto").setValue("1.105,73");
    await wrapper.get('[data-testid="crear-sobre"]').trigger("submit");
    await flushPromises();

    expect(endpoints.crearSobre).toHaveBeenCalledWith({ nombre: "FlexiAhorro", monto: 1105.73 });
    // Dos lecturas: la del montaje y la de después de crear.
    expect(endpoints.fetchSobres).toHaveBeenCalledTimes(2);
  });

  it("sin monto NO manda un cero: el motor decide el default", async () => {
    const wrapper = await montar();
    await wrapper.get("#sobre-nombre").setValue("Regalos");
    await wrapper.get('[data-testid="crear-sobre"]').trigger("submit");
    await flushPromises();
    expect(endpoints.crearSobre).toHaveBeenCalledWith({ nombre: "Regalos" });
  });

  it("un monto que no es una cifra se rechaza acá y se dice", async () => {
    const wrapper = await montar();
    await wrapper.get("#sobre-nombre").setValue("Viaje");
    await wrapper.get("#sobre-monto").setValue("dos mil");
    await wrapper.get('[data-testid="crear-sobre"]').trigger("submit");
    await flushPromises();
    expect(endpoints.crearSobre).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="alta-error"]').text()).toContain("cifra");
  });

  it("el rechazo del motor se muestra con su motivo, no como un rojo generico", async () => {
    endpoints.crearSobre.mockRejectedValue(new ErrorDelMotorFalso("sobre_duplicado", 400));
    const wrapper = await montar();
    await wrapper.get("#sobre-nombre").setValue("Emergencia");
    await wrapper.get('[data-testid="crear-sobre"]').trigger("submit");
    await flushPromises();
    expect(wrapper.get('[data-testid="alta-error"]').text()).toContain("Ya tenés un sobre con ese nombre");
  });

  it("sin nombre no se llama al backend", async () => {
    const wrapper = await montar();
    await wrapper.get('[data-testid="crear-sobre"]').trigger("submit");
    await flushPromises();
    expect(endpoints.crearSobre).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="alta-error"]').text()).toContain("nombre");
  });
});

describe("ajustar un sobre", () => {
  it("un aporte al colchon viaja como aporte, no como monto", async () => {
    const wrapper = await montar();
    await wrapper.get('[data-testid="ajustar-colchon"]').trigger("click");
    await wrapper.get("#colchon-aporte").setValue("200");
    await wrapper.get("form.editor").trigger("submit");
    await flushPromises();
    expect(endpoints.ajustarSobre).toHaveBeenCalledWith("colchon", { aporte: 200 });
  });

  it("un retiro va en negativo, que es lo unico que el signo significa acá", async () => {
    const wrapper = await montar();
    await wrapper.get('[data-testid="ajustar-colchon"]').trigger("click");
    await wrapper.get("#colchon-aporte").setValue("-50");
    await wrapper.get("form.editor").trigger("submit");
    await flushPromises();
    expect(endpoints.ajustarSobre).toHaveBeenCalledWith("colchon", { aporte: -50 });
  });

  it("cambiar el objetivo lo manda, y no tocarlo no lo manda", async () => {
    const wrapper = await montar();
    await wrapper.get('[data-testid="ajustar-colchon"]').trigger("click");
    // El editor abre con la meta actual (500) ya escrita: guardarlo tal cual no
    // puede parecer un cambio.
    await wrapper.get("#colchon-aporte").setValue("10");
    await wrapper.get("form.editor").trigger("submit");
    await flushPromises();
    expect(endpoints.ajustarSobre).toHaveBeenCalledWith("colchon", { aporte: 10 });

    await wrapper.get('[data-testid="ajustar-colchon"]').trigger("click");
    await wrapper.get("#colchon-meta").setValue("800");
    await wrapper.get("form.editor").trigger("submit");
    await flushPromises();
    expect(endpoints.ajustarSobre).toHaveBeenLastCalledWith("colchon", { objetivo: 800 });
  });

  it("vaciar la meta la borra: manda null, que no es lo mismo que no tocarla", async () => {
    const wrapper = await montar();
    await wrapper.get('[data-testid="ajustar-colchon"]').trigger("click");
    await wrapper.get("#colchon-meta").setValue("");
    await wrapper.get("form.editor").trigger("submit");
    await flushPromises();
    expect(endpoints.ajustarSobre).toHaveBeenCalledWith("colchon", { objetivo: null });
  });

  it("guardar sin cambiar nada no llama al backend: lo dice", async () => {
    const wrapper = await montar();
    await wrapper.get('[data-testid="ajustar-colchon"]').trigger("click");
    await wrapper.get("form.editor").trigger("submit");
    await flushPromises();
    expect(endpoints.ajustarSobre).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="colchon-error"]').text()).toContain("No cambiaste nada");
  });

  it("el rechazo del motor al ajustar se muestra con su motivo", async () => {
    endpoints.ajustarSobre.mockRejectedValue(new ErrorDelMotorFalso("monto_negativo", 400));
    const wrapper = await montar();
    await wrapper.get('[data-testid="ajustar-colchon"]').trigger("click");
    await wrapper.get("#colchon-aporte").setValue("-9999");
    await wrapper.get("form.editor").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[data-testid="colchon-error"]').text()).toContain("más de lo que hay");
  });

  it("un sobre propio se puede renombrar; el editor del colchon no tiene ese campo", async () => {
    endpoints.fetchSobres.mockResolvedValue(
      respuesta({ sobres: [COLCHON, sobre({ id: "viaje", nombre: "Viaje", monto: 100 })] })
    );
    const wrapper = await montar();

    await wrapper.get('[data-testid="ajustar-colchon"]').trigger("click");
    expect(wrapper.find("#colchon-nombre").exists()).toBe(false);
    await wrapper.get('[data-testid="ajustar-colchon"]').trigger("click");

    await wrapper.get('[data-sobre="viaje"] .btn.qui').trigger("click");
    await wrapper.get("#viaje-nombre").setValue("Viaje largo");
    await wrapper.get('[data-sobre="viaje"] form.editor').trigger("submit");
    await flushPromises();
    expect(endpoints.ajustarSobre).toHaveBeenCalledWith("viaje", { nombre: "Viaje largo" });
  });
});
