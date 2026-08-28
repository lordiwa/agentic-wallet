import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { getSyncState } from "../db/repository.js";
import { runSync } from "./run-sync.js";
import type { IngestDeps } from "../ingest/index.js";
import type { EmailExtractor, ExtractedEmail, GmailClient, GmailMessage } from "../ingest/index.js";

const TITULAR = "PEREZ GOMEZ ANA MARIA";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

// ---------------------------------------------------------------------------
// Fakes -- mirrors pipeline.test.ts's mocked Gmail boundary, plus a query
// spy so tests can assert what window runSync asked Gmail to search.
// ---------------------------------------------------------------------------

class FakeGmailClient implements GmailClient {
  queries: string[] = [];
  listCalls = 0;

  constructor(
    private readonly messages: GmailMessage[],
    private readonly pageSize = 50
  ) {}

  async searchMessageIds(query: string): Promise<string[]> {
    this.queries.push(query);
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

class ThrowingGmailClient implements GmailClient {
  async searchMessageIds(): Promise<string[]> {
    return ["msg-boom"];
  }
  async getMessage(): Promise<GmailMessage> {
    throw new Error("gmail read failed");
  }
}

class FakeEmailExtractor implements EmailExtractor {
  constructor(private readonly responsesBySubject: Map<string, ExtractedEmail>) {}

  async extract(email: { subject: string; body: string }): Promise<ExtractedEmail> {
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

function deps(gmailClient: GmailClient, extractor: EmailExtractor = new FakeEmailExtractor(new Map())): IngestDeps {
  return { db, gmailClient, extractor, titular: TITULAR };
}

function countTransactions(): number {
  return (db.prepare("SELECT COUNT(*) as c FROM transactions").get() as { c: number }).c;
}

// ---------------------------------------------------------------------------

describe("runSync", () => {
  it("advances sync_state.last_sync_ts and returns ingestOnce's summary", async () => {
    const consumo = message({
      gmail_msg_id: "msg-consumo",
      subject: "Consumo tarjeta de débito por USD 9.42",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMISARIATO EXPRESS",
    });
    const gmail = new FakeGmailClient([consumo]);
    const extractor = new FakeEmailExtractor(
      new Map([[consumo.subject, { amount_text_raw: "USD 9.42", counterparty: "COMISARIATO EXPRESS" }]])
    );

    const summary = await runSync(deps(gmail, extractor), { now: "2026-07-20T10:00:00.000Z" });

    expect(summary.seen).toBe(1);
    expect(summary.inserted).toBe(1);

    const state = getSyncState(db);
    expect(state?.last_sync_ts).toBe("2026-07-20T10:00:00.000Z");
    expect(state?.last_history).toBeTruthy();
    expect(JSON.parse(state!.last_history!)).toMatchObject({ seen: 1, inserted: 1 });
  });

  it("first run (no sync_state row) starts from the beginning, not from an arbitrary bound", async () => {
    const gmail = new FakeGmailClient([]);

    expect(getSyncState(db)).toBeUndefined();

    await runSync(deps(gmail), { now: "2026-07-20T10:00:00.000Z" });

    // buildSearchQuery's date is derived from sinceTs; a first run with no
    // prior sync_state row must search from epoch, not from "now".
    expect(gmail.queries).toHaveLength(1);
    expect(gmail.queries[0]).toContain("after:1969/12/31");
  });

  it("a repeated sync with no new emails is a no-op: no duplicate transactions", async () => {
    const consumo = message({
      gmail_msg_id: "msg-consumo",
      subject: "Consumo tarjeta de débito por USD 9.42",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMISARIATO EXPRESS",
    });
    const extractor = new FakeEmailExtractor(
      new Map([[consumo.subject, { amount_text_raw: "USD 9.42", counterparty: "COMISARIATO EXPRESS" }]])
    );

    await runSync(deps(new FakeGmailClient([consumo]), extractor), { now: "2026-07-20T10:00:00.000Z" });
    expect(countTransactions()).toBe(1);

    // Same message seen again on a second sync pass (e.g. the search window
    // overlaps, per buildSearchQuery's -1 day guard) -- must not duplicate.
    const second = await runSync(deps(new FakeGmailClient([consumo]), extractor), {
      now: "2026-07-20T11:00:00.000Z",
    });

    expect(second.duplicates).toBe(1);
    expect(second.inserted).toBe(0);
    expect(countTransactions()).toBe(1);
    expect(getSyncState(db)?.last_sync_ts).toBe("2026-07-20T11:00:00.000Z");
  });

  it("does NOT advance last_sync_ts when ingestOnce throws, so the next sync retries the same window", async () => {
    await expect(runSync(deps(new ThrowingGmailClient()), { now: "2026-07-20T10:00:00.000Z" })).rejects.toThrow(
      "gmail read failed"
    );

    expect(getSyncState(db)).toBeUndefined();
  });

  it("does not re-advance from an already-advanced sync_state when a later run throws", async () => {
    const consumo = message({ gmail_msg_id: "msg-1", subject: "s", body: "Consumo Tarjeta de Débito Produbanco" });
    await runSync(deps(new FakeGmailClient([consumo])), { now: "2026-07-20T10:00:00.000Z" });
    expect(getSyncState(db)?.last_sync_ts).toBe("2026-07-20T10:00:00.000Z");

    await expect(
      runSync(deps(new ThrowingGmailClient()), { now: "2026-07-20T11:00:00.000Z" })
    ).rejects.toThrow();

    expect(getSyncState(db)?.last_sync_ts).toBe("2026-07-20T10:00:00.000Z");
  });

  it("flows a multi-page Gmail search through end to end", async () => {
    const messages = Array.from({ length: 123 }, (_, i) =>
      message({
        gmail_msg_id: `msg-${i}`,
        subject: `Consumo tarjeta de débito por USD ${(i + 1).toFixed(2)}`,
        body: `Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMERCIO ${i}`,
      })
    );
    const extractor = new FakeEmailExtractor(
      new Map(
        messages.map((m) => [m.subject, { amount_text_raw: `USD ${(Number(m.gmail_msg_id.slice(4)) + 1).toFixed(2)}`, counterparty: null }])
      )
    );
    const gmail = new FakeGmailClient(messages, 50);

    const summary = await runSync(deps(gmail, extractor), { now: "2026-07-20T10:00:00.000Z" });

    // 123 messages at a page size of 50 -> 3 pages.
    expect(gmail.listCalls).toBe(3);
    expect(summary.seen).toBe(123);
    expect(summary.inserted).toBe(123);
    expect(countTransactions()).toBe(123);
  });
});
