/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMockFetch } from "../test/mockFetch";
import { SyncButton } from "./SyncButton";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SyncButton", () => {
  it("POSTs /api/sync and shows the returned summary", async () => {
    const { calls } = installMockFetch([{ body: { inserted: 4, updated: 1 } }]);
    const user = userEvent.setup();

    render(<SyncButton />);
    await user.click(screen.getByRole("button", { name: "Sincronizar" }));

    expect(await screen.findByRole("status")).toHaveTextContent("inserted");
    expect(calls[0].url).toBe("/api/sync");
    expect(calls[0].init?.method).toBe("POST");
  });

  it("shows an error state when the endpoint is not available yet", async () => {
    installMockFetch([{ status: 404, ok: false, body: { error: "not found" } }]);
    const user = userEvent.setup();

    render(<SyncButton />);
    await user.click(screen.getByRole("button", { name: "Sincronizar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("not found");
  });
});
