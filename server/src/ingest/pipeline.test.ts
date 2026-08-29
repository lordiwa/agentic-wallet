import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { upsertCategoryRule } from "../category/rules-repository.js";
import { buildSearchQuery, ingestBatch, ingestOnce } from "./pipeline.js";
import { listParsers, registerParser } from "../parser/index.js";
import type { BankEmailParser } from "../parser/types.js";
import { EXCLUDE_FROM_TOTALS_SQL } from "../strategy/totals.js";
import type { IngestDeps } from "./pipeline.js";
import type { EmailExtractor, ExtractedEmail, GmailClient, GmailMessage } from "./types.js";

const TITULAR = "PEREZ GOMEZ ANA MARIA";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

// ---------------------------------------------------------------------------
// Fakes — the two mocked boundaries (Gmail, Claude).
// ---------------------------------------------------------------------------

/** In-memory GmailClient that paginates internally over `pageSize`-sized
 * chunks, mirroring the real client's do-while shape closely enough to
 * prove the pipeline consumes a paginated multi-call search transparently. */
class FakeGmailClient implements GmailClient {
  listCalls = 0;

  constructor(
    private readonly messages: GmailMessage[],
    private readonly pageSize = 50
  ) {}

  async searchMessageIds(_query: string): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < this.messages.length; i += this.pageSize) {
      this.listCalls += 1;
      ids.push(...this.messages.slice(i, i + this.pageSize).map((m) => m.gmail_msg_id));
    }
    return ids;
  }

  async getMessage(id: string): Promise<GmailMessage> {
    const found = this.messages.find((m) => m.gmail_msg_id === id);
    if (!found) throw new Error(`FakeGmailClient: no message ${id}`);
    return found;
  }
}

/** Fake EmailExtractor keyed by (masked) subject — the interface never
 * receives gmail_msg_id, only subject/body, so tests key canned responses
 * by subject text. Also records every email it was handed, so tests can
 * assert masking (AC5) and that it's never called for non-transaction kinds. */
class FakeEmailExtractor implements EmailExtractor {
  received: Array<{ subject: string; body: string }> = [];

  constructor(private readonly responsesBySubject: Map<string, ExtractedEmail>) {}

  async extract(email: { subject: string; body: string }): Promise<ExtractedEmail> {
    this.received.push(email);
    return this.responsesBySubject.get(email.subject) ?? { amount_text_raw: null, counterparty: null };
  }
}

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

function deps(gmailClient: GmailClient, extractor: EmailExtractor): IngestDeps {
  return { db, gmailClient, extractor, titular: TITULAR };
}

/** Igual que `deps`, pero con el titular sin configurar todavia — el estado
 * real de cualquiera que sincroniza ANTES de terminar el onboarding. */
function depsSinTitular(gmailClient: GmailClient, extractor: EmailExtractor): IngestDeps {
  return { db, gmailClient, extractor, titular: null };
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
// AC2 — amount cross-validation.
// ---------------------------------------------------------------------------

describe("ingestOnce: amount cross-validation (AC2)", () => {
  it("persists when Claude's amount_text_raw agrees with the deterministic parser's amount", async () => {
    const consumo = message({
      gmail_msg_id: "msg-consumo-match",
      subject: "Consumo tarjeta de débito por USD 9.42",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMISARIATO EXPRESS\nCuenta origen: 1234567890",
    });
    const gmail = new FakeGmailClient([consumo]);
    const extractor = new FakeEmailExtractor(
      new Map([[consumo.subject, { amount_text_raw: "USD 9.42", counterparty: "COMISARIATO EXPRESS" }]])
    );

    const summary = await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(summary.seen).toBe(1);
    expect(summary.inserted).toBe(1);
    expect(summary.needsReview).toBe(0);

    const row = txRow("msg-consumo-match");
    expect(row?.amount).toBe(9.42);
    expect(row?.needs_review).toBe(0);

    // AC5: accounts must be masked before anything reaches the extractor.
    expect(extractor.received).toHaveLength(1);
    expect(extractor.received[0].body).not.toContain("1234567890");
    expect(extractor.received[0].body).toContain("XXXXXX7890");
  });

  it("flags needs_review and excludes from totals when Claude's amount disagrees with the deterministic parser", async () => {
    const consumo = message({
      gmail_msg_id: "msg-consumo-mismatch",
      subject: "Consumo tarjeta de débito por USD 15.00",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: FARMACIA CRUZ AZUL",
    });
    const gmail = new FakeGmailClient([consumo]);
    // Claude hallucinates a different amount than what's actually in the raw text.
    const extractor = new FakeEmailExtractor(new Map([[consumo.subject, { amount_text_raw: "USD 20.00", counterparty: null }]]));

    const summary = await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(summary.inserted).toBe(1);
    expect(summary.needsReview).toBe(1);

    const row = txRow("msg-consumo-mismatch");
    // The deterministic amount is what gets stored (never Claude's number) —
    // it's just flagged, not silently trusted either way.
    expect(row?.amount).toBe(15.0);
    expect(row?.needs_review).toBe(1);
  });

  it("flags needs_review when Claude returns no amount_text_raw at all", async () => {
    const consumo = message({
      gmail_msg_id: "msg-consumo-no-claude-amount",
      subject: "Consumo tarjeta de débito por USD 3.50",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: PANADERIA",
    });
    const gmail = new FakeGmailClient([consumo]);
    const extractor = new FakeEmailExtractor(new Map([[consumo.subject, { amount_text_raw: null, counterparty: null }]]));

    const summary = await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(summary.needsReview).toBe(1);
    expect(txRow("msg-consumo-no-claude-amount")?.needs_review).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Sync sin titular configurado — el orden real del onboarding es "sincroniza
// primero, configura el perfil despues" (el titular se PROPONE leyendo el
// ledger), asi que exigir titular para sincronizar hacia un deadlock.
// ---------------------------------------------------------------------------

describe("ingestOnce: sin titular configurado", () => {
  function transferenciaASiMismo() {
    return message({
      gmail_msg_id: "msg-transferencia-propia",
      subject: "Transferencia enviada por $30.00 desde Produbanco",
      body: `Contacto: ${TITULAR} Banco Destino: Produbanco`,
    });
  }

  function extractorDe(msg: GmailMessage) {
    return new FakeEmailExtractor(new Map([[msg.subject, { amount_text_raw: "$30.00", counterparty: TITULAR }]]));
  }

  it("no falla: ingesta normal y solo omite el marcado de transferencias internas", async () => {
    const transferencia = transferenciaASiMismo();
    const summary = await ingestOnce(
      depsSinTitular(new FakeGmailClient([transferencia]), extractorDe(transferencia)),
      { sinceTs: "2026-06-01T00:00:00Z" }
    );

    expect(summary.inserted).toBe(1);
    expect(summary.needsReview).toBe(0);
    // Sin titular no hay con que comparar: la fila entra sin marcar, no se
    // adivina. La marca correcta llega cuando el usuario confirme el titular.
    expect(txRow("msg-transferencia-propia")?.is_internal).toBe(0);
  });

  // `null` no es la unica forma de "sin titular": `strategy_config` puede
  // tener la clave escrita en blanco, y `onboard/status.ts` la lee como no
  // configurada con un `trim()`. La ingesta tiene que coincidir con esa
  // lectura, no marcar internas contra un nombre vacio.
  it.each(["", "   "])("trata el titular en blanco (%j) igual que sin configurar", async (titular) => {
    const transferencia = transferenciaASiMismo();
    const summary = await ingestOnce(
      { db, gmailClient: new FakeGmailClient([transferencia]), extractor: extractorDe(transferencia), titular },
      { sinceTs: "2026-06-01T00:00:00Z" }
    );

    expect(summary.inserted).toBe(1);
    expect(txRow("msg-transferencia-propia")?.is_internal).toBe(0);
  });

  it("con titular configurado marca la transferencia a si mismo como interna", async () => {
    const transferencia = transferenciaASiMismo();
    await ingestOnce(deps(new FakeGmailClient([transferencia]), extractorDe(transferencia)), {
      sinceTs: "2026-06-01T00:00:00Z",
    });

    expect(txRow("msg-transferencia-propia")?.is_internal).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC4 — idempotent persistence by gmail_msg_id.
// ---------------------------------------------------------------------------

describe("ingestOnce: idempotent persistence (AC4)", () => {
  it("reprocessing the same email does not duplicate the row", async () => {
    const consumo = message({
      gmail_msg_id: "msg-idempotent",
      subject: "Consumo tarjeta de débito por USD 9.42",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMISARIATO EXPRESS",
    });
    const responses = new Map([[consumo.subject, { amount_text_raw: "USD 9.42", counterparty: "COMISARIATO EXPRESS" }]]);

    const first = await ingestOnce(deps(new FakeGmailClient([consumo]), new FakeEmailExtractor(responses)), {
      sinceTs: "2026-06-01T00:00:00Z",
    });
    expect(first.inserted).toBe(1);
    expect(first.duplicates).toBe(0);

    const second = await ingestOnce(deps(new FakeGmailClient([consumo]), new FakeEmailExtractor(responses)), {
      sinceTs: "2026-06-01T00:00:00Z",
    });
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(1);

    expect(countTransactions()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F1-04 reversal rules wired through the pipeline.
// ---------------------------------------------------------------------------

describe("ingestOnce: reversal rules (F1-04)", () => {
  it("matches a reverso to its consumo and marks it is_reversed", async () => {
    const consumo = message({
      gmail_msg_id: "msg-consumo-1",
      subject: "Consumo tarjeta de débito por USD 9.42",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMISARIATO EXPRESS",
      ts: "2026-07-01T15:00:00Z",
    });
    const reverso = message({
      gmail_msg_id: "msg-reverso-1",
      subject: "Notificación Reverso Consumo Tarjeta de Débito Produbanco",
      body: "Detalle Monto: $9.42 Fecha: 01/07/2026",
      ts: "2026-07-01T15:30:00Z",
    });
    const gmail = new FakeGmailClient([consumo, reverso]);
    const extractor = new FakeEmailExtractor(
      new Map([[consumo.subject, { amount_text_raw: "USD 9.42", counterparty: "COMISARIATO EXPRESS" }]])
    );

    const summary = await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(summary.reversalsApplied).toBe(1);
    const consumoRow = txRow("msg-consumo-1");
    expect(consumoRow?.is_reversed).toBe(1);

    // Review fix (TASK-017 HIGH-1, part b): a matched reverso is still
    // persisted as its own auditable trace row (never summed as a
    // needs_review item — it's fully resolved, not awaiting a human).
    const reversoRow = txRow("msg-reverso-1");
    expect(reversoRow).toBeDefined();
    expect(reversoRow?.type).toBe("reverso");
    expect(reversoRow?.needs_review).toBe(0);

    // Extractor is only ever invoked for "transaction"-kind emails.
    expect(extractor.received).toHaveLength(1);
  });

  it("persists an ambiguous reverso (2+ candidates) as its own needs_review row, and flags both candidate consumos", async () => {
    const consumoA = message({
      gmail_msg_id: "msg-consumo-a",
      subject: "Consumo tarjeta de débito por USD 9.42",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMISARIATO EXPRESS",
      ts: "2026-07-01T10:00:00Z",
    });
    const consumoB = message({
      gmail_msg_id: "msg-consumo-b",
      subject: "Consumo tarjeta de débito por USD 9.42",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMISARIATO EXPRESS",
      ts: "2026-07-01T11:00:00Z",
    });
    const reverso = message({
      gmail_msg_id: "msg-reverso-ambiguous",
      subject: "Notificación Reverso Consumo Tarjeta de Débito Produbanco",
      body: "Detalle Monto: $9.42 Fecha: 01/07/2026",
      ts: "2026-07-01T11:30:00Z",
    });
    const gmail = new FakeGmailClient([consumoA, consumoB, reverso]);
    const extractor = new FakeEmailExtractor(
      new Map([[consumoA.subject, { amount_text_raw: "USD 9.42", counterparty: "COMISARIATO EXPRESS" }]])
    );

    const summary = await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(summary.reversalsApplied).toBe(0);
    expect(txRow("msg-consumo-a")?.needs_review).toBe(1);
    expect(txRow("msg-consumo-b")?.needs_review).toBe(1);

    const reversoRow = txRow("msg-reverso-ambiguous");
    expect(reversoRow).toBeDefined();
    expect(reversoRow?.needs_review).toBe(1);
    expect(reversoRow?.type).toBe("reverso");
    expect(summary.needsReview).toBe(3);
  });

  it("persists an unmatched reverso (no candidate) as its own needs_review row", async () => {
    const consumo = message({
      gmail_msg_id: "msg-consumo-unrelated",
      subject: "Consumo tarjeta de débito por USD 5.00",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: FARMACIA",
      ts: "2026-07-01T10:00:00Z",
    });
    const reverso = message({
      gmail_msg_id: "msg-reverso-unmatched",
      subject: "Notificación Reverso Consumo Tarjeta de Débito Produbanco",
      body: "Detalle Monto: $9.42 Fecha: 01/07/2026",
      ts: "2026-07-01T10:05:00Z",
    });
    const gmail = new FakeGmailClient([consumo, reverso]);
    const extractor = new FakeEmailExtractor(
      new Map([[consumo.subject, { amount_text_raw: "USD 5.00", counterparty: "FARMACIA" }]])
    );

    const summary = await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(summary.reversalsApplied).toBe(0);
    expect(txRow("msg-consumo-unrelated")?.is_reversed).toBe(0);

    const reversoRow = txRow("msg-reverso-unmatched");
    expect(reversoRow?.needs_review).toBe(1);
    expect(reversoRow?.amount).toBe(9.42);
  });

  it("persists a reverso as needs_review even when no amount can be extracted from its body", async () => {
    const reverso = message({
      gmail_msg_id: "msg-reverso-no-amount",
      subject: "Notificación Reverso Consumo Tarjeta de Débito Produbanco",
      body: "Este es un reverso sin el campo Monto esperado.",
      ts: "2026-07-01T10:00:00Z",
    });
    const gmail = new FakeGmailClient([reverso]);
    const extractor = new FakeEmailExtractor(new Map());

    const summary = await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(summary.needsReview).toBe(1);
    const row = txRow("msg-reverso-no-amount");
    expect(row?.needs_review).toBe(1);
    expect(row?.type).toBe("reverso");
    // The extractor is never invoked for reverso emails.
    expect(extractor.received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// F1-05 statement routing wired through the pipeline.
// ---------------------------------------------------------------------------

describe("ingestOnce: statement routing (F1-05)", () => {
  it("persists a recognizable statement email via ingestStatementEmail", async () => {
    const statement = message({
      gmail_msg_id: "msg-statement-1",
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
    const gmail = new FakeGmailClient([statement]);
    const extractor = new FakeEmailExtractor(new Map());

    const summary = await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(summary.statementsPersisted).toBe(1);
    expect(summary.statementsNeedReview).toBe(0);
    const stmtRow = db.prepare("SELECT * FROM statements WHERE gmail_msg_id = ?").get("msg-statement-1") as
      | { balance: number }
      | undefined;
    expect(stmtRow?.balance).toBe(3856.74);
    // A statement is never inserted into `transactions`.
    expect(txRow("msg-statement-1")).toBeUndefined();
    // The extractor is never invoked for statement emails.
    expect(extractor.received).toHaveLength(0);
  });

  it("treats an unrecognizable statement email as needs_review, not a persisted statement", async () => {
    const statement = message({
      gmail_msg_id: "msg-statement-unrecognizable",
      subject: "Estado de Cuenta Produbanco - Grupo Promerica",
      body: "Correo sin los campos esperados.",
    });
    const gmail = new FakeGmailClient([statement]);
    const extractor = new FakeEmailExtractor(new Map());

    const summary = await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(summary.statementsPersisted).toBe(0);
    expect(summary.statementsNeedReview).toBe(1);
    const count = (db.prepare("SELECT COUNT(*) as c FROM statements").get() as { c: number }).c;
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ignored emails.
// ---------------------------------------------------------------------------

describe("ingestOnce: ignored emails", () => {
  it("skips a recognized non-transaction email without persisting anything", async () => {
    const ignored = message({
      gmail_msg_id: "msg-ignored-login",
      subject: "Notificación Ingreso App Móvil Produbanco",
      body: "Se detecto un ingreso a tu app Produbanco.",
    });
    const gmail = new FakeGmailClient([ignored]);
    const extractor = new FakeEmailExtractor(new Map());

    const summary = await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(summary.skipped).toBe(1);
    expect(summary.inserted).toBe(0);
    expect(txRow("msg-ignored-login")).toBeUndefined();
    expect(extractor.received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Gmail pagination.
// ---------------------------------------------------------------------------

describe("ingestOnce: Gmail pagination", () => {
  it("consumes every id across multiple pages from the fake client", async () => {
    const messages = Array.from({ length: 120 }, (_, i) =>
      message({
        gmail_msg_id: `msg-ignored-${i}`,
        subject: "Notificación Ingreso App Móvil Produbanco",
        body: "Se detecto un ingreso a tu app Produbanco.",
      })
    );
    const gmail = new FakeGmailClient(messages, 50);
    const extractor = new FakeEmailExtractor(new Map());

    const summary = await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(gmail.listCalls).toBe(3); // 50 + 50 + 20
    expect(summary.seen).toBe(120);
    expect(summary.skipped).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// TASK-017 review fix (HIGH-1): a reverso that arrives in a LATER run than
// its consumo must not be silently lost. insertTransaction alone is
// insert-only (ON CONFLICT DO NOTHING), so a naive re-run would leave the
// already-persisted consumo's is_reversed stuck at 0 forever, and (before
// this fix) the matched reverso itself was never persisted at all.
// ---------------------------------------------------------------------------

describe("ingestOnce: cross-run reversal reconciliation (HIGH-1 review fix)", () => {
  it("reconciles a reverso that arrives in run 2 against a consumo already persisted in run 1", async () => {
    const consumo = message({
      gmail_msg_id: "msg-consumo-crossrun",
      subject: "Consumo tarjeta de débito por USD 9.42",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMISARIATO EXPRESS",
      ts: "2026-07-01T15:00:00Z",
    });
    const reverso = message({
      gmail_msg_id: "msg-reverso-crossrun",
      subject: "Notificación Reverso Consumo Tarjeta de Débito Produbanco",
      body: "Detalle Monto: $9.42 Fecha: 01/07/2026",
      ts: "2026-07-01T15:30:00Z",
    });
    const extractorResponses = new Map([
      [consumo.subject, { amount_text_raw: "USD 9.42", counterparty: "COMISARIATO EXPRESS" }],
    ]);

    // Run 1: only the consumo has arrived yet.
    const run1 = await ingestOnce(deps(new FakeGmailClient([consumo]), new FakeEmailExtractor(extractorResponses)), {
      sinceTs: "2026-06-01T00:00:00Z",
    });
    expect(run1.inserted).toBe(1);
    expect(txRow("msg-consumo-crossrun")?.is_reversed).toBe(0);

    // Run 2: the search window re-scans the day and now also picks up the
    // reverso (plus re-seeing the already-ingested consumo).
    const run2 = await ingestOnce(
      deps(new FakeGmailClient([consumo, reverso]), new FakeEmailExtractor(extractorResponses)),
      { sinceTs: "2026-06-01T00:00:00Z" }
    );
    expect(run2.reversalsApplied).toBe(1);

    // The row persisted in run 1 must now read is_reversed=1 — not stuck at
    // its original value.
    const consumoRow = txRow("msg-consumo-crossrun");
    expect(consumoRow?.is_reversed).toBe(1);
    expect(consumoRow?.amount).toBe(9.42); // untouched by the flags-only update

    // The matched reverso itself leaves an auditable trace.
    const reversoRow = txRow("msg-reverso-crossrun");
    expect(reversoRow).toBeDefined();
    expect(reversoRow?.type).toBe("reverso");

    expect((db.prepare("SELECT COUNT(*) as c FROM transactions").get() as { c: number }).c).toBe(2);

    // Run 3: reprocessing the same window again is idempotent — no new
    // rows, no flag flip-flopping.
    const run3 = await ingestOnce(
      deps(new FakeGmailClient([consumo, reverso]), new FakeEmailExtractor(extractorResponses)),
      { sinceTs: "2026-06-01T00:00:00Z" }
    );
    expect(run3.inserted).toBe(0);
    expect(run3.duplicates).toBe(2);
    expect(txRow("msg-consumo-crossrun")?.is_reversed).toBe(1);
    expect((db.prepare("SELECT COUNT(*) as c FROM transactions").get() as { c: number }).c).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TASK-017 review fix (MEDIUM-1): Gmail's `after:` is date-only and
// evaluated in the account's LOCAL timezone (local time, UTC-5) — not UTC.
// Truncating sinceTs to its UTC calendar date can start the search window
// up to 5h after sinceTs, silently losing early-UTC-morning mail once
// F1-08 advances last_sync day by day.
// ---------------------------------------------------------------------------

describe("buildSearchQuery (MEDIUM-1 review fix: local after: widening)", () => {
  it("widens the after: date back by one day so the window always covers sinceTs regardless of local offset", () => {
    // 2026-07-01T02:00:00Z is still 2026-06-30 21:00 local time — a naive
    // UTC-date truncation ("after:2026/07/01") would miss that whole
    // 21:00-24:00 local time window.
    expect(buildSearchQuery("2026-07-01T02:00:00Z")).toBe("from:produbanco after:2026/06/30");
  });

  it("still widens back a day even when sinceTs falls late in the UTC day", () => {
    expect(buildSearchQuery("2026-07-01T23:00:00Z")).toBe("from:produbanco after:2026/06/30");
  });

  it("falls back to a raw date-prefix slice (no day math) for an unparseable sinceTs", () => {
    expect(buildSearchQuery("not-a-date")).toBe("from:produbanco after:not/a/date");
  });

  it("ORs every registered bank's senders, so adding a parser is enough to fetch its mail", () => {
    expect(buildSearchQuery("2026-07-01T02:00:00Z", ["produbanco", "mibanco.com"])).toBe(
      "(from:produbanco OR from:mibanco.com) after:2026/06/30"
    );
  });

  it("defaults to the senders declared by the registered parsers", () => {
    const senders = listParsers().flatMap((p) => p.gmailSenders);
    expect(senders).toContain("produbanco");
    for (const sender of senders) expect(buildSearchQuery("2026-07-01T02:00:00Z")).toContain(`from:${sender}`);
  });
});

// ---------------------------------------------------------------------------
// TASK-017 review fix (LOW-2): a transaction row whose amount is always
// deterministic (never Claude's own number) but whose classification did
// involve a Claude cross-check is source:'hybrid', not the misleading
// source:'claude' — reverso/statement-adjacent rows Claude never saw stay
// source:'deterministic'.
// ---------------------------------------------------------------------------

describe("ingestOnce: source attribution (LOW-2 review fix)", () => {
  it("tags a Claude-cross-validated transaction row source:'hybrid', not 'claude'", async () => {
    const consumo = message({
      gmail_msg_id: "msg-consumo-source",
      subject: "Consumo tarjeta de débito por USD 9.42",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMISARIATO EXPRESS",
    });
    const gmail = new FakeGmailClient([consumo]);
    const extractor = new FakeEmailExtractor(
      new Map([[consumo.subject, { amount_text_raw: "USD 9.42", counterparty: "COMISARIATO EXPRESS" }]])
    );

    await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(txRow("msg-consumo-source")?.source).toBe("hybrid");
  });

  it("tags a reverso audit/review row source:'deterministic' (Claude never sees reverso emails)", async () => {
    const reverso = message({
      gmail_msg_id: "msg-reverso-source",
      subject: "Notificación Reverso Consumo Tarjeta de Débito Produbanco",
      body: "Este es un reverso sin el campo Monto esperado.",
    });
    const gmail = new FakeGmailClient([reverso]);
    const extractor = new FakeEmailExtractor(new Map());

    await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(txRow("msg-reverso-source")?.source).toBe("deterministic");
  });
});

// ---------------------------------------------------------------------------
// TASK-024 (F2-B) AC3 — `category` is populated at persist time, deterministically.
// ---------------------------------------------------------------------------

describe("ingestOnce: category population (TASK-024 AC3)", () => {
  it("retiro -> efectivo", async () => {
    const retiro = message({
      gmail_msg_id: "msg-retiro-category",
      subject: "Retiro sin tarjeta de débito Produbanco en cajero automático",
      body: "Detalle Monto: $20.00 Cuenta débito: ANA XXXXXX20924",
    });
    const gmail = new FakeGmailClient([retiro]);
    const extractor = new FakeEmailExtractor(new Map([[retiro.subject, { amount_text_raw: "$20.00", counterparty: null }]]));

    await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(txRow("msg-retiro-category")?.category).toBe("efectivo");
  });

  it("establishment matching a user category_rule on a debito consumo -> that category", async () => {
    // No merchant list ships with the boilerplate: the rule is the user's own,
    // so the fixture configures it exactly as `npm run onboard` would.
    upsertCategoryRule(db, "veterinaria", "mascota");
    const consumo = message({
      gmail_msg_id: "msg-establecimiento-category",
      subject: "Consumo tarjeta de débito por USD 12.50",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: VETERINARIA CENTRAL",
    });
    const gmail = new FakeGmailClient([consumo]);
    const extractor = new FakeEmailExtractor(
      new Map([[consumo.subject, { amount_text_raw: "USD 12.50", counterparty: "VETERINARIA CENTRAL" }]])
    );

    await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(txRow("msg-establecimiento-category")?.category).toBe("mascota");
  });

  it("establishment with no matching rule -> otros (never guesses)", async () => {
    const consumo = message({
      gmail_msg_id: "msg-sin-regla-category",
      subject: "Consumo tarjeta de débito por USD 12.50",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: VETERINARIA CENTRAL",
    });
    const gmail = new FakeGmailClient([consumo]);
    const extractor = new FakeEmailExtractor(
      new Map([[consumo.subject, { amount_text_raw: "USD 12.50", counterparty: "VETERINARIA CENTRAL" }]])
    );

    await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(txRow("msg-sin-regla-category")?.category).toBe("otros");
  });

  it("transferencia enviada a persona (no interna) -> transferencia_persona", async () => {
    const transferencia = message({
      gmail_msg_id: "msg-transferencia-category",
      subject: "Transferencia enviada por $30.00 desde Produbanco",
      body: "Contacto: Carlos Andres Molina Vera Banco Destino: Banco Pichincha",
    });
    const gmail = new FakeGmailClient([transferencia]);
    const extractor = new FakeEmailExtractor(
      new Map([[transferencia.subject, { amount_text_raw: "$30.00", counterparty: "Carlos Andres Molina Vera" }]])
    );

    await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(txRow("msg-transferencia-category")?.category).toBe("transferencia_persona");
  });

  it("sueldo (income) -> otros, never a spend category", async () => {
    const sueldo = message({
      gmail_msg_id: "msg-sueldo-category",
      subject: "Notificación Transferencia Internacional Recibida",
      body: "Produbanco te informa: hemos acreditado a tu cuenta una transferencia de Acme Corp S.A. por el valor de USD 2337.71.",
    });
    const gmail = new FakeGmailClient([sueldo]);
    const extractor = new FakeEmailExtractor(
      new Map([[sueldo.subject, { amount_text_raw: "USD 2337.71", counterparty: "Acme Corp S.A." }]])
    );

    await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-06-01T00:00:00Z" });

    expect(txRow("msg-sueldo-category")?.category).toBe("otros");
  });
});

// ---------------------------------------------------------------------------
// ingestBatch — el lote es la unidad del sync incremental (ver sync/run-sync.ts).
// ---------------------------------------------------------------------------

describe("ingestBatch", () => {
  /** N consumos distinguibles, con su respuesta de Claude ya coincidente. */
  function consumos(n: number): { messages: GmailMessage[]; extractor: FakeEmailExtractor } {
    const messages = Array.from({ length: n }, (_, i) =>
      message({
        gmail_msg_id: `msg-${i}`,
        subject: `Consumo tarjeta de débito por USD ${(i + 1).toFixed(2)}`,
        body: `Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMERCIO ${i}`,
      })
    );
    const extractor = new FakeEmailExtractor(
      new Map(messages.map((m, i) => [m.subject, { amount_text_raw: `USD ${(i + 1).toFixed(2)}`, counterparty: null }]))
    );
    return { messages, extractor };
  }

  it("procesa exactamente los ids que recibe, sin buscar en Gmail", async () => {
    const { messages, extractor } = consumos(5);
    const gmail = new FakeGmailClient(messages);

    const result = await ingestBatch(deps(gmail, extractor), { messageIds: ["msg-1", "msg-3"] });

    expect(gmail.listCalls).toBe(0);
    expect(result.seen).toBe(2);
    expect(result.inserted).toBe(2);
    expect(countTransactions()).toBe(2);
    expect(txRow("msg-1")).toBeTruthy();
    expect(txRow("msg-3")).toBeTruthy();
    expect(txRow("msg-0")).toBeUndefined();
  });

  it("corta al agotarse el presupuesto de tiempo y persiste lo ya procesado", async () => {
    const { messages, extractor } = consumos(10);
    // Reloj falso: cada consulta avanza 10s, asi que con maxMs=25s entran
    // tres correos y el cuarto ya encuentra el presupuesto agotado.
    let tick = 0;
    const monotonicNow = () => (tick++ * 10_000);

    const result = await ingestBatch(deps(new FakeGmailClient(messages), extractor), {
      messageIds: messages.map((m) => m.gmail_msg_id),
      maxMs: 25_000,
      monotonicNow,
    });

    // Lo procesado esta en la base ANTES de que termine el backlog entero:
    // es justamente lo que evita perder 2 horas de trabajo por un timeout.
    expect(result.seen).toBeGreaterThan(0);
    expect(result.seen).toBeLessThan(10);
    expect(countTransactions()).toBe(result.inserted);
    expect(result.inserted).toBe(result.seen);
  });

  it("`seen` es siempre un prefijo del lote: lo no atendido queda intacto para la proxima llamada", async () => {
    const { messages, extractor } = consumos(6);
    let tick = 0;
    const monotonicNow = () => (tick++ * 10_000);

    const ids = messages.map((m) => m.gmail_msg_id);
    const result = await ingestBatch(deps(new FakeGmailClient(messages), extractor), {
      messageIds: ids,
      maxMs: 25_000,
      monotonicNow,
    });

    for (const id of ids.slice(0, result.seen)) expect(txRow(id)).toBeTruthy();
    for (const id of ids.slice(result.seen)) expect(txRow(id)).toBeUndefined();
  });

  it("con el presupuesto ya vencido procesa igual un correo: el backlog nunca se traba", async () => {
    const { messages, extractor } = consumos(3);

    const result = await ingestBatch(deps(new FakeGmailClient(messages), extractor), {
      messageIds: messages.map((m) => m.gmail_msg_id),
      maxMs: 0,
      monotonicNow: () => 0,
    });

    expect(result.seen).toBe(1);
    expect(countTransactions()).toBe(1);
  });

  it("sin presupuesto de tiempo procesa el lote entero", async () => {
    const { messages, extractor } = consumos(4);

    const result = await ingestBatch(deps(new FakeGmailClient(messages), extractor), {
      messageIds: messages.map((m) => m.gmail_msg_id),
    });

    expect(result.seen).toBe(4);
    expect(countTransactions()).toBe(4);
  });

  it("un lote vacio no toca nada", async () => {
    const result = await ingestBatch(deps(new FakeGmailClient([]), new FakeEmailExtractor(new Map())), {
      messageIds: [],
    });

    expect(result.seen).toBe(0);
    expect(countTransactions()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// La regla 4 del CLAUDE.md en el punto donde se puede romper.
//
// `transactions.amount` es NOT NULL, así que una fila cuyo monto no se pudo
// leer necesita igual un número para persistir: el placeholder. Cero es
// aceptable SÓLO mientras `needs_review = 1` la mantenga fuera de todos los
// agregados. Si esas dos cosas se desacoplan — un parser que devuelve
// `amount: null` sin marcar, alguien que "simplifica" el ternario del
// cross-check — el placeholder entra a los totales como una transacción de
// cero dólares y el saldo no da error: da un número silenciosamente
// equivocado. Es el único riesgo de corrección de todo el paquete
// (docs/investigacion-riesgos.md §4), y esto es el test que lo cubre.
//
// Es GLOBAL, no de Produbanco: el fixture es un banco ficticio.
// ---------------------------------------------------------------------------

describe("placeholder de monto desconocido", () => {
  const initialParserCount = listParsers().length;
  afterEach(() => {
    (listParsers() as BankEmailParser[]).length = initialParserCount;
  });

  /** Un parser que devuelve `amount: null` SIN marcar needs_review — el bug
   * que este guarda ataja, venga de donde venga. */
  function registerSloppyBank(): void {
    registerParser({
      bankId: "banco-ejemplo",
      gmailSenders: ["notificaciones@bancoejemplo.test"],
      canParse: (e) => e.subject.includes("Banco Ejemplo"),
      parse: (e) => ({
        kind: "transaction",
        type: "debito",
        direction: "out",
        amount: null,
        currency: "USD",
        raw_subject: e.subject,
        needs_review: false,
      }),
    });
  }

  it("marca needs_review una fila sin monto aunque el parser dijo que no hacía falta", async () => {
    registerSloppyBank();
    const gmail = new FakeGmailClient([message({ subject: "Banco Ejemplo consumo", body: "sin monto" })]);
    const extractor = new FakeEmailExtractor(new Map([["Banco Ejemplo consumo", { amount_text_raw: "9.42", counterparty: null }]]));

    await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-07-01T00:00:00Z" });

    const row = db.prepare("SELECT amount, needs_review FROM transactions").get() as {
      amount: number;
      needs_review: number;
    };
    expect(row.amount).toBe(0);
    expect(row.needs_review).toBe(1);
  });

  it("deja esa fila fuera de los totales", async () => {
    registerSloppyBank();
    const gmail = new FakeGmailClient([message({ subject: "Banco Ejemplo consumo", body: "sin monto" })]);
    const extractor = new FakeEmailExtractor(new Map());

    await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-07-01T00:00:00Z" });

    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM transactions WHERE ${EXCLUDE_FROM_TOTALS_SQL}`)
      .get() as { total: number };
    expect(total).toBe(0);
  });

  it("no toca una fila cuyo monto SÍ es cero: cero es un monto válido", async () => {
    registerParser({
      bankId: "banco-ejemplo",
      gmailSenders: ["notificaciones@bancoejemplo.test"],
      canParse: (e) => e.subject.includes("Banco Ejemplo"),
      parse: (e) => ({
        kind: "transaction",
        type: "debito",
        direction: "out",
        amount: 0,
        currency: "USD",
        raw_subject: e.subject,
        needs_review: false,
      }),
    });
    const gmail = new FakeGmailClient([message({ subject: "Banco Ejemplo consumo", body: "por $0.00" })]);
    const extractor = new FakeEmailExtractor(
      new Map([["Banco Ejemplo consumo", { amount_text_raw: "$0.00", counterparty: null }]])
    );

    await ingestOnce(deps(gmail, extractor), { sinceTs: "2026-07-01T00:00:00Z" });

    const row = db.prepare("SELECT amount, needs_review FROM transactions").get() as {
      amount: number;
      needs_review: number;
    };
    expect(row.amount).toBe(0);
    expect(row.needs_review).toBe(0);
  });
});
