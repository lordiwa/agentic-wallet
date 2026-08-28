/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverviewResponse } from "../api/types";
import { CardStatusCard, NextPaydayCard, StrategyCards, TransfersVsTopeCard } from "./StrategyCards";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const baseOverview: OverviewResponse = {
  balance: null,
  card: null,
  counts: { total: 0, needs_review: 0 },
  safe_to_spend_hoy: 12.5,
  buffer_status: { objetivo: 500, reservado: 250, financiado: false, faltante: 250 },
  card_status: {
    saldoCorte: 300,
    minimo: 30,
    fechaMaxima: "2026-07-25",
    saldoActualEstimado: 320,
    aTiempo: true,
    requeridoPorQuincena: 150,
  },
  transfers_summary: { total: 100, tope: 200, restante: 100, sobrepasado: false, topContrapartes: [] },
  next_payday: "2026-07-25",
  spending_by_category: {},
};

describe("StrategyCards", () => {
  it("renders every figure from /api/overview, no invented numbers (AC1)", async () => {
    render(<StrategyCards overview={baseOverview} />);

    expect(await screen.findByText("12.5 USD/dia")).toBeInTheDocument();
    expect(screen.getByText(/250 \/ 500 USD \(50%\)/)).toBeInTheDocument();
    expect(screen.getByText("300")).toBeInTheDocument(); // saldoCorte
  });

  it("shows explicit 'sin datos' states when card_status/next_payday are null", () => {
    const overview: OverviewResponse = {
      ...baseOverview,
      card_status: null,
      next_payday: null,
      safe_to_spend_hoy: 0,
    };

    render(<StrategyCards overview={overview} />);

    expect(screen.getByText("Sin estado de cuenta aun.")).toBeInTheDocument();
    expect(screen.getByText("Sin fecha de proximo pago conocida.")).toBeInTheDocument();
    expect(screen.getByText("Sin datos suficientes (no hay proxima fecha de pago).")).toBeInTheDocument();
  });

  it("reflects card_status.aTiempo in the semaforo", () => {
    const overview: OverviewResponse = {
      ...baseOverview,
      card_status: { ...baseOverview.card_status!, aTiempo: false },
    };

    render(<CardStatusCard overview={overview} />);

    const semaforo = screen.getByTestId("tarjeta-semaforo");
    expect(semaforo).toHaveTextContent("En riesgo");
    expect(semaforo).toHaveStyle({ color: "#c62828" });
  });

  it("shows a warning when the monthly transfer cap is exceeded (sobrepasado)", () => {
    const overview: OverviewResponse = {
      ...baseOverview,
      transfers_summary: { total: 250, tope: 200, restante: -50, sobrepasado: true, topContrapartes: [] },
    };

    render(<TransfersVsTopeCard overview={overview} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Tope de transferencias del mes superado.");
  });

  it("computes the next-payday countdown (AC2)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));

    const overview: OverviewResponse = { ...baseOverview, next_payday: "2026-07-25" };
    render(<NextPaydayCard overview={overview} />);

    expect(screen.getByText("2026-07-25 (en 5 dias)")).toBeInTheDocument();
  });
});
