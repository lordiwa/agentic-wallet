/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import { mount } from "@vue/test-utils";
import SesionChip from "./SesionChip.vue";
import type { SesionVista } from "../composables/useSesion";
import type { Usuario } from "../auth/sesion";

function sesionFalsa(usuario: Usuario | null): SesionVista & { salir: ReturnType<typeof vi.fn> } {
  return {
    usuario: ref(usuario),
    listo: ref(true),
    error: ref(null),
    entrando: ref(false),
    configurado: computed(() => true),
    entrar: vi.fn(async () => {}),
    salir: vi.fn(async () => {}),
  } as unknown as SesionVista & { salir: ReturnType<typeof vi.fn> };
}

describe("SesionChip", () => {
  it("sin sesión no dibuja nada", () => {
    const wrapper = mount(SesionChip, { props: { sesion: sesionFalsa(null) } });
    expect(wrapper.find('[data-testid="sesion-chip"]').exists()).toBe(false);
  });

  it("muestra la dirección de la cuenta", () => {
    const wrapper = mount(SesionChip, {
      props: { sesion: sesionFalsa({ uid: "u-1", email: "ana@ejemplo.test", nombre: "Ana" }) },
    });
    expect(wrapper.get('[data-testid="sesion-chip"]').text()).toContain("ana@ejemplo.test");
  });

  it("sin dirección cae en el nombre", () => {
    const wrapper = mount(SesionChip, {
      props: { sesion: sesionFalsa({ uid: "u-1", email: null, nombre: "Ana" }) },
    });
    expect(wrapper.get('[data-testid="sesion-chip"]').text()).toContain("Ana");
  });

  it("salir llama a salir", async () => {
    const sesion = sesionFalsa({ uid: "u-1", email: "ana@ejemplo.test", nombre: "Ana" });
    const wrapper = mount(SesionChip, { props: { sesion } });

    await wrapper.get('[data-testid="sesion-salir"]').trigger("click");
    expect(sesion.salir).toHaveBeenCalledTimes(1);
  });
});
