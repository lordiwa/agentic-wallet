import { describe, expect, it, vi } from "vitest";
import type { Auth } from "firebase-admin/auth";
import { authenticate, AuthError, bearerToken } from "./verify.js";

function peticion(headers: Record<string, string> = {}) {
  return { headers } as unknown as Parameters<typeof authenticate>[1];
}

/** Un `Auth` de mentira: sólo `verifyIdToken`, que es lo único que se usa. */
function authFalso(impl: (token: string, checkRevoked?: boolean) => unknown): Auth {
  return { verifyIdToken: vi.fn(impl) } as unknown as Auth;
}

describe("bearerToken", () => {
  it("extrae el token del header", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("tolera el esquema en otra caja y espacios de mas", () => {
    expect(bearerToken("bearer   abc")).toBe("abc");
    expect(bearerToken("  BEARER abc  ")).toBe("abc");
  });

  it.each([
    ["ausente", undefined],
    ["vacio", ""],
    ["sin esquema", "abc.def"],
    ["otro esquema", "Basic dXNlcjpwYXNz"],
    ["sin token", "Bearer"],
    ["con espacio adentro del token", "Bearer abc def"],
  ])("rechaza el header %s", (_nombre, header) => {
    expect(bearerToken(header)).toBeNull();
  });
});

describe("authenticate", () => {
  it("devuelve el uid del token", async () => {
    const auth = authFalso(() => ({ uid: "uid-1", email: "a@b.c", email_verified: true }));
    await expect(authenticate(auth, peticion({ authorization: "Bearer t" }))).resolves.toEqual({
      uid: "uid-1",
      email: "a@b.c",
      emailVerified: true,
    });
  });

  it("pide chequeo de revocacion", async () => {
    const verify = vi.fn(() => ({ uid: "uid-1", email_verified: true }));
    await authenticate(authFalso(verify), peticion({ authorization: "Bearer t" }));
    expect(verify).toHaveBeenCalledWith("t", true);
  });

  it("401 sin header", async () => {
    const auth = authFalso(() => ({ uid: "uid-1", email_verified: true }));
    await expect(authenticate(auth, peticion())).rejects.toMatchObject({
      status: 401,
      code: "sin_token",
    });
  });

  it("401 con token invalido, sin filtrar por que", async () => {
    const auth = authFalso(() => {
      throw new Error("Firebase ID token has expired at 2026-01-01. Get a fresh token from your client app");
    });
    const error = await authenticate(auth, peticion({ authorization: "Bearer t" })).catch((e) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error.status).toBe(401);
    // Lo que NO tiene que estar: el detalle del SDK, que le dice a quien esta
    // probando tokens si fallo la firma, el proyecto o la expiracion.
    expect(error.message).not.toContain("expired");
    expect(error.message).not.toContain("Firebase");
  });

  it("403 si el correo no esta verificado", async () => {
    const auth = authFalso(() => ({ uid: "uid-1", email: "a@b.c", email_verified: false }));
    await expect(authenticate(auth, peticion({ authorization: "Bearer t" }))).rejects.toMatchObject({
      status: 403,
      code: "correo_sin_verificar",
    });
  });

  it("un uid en la query NO cambia de quien es la sesion", async () => {
    // No hay assert sobre la query porque `authenticate` ni la mira: el test
    // existe para que si alguien la agrega, se note.
    const auth = authFalso(() => ({ uid: "uid-real", email_verified: true }));
    const req = {
      headers: { authorization: "Bearer t" },
      query: { uid: "uid-de-otro" },
      body: { uid: "uid-de-otro" },
    } as unknown as Parameters<typeof authenticate>[1];
    await expect(authenticate(auth, req)).resolves.toMatchObject({ uid: "uid-real" });
  });
});
