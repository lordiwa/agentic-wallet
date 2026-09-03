/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { useSesion, type SesionVista } from "./useSesion";
import { marcarSinAuth, reiniciarSesion, setMotorAuth, type MotorAuth, type Usuario } from "../auth/sesion";

const ANA: Usuario = { uid: "u-1", email: "ana@ejemplo.test", nombre: "Ana" };

function motorFalso(entrar = vi.fn(async () => {})) {
  let avisar: ((u: Usuario | null) => void) | null = null;
  const motor: MotorAuth = {
    observar(alCambiar) {
      avisar = alCambiar;
      return () => {
        avisar = null;
      };
    },
    entrarConGoogle: entrar,
    salir: vi.fn(async () => avisar?.(null)),
    idToken: async () => null,
  };
  return { motor, notificar: (u: Usuario | null) => avisar?.(u) };
}

/** El composable necesita un scope vivo (`onScopeDispose`), así que se monta. */
function montar(): { sesion: SesionVista; desmontar: () => void } {
  let sesion!: SesionVista;
  const wrapper = mount(
    defineComponent({
      setup() {
        sesion = useSesion();
        return () => h("div");
      },
    })
  );
  return { sesion, desmontar: () => wrapper.unmount() };
}

beforeEach(() => {
  reiniciarSesion();
  vi.stubEnv("VITE_FIREBASE_API_KEY", "llave-de-prueba");
  vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "proyecto-de-prueba.firebaseapp.com");
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "proyecto-de-prueba");
});

afterEach(() => {
  reiniciarSesion();
  vi.unstubAllEnvs();
});

describe("useSesion", () => {
  it("con identidad en el build espera antes de decidir", () => {
    const { sesion } = montar();
    expect(sesion.configurado.value).toBe(true);
    expect(sesion.listo.value).toBe(false);
    expect(sesion.usuario.value).toBeNull();
  });

  it("sin identidad en el build no espera a nadie", () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    const { sesion } = montar();
    expect(sesion.configurado.value).toBe(false);
    // El panel local no tiene puerta de sesión: `listo` desde el arranque.
    expect(sesion.listo.value).toBe(true);
  });

  it("sigue los cambios del motor", async () => {
    const { motor, notificar } = motorFalso();
    setMotorAuth(motor);
    const { sesion } = montar();

    notificar(ANA);
    expect(sesion.listo.value).toBe(true);
    expect(sesion.usuario.value).toEqual(ANA);

    notificar(null);
    expect(sesion.usuario.value).toBeNull();
  });

  it("marcarSinAuth resuelve la espera con el motivo a la vista", () => {
    const { sesion } = montar();
    marcarSinAuth("No se pudo cargar el acceso con Google.");
    expect(sesion.listo.value).toBe(true);
    expect(sesion.error.value).toBe("No se pudo cargar el acceso con Google.");
  });

  it("entrar marca el intento en curso y lo libera al terminar", async () => {
    const { motor } = motorFalso();
    setMotorAuth(motor);
    const { sesion } = montar();

    const enCurso = sesion.entrar();
    expect(sesion.entrando.value).toBe(true);
    await enCurso;
    expect(sesion.entrando.value).toBe(false);
  });

  it("un login que falla no explota en el componente", async () => {
    const { motor } = motorFalso(
      vi.fn(async () => {
        throw new Error("Cerraste la ventana de Google antes de terminar.");
      })
    );
    setMotorAuth(motor);
    const { sesion } = montar();

    await expect(sesion.entrar()).resolves.toBeUndefined();
    expect(sesion.error.value).toBe("Cerraste la ventana de Google antes de terminar.");
    expect(sesion.entrando.value).toBe(false);
  });

  it("dos clicks seguidos no abren dos ventanas de Google", async () => {
    const entrar = vi.fn(async () => {});
    const { motor } = motorFalso(entrar);
    setMotorAuth(motor);
    const { sesion } = montar();

    const primero = sesion.entrar();
    await sesion.entrar();
    await primero;
    expect(entrar).toHaveBeenCalledTimes(1);
  });

  it("al desmontar deja de escuchar", () => {
    const { motor, notificar } = motorFalso();
    setMotorAuth(motor);
    const { sesion, desmontar } = montar();

    desmontar();
    notificar(ANA);
    expect(sesion.usuario.value).toBeNull();
  });
});
