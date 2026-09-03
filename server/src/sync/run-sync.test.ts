import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { getSyncState } from "../db/repository.js";
import { getSyncProgress } from "../db/sync-progress.js";
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

    // Un lote holgado: lo que se prueba aca es que la busqueda paginada de
    // Gmail fluye entera, no el troceo (eso vive en el describe de abajo).
    const summary = await runSync(deps(gmail, extractor), { now: "2026-07-20T10:00:00.000Z", batchSize: 200 });

    // 123 messages at a page size of 50 -> 3 pages.
    expect(gmail.listCalls).toBe(3);
    expect(summary.seen).toBe(123);
    expect(summary.inserted).toBe(123);
    expect(countTransactions()).toBe(123);
    expect(summary.progress.complete).toBe(true);
  });

  it("con el lote por defecto, un buzon grande se drena en varias llamadas sin duplicar nada", async () => {
    const messages = Array.from({ length: 123 }, (_, i) =>
      message({
        gmail_msg_id: `msg-${i}`,
        subject: `Consumo tarjeta de débito por USD ${(i + 1).toFixed(2)}`,
        body: `Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMERCIO ${i}`,
      })
    );
    const extractor = new FakeEmailExtractor(
      new Map(messages.map((m, i) => [m.subject, { amount_text_raw: `USD ${(i + 1).toFixed(2)}`, counterparty: null }]))
    );
    const gmail = new FakeGmailClient(messages, 50);

    let llamadas = 0;
    let ultimo = await runSync(deps(gmail, extractor), { now: "2026-07-20T10:00:00.000Z" });
    llamadas += 1;
    while (!ultimo.progress.complete) {
      ultimo = await runSync(deps(gmail, extractor), { now: `2026-07-20T10:0${llamadas}:00.000Z` });
      llamadas += 1;
    }

    // 123 correos con el lote por defecto (50) -> 3 llamadas.
    expect(llamadas).toBe(3);
    expect(countTransactions()).toBe(123);
    expect(ultimo.cumulative).toMatchObject({ seen: 123, inserted: 123, duplicates: 0 });
    expect(getSyncState(db)?.last_sync_ts).toBe("2026-07-20T10:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Sync incremental con checkpoint: el primer sync de un buzon real son miles
// de correos y ningun cliente con timeout aguanta esa corrida entera.
// ---------------------------------------------------------------------------

describe("runSync por lotes (checkpoint)", () => {
  /** N consumos distinguibles con su respuesta de Claude ya coincidente. */
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

  it("un lote parcial persiste ya mismo y deja checkpoint: nada se pierde si la llamada se corta", async () => {
    const { messages, extractor } = consumos(5);
    const gmail = new FakeGmailClient(messages);

    const result = await runSync(deps(gmail, extractor), { now: "2026-07-20T10:00:00.000Z", batchSize: 2 });

    // Las dos filas del lote ya estan en la base, sin esperar a las otras tres.
    expect(countTransactions()).toBe(2);
    expect(result.progress).toEqual({ processed: 2, total: 5, remaining: 3, complete: false });

    // El checkpoint sabe que falta, y `last_sync_ts` NO avanzo: la ventana
    // sigue abierta hasta drenar el backlog entero.
    expect(getSyncProgress(db)).toMatchObject({ processed: 2, pendingIds: ["msg-2", "msg-3", "msg-4"] });
    expect(getSyncState(db)).toBeUndefined();
  });

  it("la llamada siguiente reanuda donde quedo y no duplica lo ya procesado", async () => {
    const { messages, extractor } = consumos(5);

    await runSync(deps(new FakeGmailClient(messages), extractor), { now: "2026-07-20T10:00:00.000Z", batchSize: 2 });
    const segunda = await runSync(deps(new FakeGmailClient(messages), extractor), {
      now: "2026-07-20T10:01:00.000Z",
      batchSize: 2,
    });

    expect(segunda.inserted).toBe(2);
    expect(segunda.duplicates).toBe(0);
    expect(countTransactions()).toBe(4);
    expect(segunda.progress).toEqual({ processed: 4, total: 5, remaining: 1, complete: false });

    const tercera = await runSync(deps(new FakeGmailClient(messages), extractor), {
      now: "2026-07-20T10:02:00.000Z",
      batchSize: 2,
    });

    expect(countTransactions()).toBe(5);
    expect(tercera.progress).toEqual({ processed: 5, total: 5, remaining: 0, complete: true });
    // Backlog cerrado: el checkpoint se borra y recien ahi avanza sync_state.
    expect(getSyncProgress(db)).toBeUndefined();
  });

  it("al cerrar el backlog fija last_sync_ts en el arranque, no en el ultimo lote", async () => {
    const { messages, extractor } = consumos(3);

    await runSync(deps(new FakeGmailClient(messages), extractor), { now: "2026-07-20T10:00:00.000Z", batchSize: 2 });
    await runSync(deps(new FakeGmailClient(messages), extractor), { now: "2026-07-20T18:00:00.000Z", batchSize: 2 });

    // Si guardara las 18:00 (fin del drenado) se perderian los correos que
    // llegaron entre las 10:00 y las 18:00: nunca los buscaria nadie.
    expect(getSyncState(db)?.last_sync_ts).toBe("2026-07-20T10:00:00.000Z");
  });

  it("no repite la busqueda de Gmail en cada lote: el backlog se arma una sola vez", async () => {
    const { messages, extractor } = consumos(5);
    const gmail = new FakeGmailClient(messages);

    await runSync(deps(gmail, extractor), { now: "2026-07-20T10:00:00.000Z", batchSize: 2 });
    await runSync(deps(gmail, extractor), { now: "2026-07-20T10:01:00.000Z", batchSize: 2 });
    await runSync(deps(gmail, extractor), { now: "2026-07-20T10:02:00.000Z", batchSize: 2 });

    expect(gmail.queries).toHaveLength(1);
  });

  it("el checkpoint vive en la base, asi que un reinicio del proceso lo reanuda igual", async () => {
    const { messages, extractor } = consumos(4);
    // Base en disco: una :memory: se evapora al cerrar, y lo que se prueba
    // aca es justamente que el checkpoint sobrevive al proceso.
    const dir = mkdtempSync(path.join(tmpdir(), "wallet-run-sync-"));
    const file = path.join(dir, "wallet.sqlite");

    try {
      const primera = new Database(file);
      migrate(primera);
      await runSync(
        { db: primera, gmailClient: new FakeGmailClient(messages), extractor, titular: TITULAR },
        { now: "2026-07-20T10:00:00.000Z", batchSize: 2 }
      );
      primera.close();

      // "Reinicio": otra conexion a la MISMA base, clientes nuevos. Lo unico
      // que sobrevive es lo que quedo escrito.
      const segunda = new Database(file);
      const result = await runSync(
        { db: segunda, gmailClient: new FakeGmailClient(messages), extractor, titular: TITULAR },
        { now: "2026-07-20T10:05:00.000Z", batchSize: 2 }
      );

      expect(result.progress).toEqual({ processed: 4, total: 4, remaining: 0, complete: true });
      expect((segunda.prepare("SELECT COUNT(*) as c FROM transactions").get() as { c: number }).c).toBe(4);
      // El backlog se armo antes del reinicio: no se volvio a buscar en Gmail.
      expect(getSyncState(segunda)?.last_sync_ts).toBe("2026-07-20T10:00:00.000Z");
      segunda.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("acumula el resumen de todo el backlog, no solo el del ultimo lote", async () => {
    const { messages, extractor } = consumos(5);

    await runSync(deps(new FakeGmailClient(messages), extractor), { now: "2026-07-20T10:00:00.000Z", batchSize: 2 });
    const ultima = await runSync(deps(new FakeGmailClient(messages), extractor), {
      now: "2026-07-20T10:01:00.000Z",
      batchSize: 99,
    });

    // El lote de esta llamada vio 3; el backlog completo, 5.
    expect(ultima.seen).toBe(3);
    expect(ultima.cumulative).toMatchObject({ seen: 5, inserted: 5 });
    expect(JSON.parse(getSyncState(db)!.last_history!)).toMatchObject({ seen: 5, inserted: 5 });
  });

  it("un buzon que entra en un solo lote se cierra en una llamada, como siempre", async () => {
    const { messages, extractor } = consumos(2);

    const result = await runSync(deps(new FakeGmailClient(messages), extractor), {
      now: "2026-07-20T10:00:00.000Z",
    });

    expect(result.progress).toEqual({ processed: 2, total: 2, remaining: 0, complete: true });
    expect(getSyncProgress(db)).toBeUndefined();
    expect(getSyncState(db)?.last_sync_ts).toBe("2026-07-20T10:00:00.000Z");
  });

  it("un buzon vacio cierra el backlog igual (no deja un checkpoint fantasma)", async () => {
    const result = await runSync(deps(new FakeGmailClient([])), { now: "2026-07-20T10:00:00.000Z" });

    expect(result.progress).toEqual({ processed: 0, total: 0, remaining: 0, complete: true });
    expect(getSyncProgress(db)).toBeUndefined();
    expect(getSyncState(db)?.last_sync_ts).toBe("2026-07-20T10:00:00.000Z");
  });

  it("si el lote revienta, lo ya drenado queda y el checkpoint conserva lo pendiente", async () => {
    const { messages, extractor } = consumos(4);

    await runSync(deps(new FakeGmailClient(messages), extractor), { now: "2026-07-20T10:00:00.000Z", batchSize: 2 });
    await expect(
      runSync(deps(new ThrowingGmailClient()), { now: "2026-07-20T10:01:00.000Z", batchSize: 2 })
    ).rejects.toThrow("gmail read failed");

    expect(countTransactions()).toBe(2);
    expect(getSyncProgress(db)).toMatchObject({ processed: 2, pendingIds: ["msg-2", "msg-3"] });
    expect(getSyncState(db)).toBeUndefined();
  });

  it("corta el lote por presupuesto de tiempo antes que por tamaño", async () => {
    const { messages, extractor } = consumos(10);
    // Cada consulta al reloj avanza 10s: con 25s de presupuesto entran 3.
    let tick = 0;

    const result = await runSync(deps(new FakeGmailClient(messages), extractor), {
      now: "2026-07-20T10:00:00.000Z",
      batchSize: 10,
      maxMs: 25_000,
      monotonicNow: () => tick++ * 10_000,
    });

    expect(result.progress.complete).toBe(false);
    expect(result.progress.processed).toBe(3);
    expect(result.progress.remaining).toBe(7);
    expect(countTransactions()).toBe(3);
  });
});

describe("runSync: los ids del lote (D7-b)", () => {
  it("devuelve los ids de las filas que ESTE lote agrego", async () => {
    const consumo = message({
      gmail_msg_id: "msg-consumo",
      subject: "Consumo tarjeta de débito por USD 9.42",
      body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMISARIATO EXPRESS",
    });
    const extractor = new FakeEmailExtractor(
      new Map([[consumo.subject, { amount_text_raw: "USD 9.42", counterparty: "COMISARIATO EXPRESS" }]])
    );

    const first = await runSync(deps(new FakeGmailClient([consumo]), extractor), {
      now: "2026-07-20T10:00:00.000Z",
    });

    expect(first.insertedIds).toHaveLength(1);
    const persisted = db.prepare("SELECT id FROM transactions").all() as { id: number }[];
    expect(first.insertedIds).toEqual(persisted.map((row) => row.id));

    // Un segundo pase sobre el mismo correo no agrega nada: la lista queda
    // vacia, no repite el id de la vez pasada. El aviso post-sync pregunta por
    // lo que entro AHORA.
    const second = await runSync(deps(new FakeGmailClient([consumo]), extractor), {
      now: "2026-07-20T11:00:00.000Z",
    });
    expect(second.inserted).toBe(0);
    expect(second.insertedIds).toEqual([]);
  });

  it("un backlog vacio devuelve una lista vacia, no undefined", async () => {
    const summary = await runSync(deps(new FakeGmailClient([])), { now: "2026-07-20T10:00:00.000Z" });
    expect(summary.insertedIds).toEqual([]);
  });
});
