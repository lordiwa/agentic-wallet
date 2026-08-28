import { describe, expect, it } from "vitest";
import { fromCents, toCents } from "./money.js";

describe("toCents", () => {
  it("converts a USD amount to integer cents", () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0)).toBe(0);
    expect(toCents(1200)).toBe(120000);
  });

  it("avoids float-drift artifacts that plain `amount * 100` produces", () => {
    // 19.999999999999996 * 100 without rounding is 1999.9999999999998, not 2000.
    expect(toCents(19.999999999999996)).toBe(2000);
    // 0.1 + 0.2 is the canonical float-drift example: 0.30000000000000004 without rounding.
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it("rounds negative amounts the same way", () => {
    expect(toCents(-19.99)).toBe(-1999);
  });
});

describe("fromCents", () => {
  it("converts integer cents back to a USD amount", () => {
    expect(fromCents(1999)).toBe(19.99);
    expect(fromCents(120000)).toBe(1200);
    expect(fromCents(0)).toBe(0);
  });

  it("round-trips through toCents without drift", () => {
    expect(fromCents(toCents(2409))).toBe(2409);
    expect(fromCents(toCents(19.99))).toBe(19.99);
  });
});
