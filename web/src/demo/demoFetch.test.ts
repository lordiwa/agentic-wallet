import { describe, expect, it } from "vitest";
import { demoFetch } from "./demoFetch";

describe("demoFetch", () => {
  it("responde el overview con la forma que espera la UI", async () => {
    const body = await (await demoFetch("/api/overview")).json();
    expect(body).toHaveProperty("balance.amount");
    expect(body).toHaveProperty("counts.needs_review");
    expect(body).toHaveProperty("buffer_status.objetivo");
    expect(body).toHaveProperty("spending_by_category");
  });

  it("la bandeja de revision trae solo filas con needs_review", async () => {
    const body = await (await demoFetch("/api/review")).json();
    expect(body.count).toBeGreaterThan(0);
    expect(body.transactions.every((t: { needs_review: number }) => t.needs_review === 1)).toBe(true);
  });

  it("ignora la query al enrutar", async () => {
    const res = await demoFetch("/api/transactions?limit=50&offset=0");
    const body = await res.json();
    expect(body.transactions.length).toBeGreaterThan(0);
  });

  it("no finge un sync: POST /api/sync falla explicitamente", async () => {
    const res = await demoFetch("/api/sync", { method: "POST" });
    expect(res.ok).toBe(false);
    expect((await res.json()).error).toMatch(/demostracion/);
  });

  it("el chat devuelve un stream SSE con el mismo framing que el server", async () => {
    const res = await demoFetch("/api/chat", { method: "POST" });
    const text = await res.text();
    expect(text).toContain("event: meta");
    expect(text).toContain("event: done");
  });

  it("una ruta desconocida es 404, no una respuesta inventada", async () => {
    const res = await demoFetch("/api/no-existe");
    expect(res.status).toBe(404);
  });

  it("todo lo que publica esta marcado como demo, sin datos de nadie", async () => {
    const body = await (await demoFetch("/api/transactions")).json();
    expect(body.transactions.every((t: { source: string }) => t.source === "demo")).toBe(true);
  });
});
