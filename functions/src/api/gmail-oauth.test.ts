/**
 * El flujo OAuth de punta a punta: `start` → URL de Google → `callback` →
 * documento cifrado → `status`.
 *
 * Firestore es el emulador (el state y el documento del token son escrituras
 * reales); Auth y `fetch` son dobles. Es la misma división que en
 * `handlers.test.ts` y por la misma razón: lo que puede fallar en Firestore es
 * la transacción, lo que puede fallar en el canje es cómo interpretamos la
 * respuesta de Google — y a Google no se lo llama desde un test.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../test-support/emulator.js";
import { configDoc } from "../ledger/paths.js";
import { generarClaveMaestra, type MasterKey } from "../oauth/crypto.js";
import { leerRefreshToken } from "../oauth/gmail-tokens.js";
import type { FetchLike } from "../oauth/google.js";
import { challengeS256, GMAIL_SCOPES } from "../oauth/pkce.js";
import { STATES_COLLECTION } from "../oauth/state-store.js";
import type { OAuthConfig } from "../oauth/config.js";
import { gmailCallbackHandler, gmailStartHandler, gmailStatusHandler } from "./gmail-oauth.js";

const master: MasterKey = { version: 1, key: Buffer.from(generarClaveMaestra(), "base64") };
const REFRESH_FALSO = "1//0gREFRESH-DE-PRUEBA-inventado";
const ACCESS_FALSO = "ya29.ACCESS-DE-PRUEBA-inventado";

const config: OAuthConfig = {
  clientId: "cliente.apps.googleusercontent.com",
  clientSecret: "secreto-de-prueba-inventado",
  redirectUri: "https://us-central1-p.cloudfunctions.net/gmailAuthCallback",
  panelOrigin: "https://panel.example",
  master,
  clavesDeLectura: [master],
};

function authQueDevuelve(uid: string, email: string | null = `${uid}@ejemplo.test`): Auth {
  return {
    verifyIdToken: vi.fn(async () => ({ uid, email, email_verified: true })),
  } as unknown as Auth;
}

const authQueRechaza: Auth = {
  verifyIdToken: vi.fn(async () => {
    throw new Error("token invalido");
  }),
} as unknown as Auth;

interface EstadoRes {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  redirect: string | null;
}

function parHttp(
  overrides: {
    method?: string;
    headers?: Record<string, string>;
    query?: Record<string, unknown>;
    body?: unknown;
  } = {}
) {
  const estado: EstadoRes = { status: 0, body: undefined, headers: {}, redirect: null };
  const res = {
    status(code: number) {
      estado.status = code;
      return res;
    },
    json(payload: unknown) {
      estado.body = payload;
      return res;
    },
    send(payload: unknown) {
      estado.body = payload;
      return res;
    },
    set(key: string, value: string) {
      estado.headers[key] = value;
      return res;
    },
    redirect(code: number, url: string) {
      estado.status = code;
      estado.redirect = url;
      return res;
    },
  };
  const req = {
    method: overrides.method ?? "GET",
    headers: overrides.headers ?? { authorization: "Bearer token-de-prueba" },
    query: overrides.query ?? {},
    body: overrides.body,
  };
  return { req: req as never, res: res as never, estado };
}

/** Un `fetch` que contesta como Google. `sobre` reemplaza campos de la
 * respuesta del canje para poder probar los casos raros. */
function fetchDeGoogle(sobre: Record<string, unknown> = {}) {
  const llamadas: { url: string; body: string | undefined }[] = [];
  const impl: FetchLike = async (url, init) => {
    llamadas.push({ url, body: typeof init.body === "string" ? init.body : undefined });
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({
          access_token: ACCESS_FALSO,
          refresh_token: REFRESH_FALSO,
          expires_in: 3599,
          scope: GMAIL_SCOPES.join(" "),
          token_type: "Bearer",
          ...sobre,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("userinfo")) {
      return new Response(JSON.stringify({ email: "buzon@ejemplo.test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("no esperado", { status: 404 });
  };
  return { impl, llamadas };
}

describe.skipIf(!hayEmulador)("flujo OAuth de Gmail", () => {
  let db: Firestore;
  let cerrar: () => Promise<void>;
  const tenants: string[] = [];
  const states: string[] = [];

  beforeAll(() => {
    ({ db, cerrar } = conectarEmulador());
  });

  afterAll(async () => {
    for (const uid of tenants) await limpiarTenant(db, uid);
    for (const id of states) await db.collection(STATES_COLLECTION).doc(id).delete();
    await cerrar();
  });

  function tenant(etiqueta = "oauth"): string {
    const uid = uidDePrueba(etiqueta);
    tenants.push(uid);
    return uid;
  }

  /** Corre `start` y devuelve lo que el panel recibiría. */
  async function empezar(uid: string, body?: unknown) {
    const { req, res, estado } = parHttp({ method: "POST", body });
    await gmailStartHandler({ auth: authQueDevuelve(uid), db, config })(req, res);
    const payload = estado.body as { authUrl: string; state: string };
    if (payload?.state) states.push(payload.state);
    return { estado, payload, url: payload?.authUrl ? new URL(payload.authUrl) : null };
  }

  describe("POST start", () => {
    it("devuelve la URL de Google con el state y el challenge", async () => {
      const { estado, payload, url } = await empezar(tenant());
      expect(estado.status).toBe(200);
      expect(url!.origin).toBe("https://accounts.google.com");
      expect(url!.searchParams.get("state")).toBe(payload.state);
      expect(url!.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url!.searchParams.get("client_id")).toBe(config.clientId);
      expect(url!.searchParams.get("redirect_uri")).toBe(config.redirectUri);
      expect(url!.searchParams.get("scope")).toBe(GMAIL_SCOPES.join(" "));
    });

    it("guarda el state con el uid del TOKEN, no de la petición", async () => {
      const uid = tenant();
      const { payload } = await empezar(uid);
      const doc = (await db.collection(STATES_COLLECTION).doc(payload.state).get()).data()!;
      expect(doc.uid).toBe(uid);
    });

    it("NUNCA devuelve el code_verifier al navegador", async () => {
      const { payload, url } = await empezar(tenant());
      const doc = (await db.collection(STATES_COLLECTION).doc(payload.state).get()).data()!;
      // El verifier está cifrado en la base; el challenge (su hash) es lo único
      // que sale, y sale dentro de la URL de Google, que es su lugar.
      const serializado = JSON.stringify(payload);
      expect(serializado).not.toContain("verifier");
      expect(serializado).not.toContain(doc.verifier.ciphertext);
      expect(url!.searchParams.get("code_challenge")).toBeTruthy();
    });

    it("dos llamadas dan states y challenges distintos", async () => {
      const uid = tenant();
      const a = await empezar(uid);
      const b = await empezar(uid);
      expect(a.payload.state).not.toBe(b.payload.state);
      expect(a.url!.searchParams.get("code_challenge")).not.toBe(
        b.url!.searchParams.get("code_challenge")
      );
    });

    it("usa el correo del token como login_hint", async () => {
      const uid = tenant();
      const { url } = await empezar(uid);
      expect(url!.searchParams.get("login_hint")).toBe(`${uid}@ejemplo.test`);
    });

    it("acepta un returnTo del panel y rechaza uno de afuera", async () => {
      const bueno = await empezar(tenant(), { returnTo: "/#/onboarding/listo" });
      const docBueno = (
        await db.collection(STATES_COLLECTION).doc(bueno.payload.state).get()
      ).data()!;
      expect(docBueno.returnTo).toBe("https://panel.example/#/onboarding/listo");

      const malo = await empezar(tenant(), { returnTo: "https://malo.example/robar" });
      const docMalo = (
        await db.collection(STATES_COLLECTION).doc(malo.payload.state).get()
      ).data()!;
      expect(docMalo.returnTo).toBe("https://panel.example/#/conectado");
    });

    it("sin ID token no crea ningún state", async () => {
      const antes = (await db.collection(STATES_COLLECTION).get()).size;
      const { req, res, estado } = parHttp({ method: "POST", headers: {} });
      await gmailStartHandler({ auth: authQueRechaza, db, config })(req, res);
      expect(estado.status).toBe(401);
      expect((await db.collection(STATES_COLLECTION).get()).size).toBe(antes);
    });

    it("con un ID token inválido responde 401", async () => {
      const { req, res, estado } = parHttp({ method: "POST" });
      await gmailStartHandler({ auth: authQueRechaza, db, config })(req, res);
      expect(estado.status).toBe(401);
      expect(estado.body).toMatchObject({ error: "token_invalido" });
    });

    it("no acepta GET", async () => {
      const { req, res, estado } = parHttp({ method: "GET" });
      await gmailStartHandler({ auth: authQueDevuelve("x"), db, config })(req, res);
      expect(estado.status).toBe(405);
    });
  });

  describe("GET callback", () => {
    async function callback(
      query: Record<string, unknown>,
      fetchImpl: FetchLike = fetchDeGoogle().impl
    ) {
      const { req, res, estado } = parHttp({ method: "GET", query, headers: {} });
      await gmailCallbackHandler({ auth: authQueDevuelve("no-se-usa"), db, config, fetchImpl })(
        req,
        res
      );
      return estado;
    }

    it("canjea el code, guarda el token cifrado y redirige al panel", async () => {
      const uid = tenant();
      const { payload } = await empezar(uid);
      const { impl, llamadas } = fetchDeGoogle();
      const estado = await callback({ code: "code-de-google", state: payload.state }, impl);

      expect(estado.status).toBe(302);
      expect(estado.redirect).toBe("https://panel.example/?gmail=ok#/conectado");
      expect(await leerRefreshToken(db, uid, [master])).toBe(REFRESH_FALSO);

      const doc = (await configDoc(db, uid, "gmail").get()).data()!;
      expect(doc.conectado).toBe(true);
      expect(doc.email).toBe("buzon@ejemplo.test");
      expect(JSON.stringify(doc)).not.toContain(REFRESH_FALSO);

      const canje = llamadas.find((l) => l.url.includes("/token"))!;
      expect(canje.body).toContain("grant_type=authorization_code");
      expect(canje.body).toContain("code_verifier=");
      expect(canje.body).toContain("client_secret=");
    });

    it("el code_verifier que manda a Google es el del state, no uno nuevo", async () => {
      const uid = tenant();
      const { payload } = await empezar(uid);
      const { impl, llamadas } = fetchDeGoogle();
      await callback({ code: "code", state: payload.state }, impl);
      const enviado = new URLSearchParams(llamadas.find((l) => l.url.includes("/token"))!.body!).get(
        "code_verifier"
      )!;
      // El challenge que viajó en la URL de autorización tiene que ser el hash
      // de ESTE verifier: si no, Google rechazaría el canje en el mundo real y
      // el test seguiría verde por estar mockeado.
      expect(challengeS256(enviado)).toBe(
        new URL(payload.authUrl).searchParams.get("code_challenge")
      );
    });

    it("redirige al returnTo que se guardó al empezar", async () => {
      const { payload } = await empezar(tenant(), { returnTo: "/#/onboarding/listo" });
      const estado = await callback({ code: "code", state: payload.state });
      expect(estado.redirect).toBe("https://panel.example/?gmail=ok#/onboarding/listo");
    });

    it("el mismo state no se puede canjear dos veces", async () => {
      const uid = tenant();
      const { payload } = await empezar(uid);
      await callback({ code: "code", state: payload.state });
      const segundo = await callback({ code: "otro-code", state: payload.state });
      expect(segundo.redirect).toContain("gmail=state_invalido");
    });

    it("un state inventado no escribe nada y ni siquiera llama a Google", async () => {
      const { impl, llamadas } = fetchDeGoogle();
      const estado = await callback({ code: "code", state: "inventado-por-alguien" }, impl);
      expect(estado.status).toBe(302);
      expect(estado.redirect).toBe("https://panel.example/?gmail=state_invalido#/conectado");
      expect(llamadas).toHaveLength(0);
    });

    it("sin state no hace nada", async () => {
      expect((await callback({ code: "code" })).redirect).toContain("gmail=state_invalido");
    });

    it("sin code no hace nada", async () => {
      const { payload } = await empezar(tenant());
      expect((await callback({ state: payload.state })).redirect).toContain("gmail=state_invalido");
    });

    it("el usuario canceló: vuelve al panel diciéndolo, sin error", async () => {
      const estado = await callback({ error: "access_denied", state: "cualquiera" });
      expect(estado.status).toBe(302);
      expect(estado.redirect).toContain("gmail=cancelado");
    });

    it("si Google rechaza el canje no guarda nada", async () => {
      const uid = tenant();
      const { payload } = await empezar(uid);
      const impl: FetchLike = async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      const estado = await callback({ code: "code", state: payload.state }, impl);
      expect(estado.redirect).toContain("gmail=google_rechazo");
      expect((await configDoc(db, uid, "gmail").get()).exists).toBe(false);
    });

    it("si Google no manda refresh_token no guarda una conexión a medias", async () => {
      const uid = tenant();
      const { payload } = await empezar(uid);
      const { impl } = fetchDeGoogle({ refresh_token: undefined });
      const estado = await callback({ code: "code", state: payload.state }, impl);
      expect(estado.redirect).toContain("gmail=sin_refresh_token");
      expect((await configDoc(db, uid, "gmail").get()).exists).toBe(false);
    });

    it("si el usuario destildó gmail.readonly no guarda nada", async () => {
      const uid = tenant();
      const { payload } = await empezar(uid);
      const { impl } = fetchDeGoogle({ scope: "https://www.googleapis.com/auth/userinfo.email" });
      const estado = await callback({ code: "code", state: payload.state }, impl);
      expect(estado.redirect).toContain("gmail=scope_insuficiente");
      expect((await configDoc(db, uid, "gmail").get()).exists).toBe(false);
    });

    it("si el userinfo falla, guarda igual: el correo es para mostrar, no una llave", async () => {
      const uid = tenant();
      const { payload } = await empezar(uid);
      const impl: FetchLike = async (url, init) => {
        if (url.includes("userinfo")) return new Response("no", { status: 403 });
        return fetchDeGoogle().impl(url, init);
      };
      const estado = await callback({ code: "code", state: payload.state }, impl);
      expect(estado.redirect).toContain("gmail=ok");
      expect(await leerRefreshToken(db, uid, [master])).toBe(REFRESH_FALSO);
      expect((await configDoc(db, uid, "gmail").get()).data()!.email).toBeNull();
    });

    it("marca la respuesta como no cacheable: la URL trae el code", async () => {
      const { payload } = await empezar(tenant());
      const estado = await callback({ code: "code", state: payload.state });
      expect(estado.headers["Cache-Control"]).toBe("no-store");
    });

    it("el redirect nunca sale del panel, pase lo que pase", async () => {
      for (const query of [
        { error: "access_denied" },
        { code: "c", state: "malo" },
        {},
      ] as Record<string, unknown>[]) {
        const estado = await callback(query);
        expect(estado.redirect!.startsWith("https://panel.example/")).toBe(true);
      }
    });

    it("no acepta POST", async () => {
      const { req, res, estado } = parHttp({ method: "POST", headers: {} });
      await gmailCallbackHandler({ auth: authQueDevuelve("x"), db, config })(req, res);
      expect(estado.status).toBe(405);
    });
  });

  describe("GET status", () => {
    it("dice que no antes de conectar", async () => {
      const uid = tenant();
      const { req, res, estado } = parHttp();
      await gmailStatusHandler({ auth: authQueDevuelve(uid), db })(req, res);
      expect(estado.status).toBe(200);
      expect(estado.body).toMatchObject({ conectado: false });
    });

    it("dice que sí después del callback, y NUNCA manda el token", async () => {
      const uid = tenant();
      const { payload } = await empezar(uid);
      const { req: reqCb, res: resCb } = parHttp({
        method: "GET",
        query: { code: "code", state: payload.state },
        headers: {},
      });
      await gmailCallbackHandler({ auth: authQueDevuelve(uid), db, config, fetchImpl: fetchDeGoogle().impl })(
        reqCb,
        resCb
      );

      const { req, res, estado } = parHttp();
      await gmailStatusHandler({ auth: authQueDevuelve(uid), db })(req, res);
      expect(estado.body).toMatchObject({ conectado: true, email: "buzon@ejemplo.test" });
      const serializado = JSON.stringify(estado.body);
      expect(serializado).not.toContain(REFRESH_FALSO);
      expect(serializado).not.toContain(ACCESS_FALSO);
      expect(serializado).not.toContain("ciphertext");
    });

    it("el estado que devuelve es el del uid del token, no el de otro tenant", async () => {
      const ana = tenant("ana");
      const beto = tenant("beto");
      const { payload } = await empezar(ana);
      const { req: reqCb, res: resCb } = parHttp({
        method: "GET",
        query: { code: "code", state: payload.state },
        headers: {},
      });
      await gmailCallbackHandler({ auth: authQueDevuelve(ana), db, config, fetchImpl: fetchDeGoogle().impl })(
        reqCb,
        resCb
      );

      const { req, res, estado } = parHttp();
      await gmailStatusHandler({ auth: authQueDevuelve(beto), db })(req, res);
      expect(estado.body).toMatchObject({ conectado: false });
    });

    it("sin ID token responde 401", async () => {
      const { req, res, estado } = parHttp({ headers: {} });
      await gmailStatusHandler({ auth: authQueRechaza, db })(req, res);
      expect(estado.status).toBe(401);
    });

    it("no se cachea", async () => {
      const { req, res, estado } = parHttp();
      await gmailStatusHandler({ auth: authQueDevuelve(tenant()), db })(req, res);
      expect(estado.headers["Cache-Control"]).toBe("no-store");
    });
  });
});
