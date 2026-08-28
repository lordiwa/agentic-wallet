/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMockFetch } from "../test/mockFetch";
import { TransactionsTable } from "./TransactionsTable";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sampleTx = {
  id: 1,
  gmail_msg_id: "a",
  gmail_thread_id: null,
  ts: "2026-07-10T00:00:00Z",
  direction: "out",
  type: "debito",
  amount: 25.5,
  currency: "USD",
  counterparty: "Supermaxi",
  account: null,
  category: null,
  raw_subject: null,
  is_reversed: 0,
  is_internal: 0,
  needs_review: 0,
  source: "gmail",
  created_at: "2026-07-10T00:00:00Z",
};

describe("TransactionsTable", () => {
  it("renders rows from /api/transactions", async () => {
    installMockFetch([{ body: { transactions: [sampleTx], count: 1 } }]);

    render(<TransactionsTable />);

    expect(await screen.findByText("Supermaxi")).toBeInTheDocument();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("debito")).toBeInTheDocument();
  });

  it("shows an empty-state message when there are no transactions", async () => {
    installMockFetch([{ body: { transactions: [], count: 0 } }]);

    render(<TransactionsTable />);

    expect(await screen.findByText("No hay transacciones.")).toBeInTheDocument();
  });

  it("re-fetches with the counterparty filter param when the form is submitted", async () => {
    const { calls } = installMockFetch([
      { body: { transactions: [sampleTx], count: 1 } },
      { body: { transactions: [sampleTx], count: 1 } },
    ]);
    const user = userEvent.setup();

    render(<TransactionsTable />);
    await screen.findByText("Supermaxi");

    await user.type(screen.getByLabelText("Contraparte"), "Supermaxi");
    await user.click(screen.getByRole("button", { name: "Filtrar" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    const secondRequestUrl = calls[1].url;
    expect(secondRequestUrl).toContain("counterparty=Supermaxi");
  });

  it("shows an error message when the request fails", async () => {
    installMockFetch([{ status: 500, ok: false, body: { error: "boom" } }]);

    render(<TransactionsTable />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("sends an end-of-day 'to' bound so same-day transactions aren't excluded (AC4)", async () => {
    const { calls } = installMockFetch([
      { body: { transactions: [sampleTx], count: 1 } },
      { body: { transactions: [sampleTx], count: 1 } },
    ]);
    const user = userEvent.setup();

    render(<TransactionsTable />);
    await screen.findByText("Supermaxi");

    const toInput = screen.getByLabelText("Hasta");
    await user.type(toInput, "2026-07-15");
    await user.click(screen.getByRole("button", { name: "Filtrar" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].url).toContain(`to=${encodeURIComponent("2026-07-15T23:59:59.999Z")}`);
  });

  it("shows the counterparty filter as exact-match (AC5)", async () => {
    installMockFetch([{ body: { transactions: [sampleTx], count: 1 } }]);

    render(<TransactionsTable />);
    await screen.findByText("Supermaxi");

    expect(screen.getByText("(coincidencia exacta)")).toBeInTheDocument();
  });

  it("shows a 'more results' notice and enables Siguiente when a page is full (AC5)", async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => ({ ...sampleTx, id: i + 1 }));
    installMockFetch([{ body: { transactions: fullPage, count: 50 } }]);

    render(<TransactionsTable />);

    expect(await screen.findByText(/Mostrando los primeros 50 resultados/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();
  });

  it("pages forward with Siguiente using an offset param", async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => ({ ...sampleTx, id: i + 1 }));
    const { calls } = installMockFetch([
      { body: { transactions: fullPage, count: 50 } },
      { body: { transactions: [sampleTx], count: 1 } },
    ]);
    const user = userEvent.setup();

    render(<TransactionsTable />);
    await screen.findByText(/Mostrando los primeros 50 resultados/);

    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].url).toContain("offset=50");
  });

  it("resets pagination back to the first page on Limpiar (neighboring reset path)", async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => ({ ...sampleTx, id: i + 1 }));
    const { calls } = installMockFetch([
      { body: { transactions: fullPage, count: 50 } },
      { body: { transactions: [sampleTx], count: 1 } },
      { body: { transactions: fullPage, count: 50 } },
    ]);
    const user = userEvent.setup();

    render(<TransactionsTable />);
    await screen.findByText(/Mostrando los primeros 50 resultados/);

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].url).toContain("offset=50");

    await user.click(screen.getByRole("button", { name: "Limpiar" }));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].url).not.toContain("offset=50");
    expect(calls[2].url).toContain("offset=0");
  });
});
