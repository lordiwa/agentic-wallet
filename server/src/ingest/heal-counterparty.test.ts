import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../db/schema.js";
import { healCounterparties } from "./heal-counterparty.js";
import type { GmailClient, GmailMessage } from "./types.js";

/** Cuerpo real de un consumo con tarjeta de Produbanco: el comercio va en la
 * LINEA SIGUIENTE a "Establecimiento:", que es como llegan de verdad. */
function consumoBody(merchant: string, amount: string): string {
  return [
    "Estimado/a",
    "PEREZ GOMEZ ANA MARIA",
    "Fecha y Hora:",
    "05/04/2026 13:11",
    "Transaccion: Consumo Tarjeta de",
    "Credito Produbanco",
    "Detalle",
    "Valor: USD",
    amount,
    "Establecimiento:",
    merchant,
    "Si no realizaste esta transaccion comunicate con nosotros.",
  ].join("\n");
}

function creditoMessage(id: string, merchant: string, amount: string): GmailMessage {
  return {
    gmail_msg_id: id,
    gmail_thread_id: null,
    subject: `Consumo Tarjeta de Crédito por USD ${amount}`,
    body: consumoBody(merchant, amount),
    ts: "2026-05-04T18:11:00.000Z",
  };
}

/** Un cuerpo sin campo "Establecimiento": el correo simplemente no nombra a
 * nadie, y ninguna corrida va a poder inventarlo. */
function unnamedMessage(id: string, amount: string): GmailMessage {
  return {
    gmail_msg_id: id,
    gmail_thread_id: null,
    subject: `Consumo Tarjeta de Crédito por USD ${amount}`,
    body: ["Detalle", "Valor: USD", amount, "Atentamente Produbanco"].join("\n"),
    ts: "2026-05-04T18:11:00.000Z",
  };
}

function stubGmail(messages: GmailMessage[]): GmailClient {
  const byId = new Map(messages.map((m) => [m.gmail_msg_id, m]));
  return {
    searchMessageIds: vi.fn(async () => [...byId.keys()]),
    getMessage: vi.fn(async (id: string) => {
      const found = byId.get(id);
      if (!found) throw new Error(`no such message: ${id}`);
      return found;
    }),
  };
}

interface SeedRow {
  gmail_msg_id: string;
  amount: number;
  counterparty?: string | null;
  type?: string;
  category?: string | null;
  needs_review?: number;
}

function seed(db: Database.Database, rows: SeedRow[]): void {
  const insert = db.prepare(
    `INSERT INTO transactions (gmail_msg_id, ts, direction, type, amount, currency, counterparty, category,
                               raw_subject, needs_review, source)
     VALUES (@gmail_msg_id, '2026-05-04T18:11:00.000Z', 'out', @type, @amount, 'USD', @counterparty, @category,
             'Consumo', @needs_review, 'hybrid')`
  );
  for (const row of rows) {
    insert.run({
      gmail_msg_id: row.gmail_msg_id,
      type: row.type ?? "credito",
      amount: row.amount,
      counterparty: row.counterparty ?? null,
      category: row.category ?? "otros",
      needs_review: row.needs_review ?? 0,
    });
  }
}

function rowFor(db: Database.Database, gmailMsgId: string) {
  return db.prepare("SELECT * FROM transactions WHERE gmail_msg_id = ?").get(gmailMsgId) as {
    counterparty: string | null;
    amount: number;
    type: string;
    direction: string;
    category: string | null;
    needs_review: number;
  };
}

describe("healCounterparties", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    migrate(db);
  });

  it("le pone nombre a una fila que quedo sin contraparte", async () => {
    seed(db, [{ gmail_msg_id: "m1", amount: 11.99 }]);
    const gmailClient = stubGmail([creditoMessage("m1", "NETFLIX.COM", "11.99")]);

    const result = await healCounterparties({ db, gmailClient });

    expect(rowFor(db, "m1").counterparty).toBe("NETFLIX.COM");
    expect(result).toMatchObject({ candidates: 1, healed: 1, unnamed: 0, skippedAmountMismatch: 0, failed: 0 });
  });

  it("no toca una fila que ya tiene contraparte, ni le pide el correo a Gmail", async () => {
    seed(db, [{ gmail_msg_id: "m1", amount: 11.99, counterparty: "NOMBRE PUESTO A MANO" }]);
    const gmailClient = stubGmail([creditoMessage("m1", "NETFLIX.COM", "11.99")]);

    const result = await healCounterparties({ db, gmailClient });

    expect(rowFor(db, "m1").counterparty).toBe("NOMBRE PUESTO A MANO");
    expect(gmailClient.getMessage).not.toHaveBeenCalled();
    expect(result.candidates).toBe(0);
  });

  it("trata una contraparte en blanco igual que una ausente", async () => {
    seed(db, [{ gmail_msg_id: "m1", amount: 11.99, counterparty: "   " }]);
    const gmailClient = stubGmail([creditoMessage("m1", "NETFLIX.COM", "11.99")]);

    await healCounterparties({ db, gmailClient });

    expect(rowFor(db, "m1").counterparty).toBe("NETFLIX.COM");
  });

  // La invariante que protege todo lo demas: si el correo ya no rinde el
  // MISMO monto que la fila guardada, la fila y el correo no son la misma
  // transaccion (o el parser cambio de opinion). Pegarle un comercio ahi
  // seria atribuirle un gasto a un nombre equivocado.
  it("no escribe nada si el monto del correo no coincide con el guardado", async () => {
    seed(db, [{ gmail_msg_id: "m1", amount: 11.99 }]);
    const gmailClient = stubGmail([creditoMessage("m1", "NETFLIX.COM", "99.00")]);

    const result = await healCounterparties({ db, gmailClient });

    expect(rowFor(db, "m1").counterparty).toBeNull();
    expect(result).toMatchObject({ healed: 0, skippedAmountMismatch: 1 });
  });

  it("no escribe nada si el correo no rinde monto alguno", async () => {
    seed(db, [{ gmail_msg_id: "m1", amount: 0, needs_review: 1 }]);
    const gmailClient = stubGmail([
      { gmail_msg_id: "m1", gmail_thread_id: null, subject: "Consumo Tarjeta de Crédito por USD", body: consumoBody("NETFLIX.COM", "11.99"), ts: "2026-05-04T18:11:00.000Z" },
    ]);

    const result = await healCounterparties({ db, gmailClient });

    expect(rowFor(db, "m1").counterparty).toBeNull();
    expect(result).toMatchObject({ healed: 0, skippedAmountMismatch: 1 });
  });

  it("cuenta aparte el correo que efectivamente no nombra a nadie", async () => {
    seed(db, [{ gmail_msg_id: "m1", amount: 8.0 }]);
    const gmailClient = stubGmail([unnamedMessage("m1", "8.00")]);

    const result = await healCounterparties({ db, gmailClient });

    expect(rowFor(db, "m1").counterparty).toBeNull();
    expect(result).toMatchObject({ healed: 0, unnamed: 1, failed: 0 });
  });

  it("un correo ilegible no aborta la corrida: se cuenta y se sigue", async () => {
    seed(db, [{ gmail_msg_id: "desaparecido", amount: 5 }, { gmail_msg_id: "m2", amount: 11.99 }]);
    const gmailClient = stubGmail([creditoMessage("m2", "NETFLIX.COM", "11.99")]);

    const result = await healCounterparties({ db, gmailClient });

    expect(rowFor(db, "m2").counterparty).toBe("NETFLIX.COM");
    expect(result).toMatchObject({ candidates: 2, healed: 1, failed: 1 });
  });

  // Invariante 1 del proyecto: el monto sale del parser en el ingest y esta
  // capa solo reordena etiquetas. Nada de plata se toca aca.
  it("nunca toca monto, tipo, direccion ni needs_review", async () => {
    seed(db, [{ gmail_msg_id: "m1", amount: 11.99, needs_review: 1 }]);
    const before = rowFor(db, "m1");
    const gmailClient = stubGmail([creditoMessage("m1", "NETFLIX.COM", "11.99")]);

    await healCounterparties({ db, gmailClient });

    const after = rowFor(db, "m1");
    expect(after.amount).toBe(before.amount);
    expect(after.type).toBe(before.type);
    expect(after.direction).toBe(before.direction);
    expect(after.needs_review).toBe(before.needs_review);
  });

  // Tampoco recalcula la categoria: eso es trabajo de `reclassifyTransactions`,
  // que ya sabe cuando puede repisar y cuando no.
  it("deja la categoria como estaba", async () => {
    seed(db, [{ gmail_msg_id: "m1", amount: 11.99, category: "otros" }]);
    const gmailClient = stubGmail([creditoMessage("m1", "NETFLIX.COM", "11.99")]);

    await healCounterparties({ db, gmailClient });

    expect(rowFor(db, "m1").category).toBe("otros");
  });

  it("es idempotente: la segunda corrida no tiene nada que hacer", async () => {
    seed(db, [{ gmail_msg_id: "m1", amount: 11.99 }]);
    const gmailClient = stubGmail([creditoMessage("m1", "NETFLIX.COM", "11.99")]);

    await healCounterparties({ db, gmailClient });
    const second = await healCounterparties({ db, gmailClient });

    expect(second).toMatchObject({ candidates: 0, healed: 0, remaining: 0 });
  });

  it("respeta el tope por corrida y reporta lo que queda", async () => {
    seed(db, [
      { gmail_msg_id: "m1", amount: 1.0 },
      { gmail_msg_id: "m2", amount: 2.0 },
      { gmail_msg_id: "m3", amount: 3.0 },
    ]);
    const gmailClient = stubGmail([
      creditoMessage("m1", "UNO", "1.00"),
      creditoMessage("m2", "DOS", "2.00"),
      creditoMessage("m3", "TRES", "3.00"),
    ]);

    const result = await healCounterparties({ db, gmailClient }, { limit: 2 });

    expect(result).toMatchObject({ candidates: 2, healed: 2, remaining: 1 });
    expect(gmailClient.getMessage).toHaveBeenCalledTimes(2);
  });

  it("empieza por lo mas caro: el tope no deja afuera al gasto que mas pesa", async () => {
    seed(db, [
      { gmail_msg_id: "chico", amount: 1.0 },
      { gmail_msg_id: "grande", amount: 172.96 },
    ]);
    const gmailClient = stubGmail([
      creditoMessage("chico", "UNO", "1.00"),
      creditoMessage("grande", "AEROLINEA", "172.96"),
    ]);

    await healCounterparties({ db, gmailClient }, { limit: 1 });

    expect(rowFor(db, "grande").counterparty).toBe("AEROLINEA");
    expect(rowFor(db, "chico").counterparty).toBeNull();
  });

  it("ignora las filas de reverso: no son un consumo con comercio", async () => {
    seed(db, [{ gmail_msg_id: "r1", amount: 5, type: "reverso" }]);
    const gmailClient = stubGmail([]);

    const result = await healCounterparties({ db, gmailClient });

    expect(result.candidates).toBe(0);
    expect(gmailClient.getMessage).not.toHaveBeenCalled();
  });
});
