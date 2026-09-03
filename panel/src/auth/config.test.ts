/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { authConfigurado, configFirebase } from "./config";

/** `import.meta.env` es de sólo lectura en Vite: se toca con `vi.stubEnv`. */
function conEnv(vars: Record<string, string>): void {
  for (const [clave, valor] of Object.entries(vars)) vi.stubEnv(clave, valor);
}

const MINIMA = {
  VITE_FIREBASE_API_KEY: "llave-de-prueba",
  VITE_FIREBASE_AUTH_DOMAIN: "proyecto-de-prueba.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "proyecto-de-prueba",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("configFirebase", () => {
  it("sin variables no hay identidad", () => {
    expect(configFirebase()).toBeNull();
    expect(authConfigurado()).toBe(false);
  });

  it("con los tres obligatorios devuelve la config", () => {
    conEnv(MINIMA);
    expect(configFirebase()).toEqual({
      apiKey: "llave-de-prueba",
      authDomain: "proyecto-de-prueba.firebaseapp.com",
      projectId: "proyecto-de-prueba",
    });
    expect(authConfigurado()).toBe(true);
  });

  it.each(Object.keys(MINIMA))("una config a la que le falta %s no vale", (faltante) => {
    conEnv({ ...MINIMA, [faltante]: "" });
    expect(configFirebase()).toBeNull();
  });

  it("los opcionales entran sólo si tienen valor", () => {
    conEnv({ ...MINIMA, VITE_FIREBASE_MESSAGING_SENDER_ID: "123456", VITE_FIREBASE_APP_ID: "" });
    const config = configFirebase();
    expect(config?.messagingSenderId).toBe("123456");
    expect(config).not.toHaveProperty("appId");
    expect(config).not.toHaveProperty("storageBucket");
  });

  it("los espacios sobrantes de una variable del build no rompen la config", () => {
    conEnv({ ...MINIMA, VITE_FIREBASE_PROJECT_ID: "  proyecto-de-prueba  " });
    expect(configFirebase()?.projectId).toBe("proyecto-de-prueba");
  });
});
