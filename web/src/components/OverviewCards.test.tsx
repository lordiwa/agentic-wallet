/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMockFetch } from "../test/mockFetch";
import { OverviewCards } from "./OverviewCards";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OverviewCards", () => {
  it("renders the balance and card figures from /api/overview, no invented numbers", async () => {
    installMockFetch([
      {
        body: {
          balance: { amount: 2409, currency: "USD", at: "2026-07-20" },
          card: {
            card_mask: "XXXXXX20924",
            issue_date: "2026-07-01",
            balance: 350.75,
            min_payment: 35,
            due_date: "2026-07-25",
          },
          counts: { total: 12, needs_review: 3 },
        },
      },
    ]);

    render(<OverviewCards />);

    expect(await screen.findByText(/2409 USD/)).toBeInTheDocument();
    expect(screen.getByText("XXXXXX20924")).toBeInTheDocument();
    expect(screen.getByText("350.75")).toBeInTheDocument();
    expect(screen.getByText(/Total: 12 - Por revisar: 3/)).toBeInTheDocument();
  });

  it("renders a graceful empty state when balance/card are null (unseeded)", async () => {
    installMockFetch([
      {
        body: { balance: null, card: null, counts: { total: 0, needs_review: 0 } },
      },
    ]);

    render(<OverviewCards />);

    expect(await screen.findByText("Sin datos de saldo aun.")).toBeInTheDocument();
    expect(screen.getByText("Sin estado de cuenta aun.")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    installMockFetch([{ status: 500, ok: false, body: { error: "boom" } }]);

    render(<OverviewCards />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
