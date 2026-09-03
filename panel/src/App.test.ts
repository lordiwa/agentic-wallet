/** @vitest-environment jsdom */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.vue";
import { API_BASE_STORAGE_KEY, setAccessToken } from "./api/base";
import type { HealthResponse } from "./api/client";
import { marcarSinAuth, reiniciarSesion, setMotorAuth, type MotorAuth, type Usuario } from "./auth/sesion";

function stubHealth(body: HealthResponse) {
  const fake = vi.fn(async (_url: string) => ({ ok: true, json: async () => body }));
  vi.stubGlobal("fetch", fake);
  return fake;
}

async function montar() {
  const wrapper = mount(App);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  reiniciarSesion();
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  reiniciarSesion();
});

describe("el andamio de N0", () => {
  it("el chip está en la barra pase lo que pase", async () => {
    stubHealth({ status: "ok", auth_required: false, authenticated: true });
    const wrapper = await montar();
    expect(wrapper.find(".barra [data-testid='backend-chip']").exists()).toBe(true);
  });

  it("pide la llave cuando el server la pide y este navegador no la tiene", async () => {
    stubHealth({ status: "ok", auth_required: true, authenticated: false });
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="acceso-llave"]').exists()).toBe(true);
    // Y el chip sigue arriba: un ?api= hostil se puede rechazar ANTES de
    // escribir la llave.
    expect(wrapper.find(".barra [data-testid='backend-chip']").exists()).toBe(true);
  });

  it("no pide llave si el server no la pide", async () => {
    stubHealth({ status: "ok", auth_required: false, authenticated: true });
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="acceso-llave"]').exists()).toBe(false);
  });

  it("no pide llave si la que hay ya sirve", async () => {
    setAccessToken("la-que-anda");
    stubHealth({ status: "ok", auth_required: true, authenticated: true });
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="acceso-llave"]').exists()).toBe(false);
  });

  it("un backend ajeno no manda a la pantalla de llave: el problema es otro", async () => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, "https://host-ajeno.example");
    stubHealth({ status: "ok", auth_required: true, authenticated: false });
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="acceso-llave"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="backend-chip-tag"]').text()).toBe("No autorizado");
  });

  it("un server caído tampoco manda a la pantalla de llave", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const wrapper = await montar();
    expect(wrapper.find('[data-testid="acceso-llave"]').exists()).toBe(false);
  });
});

/**
 * La puerta de sesión: sólo existe en los builds con identidad, y va antes que
 * la de la llave. Los tests de arriba corren sin `VITE_FIREBASE_*` — o sea que
 * ya prueban lo primero: el panel local no cambió.
 */
describe("la puerta de Google", () => {
  const ANA: Usuario = { uid: "u-1", email: "ana@ejemplo.test", nombre: "Ana" };

  function conIdentidad(): void {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "llave-de-prueba");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "proyecto-de-prueba.firebaseapp.com");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "proyecto-de-prueba");
  }

  function motorFalso() {
    let avisar: ((u: Usuario | null) => void) | null = null;
    const motor: MotorAuth = {
      observar(alCambiar) {
        avisar = alCambiar;
        return () => {
          avisar = null;
        };
      },
      entrarConGoogle: async () => {},
      salir: async () => avisar?.(null),
      idToken: async () => (avisar === null ? null : "id-token-de-prueba"),
    };
    return { motor, notificar: (u: Usuario | null) => avisar?.(u) };
  }

  it("mientras la sesión no está resuelta no se dibuja ninguna puerta", async () => {
    conIdentidad();
    stubHealth({ status: "ok", auth_required: true, authenticated: false });
    setMotorAuth(motorFalso().motor);

    const wrapper = await montar();
    expect(wrapper.find('[data-testid="app-esperando-sesion"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="entrar-google"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="acceso-llave"]').exists()).toBe(false);
  });

  it("sin sesión se pide entrar con Google, no la llave", async () => {
    conIdentidad();
    stubHealth({ status: "ok", auth_required: true, authenticated: false });
    const { motor, notificar } = motorFalso();
    setMotorAuth(motor);

    const wrapper = await montar();
    notificar(null);
    await flushPromises();

    expect(wrapper.find('[data-testid="entrar-google"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="acceso-llave"]').exists()).toBe(false);
    // El chip de backend no se esconde ni acá: un ?api= hostil se rechaza antes
    // de entrar, igual que en la puerta de la llave.
    expect(wrapper.find(".barra [data-testid='backend-chip']").exists()).toBe(true);
  });

  it("con sesión se entra al panel y la cuenta queda a la vista", async () => {
    conIdentidad();
    stubHealth({ status: "ok", auth_required: false, authenticated: true });
    const { motor, notificar } = motorFalso();
    setMotorAuth(motor);

    const wrapper = await montar();
    notificar(ANA);
    await flushPromises();

    expect(wrapper.find('[data-testid="entrar-google"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="sesion-chip"]').text()).toContain("ana@ejemplo.test");
  });

  it("si el acceso con Google no se pudo cargar, la puerta lo dice", async () => {
    conIdentidad();
    stubHealth({ status: "ok", auth_required: false, authenticated: true });

    const wrapper = await montar();
    marcarSinAuth("No se pudo cargar el acceso con Google. Recargá la página.");
    await flushPromises();

    expect(wrapper.get('[data-testid="entrar-error"]').text()).toContain("No se pudo cargar");
  });

  it("se puede mirar la demostración sin entrar", async () => {
    conIdentidad();
    vi.stubEnv("VITE_API_BASE_URL", "demo");
    stubHealth({ status: "ok", auth_required: false, authenticated: true });
    const { motor, notificar } = motorFalso();
    setMotorAuth(motor);

    const wrapper = await montar();
    notificar(null);
    await flushPromises();

    await wrapper.get('[data-testid="entrar-demo"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="entrar-google"]').exists()).toBe(false);
    // Sin sesión: el panel se ve, pero no hay cuenta que mostrar.
    expect(wrapper.find('[data-testid="sesion-chip"]').exists()).toBe(false);
  });
});
