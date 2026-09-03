/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cerrarSesion,
  entrarConGoogle,
  estadoSesion,
  idTokenActual,
  marcarSinAuth,
  observarSesion,
  reiniciarSesion,
  setMotorAuth,
  type MotorAuth,
  type Usuario,
} from "./sesion";

const ANA: Usuario = { uid: "u-1", email: "ana@ejemplo.test", nombre: "Ana" };

/** Un motor de mentira: notifica cuando el test quiere, no cuando Firebase
 * puede. Es todo lo que hace falta para probar el estado. */
function motorFalso(overrides: Partial<MotorAuth> = {}) {
  let avisar: ((u: Usuario | null) => void) | null = null;
  const motor: MotorAuth = {
    observar(alCambiar) {
      avisar = alCambiar;
      return () => {
        avisar = null;
      };
    },
    entrarConGoogle: vi.fn(async () => {
      avisar?.(ANA);
    }),
    salir: vi.fn(async () => {
      avisar?.(null);
    }),
    idToken: vi.fn(async () => (avisar === null ? null : "id-token-de-prueba")),
    ...overrides,
  };
  return { motor, notificar: (u: Usuario | null) => avisar?.(u), sigueEscuchando: () => avisar !== null };
}

beforeEach(() => {
  reiniciarSesion();
});
afterEach(() => {
  reiniciarSesion();
});

describe("el estado de la sesión", () => {
  it("arranca sin resolver: ni entrado ni afuera", () => {
    expect(estadoSesion()).toEqual({ usuario: null, listo: false, error: null });
  });

  it("queda listo recién cuando el motor dice quién hay", () => {
    const { motor, notificar } = motorFalso();
    setMotorAuth(motor);
    expect(estadoSesion().listo).toBe(false);

    notificar(null);
    expect(estadoSesion()).toEqual({ usuario: null, listo: true, error: null });
  });

  it("un usuario notificado llega a los oyentes", () => {
    const vistos: (Usuario | null)[] = [];
    observarSesion((e) => vistos.push(e.usuario));
    const { motor, notificar } = motorFalso();
    setMotorAuth(motor);
    notificar(ANA);

    // El primero es el estado de entrada (sin resolver), el segundo el cambio.
    expect(vistos).toEqual([null, ANA]);
  });

  it("quien se suscribe tarde recibe el estado que ya había", () => {
    const { motor, notificar } = motorFalso();
    setMotorAuth(motor);
    notificar(ANA);

    const vistos: (Usuario | null)[] = [];
    observarSesion((e) => vistos.push(e.usuario));
    expect(vistos).toEqual([ANA]);
  });

  it("desuscribirse deja de recibir", () => {
    const vistos: (Usuario | null)[] = [];
    const parar = observarSesion((e) => vistos.push(e.usuario));
    const { motor, notificar } = motorFalso();
    setMotorAuth(motor);
    parar();
    notificar(ANA);
    expect(vistos).toEqual([null]);
  });

  it("registrar otro motor suelta el anterior", () => {
    const primero = motorFalso();
    setMotorAuth(primero.motor);
    setMotorAuth(motorFalso().motor);
    expect(primero.sigueEscuchando()).toBe(false);
  });

  it("marcarSinAuth resuelve la espera sin sesión", () => {
    marcarSinAuth("el SDK no cargó");
    expect(estadoSesion()).toEqual({ usuario: null, listo: true, error: "el SDK no cargó" });
  });
});

describe("entrar y salir", () => {
  it("entrar deja el usuario del motor", async () => {
    const { motor } = motorFalso();
    setMotorAuth(motor);
    await entrarConGoogle();
    expect(estadoSesion().usuario).toEqual(ANA);
  });

  it("un login que falla deja el motivo y no inventa sesión", async () => {
    const { motor } = motorFalso({
      entrarConGoogle: vi.fn(async () => {
        throw new Error("Cerraste la ventana de Google antes de terminar.");
      }),
    });
    setMotorAuth(motor);

    await expect(entrarConGoogle()).rejects.toThrow(/ventana de Google/);
    expect(estadoSesion().usuario).toBeNull();
    expect(estadoSesion().error).toBe("Cerraste la ventana de Google antes de terminar.");
    expect(estadoSesion().listo).toBe(true);
  });

  it("sin motor, entrar es un error explícito y no un silencio", async () => {
    await expect(entrarConGoogle()).rejects.toThrow(/proveedor de identidad/);
  });

  it("salir vuelve a dejar el estado sin usuario", async () => {
    const { motor } = motorFalso();
    setMotorAuth(motor);
    await entrarConGoogle();
    await cerrarSesion();
    expect(estadoSesion().usuario).toBeNull();
  });

  it("salir sin motor no rompe", async () => {
    await expect(cerrarSesion()).resolves.toBeUndefined();
  });
});

describe("idTokenActual — lo que el botón de Gmail le manda a las funciones", () => {
  it("sin motor devuelve null, que es 'no hay sesión'", async () => {
    await expect(idTokenActual()).resolves.toBeNull();
  });

  it("con sesión devuelve el token del motor", async () => {
    const { motor } = motorFalso();
    setMotorAuth(motor);
    await expect(idTokenActual()).resolves.toBe("id-token-de-prueba");
  });
});
