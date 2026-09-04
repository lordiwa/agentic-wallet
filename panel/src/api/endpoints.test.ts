/**
 * Lo único que se prueba acá es el error de `postSync`, porque es lo único de
 * este archivo que el panel *interpreta* en vez de dibujar: el cartel del chip
 * de sync sale de ese mensaje (`lib/sync-estado.ts`), así que lo que se pierda
 * en la traducción no se puede recuperar más adelante.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postSync } from "./endpoints";

const { client } = vi.hoisted(() => ({ client: { panelFetch: vi.fn() } }));

vi.mock("./client", () => client);

function respuesta(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("postSync", () => {
  // Las dos causas del 503 comparten el `error` y sólo se distinguen por el
  // `detalle`. Quedarse con el `error` las volvía el mismo cartel: "falta una
  // credencial", que además no era cierto para ninguna de las dos.
  it("el `detalle` del 503 viaja pegado al `error`", async () => {
    client.panelFetch.mockResolvedValue(
      respuesta(503, { error: "gmail_not_configured", detalle: "gmail_no_conectado" })
    );

    await expect(postSync()).rejects.toThrow("gmail_not_configured: gmail_no_conectado");
  });

  it("un server que no manda `detalle` sigue dando el `error` solo", async () => {
    client.panelFetch.mockResolvedValue(respuesta(409, { error: "sync_already_running" }));

    await expect(postSync()).rejects.toThrow(/^sync_already_running$/);
  });

  it("sin cuerpo, el mensaje es el status", async () => {
    client.panelFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => {
        throw new Error("no es JSON");
      },
    } as unknown as Response);

    await expect(postSync()).rejects.toThrow("Sync failed: 500 Internal Server Error");
  });

  it("un 200 devuelve el cuerpo tal cual", async () => {
    const cuerpo = { progress: { processed: 3, total: 3, remaining: 0, complete: true }, inserted_ids: [] };
    client.panelFetch.mockResolvedValue(respuesta(200, cuerpo));

    await expect(postSync()).resolves.toEqual(cuerpo);
  });
});
