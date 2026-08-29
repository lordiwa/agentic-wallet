import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { reconstructFromMessages } from "./reconstruct.js";
import type { GmailMessage } from "./types.js";

const TITULAR = "PEREZ GOMEZ ANA MARIA";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

function message(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    gmail_msg_id: "msg-1",
    gmail_thread_id: "thread-1",
    subject: "",
    body: "",
    ts: "2026-07-01T12:00:00Z",
    ...overrides,
  };
}

function txRow(gmailMsgId: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT * FROM transactions WHERE gmail_msg_id = ?").get(gmailMsgId) as
    | Record<string, unknown>
    | undefined;
}

function countTransactions(): number {
  return (db.prepare("SELECT COUNT(*) as c FROM transactions").get() as { c: number }).c;
}

// ---------------------------------------------------------------------------
// AC4 — fixture batch (consumo débito, transferencia enviada, transferencia
// acreditada, reverso matching the consumo), no EmailExtractor anywhere in
// this path, idempotent on a second identical run.
// ---------------------------------------------------------------------------

describe("reconstructFromMessages: deterministic reconstruction (no EmailExtractor)", () => {
  function fixtureBatch(): GmailMessage[] {
    const consumo = message({
      gmail_msg_id: "msg-consumo",
      subject: "Consumo tarjeta de débito por USD 9.42",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMISARIATO EXPRESS",
      ts: "2026-07-01T15:00:00Z",
    });
    const transferenciaEnviada = message({
      gmail_msg_id: "msg-transferencia-enviada",
      subject: "Transferencia enviada por $30.00 desde Produbanco",
      body: "Contacto: Maria Lopez Banco Destino: Banco Pichincha",
      ts: "2026-07-01T16:00:00Z",
    });
    const transferenciaAcreditada = message({
      gmail_msg_id: "msg-transferencia-acreditada",
      // El asunto real no trae monto y no existe campo `De:`: el monto sale de
      // `Monto:` y el remitente de la prosa. Ver docs/formato-correos-produbanco.md 4.4.
      subject: "Transferencia recibida desde Produbanco",
      body:
        "Te confirmamos que Juan Perez ha realizado una transferencia a tu cuenta en BANCO EJEMPLO.\n" +
        "Monto: $50.00\nCuenta Destino: XXXXX11111",
      ts: "2026-07-01T17:00:00Z",
    });
    const reverso = message({
      gmail_msg_id: "msg-reverso",
      subject: "Notificación Reverso Consumo Tarjeta de Débito Produbanco",
      body: "Detalle Monto: $9.42 Fecha: 01/07/2026",
      ts: "2026-07-01T15:30:00Z",
    });
    return [consumo, transferenciaEnviada, transferenciaAcreditada, reverso];
  }

  it("persists every row with its deterministic amount/direction/type and reconciles the reverso", () => {
    const summary = reconstructFromMessages(db, fixtureBatch(), TITULAR);

    expect(summary.seen).toBe(4);
    expect(summary.inserted).toBe(4); // 3 transactions + 1 reverso audit row
    expect(summary.duplicates).toBe(0);
    expect(summary.needsReview).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.reversalsApplied).toBe(1);
    expect(countTransactions()).toBe(4);

    const consumoRow = txRow("msg-consumo");
    expect(consumoRow?.type).toBe("debito");
    expect(consumoRow?.direction).toBe("out");
    expect(consumoRow?.amount).toBe(9.42);
    expect(consumoRow?.is_reversed).toBe(1);
    expect(consumoRow?.source).toBe("deterministic");

    const enviadaRow = txRow("msg-transferencia-enviada");
    expect(enviadaRow?.type).toBe("transferencia");
    expect(enviadaRow?.direction).toBe("out");
    expect(enviadaRow?.amount).toBe(30.0);

    const acreditadaRow = txRow("msg-transferencia-acreditada");
    expect(acreditadaRow?.type).toBe("recibido");
    expect(acreditadaRow?.direction).toBe("in");
    expect(acreditadaRow?.amount).toBe(50.0);

    const reversoRow = txRow("msg-reverso");
    expect(reversoRow?.type).toBe("reverso");
    expect(reversoRow?.direction).toBe("in");
    expect(reversoRow?.amount).toBe(9.42);
    expect(reversoRow?.needs_review).toBe(0);
  });

  it("is idempotent: reprocessing the SAME batch inserts 0 new rows", () => {
    const batch = fixtureBatch();

    const first = reconstructFromMessages(db, batch, TITULAR);
    expect(first.inserted).toBe(4);
    expect(countTransactions()).toBe(4);

    const second = reconstructFromMessages(db, batch, TITULAR);
    expect(second.seen).toBe(4);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(4);
    expect(countTransactions()).toBe(4);

    // Flags/amount are untouched by the no-op re-run.
    expect(txRow("msg-consumo")?.is_reversed).toBe(1);
    expect(txRow("msg-consumo")?.amount).toBe(9.42);
  });
});

// ---------------------------------------------------------------------------
// AC1/AC2 — ignored/statement/reverso routing identical to pipeline.ts, via
// the same reused parseEmail/ingestStatementEmail/extractReversoFields.
// ---------------------------------------------------------------------------

describe("reconstructFromMessages: ignored/statement/unresolved-reverso routing", () => {
  it("skips a recognized non-transaction email without persisting anything", () => {
    const ignored = message({
      gmail_msg_id: "msg-ignored-login",
      subject: "Notificación Ingreso App Móvil Produbanco",
      body: "Se detecto un ingreso a tu app Produbanco.",
    });

    const summary = reconstructFromMessages(db, [ignored], TITULAR);

    expect(summary.skipped).toBe(1);
    expect(summary.inserted).toBe(0);
    expect(txRow("msg-ignored-login")).toBeUndefined();
  });

  it("persists a recognizable statement email via ingestStatementEmail, never into transactions", () => {
    const statement = message({
      gmail_msg_id: "msg-statement",
      subject: "Estado de Cuenta Produbanco - Grupo Promerica",
      body: `
        <table>
          <tr><td>TARJETA No.:</td><td>4768XXXXXXXX1122</td></tr>
          <tr><td>Fecha de emisión:</td><td>2026 / 07 / 15</td></tr>
          <tr><td>Monto mínimo a pagar:</td><td>429.45</td></tr>
          <tr><td>Fecha máxima de pago:</td><td>2026 / 08 / 03</td></tr>
          <tr><td>Valor total a pagar:</td><td>3856.74</td></tr>
        </table>
      `,
    });

    const summary = reconstructFromMessages(db, [statement], TITULAR);

    expect(summary.statementsPersisted).toBe(1);
    expect(summary.statementsNeedReview).toBe(0);
    const stmtRow = db.prepare("SELECT * FROM statements WHERE gmail_msg_id = ?").get("msg-statement") as
      | { balance: number }
      | undefined;
    expect(stmtRow?.balance).toBe(3856.74);
    expect(txRow("msg-statement")).toBeUndefined();
  });

  it("persists a reverso as needs_review when no amount can be extracted from its body", () => {
    const reverso = message({
      gmail_msg_id: "msg-reverso-no-amount",
      subject: "Notificación Reverso Consumo Tarjeta de Débito Produbanco",
      body: "Este es un reverso sin el campo Monto esperado.",
    });

    const summary = reconstructFromMessages(db, [reverso], TITULAR);

    expect(summary.needsReview).toBe(1);
    const row = txRow("msg-reverso-no-amount");
    expect(row?.needs_review).toBe(1);
    expect(row?.type).toBe("reverso");
  });

  it("flags needs_review on a transaction whose amount parseEmail itself could not determine (no EmailExtractor to blame)", () => {
    // Missing the "por USD X.XX" subject amount entirely -> parseEmail sets
    // needs_review itself; reconstruct must never invent a number.
    const consumoSinMonto = message({
      gmail_msg_id: "msg-consumo-sin-monto",
      subject: "Consumo tarjeta de débito por USD",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: PANADERIA",
    });

    const summary = reconstructFromMessages(db, [consumoSinMonto], TITULAR);

    expect(summary.needsReview).toBe(1);
    const row = txRow("msg-consumo-sin-monto");
    expect(row?.needs_review).toBe(1);
    expect(row?.amount).toBe(0); // UNKNOWN_AMOUNT_PLACEHOLDER, never guessed
  });
});
