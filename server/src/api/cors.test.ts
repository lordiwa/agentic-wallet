import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createCorsMiddleware, parseAllowedOrigins } from "./cors.js";

function appWith(origins: string[]) {
  const app = express();
  app.use(createCorsMiddleware(origins));
  app.get("/api/ping", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("parseAllowedOrigins", () => {
  it("sin valor devuelve lista vacia (CORS apagado)", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
    expect(parseAllowedOrigins("  ,  ")).toEqual([]);
  });

  it("parte por coma y normaliza espacios y barra final", () => {
    expect(parseAllowedOrigins("https://a.web.app/, http://localhost:5173")).toEqual([
      "https://a.web.app",
      "http://localhost:5173",
    ]);
  });

  it("descarta el comodin: no hay lista blanca implicita", () => {
    expect(parseAllowedOrigins("*")).toEqual([]);
    expect(parseAllowedOrigins("*,https://a.web.app")).toEqual(["https://a.web.app"]);
  });
});

describe("createCorsMiddleware", () => {
  it("con lista vacia no emite ninguna cabecera", async () => {
    const res = await request(appWith([])).get("/api/ping").set("Origin", "https://a.web.app");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("refleja el origen permitido y marca Vary", async () => {
    const res = await request(appWith(["https://a.web.app"])).get("/api/ping").set("Origin", "https://a.web.app");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://a.web.app");
    expect(res.headers.vary).toContain("Origin");
  });

  it("un origen fuera de la lista no recibe cabecera", async () => {
    const res = await request(appWith(["https://a.web.app"])).get("/api/ping").set("Origin", "https://otro.example");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("responde el preflight OPTIONS sin llegar a la ruta", async () => {
    const res = await request(appWith(["https://a.web.app"]))
      .options("/api/ping")
      .set("Origin", "https://a.web.app")
      .set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    expect(res.headers["access-control-allow-headers"]).toContain("Content-Type");
  });

  it("nunca habilita credenciales: la API no usa cookies", async () => {
    const res = await request(appWith(["https://a.web.app"])).get("/api/ping").set("Origin", "https://a.web.app");
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});
