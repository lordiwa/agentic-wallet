import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyRequestAuth,
  createAuthMiddleware,
  matchesAccessToken,
  normalizeAccessToken,
  parseBearer,
} from "./auth.js";

const TOKEN = "llave-de-prueba-32-bytes-al-azar";

function appWith(expected: string | null) {
  const app = express();
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api", createAuthMiddleware(expected));
  app.get("/api/overview", (_req, res) => {
    res.json({ ok: true });
  });
  app.delete("/api/algo", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeAccessToken", () => {
  it("trata vacio y solo espacios como 'no hay llave'", () => {
    expect(normalizeAccessToken(undefined)).toBeNull();
    expect(normalizeAccessToken("")).toBeNull();
    expect(normalizeAccessToken("   ")).toBeNull();
  });

  it("recorta los espacios que arrastra un copiar/pegar del .env", () => {
    expect(normalizeAccessToken("  abc  ")).toBe("abc");
  });
});

describe("parseBearer", () => {
  it("acepta el esquema en cualquier caja (RFC 7235)", () => {
    expect(parseBearer("Bearer abc")).toBe("abc");
    expect(parseBearer("bearer abc")).toBe("abc");
    expect(parseBearer("BEARER   abc")).toBe("abc");
  });

  it("devuelve null si no hay cabecera, no es Bearer, o viene sin valor", () => {
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer("Bearer")).toBeNull();
    expect(parseBearer("Bearer    ")).toBeNull();
  });
});

describe("matchesAccessToken", () => {
  it("es exacto: distinta longitud o distinto contenido no matchea", () => {
    expect(matchesAccessToken(TOKEN, TOKEN)).toBe(true);
    expect(matchesAccessToken(TOKEN, `${TOKEN}x`)).toBe(false);
    expect(matchesAccessToken(TOKEN, TOKEN.toUpperCase())).toBe(false);
    expect(matchesAccessToken(TOKEN, "")).toBe(false);
  });
});

describe("classifyRequestAuth", () => {
  it("sin llave configurada todo es 'disabled'", () => {
    expect(classifyRequestAuth(null, undefined)).toBe("disabled");
    expect(classifyRequestAuth(null, "Bearer lo-que-sea")).toBe("disabled");
  });

  it("distingue falta de llave, llave equivocada y llave correcta", () => {
    expect(classifyRequestAuth(TOKEN, undefined)).toBe("missing");
    expect(classifyRequestAuth(TOKEN, "Bearer otra")).toBe("invalid");
    expect(classifyRequestAuth(TOKEN, `Bearer ${TOKEN}`)).toBe("ok");
  });
});

describe("createAuthMiddleware", () => {
  it("401 sin cabecera Authorization", async () => {
    const res = await request(appWith(TOKEN)).get("/api/overview");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
    expect(res.body.reason).toBe("missing_token");
  });

  it("401 con un token incorrecto", async () => {
    const res = await request(appWith(TOKEN)).get("/api/overview").set("Authorization", "Bearer no-es-esta");
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe("invalid_token");
  });

  it("200 con el token correcto", async () => {
    const res = await request(appWith(TOKEN)).get("/api/overview").set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("protege tambien los metodos que borran", async () => {
    expect((await request(appWith(TOKEN)).delete("/api/algo")).status).toBe(401);
    expect((await request(appWith(TOKEN)).delete("/api/algo").set("Authorization", `Bearer ${TOKEN}`)).status).toBe(200);
  });

  it("deja pasar el preflight OPTIONS: el navegador nunca le manda la llave", async () => {
    const res = await request(appWith(TOKEN)).options("/api/overview");
    // Sin handler de OPTIONS propio Express responde 200/204 con Allow; lo
    // que importa es que NO sea 401.
    expect(res.status).not.toBe(401);
  });

  it("nunca pide llave para /health, aunque quede detras del middleware", async () => {
    const app = express();
    app.use("/api", createAuthMiddleware(TOKEN));
    app.get("/api/health", (_req, res) => {
      res.json({ status: "ok" });
    });
    expect((await request(app).get("/api/health")).status).toBe(200);
    expect((await request(app).get("/api/health/")).status).toBe(200);
  });

  it("sin llave configurada es un no-op: el server se comporta como antes", async () => {
    const res = await request(appWith(null)).get("/api/overview");
    expect(res.status).toBe(200);
  });

  it("no loguea el token ni el origen del rechazo, solo el motivo", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await request(appWith(TOKEN))
      .get("/api/overview")
      .set("Authorization", "Bearer secreto-que-no-debe-aparecer")
      .set("Origin", "https://origen-privado.example");

    const lines = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(lines).toContain("metric.api.auth.rejected");
    expect(lines).toContain("invalid");
    expect(lines).not.toContain("secreto-que-no-debe-aparecer");
    expect(lines).not.toContain("origen-privado.example");
  });
});
