import { describe, expect, it } from "vitest";
import { maskAccountNumbers, maskEmailForExtractor } from "./mask.js";

describe("maskAccountNumbers (AC5)", () => {
  it("masks a run of 6+ digits down to its last 4", () => {
    expect(maskAccountNumbers("Cuenta origen: 1234567890")).toBe("Cuenta origen: XXXXXX7890");
  });

  it("leaves an already-masked account token untouched (idempotent)", () => {
    expect(maskAccountNumbers("Cuenta débito: ANA XXXXXX20924")).toBe("Cuenta débito: ANA XXXXXX20924");
  });

  it("does not mask short digit runs (e.g. a two-decimal amount)", () => {
    expect(maskAccountNumbers("Monto: USD 9.42")).toBe("Monto: USD 9.42");
  });

  it("masks multiple account-shaped runs in the same text", () => {
    expect(maskAccountNumbers("De 1112223334 a 5556667778")).toBe("De XXXXXX3334 a XXXXXX7778");
  });
});

describe("maskEmailForExtractor", () => {
  it("masks both subject and body, leaving other fields untouched", () => {
    const email = { subject: "Cuenta 9988776655", body: "Origen 1234509876", gmail_msg_id: "msg-1" };
    const masked = maskEmailForExtractor(email);

    expect(masked.subject).toBe("Cuenta XXXXXX6655");
    expect(masked.body).toBe("Origen XXXXXX9876");
    expect(masked.gmail_msg_id).toBe("msg-1");
  });
});
