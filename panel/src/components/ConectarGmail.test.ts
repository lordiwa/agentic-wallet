/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import { mount } from "@vue/test-utils";
import ConectarGmail from "./ConectarGmail.vue";
import type { Gmail } from "../composables/useGmail";
import { vistaGmail, type EntradaGmail, type EstadoGmail } from "../lib/gmail-estado";

const CONECTADO: EstadoGmail = {
  conectado: true,
  email: "persona@ejemplo.test",
  scopes: [],
  grantedAt: null,
  necesitaReconectar: false,
};

const DESCONECTADO: EstadoGmail = {
  conectado: false,
  email: null,
  scopes: [],
  grantedAt: null,
  necesitaReconectar: false,
};

/** Un ciclo de mentira: el componente sólo dibuja, así que alcanza con la vista
 * y los espías de las acciones. */
function gmailFalso(parcial: Partial<EntradaGmail> = {}): Gmail & { accionar: ReturnType<typeof vi.fn> } {
  const entrada: EntradaGmail = {
    estado: null,
    cargando: false,
    error: null,
    resultado: null,
    haySesion: true,
    configurado: true,
    ...parcial,
  };
  const accionar = vi.fn(async () => {});
  return {
    vista: computed(() => vistaGmail(entrada)),
    estado: ref(entrada.estado),
    refrescar: async () => {},
    conectar: async () => {},
    accionar,
  } as unknown as Gmail & { accionar: ReturnType<typeof vi.fn> };
}

function montar(parcial: Partial<EntradaGmail> = {}) {
  const gmail = gmailFalso(parcial);
  const wrapper = mount(ConectarGmail, { props: { gmail } });
  return { wrapper, gmail };
}

describe("ConectarGmail", () => {
  it("desconectado: muestra el boton primario de conectar", () => {
    const { wrapper } = montar({ estado: DESCONECTADO });

    expect(wrapper.get('[data-testid="conectar-gmail"]').attributes("data-estado")).toBe("desconectado");
    const boton = wrapper.get('[data-testid="conectar-gmail-accion"]');
    expect(boton.text()).toContain("Conectar Gmail");
    expect(boton.classes()).toContain("primario");
    expect(boton.attributes("disabled")).toBeUndefined();
  });

  it("el click delega en el ciclo, no decide nada por su cuenta", async () => {
    const { wrapper, gmail } = montar({ estado: DESCONECTADO });

    await wrapper.get('[data-testid="conectar-gmail-accion"]').trigger("click");

    expect(gmail.accionar).toHaveBeenCalledOnce();
  });

  it("conectado: muestra el correo y ofrece reconectar en secundario", () => {
    const { wrapper } = montar({ estado: CONECTADO });

    expect(wrapper.get('[data-testid="conectar-gmail-titulo"]').text()).toBe("Gmail conectado");
    expect(wrapper.get('[data-testid="conectar-gmail-detalle"]').text()).toContain("persona@ejemplo.test");
    const boton = wrapper.get('[data-testid="conectar-gmail-accion"]');
    expect(boton.text()).toContain("Reconectar");
    expect(boton.classes()).toContain("secundario");
  });

  it("necesitaReconectar: la accion pasa a ser la principal", () => {
    const { wrapper } = montar({ estado: { ...CONECTADO, necesitaReconectar: true } });

    expect(wrapper.get('[data-testid="conectar-gmail"]').attributes("data-estado")).toBe("reconectar");
    expect(wrapper.get('[data-testid="conectar-gmail-accion"]').classes()).toContain("primario");
  });

  it("cargando: el boton queda deshabilitado", () => {
    const { wrapper } = montar({ estado: DESCONECTADO, cargando: true });

    expect(wrapper.get('[data-testid="conectar-gmail-accion"]').attributes("disabled")).toBeDefined();
  });

  it("sin sesion: no hay boton que ofrecer", () => {
    const { wrapper } = montar({ haySesion: false });

    expect(wrapper.find('[data-testid="conectar-gmail-accion"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="conectar-gmail"]').attributes("data-estado")).toBe("sin-sesion");
  });

  it("sin configurar: tampoco hay boton", () => {
    const { wrapper } = montar({ configurado: false });

    expect(wrapper.find('[data-testid="conectar-gmail-accion"]').exists()).toBe(false);
  });

  it("el aviso de la vuelta se anuncia como status para el lector de pantalla", () => {
    const { wrapper } = montar({ estado: CONECTADO, resultado: "ok" });

    const aviso = wrapper.get('[data-testid="conectar-gmail-aviso"]');
    expect(aviso.text()).toContain("quedó conectado");
    expect(aviso.classes()).toContain("ok");
    expect(aviso.attributes("role")).toBe("status");
  });

  it("un resultado de falla se pinta en su tono", () => {
    const { wrapper } = montar({ estado: DESCONECTADO, resultado: "scope_insuficiente" });

    expect(wrapper.get('[data-testid="conectar-gmail-aviso"]').classes()).toContain("bad");
  });

  it("sin vuelta de Google no hay aviso", () => {
    const { wrapper } = montar({ estado: DESCONECTADO });

    expect(wrapper.find('[data-testid="conectar-gmail-aviso"]').exists()).toBe(false);
  });

  it("error: ofrece reintentar", () => {
    const { wrapper } = montar({ error: "gmailAuthStatus respondio 500" });

    expect(wrapper.get('[data-testid="conectar-gmail-accion"]').text()).toContain("Reintentar");
  });
});
