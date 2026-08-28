/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMockFetch } from "../test/mockFetch";
import { ReviewTray } from "./ReviewTray";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const flagged = {
  id: 2,
  gmail_msg_id: "b",
  gmail_thread_id: null,
  ts: "2026-07-11T00:00:00Z",
  direction: "out",
  type: "debito",
  amount: 12,
  currency: "USD",
  counterparty: "Farmacia",
  account: null,
  category: null,
  raw_subject: null,
  is_reversed: 0,
  is_internal: 0,
  needs_review: 1,
  source: "gmail",
  created_at: "2026-07-11T00:00:00Z",
};

describe("ReviewTray", () => {
  it("renders transactions from /api/review", async () => {
    installMockFetch([{ body: { transactions: [flagged], count: 1 } }]);

    render(<ReviewTray />);

    expect(await screen.findByText(/Farmacia/)).toBeInTheDocument();
  });

  it("shows a done message when nothing needs review", async () => {
    installMockFetch([{ body: { transactions: [], count: 0 } }]);

    render(<ReviewTray />);

    expect(await screen.findByText("Nada pendiente de revision.")).toBeInTheDocument();
  });

  it("shows an error message when the request fails", async () => {
    installMockFetch([{ status: 500, ok: false, body: { error: "boom" } }]);

    render(<ReviewTray />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
