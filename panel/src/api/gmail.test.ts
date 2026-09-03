/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE_STORAGE_KEY,
  DEMO_BASE,
} from "./base";
import {
  GmailApiError,
  consultarEstadoGmail,
  getFunctionsBase,
  gmailConfigurado,
  iniciarConexionGmail,
  obtenerIdToken,
  setProveedorIdToken,
} from "./gmail";

const BASE = "https://us-central1-proyecto-de-prueba.cloudfunctions.net";

/**
 * `vi.stubEnv` y no una asignación a `import.meta.env`: Vite reemplaza las
 * `VITE_*` en tiempo de transformación, así que escribirle al objeto deja el
 * string literal `"undefined"` en vez de sacar la variable.
 */
function conBase(valor: string | undefined): void {
  if (valor === undefined) vi.unstubAllEnvs();
  else vi.stubEnv("VITE_FUNCTIONS_BASE_URL", valor);
}

function respuesta(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  conBase(BASE);
  setProveedorIdToken(async () => "id-token-de-prueba");
});

afterEach(() => {
  conBase(undefined);
  setProveedorIdToken(async () => null);
});

describe("getFunctionsBase", () => {
  it("vacia por defecto: nada precargado de un despliegue concreto", () => {
    conBase(undefined);
    expect(getFunctionsBase()).toBe("");
    expect(gmailConfigurado()).toBe(false);
  });

  it("saca la barra final para que no queden dos", () => {
    conBase(`${BASE}/`);
    expect(getFunctionsBase()).toBe(BASE);
  });
});

describe("obtenerIdToken", () => {
  it("un proveedor que explota es 'no hay sesion', no una excepcion", async () => {
    setProveedorIdToken(async () => {
      throw new Error("firebase no inicializado");
    });
    await expect(obtenerIdToken()).resolves.toBeNull();
  });
});

describe("consultarEstadoGmail", () => {
  it("manda el ID token en Authorization contra la base de functions", async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta({ conectado: true, email: "a@b.test", scopes: [], grantedAt: null, necesitaReconectar: false })
    );

    const estado = await consultarEstadoGmail(fetchImpl as unknown as typeof fetch);

    expect(estado.conectado).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/gmailAuthStatus`);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer id-token-de-prueba");
  });

  it("NO manda la llave del server: esa credencial no viaja a cloudfunctions", async () => {
    window.localStorage.setItem("wallet.access_token", "llave-del-server");
    const fetchImpl = vi.fn(async () =>
      respuesta({ conectado: false, email: null, scopes: [], grantedAt: null, necesitaReconectar: false })
    );

    await consultarEstadoGmail(fetchImpl as unknown as typeof fetch);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer id-token-de-prueba");
  });

  it("sin sesion no sale a la red", async () => {
    setProveedorIdToken(async () => null);
    const fetchImpl = vi.fn();

    await expect(consultarEstadoGmail(fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(GmailApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sin configurar no sale a la red", async () => {
    conBase(undefined);
    const fetchImpl = vi.fn();

    await expect(consultarEstadoGmail(fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(GmailApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("un status que no es 2xx es un error con su codigo", async () => {
    const fetchImpl = vi.fn(async () => respuesta({ error: "sin_token" }, 401));
    await expect(consultarEstadoGmail(fetchImpl as unknown as typeof fetch)).rejects.toThrow("401");
  });

  it("en modo demo y sin sesion devuelve un estado ficticio sin tocar la red", async () => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, DEMO_BASE);
    setProveedorIdToken(async () => null);
    const fetchImpl = vi.fn();

    const estado = await consultarEstadoGmail(fetchImpl as unknown as typeof fetch);

    expect(estado.conectado).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("el modo demo no necesita sesion", async () => {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, DEMO_BASE);
    setProveedorIdToken(async () => null);

    await expect(consultarEstadoGmail(vi.fn() as unknown as typeof fetch)).resolves.toMatchObject({ conectado: true });
  });

  it("una sesion de verdad le gana a la ficcion del modo demo", async () => {
    // El sitio publicado tiene las dos cosas a la vez: `demo` como backend del
    // ledger y la URL real de las funciones. Quien entro con su cuenta tiene
    // que ver SU estado, no el inventado.
    window.localStorage.setItem(API_BASE_STORAGE_KEY, DEMO_BASE);
    const fetchImpl = vi.fn(async () => respuesta({ conectado: false, email: null, scopes: [] }));

    const estado = await consultarEstadoGmail(fetchImpl as unknown as typeof fetch);

    expect(estado.conectado).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer id-token-de-prueba");
  });
});

describe("iniciarConexionGmail", () => {
  it("hace POST y devuelve la authUrl", async () => {
    const fetchImpl = vi.fn(async () =>
      respuesta({ authUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1", state: "s1", scopes: ["gmail.readonly"] })
    );

    const res = await iniciarConexionGmail("/#/conectado", fetchImpl as unknown as typeof fetch);

    expect(res.authUrl).toContain("accounts.google.com");
    expect(res.state).toBe("s1");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/gmailAuthStart`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ returnTo: "/#/conectado" });
  });

  it("sin returnTo manda un cuerpo vacio y el backend elige la ruta por defecto", async () => {
    const fetchImpl = vi.fn(async () => respuesta({ authUrl: "https://accounts.google.com/x", state: "s", scopes: [] }));

    await iniciarConexionGmail(undefined, fetchImpl as unknown as typeof fetch);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("una respuesta 200 sin authUrl es un error, no una navegacion a undefined", async () => {
    const fetchImpl = vi.fn(async () => respuesta({ state: "s" }));
    await expect(iniciarConexionGmail(undefined, fetchImpl as unknown as typeof fetch)).rejects.toThrow("authUrl");
  });

  it("propaga el codigo cuando el backend rechaza", async () => {
    const fetchImpl = vi.fn(async () => respuesta({ error: "token_invalido" }, 403));
    await expect(iniciarConexionGmail(undefined, fetchImpl as unknown as typeof fetch)).rejects.toThrow("403");
  });
});
