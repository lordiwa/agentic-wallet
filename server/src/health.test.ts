import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./index.js";

const TOKEN = "llave-de-prueba-32-bytes-al-azar";

describe("createApp", () => {
  it("builds an Express app instance", () => {
    const app = createApp();
    expect(typeof app.listen).toBe("function");
    expect(typeof app.use).toBe("function");
  });
});

/**
 * `createApp` lee la llave una sola vez al construirse, asi que cada caso
 * setea la env ANTES de llamarlo.
 */
describe("GET /api/health", () => {
  const original = process.env.WALLET_ACCESS_TOKEN;

  beforeEach(() => {
    delete process.env.WALLET_ACCESS_TOKEN;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.WALLET_ACCESS_TOKEN;
    else process.env.WALLET_ACCESS_TOKEN = original;
  });

  it("sin llave configurada responde auth_required:false y no exige nada", async () => {
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", auth_required: false, authenticated: true });
  });

  it("con llave configurada sigue respondiendo SIN llave y lo declara", async () => {
    process.env.WALLET_ACCESS_TOKEN = TOKEN;
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.auth_required).toBe(true);
    // Es el diagnostico de R27: "el server pide llave y la que traes no sirve"
    // se distingue de "el server no responde" sin necesitar credencial.
    expect(res.body.authenticated).toBe(false);
  });

  it("con la llave correcta reporta authenticated:true", async () => {
    process.env.WALLET_ACCESS_TOKEN = TOKEN;
    const res = await request(createApp()).get("/api/health").set("Authorization", `Bearer ${TOKEN}`);
    expect(res.body).toEqual({ status: "ok", auth_required: true, authenticated: true });
  });

  it("con una llave equivocada reporta authenticated:false", async () => {
    process.env.WALLET_ACCESS_TOKEN = TOKEN;
    const res = await request(createApp()).get("/api/health").set("Authorization", "Bearer no-es-esta");
    expect(res.body.authenticated).toBe(false);
  });
});

describe("la llave protege todo /api/*", () => {
  const original = process.env.WALLET_ACCESS_TOKEN;

  beforeEach(() => {
    process.env.WALLET_ACCESS_TOKEN = TOKEN;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.WALLET_ACCESS_TOKEN;
    else process.env.WALLET_ACCESS_TOKEN = original;
  });

  it("401 sin cabecera, incluso para una ruta que no existe", async () => {
    const res = await request(createApp()).get("/api/no-existe");
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe("missing_token");
  });

  it("401 con token incorrecto sobre una ruta real", async () => {
    const res = await request(createApp()).get("/api/overview").set("Authorization", "Bearer no-es-esta");
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe("invalid_token");
  });

  it("con la llave correcta la ruta inexistente vuelve a ser un 404 normal", async () => {
    const res = await request(createApp()).get("/api/no-existe").set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
  });

  it("el 401 apunta a health, el unico diagnostico sin llave (R27)", async () => {
    const res = await request(createApp()).get("/api/overview");
    expect(res.body.hint).toContain("/api/health");
  });
});
