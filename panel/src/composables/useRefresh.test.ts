/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { DEFAULT_REFRESH_MS, SYNC_REFRESH_MS, provideRefresh, useRefresh, type RefreshState } from "./useRefresh";

/** Monta un provider y devuelve el estado, con el reloj bajo control. */
function montarReloj(intervalMs = DEFAULT_REFRESH_MS) {
  let estado!: RefreshState;
  const Hijo = defineComponent({
    setup() {
      estado = useRefresh();
      return () => h("i");
    },
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        provideRefresh(intervalMs);
        return () => h(Hijo);
      },
    })
  );
  return { wrapper, estado: () => estado };
}

function ocultarPestana(oculta: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: oculta });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("el reloj compartido", () => {
  it("late solo, al ritmo que se le pidió", () => {
    const { estado } = montarReloj(1000);
    expect(estado().tick.value).toBe(0);

    vi.advanceTimersByTime(3000);
    expect(estado().tick.value).toBe(3);
  });

  it("refreshNow adelanta un tick sin esperar al intervalo", () => {
    const { estado } = montarReloj(1000);
    estado().refreshNow();
    expect(estado().tick.value).toBe(1);
    expect(estado().lastRefreshAt.value).not.toBeNull();
  });

  it("con la pestaña oculta se para, y al volver se pone al día antes de reanudar", () => {
    const { estado } = montarReloj(1000);

    ocultarPestana(true);
    vi.advanceTimersByTime(5000);
    expect(estado().tick.value).toBe(0);

    ocultarPestana(false);
    // El tick de "ponerse al día" es inmediato, no dentro de un intervalo.
    expect(estado().tick.value).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(estado().tick.value).toBe(2);
  });

  it("cambiar el ritmo vale ya, no después del tick que estaba agendado", () => {
    const { estado } = montarReloj(DEFAULT_REFRESH_MS);

    estado().setIntervalMs(SYNC_REFRESH_MS);
    vi.advanceTimersByTime(SYNC_REFRESH_MS * 2);
    expect(estado().tick.value).toBe(2);

    estado().setIntervalMs(DEFAULT_REFRESH_MS);
    vi.advanceTimersByTime(SYNC_REFRESH_MS * 2);
    expect(estado().tick.value).toBe(2);
  });

  it("al desmontar deja de latir: una pestaña cerrada no le pega a la API", () => {
    const { wrapper, estado } = montarReloj(1000);
    vi.advanceTimersByTime(1000);
    const antes = estado().tick.value;

    wrapper.unmount();
    vi.advanceTimersByTime(5000);
    expect(estado().tick.value).toBe(antes);
  });

  it("fuera del provider es inerte: una tarjeta sola no arranca un reloj", () => {
    let estado!: RefreshState;
    mount(
      defineComponent({
        setup() {
          estado = useRefresh();
          return () => h("i");
        },
      })
    );

    vi.advanceTimersByTime(DEFAULT_REFRESH_MS * 3);
    expect(estado.tick.value).toBe(0);
  });
});
