import { describe, expect, it, vi } from "vitest";
import { InMemoryTokenStore } from "./token-store.js";

describe("InMemoryTokenStore (test double)", () => {
  it("returns null before anything is saved", async () => {
    const store = new InMemoryTokenStore();
    expect(await store.load()).toBeNull();
  });

  it("round-trips a saved token", async () => {
    const store = new InMemoryTokenStore();
    await store.save("refresh-token-abc");
    expect(await store.load()).toBe("refresh-token-abc");
  });
});

const setPasswordMock = vi.fn();
const getPasswordMock = vi.fn();

vi.mock("@napi-rs/keyring", () => ({
  Entry: vi.fn().mockImplementation(() => ({
    setPassword: setPasswordMock,
    getPassword: getPasswordMock,
  })),
}));

describe("KeyringTokenStore (OS keychain, mocked)", () => {
  it("saves through @napi-rs/keyring's Entry.setPassword", async () => {
    const { KeyringTokenStore } = await import("./token-store.js");
    const store = new KeyringTokenStore();

    await store.save("refresh-token-xyz");

    expect(setPasswordMock).toHaveBeenCalledWith("refresh-token-xyz");
  });

  it("loads through @napi-rs/keyring's Entry.getPassword", async () => {
    getPasswordMock.mockReturnValueOnce("refresh-token-xyz");
    const { KeyringTokenStore } = await import("./token-store.js");
    const store = new KeyringTokenStore();

    expect(await store.load()).toBe("refresh-token-xyz");
  });

  it("returns null (not undefined) when no token is stored yet", async () => {
    getPasswordMock.mockReturnValueOnce(undefined);
    const { KeyringTokenStore } = await import("./token-store.js");
    const store = new KeyringTokenStore();

    expect(await store.load()).toBeNull();
  });
});
