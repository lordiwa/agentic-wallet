/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshProvider, useRefresh, useRefreshTick } from "./refresh";

/** Cuenta cuantas veces un `useEffect` con el tick en sus deps volvio a
 * correr: es exactamente lo que hace cada seccion del dashboard con su
 * fetch. */
function Fetcher() {
  const tick = useRefreshTick();
  const [runs, setRuns] = useState(0);
  useEffect(() => {
    setRuns((n) => n + 1);
  }, [tick]);
  return <p>corridas: {runs}</p>;
}

function ManualRefresher() {
  const { refreshNow } = useRefresh();
  return (
    <button type="button" onClick={refreshNow}>
      refrescar
    </button>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RefreshProvider", () => {
  it("vuelve a correr los efectos en cada intervalo", async () => {
    render(
      <RefreshProvider intervalMs={1000}>
        <Fetcher />
      </RefreshProvider>
    );
    expect(screen.getByText("corridas: 1")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("corridas: 2")).toBeInTheDocument();

    // Dos intervalos que caen en el mismo render se juntan en una sola
    // corrida: si la pestania estuvo trabada, al soltarse pide los datos una
    // vez, no una por cada tick perdido.
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("corridas: 3")).toBeInTheDocument();
  });

  it("refreshNow no espera al intervalo", async () => {
    render(
      <RefreshProvider intervalMs={100000}>
        <Fetcher />
        <ManualRefresher />
      </RefreshProvider>
    );

    await act(async () => {
      screen.getByRole("button", { name: "refrescar" }).click();
    });
    expect(screen.getByText("corridas: 2")).toBeInTheDocument();
  });

  it("con la pestania oculta el reloj se para, y al volver se pone al dia", async () => {
    render(
      <RefreshProvider intervalMs={1000}>
        <Fetcher />
      </RefreshProvider>
    );

    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(5000);
    });
    // Cinco intervalos con la pestania oculta no generaron ni una corrida.
    expect(screen.getByText("corridas: 1")).toBeInTheDocument();

    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByText("corridas: 2")).toBeInTheDocument();
  });

  it("fuera del provider el tick nunca cambia: una sola carga, como antes", async () => {
    render(<Fetcher />);
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText("corridas: 1")).toBeInTheDocument();
  });

  it("no deja el intervalo vivo despues de desmontar", async () => {
    const { unmount } = render(
      <RefreshProvider intervalMs={1000}>
        <Fetcher />
      </RefreshProvider>
    );
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
