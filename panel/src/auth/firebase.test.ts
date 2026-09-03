/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El adaptador del SDK, con el SDK de mentira.
 *
 * Lo que se prueba acá no es Firebase —eso no es nuestro— sino las tres
 * decisiones propias del adaptador: que el login pida elegir cuenta, que un
 * popup bloqueado caiga en redirect en vez de morirse, y que un error del SDK
 * llegue a la pantalla como una frase en castellano y no como `auth/...`.
 */
const sdk = vi.hoisted(() => {
  const apps: { name: string; config: unknown }[] = [];
  return {
    apps,
    auth: { currentUser: null as null | { uid: string; email: string | null; displayName: string | null; getIdToken: () => Promise<string> } },
    initializeApp: vi.fn((config: unknown, name: string) => {
      const app = { name, config };
      apps.push(app);
      return app;
    }),
    signInWithPopup: vi.fn(async () => undefined),
    signInWithRedirect: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    onAuthStateChanged: vi.fn((_auth: unknown, cb: (u: unknown) => void) => {
      sdk.ultimoObservador = cb;
      return () => {
        sdk.ultimoObservador = null;
      };
    }),
    ultimoObservador: null as null | ((u: unknown) => void),
    parametros: null as unknown,
  };
});

vi.mock("firebase/app", () => ({
  initializeApp: sdk.initializeApp,
  getApps: () => sdk.apps,
  getApp: (name: string) => sdk.apps.find((a) => a.name === name),
}));

vi.mock("firebase/auth", () => ({
  getAuth: () => sdk.auth,
  onAuthStateChanged: sdk.onAuthStateChanged,
  signInWithPopup: sdk.signInWithPopup,
  signInWithRedirect: sdk.signInWithRedirect,
  signOut: sdk.signOut,
  GoogleAuthProvider: class {
    setCustomParameters(p: unknown) {
      sdk.parametros = p;
    }
  },
}));

import { motorFirebase } from "./firebase";

/** Un error del SDK: lo que importa de él es el `code`. */
function errorSdk(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  vi.stubEnv("VITE_FIREBASE_API_KEY", "llave-de-prueba");
  vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "proyecto-de-prueba.firebaseapp.com");
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "proyecto-de-prueba");
  sdk.apps.length = 0;
  sdk.auth.currentUser = null;
  sdk.ultimoObservador = null;
  sdk.parametros = null;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("motorFirebase", () => {
  it("inicializa la app una sola vez, con la config del build", async () => {
    const motor = motorFirebase();
    await motor.salir();
    await motor.salir();

    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "llave-de-prueba", projectId: "proyecto-de-prueba" }),
      "panel"
    );
  });

  it("sin config en el build el motor no se puede usar", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    await expect(motorFirebase().salir()).rejects.toThrow(/config de Firebase/);
  });

  it("entrar abre el popup y pide elegir cuenta", async () => {
    await motorFirebase().entrarConGoogle();

    expect(sdk.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(sdk.signInWithRedirect).not.toHaveBeenCalled();
    expect(sdk.parametros).toEqual({ prompt: "select_account" });
  });

  it("un popup bloqueado no es un fallo: redirige la pestaña", async () => {
    sdk.signInWithPopup.mockRejectedValueOnce(errorSdk("auth/popup-blocked"));
    await expect(motorFirebase().entrarConGoogle()).resolves.toBeUndefined();
    expect(sdk.signInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it("un popup cerrado a mano llega como frase, no como código", async () => {
    sdk.signInWithPopup.mockRejectedValueOnce(errorSdk("auth/popup-closed-by-user"));
    await expect(motorFirebase().entrarConGoogle()).rejects.toThrow("Cerraste la ventana de Google antes de terminar.");
    expect(sdk.signInWithRedirect).not.toHaveBeenCalled();
  });

  it("un código desconocido cae en el mensaje genérico", async () => {
    sdk.signInWithPopup.mockRejectedValueOnce(errorSdk("auth/internal-error"));
    await expect(motorFirebase().entrarConGoogle()).rejects.toThrow("No se pudo entrar con Google.");
  });

  it("observar traduce el usuario del SDK al del panel", () => {
    const vistos: unknown[] = [];
    const parar = motorFirebase().observar((u) => vistos.push(u));

    sdk.ultimoObservador?.({ uid: "u-1", email: "ana@ejemplo.test", displayName: "Ana", extra: "que no se copia" });
    expect(vistos).toEqual([{ uid: "u-1", email: "ana@ejemplo.test", nombre: "Ana" }]);

    sdk.ultimoObservador?.(null);
    expect(vistos[1]).toBeNull();

    parar();
    expect(sdk.ultimoObservador).toBeNull();
  });

  it("sin usuario no hay token", async () => {
    await expect(motorFirebase().idToken()).resolves.toBeNull();
  });

  it("con usuario devuelve el ID token del SDK", async () => {
    sdk.auth.currentUser = {
      uid: "u-1",
      email: "ana@ejemplo.test",
      displayName: "Ana",
      getIdToken: async () => "id-token-firmado",
    };
    await expect(motorFirebase().idToken()).resolves.toBe("id-token-firmado");
  });
});
