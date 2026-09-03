/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import { mount } from "@vue/test-utils";
import EntrarConGoogle from "./EntrarConGoogle.vue";
import type { SesionVista } from "../composables/useSesion";

/** Una sesión de mentira: la pantalla sólo dibuja y avisa. */
function sesionFalsa(parcial: Partial<{ error: string | null; entrando: boolean }> = {}): SesionVista & {
  entrar: ReturnType<typeof vi.fn>;
} {
  const entrar = vi.fn(async () => {});
  return {
    usuario: ref(null),
    listo: ref(true),
    error: ref(parcial.error ?? null),
    entrando: ref(parcial.entrando ?? false),
    configurado: computed(() => true),
    entrar,
    salir: vi.fn(async () => {}),
  } as unknown as SesionVista & { entrar: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe("EntrarConGoogle", () => {
  it("el botón llama a entrar", async () => {
    const sesion = sesionFalsa();
    const wrapper = mount(EntrarConGoogle, { props: { sesion } });

    await wrapper.get('[data-testid="entrar-google"]').trigger("click");
    expect(sesion.entrar).toHaveBeenCalledTimes(1);
  });

  it("mientras entra, el botón queda deshabilitado y lo dice", () => {
    const wrapper = mount(EntrarConGoogle, { props: { sesion: sesionFalsa({ entrando: true }) } });
    const boton = wrapper.get('[data-testid="entrar-google"]');

    expect(boton.attributes("disabled")).toBeDefined();
    expect(boton.text()).toContain("Abriendo Google");
  });

  it("un login que falló muestra el motivo", () => {
    const wrapper = mount(EntrarConGoogle, {
      props: { sesion: sesionFalsa({ error: "Cerraste la ventana de Google antes de terminar." }) },
    });
    expect(wrapper.get('[data-testid="entrar-error"]').text()).toContain("Cerraste la ventana");
  });

  it("sin error no hay cartel de error", () => {
    const wrapper = mount(EntrarConGoogle, { props: { sesion: sesionFalsa() } });
    expect(wrapper.find('[data-testid="entrar-error"]').exists()).toBe(false);
  });

  it("dice que entrar no da acceso al correo", () => {
    const wrapper = mount(EntrarConGoogle, { props: { sesion: sesionFalsa() } });
    // La promesa de la pantalla: identidad ahora, permiso de Gmail después.
    expect(wrapper.text()).toContain("Entrar no da acceso a tu correo");
  });

  it("la salida al modo demostración sólo existe en el sitio publicado", () => {
    const sinDemo = mount(EntrarConGoogle, { props: { sesion: sesionFalsa() } });
    expect(sinDemo.find('[data-testid="entrar-demo"]').exists()).toBe(false);

    vi.stubEnv("VITE_API_BASE_URL", "demo");
    const conDemo = mount(EntrarConGoogle, { props: { sesion: sesionFalsa() } });
    expect(conDemo.find('[data-testid="entrar-demo"]').exists()).toBe(true);
  });

  it("mirar la demostración se avisa hacia arriba, no se decide acá", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "demo");
    const wrapper = mount(EntrarConGoogle, { props: { sesion: sesionFalsa() } });

    await wrapper.get('[data-testid="entrar-demo"]').trigger("click");
    expect(wrapper.emitted("demo")).toHaveLength(1);
  });
});
