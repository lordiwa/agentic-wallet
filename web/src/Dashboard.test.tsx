/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";
import { API_BASE_STORAGE_KEY, DEMO_BASE } from "./api/base";

/**
 * Prueba de humo del artefacto que se publica en Firebase Hosting: el sitio
 * arranca en modo demostracion y ahi NO hay red, asi que si algo del modo
 * demo no calza con lo que espera la UI, la pagina desplegada queda en
 * blanco y nadie se entera hasta abrirla. Esto la abre.
 *
 * `fetch` se rompe a proposito: el modo demo no debe salir a la red ni una
 * vez — si lo hiciera, el sitio publico estaria pegandole a un `/api` que en
 * un hosting estatico no existe.
 */
beforeEach(() => {
  window.localStorage.setItem(API_BASE_STORAGE_KEY, DEMO_BASE);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("el modo demostracion no debe salir a la red");
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Dashboard publicado (modo demostracion)", () => {
  it("avisa que los datos son inventados antes que ninguna otra cosa", async () => {
    render(<Dashboard />);
    expect(await screen.findByText(/MODO DEMOSTRACION/)).toBeInTheDocument();
  });

  it("pinta las secciones con datos, no una pantalla de errores", async () => {
    render(<Dashboard />);

    // Resumen
    expect(await screen.findByText(/1840.25 USD/)).toBeInTheDocument();
    // Estado del sync
    expect(await screen.findByText("Al dia")).toBeInTheDocument();
    // Bandeja de revision (las filas demo con needs_review)
    const bandeja = await screen.findByRole("region", { name: "Necesitan revision" });
    expect(bandeja.querySelectorAll("li").length).toBeGreaterThan(0);
    // Tabla de transacciones
    expect(await screen.findByRole("table")).toBeInTheDocument();

    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
});
