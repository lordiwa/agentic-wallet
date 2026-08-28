/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMockFetch } from "../test/mockFetch";
import { currentUtcMonthRange, endOfDayIso } from "../lib/dates";
import { average, dailyTotals } from "../lib/spending";
import { DailySpendChart, SpendingByCategoryChart } from "./SpendingCharts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SpendingByCategoryChart", () => {
  it("renders every category from spending_by_category (AC3), no invented ones", () => {
    render(<SpendingByCategoryChart spendingByCategory={{ comida: 40, servicios: 15 }} />);

    expect(screen.getByText("comida: 40 USD")).toBeInTheDocument();
    expect(screen.getByText("servicios: 15 USD")).toBeInTheDocument();
  });

  it("shows a 'sin datos' message when there is no spend this month", () => {
    render(<SpendingByCategoryChart spendingByCategory={{}} />);

    expect(screen.getByText("Sin gastos registrados este mes.")).toBeInTheDocument();
  });
});

describe("DailySpendChart", () => {
  // Computed against the real current date rather than a hardcoded one, so
  // the test stays valid regardless of when it runs (no fake-timer
  // interaction with @testing-library's MutationObserver-based waitFor).
  const { from, to } = currentUtcMonthRange();
  const sampleTransactions = [
    { ts: `${from}T10:00:00Z`, amount: 10 },
    { ts: `${to}T10:00:00Z`, amount: 20 },
  ];
  const expectedAverage = average(dailyTotals(sampleTransactions, from, to).map((d) => d.total));

  it("fetches the current month's out transactions and renders the computed average (AC3)", async () => {
    installMockFetch([{ body: { transactions: sampleTransactions, count: 2 } }]);

    render(<DailySpendChart />);

    expect(await screen.findByText(`Promedio diario: ${expectedAverage.toFixed(2)} USD`)).toBeInTheDocument();
  });

  it("sends an end-inclusive 'to' bound so today's transactions aren't dropped (AC4)", async () => {
    const { calls } = installMockFetch([{ body: { transactions: [], count: 0 } }]);

    render(<DailySpendChart />);
    await screen.findByText(/Promedio diario/);

    expect(calls[0].url).toContain(`to=${encodeURIComponent(endOfDayIso(to))}`);
    expect(calls[0].url).toContain("direction=out");
  });
});
