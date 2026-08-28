import { describe, expect, it } from "vitest";
import { deriveAmountFromText, validateAmount } from "./amount-validate.js";

describe("deriveAmountFromText", () => {
  it("derives a number from a 'USD X.XX' substring", () => {
    expect(deriveAmountFromText("USD 9.42")).toBe(9.42);
  });

  it("derives a number from a '$X.XX' substring", () => {
    expect(deriveAmountFromText("$30.00")).toBe(30.0);
  });

  it("returns null for text with no strictly-anchored amount", () => {
    expect(deriveAmountFromText("nueve dólares con cuarenta y dos centavos")).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(deriveAmountFromText(null)).toBeNull();
    expect(deriveAmountFromText(undefined)).toBeNull();
  });

  it("never guesses from a truncated-decimal amount", () => {
    expect(deriveAmountFromText("USD 9.4")).toBeNull();
  });
});

describe("validateAmount (AC2 cross-validation)", () => {
  it("is ok when the parser's amount and Claude's raw text agree", () => {
    const result = validateAmount(9.42, "USD 9.42");
    expect(result.ok).toBe(true);
    expect(result.derived).toBe(9.42);
  });

  it("is not ok when they disagree", () => {
    const result = validateAmount(15.0, "USD 20.00");
    expect(result.ok).toBe(false);
    expect(result.derived).toBe(20.0);
  });

  it("is not ok when the parser itself found no amount", () => {
    const result = validateAmount(null, "USD 9.42");
    expect(result.ok).toBe(false);
  });

  it("is not ok when Claude's text has no parseable amount", () => {
    const result = validateAmount(9.42, null);
    expect(result.ok).toBe(false);
    expect(result.derived).toBeNull();
  });

  it("tolerates float drift cents-safe", () => {
    const result = validateAmount(0.1 + 0.2, "USD 0.30");
    expect(result.ok).toBe(true);
  });
});
