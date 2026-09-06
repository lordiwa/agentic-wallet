import { describe, expect, it } from "vitest";
import { parseStatementBody } from "./parse-statement.js";

// ---------------------------------------------------------------------------
// Spec 5.4/5.5 fixture — "Estado de Cuenta Produbanco - Grupo Promerica".
// The real email body arrives as HTML; the parser is handed the already
// html->text'd body (per InboundEmail), but tags/whitespace noise between a
// label and its value are still tolerated here so upstream stripping doesn't
// have to be perfect.
// ---------------------------------------------------------------------------

const FIXTURE_BODY = `
  <table>
    <tr><td>TARJETA No.:</td><td>4768XXXXXXXX1122</td></tr>
    <tr><td>Fecha de emisión:</td><td>
      2026 / 07 / 15
    </td></tr>
    <tr><td>Monto mínimo a pagar:</td><td>429.45</td></tr>
    <tr><td>Fecha máxima de pago:</td><td>2026 / 08 / 03</td></tr>
    <tr><td>Valor total a pagar:</td><td>3856.74</td></tr>
  </table>
`;

describe("parseStatementBody: spec 5.4/5.5 fixture", () => {
  it("extracts card_mask, issue_date, min_payment, due_date and balance", () => {
    const result = parseStatementBody(FIXTURE_BODY);
    expect(result.card_mask).toBe("4768XXXXXXXX1122");
    expect(result.issue_date).toBe("2026-07-15");
    expect(result.min_payment).toBe(429.45);
    expect(result.due_date).toBe("2026-08-03");
    expect(result.balance).toBe(3856.74);
  });
});

describe("parseStatementBody: a mojibaked body loses exactly the accented labels", () => {
  /**
   * Why this test exists: every statement in the real ledger came out as
   * `{card_mask, balance}` with `issue_date`, `min_payment` and `due_date`
   * all null -- which reads like "the parser can't handle this bank" even
   * though the fixture above is that bank's format and passes.
   *
   * It isn't the parser. Three of the five labels carry an accent ("Fecha de
   * emisión", "Monto mínimo a pagar", "Fecha máxima de pago") and two don't
   * ("TARJETA No.", "Valor total a pagar"). A body that arrived double-encoded
   * (the bug `ingest/mojibake.ts` repairs at the decode layer) turns "ó" into
   * "Ã³", so the three accented label regexes miss and the two clean ones hit
   * -- producing that exact shape and nothing else.
   *
   * `stripDiacritics` does NOT save it: it decomposes real combining marks, and
   * mojibake isn't one. The repair belongs where it already lives, in the Gmail
   * client's decode. This locks the signature so the null pattern is read as
   * "this body was mojibaked, re-sync it" instead of "the parser is broken".
   */
  const SANO =
    "TARJETA No.: 1234XXXXXXXX5678 Fecha de emisión: 2026 / 03 / 15 " +
    "Monto mínimo a pagar: 100.00 Fecha máxima de pago: 2026 / 04 / 03 Valor total a pagar: 200.00";
  /** El doble-encode UTF-8 -> latin-1 tal cual llega del mailer. */
  const MOJIBAKE = Buffer.from(SANO, "utf8").toString("latin1");

  it("parses everything when the body decoded cleanly", () => {
    expect(parseStatementBody(SANO)).toEqual({
      card_mask: "1234XXXXXXXX5678",
      issue_date: "2026-03-15",
      min_payment: 100,
      due_date: "2026-04-03",
      balance: 200,
    });
  });

  it("drops the three accented fields and keeps the two unaccented ones", () => {
    expect(parseStatementBody(MOJIBAKE)).toEqual({
      card_mask: "1234XXXXXXXX5678",
      issue_date: null,
      min_payment: null,
      due_date: null,
      balance: 200,
    });
  });
});

describe("parseStatementBody: date normalization (AC4)", () => {
  it("normalizes 'YYYY / MM / DD' (with surrounding whitespace) to ISO 8601", () => {
    const body = "Fecha máxima de pago: 2026 / 08 / 03";
    const result = parseStatementBody(body);
    expect(result.due_date).toBe("2026-08-03");
  });

  it("normalizes a tightly-formatted date the same way", () => {
    const body = "Fecha máxima de pago: 2026/08/03";
    const result = parseStatementBody(body);
    expect(result.due_date).toBe("2026-08-03");
  });
});

describe("parseStatementBody: missing/malformed fields never guess (spec philosophy, AC1)", () => {
  it("returns null for every field when the body has none of the expected labels", () => {
    const result = parseStatementBody("Este correo no es un estado de cuenta.");
    expect(result.card_mask).toBeNull();
    expect(result.issue_date).toBeNull();
    expect(result.min_payment).toBeNull();
    expect(result.due_date).toBeNull();
    expect(result.balance).toBeNull();
  });

  it("returns null only for the missing field when others are present", () => {
    const body = `
      TARJETA No.: 4768XXXXXXXX1122
      Monto mínimo a pagar: 429.45
      Valor total a pagar: 3856.74
    `;
    const result = parseStatementBody(body);
    expect(result.card_mask).toBe("4768XXXXXXXX1122");
    expect(result.min_payment).toBe(429.45);
    expect(result.balance).toBe(3856.74);
    expect(result.due_date).toBeNull();
    expect(result.issue_date).toBeNull();
  });

  it("does not coerce an amount with the wrong decimal precision", () => {
    const body = "Monto mínimo a pagar: 429.4 Valor total a pagar: 3856.7";
    const result = parseStatementBody(body);
    expect(result.min_payment).toBeNull();
    expect(result.balance).toBeNull();
  });

  it("does not coerce a malformed date (missing a segment)", () => {
    const body = "Fecha máxima de pago: 2026 / 08";
    const result = parseStatementBody(body);
    expect(result.due_date).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Review fix MEDIUM-1 (TASK-014 fix-now): NFD-decomposed accented input must
// parse identically to NFC-composed input. Gmail bodies aren't guaranteed to
// arrive NFC-composed ("í" = U+00ED, one codepoint); if the body is
// NFD-decomposed ("í" = "i" + U+0301 combining acute, two codepoints), the
// accented character classes in the label regexes (e.g. "m[ií]nimo") never
// match — every field silently comes back null.
// ---------------------------------------------------------------------------

describe("parseStatementBody: Unicode-normalization independence (review fix MEDIUM-1)", () => {
  it("parses an NFD-decomposed body the same as the NFC-composed equivalent", () => {
    const nfcResult = parseStatementBody(FIXTURE_BODY);

    const nfdBody = FIXTURE_BODY.normalize("NFD");
    const nfdResult = parseStatementBody(nfdBody);

    expect(nfdResult).toEqual(nfcResult);
    expect(nfdResult.min_payment).toBe(429.45);
    expect(nfdResult.due_date).toBe("2026-08-03");
    expect(nfdResult.balance).toBe(3856.74);
    expect(nfdResult.issue_date).toBe("2026-07-15");
  });
});

// ---------------------------------------------------------------------------
// Review fix MEDIUM-2 (TASK-014 fix-now): a date with an out-of-range or
// otherwise non-existent calendar value must never be persisted — it would
// feed the card payment strategy garbage.
// ---------------------------------------------------------------------------

describe("parseStatementBody: date range/calendar validation (review fix MEDIUM-2)", () => {
  it("rejects an out-of-range month and day (2026/13/45)", () => {
    const body = "Fecha máxima de pago: 2026 / 13 / 45";
    expect(parseStatementBody(body).due_date).toBeNull();
  });

  it("rejects month 00 (2026/00/10)", () => {
    const body = "Fecha máxima de pago: 2026 / 00 / 10";
    expect(parseStatementBody(body).due_date).toBeNull();
  });

  it("rejects a day that doesn't exist on the calendar (Feb 30)", () => {
    const body = "Fecha máxima de pago: 2026 / 02 / 30";
    expect(parseStatementBody(body).due_date).toBeNull();
  });

  it("still accepts a well-formed, valid date (2026/08/03)", () => {
    const body = "Fecha máxima de pago: 2026 / 08 / 03";
    expect(parseStatementBody(body).due_date).toBe("2026-08-03");
  });
});
