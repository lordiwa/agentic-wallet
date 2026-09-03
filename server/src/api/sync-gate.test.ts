import { describe, expect, it } from "vitest";
import { createSyncGate } from "./sync-gate.js";

describe("createSyncGate", () => {
  it("arranca libre", () => {
    expect(createSyncGate().isRunning()).toBe(false);
  });

  it("el segundo que llega no entra, y lo sabe", () => {
    const gate = createSyncGate();
    expect(gate.begin()).toBe(true);
    expect(gate.isRunning()).toBe(true);
    expect(gate.begin()).toBe(false);
  });

  it("al soltarla vuelve a estar libre", () => {
    const gate = createSyncGate();
    gate.begin();
    gate.end();
    expect(gate.isRunning()).toBe(false);
    expect(gate.begin()).toBe(true);
  });

  it("dos guardas son independientes: una por proceso, no una global del modulo", () => {
    const a = createSyncGate();
    const b = createSyncGate();
    a.begin();
    expect(b.isRunning()).toBe(false);
  });
});
