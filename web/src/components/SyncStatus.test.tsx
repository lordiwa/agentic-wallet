/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMockFetch } from "../test/mockFetch";
import { SyncStatus } from "./SyncStatus";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SyncStatus", () => {
  it("pide el estado en frio, sin disparar un sync", async () => {
    const { calls } = installMockFetch([{ body: { last_sync_ts: new Date().toISOString(), backlog: null } }]);

    render(<SyncStatus />);
    await screen.findByText("Al dia");

    expect(calls[0].url).toBe("/api/sync/status");
    expect(calls[0].init?.method ?? "GET").toBe("GET");
  });

  it("marca atrasado cuando el ultimo sync es de hace mas de un dia", async () => {
    installMockFetch([{ body: { last_sync_ts: "2020-01-01T00:00:00Z", backlog: null } }]);

    render(<SyncStatus />);
    expect(await screen.findByText("Atrasado")).toBeInTheDocument();
  });

  it("sin sync previo lo dice, no muestra una fecha inventada", async () => {
    installMockFetch([{ body: { last_sync_ts: null, backlog: null } }]);

    render(<SyncStatus />);
    expect(await screen.findByText("Nunca se sincronizo")).toBeInTheDocument();
  });

  it("un backlog a medias manda sobre la fecha y dice cuanto falta", async () => {
    installMockFetch([
      {
        body: {
          last_sync_ts: new Date().toISOString(),
          backlog: { processed: 50, total: 1717, remaining: 1667, updated_at: new Date().toISOString() },
        },
      },
    ]);

    render(<SyncStatus />);
    expect(await screen.findByText("Sincronizacion a medias")).toBeInTheDocument();
    expect(screen.getByText(/50 de 1717/)).toBeInTheDocument();
  });

  it("un fallo se reporta, no deja el estado anterior en pantalla", async () => {
    installMockFetch([{ status: 500, ok: false, body: {} }]);

    render(<SyncStatus />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Estado del sync no disponible");
  });
});
