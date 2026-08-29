import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { insertTransaction, getTransactionByGmailMsgId } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { reclassifyTransactions } from "./reclassify.js";
import { upsertCategoryRule } from "./rules-repository.js";

const TITULAR = "PEREZ GOMEZ ANA MARIA";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

function tx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    gmail_msg_id: "msg-1",
    ts: "2026-07-01T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: 20,
    ...overrides,
  };
}

describe("reclassifyTransactions", () => {
  it("repisa una categoria desactualizada (lo que el backfill no hace)", async () => {
    // El caso real: el historial se categorizo ANTES de tener `counterparty`,
    // asi que una transferencia a una persona quedo en 'otros'.
    insertTransaction(db, tx({ gmail_msg_id: "m1", type: "transferencia", counterparty: "Carlos Molina", category: "otros" }));

    const result = await reclassifyTransactions(db, { titular: TITULAR });

    expect(result.recategorized).toBe(1);
    expect(getTransactionByGmailMsgId(db, "m1")?.category).toBe("transferencia_persona");
  });

  it("marca la interna que el titular no habia podido marcar", async () => {
    insertTransaction(
      db,
      tx({ gmail_msg_id: "m1", type: "transferencia", counterparty: "ANA MARIA PEREZ GOMEZ", category: "otros" })
    );

    const result = await reclassifyTransactions(db, { titular: TITULAR });

    expect(result.markedInternal).toBe(1);
    expect(getTransactionByGmailMsgId(db, "m1")?.is_internal).toBe(1);
  });

  // El bug que este guard evita: un ledger migrado trae categorias
  // (salud, mascota, comida) cuyas reglas NO estan en `category_rules`, asi
  // que `categorize` responde 'otros' para todas. Sin el guard, una sola
  // corrida borra la clasificacion entera del historial.
  it("NUNCA degrada a 'otros' una categoria especifica que las reglas de hoy no saben reproducir", async () => {
    insertTransaction(db, tx({ gmail_msg_id: "m1", counterparty: "FARMACIA DEL BARRIO", category: "salud" }));
    insertTransaction(db, tx({ gmail_msg_id: "m2", counterparty: "PET SHOP", category: "mascota" }));

    const result = await reclassifyTransactions(db, { titular: TITULAR });

    expect(result.recategorized).toBe(0);
    expect(getTransactionByGmailMsgId(db, "m1")?.category).toBe("salud");
    expect(getTransactionByGmailMsgId(db, "m2")?.category).toBe("mascota");
  });

  it("si sube de precision: una regla nueva le gana a 'otros'", async () => {
    upsertCategoryRule(db, "farmacia", "salud");
    insertTransaction(db, tx({ gmail_msg_id: "m1", counterparty: "FARMACIA DEL BARRIO", category: "otros" }));

    await reclassifyTransactions(db, { titular: TITULAR });

    expect(getTransactionByGmailMsgId(db, "m1")?.category).toBe("salud");
  });

  it("una categoria especifica le gana a otra especifica (la regla vigente manda)", async () => {
    // No es una degradacion: 'otros' no esta en juego, asi que la regla del
    // usuario es la respuesta mas actual.
    upsertCategoryRule(db, "farmacia", "salud");
    insertTransaction(db, tx({ gmail_msg_id: "m1", counterparty: "FARMACIA DEL BARRIO", category: "comida" }));

    await reclassifyTransactions(db, { titular: TITULAR });

    expect(getTransactionByGmailMsgId(db, "m1")?.category).toBe("salud");
  });

  it("aplica las reglas de comercio del usuario sobre filas ya categorizadas", async () => {
    upsertCategoryRule(db, "veterinaria luna", "mascota");
    insertTransaction(db, tx({ gmail_msg_id: "m1", counterparty: "VETERINARIA LUNA suc 2", category: "otros" }));

    await reclassifyTransactions(db, { titular: TITULAR });

    expect(getTransactionByGmailMsgId(db, "m1")?.category).toBe("mascota");
  });

  it("NUNCA desmarca una interna puesta a mano que la regla del titular no ve", async () => {
    // El historial migrado etiqueta los movimientos entre cuentas propias con
    // contrapartes que no son un nombre ("self/<otro banco>"): la regla del
    // titular no las reconoce, y apagarlas las devolveria a los totales.
    insertTransaction(
      db,
      tx({ gmail_msg_id: "m1", type: "transferencia", counterparty: "self/Otro Banco", is_internal: true, category: "otros" })
    );

    const result = await reclassifyTransactions(db, { titular: TITULAR });

    expect(result.markedInternal).toBe(0);
    expect(getTransactionByGmailMsgId(db, "m1")?.is_internal).toBe(1);
  });

  it("no toca plata: amount, direction, type y needs_review quedan como estaban", async () => {
    insertTransaction(
      db,
      tx({ gmail_msg_id: "m1", type: "transferencia", direction: "out", amount: 42.5, counterparty: "Carlos Molina", needs_review: true })
    );

    await reclassifyTransactions(db, { titular: TITULAR });

    const row = getTransactionByGmailMsgId(db, "m1");
    expect(row?.amount).toBe(42.5);
    expect(row?.direction).toBe("out");
    expect(row?.type).toBe("transferencia");
    expect(row?.needs_review).toBe(1);
  });

  it("deja el sueldo como ingreso: no lo convierte en gasto ni lo marca interno", async () => {
    insertTransaction(
      db,
      tx({ gmail_msg_id: "m1", direction: "in", type: "sueldo", amount: 2125.19, counterparty: "Acme LLC", category: "otros" })
    );

    const result = await reclassifyTransactions(db, { titular: TITULAR });

    expect(result.markedInternal).toBe(0);
    const row = getTransactionByGmailMsgId(db, "m1");
    expect(row?.direction).toBe("in");
    expect(row?.type).toBe("sueldo");
    expect(row?.is_internal).toBe(0);
  });

  it("sin titular configurado no marca ninguna interna, pero si recategoriza", async () => {
    insertTransaction(
      db,
      tx({ gmail_msg_id: "m1", type: "transferencia", counterparty: "ANA MARIA PEREZ GOMEZ", category: "otros" })
    );

    const result = await reclassifyTransactions(db, { titular: null });

    expect(result.markedInternal).toBe(0);
    expect(getTransactionByGmailMsgId(db, "m1")?.category).toBe("transferencia_persona");
  });

  it("es idempotente: la segunda corrida no cambia nada", async () => {
    insertTransaction(db, tx({ gmail_msg_id: "m1", type: "transferencia", counterparty: "ANA MARIA PEREZ GOMEZ", category: "otros" }));
    insertTransaction(db, tx({ gmail_msg_id: "m2", type: "transferencia", counterparty: "Carlos Molina", category: "otros" }));

    const first = await reclassifyTransactions(db, { titular: TITULAR });
    expect(first).toEqual({ markedInternal: 1, recategorized: 1 });

    const second = await reclassifyTransactions(db, { titular: TITULAR });
    expect(second).toEqual({ markedInternal: 0, recategorized: 0 });
  });

  it("devuelve ceros sobre una base vacia", async () => {
    expect(await reclassifyTransactions(db, { titular: TITULAR })).toEqual({ markedInternal: 0, recategorized: 0 });
  });
});
