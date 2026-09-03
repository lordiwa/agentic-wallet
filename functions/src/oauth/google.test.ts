import { describe, expect, it, vi } from "vitest";
import { canjearCode, correoDelToken, GoogleOAuthError, revocar, type FetchLike } from "./google.js";

const PARAMS = {
  code: "code-de-google",
  codeVerifier: "verifier-de-prueba",
  clientId: "cliente.apps.googleusercontent.com",
  clientSecret: "secreto-inventado",
  redirectUri: "https://us-central1-p.cloudfunctions.net/gmailAuthCallback",
};

function respuesta(json: unknown, status = 200): Response {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("canjearCode", () => {
  it("postea al endpoint de Google con todo lo que el grant necesita", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      respuesta({ access_token: "ya29.x", refresh_token: "1//r", expires_in: 3599, scope: "a b" })
    );
    await canjearCode(PARAMS, fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe(PARAMS.code);
    expect(body.get("code_verifier")).toBe(PARAMS.codeVerifier);
    expect(body.get("client_secret")).toBe(PARAMS.clientSecret);
    expect(body.get("redirect_uri")).toBe(PARAMS.redirectUri);
  });

  it("devuelve los tokens y los scopes concedidos", async () => {
    const fetchImpl: FetchLike = async () =>
      respuesta({
        access_token: "ya29.x",
        refresh_token: "1//r",
        expires_in: 3599,
        scope: "https://www.googleapis.com/auth/gmail.readonly openid",
        token_type: "Bearer",
      });
    const tokens = await canjearCode(PARAMS, fetchImpl);
    expect(tokens.refreshToken).toBe("1//r");
    expect(tokens.expiresInSeconds).toBe(3599);
    expect(tokens.scopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly", "openid"]);
  });

  it("refreshToken es null —no undefined ni ''— cuando Google no lo manda", async () => {
    const fetchImpl: FetchLike = async () => respuesta({ access_token: "ya29.x", expires_in: 10 });
    expect((await canjearCode(PARAMS, fetchImpl)).refreshToken).toBeNull();
  });

  it("conserva el código de error de Google, que es lo que dice qué configurar", async () => {
    const fetchImpl: FetchLike = async () => respuesta({ error: "redirect_uri_mismatch" }, 400);
    await expect(canjearCode(PARAMS, fetchImpl)).rejects.toMatchObject({
      code: "redirect_uri_mismatch",
    });
  });

  it("un 400 sin JSON no rompe: queda el status", async () => {
    const fetchImpl: FetchLike = async () => new Response("<html>error</html>", { status: 502 });
    await expect(canjearCode(PARAMS, fetchImpl)).rejects.toMatchObject({ code: "http_502" });
  });

  it("un fallo de red es un GoogleOAuthError, no una excepción cruda", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(canjearCode(PARAMS, fetchImpl)).rejects.toBeInstanceOf(GoogleOAuthError);
  });

  it("una respuesta 200 sin access_token es un error, no un token vacío", async () => {
    const fetchImpl: FetchLike = async () => respuesta({ token_type: "Bearer" });
    await expect(canjearCode(PARAMS, fetchImpl)).rejects.toMatchObject({
      code: "respuesta_invalida",
    });
  });

  it("el error que sale nunca lleva el secreto ni el code", async () => {
    const fetchImpl: FetchLike = async () => respuesta({ error: "invalid_client" }, 401);
    try {
      await canjearCode(PARAMS, fetchImpl);
      throw new Error("tenía que fallar");
    } catch (error) {
      const texto = `${(error as Error).message} ${(error as GoogleOAuthError).code}`;
      expect(texto).not.toContain(PARAMS.clientSecret);
      expect(texto).not.toContain(PARAMS.code);
      expect(texto).not.toContain(PARAMS.codeVerifier);
    }
  });
});

describe("correoDelToken", () => {
  it("devuelve el correo del buzón autorizado", async () => {
    const fetchImpl: FetchLike = async () => respuesta({ email: "buzon@ejemplo.test" });
    expect(await correoDelToken("ya29.x", fetchImpl)).toBe("buzon@ejemplo.test");
  });

  it("manda el access token como Bearer", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => respuesta({ email: "a@b.test" }));
    await correoDelToken("ya29.x", fetchImpl);
    expect(fetchImpl.mock.calls[0]![1].headers).toMatchObject({ Authorization: "Bearer ya29.x" });
  });

  it("devuelve null si falla, en vez de tumbar el flujo", async () => {
    const rechaza: FetchLike = async () => new Response("no", { status: 403 });
    const explota: FetchLike = async () => {
      throw new Error("red");
    };
    expect(await correoDelToken("ya29.x", rechaza)).toBeNull();
    expect(await correoDelToken("ya29.x", explota)).toBeNull();
  });

  it("devuelve null si la respuesta no trae email", async () => {
    const fetchImpl: FetchLike = async () => respuesta({ sub: "123" });
    expect(await correoDelToken("ya29.x", fetchImpl)).toBeNull();
  });
});

describe("revocar", () => {
  it("postea el token al endpoint de revocación", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response("", { status: 200 }));
    expect(await revocar("1//r", fetchImpl)).toBe(true);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://oauth2.googleapis.com/revoke");
    expect(new URLSearchParams(fetchImpl.mock.calls[0]![1].body as string).get("token")).toBe("1//r");
  });

  it("no explota si Google contesta mal", async () => {
    expect(await revocar("1//r", async () => new Response("", { status: 400 }))).toBe(false);
    expect(
      await revocar("1//r", async () => {
        throw new Error("red");
      })
    ).toBe(false);
  });
});
