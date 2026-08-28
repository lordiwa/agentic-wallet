import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { ingestStatementEmail } from "./ingest-statement.js";
import type { IngestStatementResult } from "./ingest-statement.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

const FIXTURE_BODY = `
  <table>
    <tr><td>TARJETA No.:</td><td>4768XXXXXXXX1122</td></tr>
    <tr><td>Fecha de emisión:</td><td>2026 / 07 / 15</td></tr>
    <tr><td>Monto mínimo a pagar:</td><td>429.45</td></tr>
    <tr><td>Fecha máxima de pago:</td><td>2026 / 08 / 03</td></tr>
    <tr><td>Valor total a pagar:</td><td>3856.74</td></tr>
  </table>
`;

function statementEmail(overrides: { gmail_msg_id?: string; body?: string } = {}) {
  return {
    subject: "Estado de Cuenta Produbanco - Grupo Promerica",
    body: FIXTURE_BODY,
    gmail_msg_id: "stmt-msg-1",
    ts: "2026-07-15T08:00:00Z",
    ...overrides,
  };
}

/** Narrows an IngestStatementResult to its persisted branch, failing loudly otherwise. */
function asPersisted(result: IngestStatementResult): Extract<IngestStatementResult, { persisted: true }> {
  if (!result.persisted) {
    throw new Error(`expected persisted result, got: ${JSON.stringify(result)}`);
  }
  return result;
}

describe("ingestStatementEmail", () => {
  it("parses the body and persists the official statement fields (AC1/AC2)", () => {
    const { inserted, row } = asPersisted(ingestStatementEmail(db, statementEmail()));
    expect(inserted).toBe(true);
    expect(row.card_mask).toBe("4768XXXXXXXX1122");
    expect(row.issue_date).toBe("2026-07-15");
    expect(row.min_payment).toBe(429.45);
    expect(row.due_date).toBe("2026-08-03");
    expect(row.balance).toBe(3856.74);
    expect(row.gmail_msg_id).toBe("stmt-msg-1");
  });

  it("is idempotent by gmail_msg_id: reparsing the same email does not duplicate (AC3)", () => {
    ingestStatementEmail(db, statementEmail());
    const second = asPersisted(
      ingestStatementEmail(db, statementEmail({ body: FIXTURE_BODY.replace("3856.74", "9999.99") }))
    );
    expect(second.inserted).toBe(false);
    // the original row wins; the reparse did not overwrite it
    expect(second.row.balance).toBe(3856.74);

    const count = db.prepare("SELECT COUNT(*) as c FROM statements").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("stores nulls for a field that could not be extracted rather than guessing, while other key fields anchor the statement", () => {
    // due_date is missing, but balance and min_payment are present — this is
    // still a recognizable statement, just partially incomplete.
    const partialBody = `
      TARJETA No.: 4768XXXXXXXX1122
      Monto mínimo a pagar: 429.45
      Valor total a pagar: 3856.74
    `;
    const { row } = asPersisted(
      ingestStatementEmail(db, statementEmail({ gmail_msg_id: "stmt-msg-2", body: partialBody }))
    );
    expect(row.due_date).toBeNull();
    expect(row.issue_date).toBeNull();
    expect(row.balance).toBe(3856.74);
  });

  // Review fix (TASK-014 fix-now, related-3): a body with none of the three
  // key fields (balance, min_payment, due_date) is not a recognizable
  // statement — persisting it would put an all-null row into `statements`
  // that a payment strategy could misread as "no balance due".
  it("does not persist a row when the email is not a recognizable statement", () => {
    const result = ingestStatementEmail(
      db,
      statementEmail({ gmail_msg_id: "stmt-msg-3", body: "Correo sin los campos esperados." })
    );
    expect(result.persisted).toBe(false);
    if (!result.persisted) {
      expect(result.needs_review).toBe(true);
      expect(result.reason).toBe("no_recognizable_statement_fields");
    }

    const count = db.prepare("SELECT COUNT(*) as c FROM statements").get() as { c: number };
    expect(count.c).toBe(0);
  });
});
