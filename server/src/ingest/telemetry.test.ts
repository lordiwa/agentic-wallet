/**
 * Lock de regresion del canal de salida.
 *
 * De este modulo cuelgan `ingest/pipeline`, `category/backfill` y
 * `category/reclassify` — es decir, las tools MCP `sync`, `apply_rules` y
 * `heal_counterparties`. En el server MCP stdout ES el canal JSON-RPC, asi que
 * una linea de span impresa ahi la rechaza el parser del cliente. Estos tests
 * fijan las dos mitades del contrato: con `WALLET_TELEMETRY_SILENT` no sale
 * NADA por stdout, y los errores salen igual por stderr pase lo que pase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitMetric, withSpan } from "./telemetry.js";

let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;
const previous = process.env.WALLET_TELEMETRY_SILENT;

beforeEach(() => {
  stdout = vi.spyOn(console, "log").mockImplementation(() => {});
  stderr = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  stdout.mockRestore();
  stderr.mockRestore();
  if (previous === undefined) delete process.env.WALLET_TELEMETRY_SILENT;
  else process.env.WALLET_TELEMETRY_SILENT = previous;
});

describe("ingest/telemetry", () => {
  it("no escribe nada en stdout con WALLET_TELEMETRY_SILENT=1", async () => {
    process.env.WALLET_TELEMETRY_SILENT = "1";

    await withSpan("test.span", { foo: 1 }, async () => "ok");
    emitMetric("test.metric", { updated: 3 });

    expect(stdout).not.toHaveBeenCalled();
  });

  it("emite los spans en stdout cuando la variable no esta puesta", async () => {
    delete process.env.WALLET_TELEMETRY_SILENT;

    await withSpan("test.span", {}, async () => "ok");

    expect(stdout).toHaveBeenCalled();
  });

  // Silenciar es para el canal de resultado, no para tapar fallas: un error
  // tiene que seguir siendo visible aunque el CLI/MCP pidan silencio.
  it("manda los errores a stderr incluso silenciado, y los propaga", async () => {
    process.env.WALLET_TELEMETRY_SILENT = "1";

    await expect(
      withSpan("test.span", {}, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledOnce();
    expect(String(stderr.mock.calls[0]?.[0])).toContain("test.span.error");
  });
});
