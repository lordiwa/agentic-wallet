/**
 * Round-trip del MCP server contra una base temporal, usando el transporte
 * in-memory del SDK: cliente y server viven en el mismo proceso, sin stdio ni
 * subprocesos, asi que el test es determinista y rapido.
 *
 * Lo que se verifica aca es la CAPA MCP — que las tools esten registradas,
 * que los argumentos lleguen al motor traducidos correctamente y que el
 * resultado salga como JSON parseable. La aritmetica financiera ya la
 * cubren los tests de `strategy/`, `api/` y `onboard/`; repetirla aca solo
 * duplicaria el oraculo.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb } from "../db/open.js";
import { insertTransaction } from "../db/repository.js";
import { setStrategyConfig } from "../db/strategy-config.js";
import { createWalletMcpServer, type WalletMcpDeps } from "./server.js";

/** Cada tool devuelve `{ content: [{ type: 'text', text: '<json>' }] }`. */
function parse(result: unknown): any {
  const typed = result as { content: { type: string; text: string }[]; isError?: boolean };
  return JSON.parse(typed.content[0].text);
}

/** Reloj fijo: "hoy" es 15 de marzo de 2025, para que el mes local en curso
 * sea marzo y las asserciones no dependan de cuando corra la suite. */
const NOW = new Date("2025-03-15T17:00:00.000Z");

describe("MCP server del wallet", () => {
  let projectRoot: string;
  let db: Database.Database;
  let client: Client;
  let syncRunner: WalletMcpDeps["buildSyncRunner"];
  let gmailClient: WalletMcpDeps["buildGmailClient"];

  beforeEach(async () => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "wallet-mcp-"));
    db = openDb(path.join(projectRoot, "test.sqlite"));

    setStrategyConfig(db, {
      titular: "Persona Ejemplo",
      colchonObjetivo: 1000,
      // Ventanas, no dias sueltos: es lo unico que `parseDiasPago` entiende.
      sueldo: { fuente: "EMPRESA EJEMPLO", cadencia: "quincenal", montoEstimado: 2000, diasPago: ["15-15", "30-30"] },
      balanceSnapshot: { amount: 500, at: "2025-03-01" },
    });

    const base = {
      direction: "out",
      type: "debito",
      currency: "USD",
      account: "Persona Ejemplo",
      source: "test",
    };
    insertTransaction(db, {
      ...base,
      gmail_msg_id: "m1",
      ts: "2025-03-10T15:00:00.000Z",
      amount: 30,
      counterparty: "VETERINARIA CENTRAL",
    });
    insertTransaction(db, {
      ...base,
      gmail_msg_id: "m2",
      ts: "2025-03-11T15:00:00.000Z",
      amount: 12,
      counterparty: "PANADERIA DEL BARRIO",
    });
    // Reversado: no debe aparecer por defecto ni sumar en ningun total.
    insertTransaction(db, {
      ...base,
      gmail_msg_id: "m3",
      ts: "2025-03-12T15:00:00.000Z",
      amount: 999,
      counterparty: "COMPRA ANULADA",
      is_reversed: true,
    });
    // Fuera del rango que consulta el test de fechas.
    insertTransaction(db, {
      ...base,
      gmail_msg_id: "m4",
      ts: "2025-02-05T15:00:00.000Z",
      amount: 77,
      counterparty: "MES ANTERIOR",
    });

    // Sin credenciales de Gmail/Claude el runner real es null; el test lo
    // inyecta para no depender del `.env` de nadie.
    syncRunner = () => null;
    gmailClient = async () => null;

    const server = createWalletMcpServer({
      getDb: () => db,
      projectRoot,
      env: {},
      buildSyncRunner: (handle) => syncRunner(handle),
      buildGmailClient: () => gmailClient(),
      now: () => NOW,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
    db.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("registra toda la superficie de herramientas", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    // Sin `.length`: la lista crece, y afirmar un numero solo obliga a
    // editar el test cada vez que se agrega una tool.
    expect(names).toEqual(
      expect.arrayContaining([
        "get_balance",
        "get_colchon_status",
        "get_overview",
        "get_review_queue",
        "resolve_review",
        "get_spending_by_category",
        "onboarding_status",
        "query_transactions",
        "apply_rules",
        "heal_counterparties",
        "set_profile",
        "set_rule",
        "suggest_profile",
        "sync",
      ])
    );
    // Toda tool tiene descripcion: es lo unico que el agente lee para decidir
    // si la llama.
    expect(tools.every((t) => typeof t.description === "string" && t.description.length > 0)).toBe(true);
  });

  it("get_balance parte del snapshot y descuenta los movimientos posteriores", async () => {
    const result = parse(await client.callTool({ name: "get_balance", arguments: {} }));

    expect(result.snapshot).toEqual({ amount: 500, currency: "USD", at: "2025-03-01" });
    // 500 - 30 - 12 = 458. El reversado (999) no cuenta.
    expect(result.balance_actual).toBe(458);
    expect(result.counts.total).toBe(4);
  });

  it("get_colchon_status reporta el faltante contra el objetivo", async () => {
    const result = parse(await client.callTool({ name: "get_colchon_status", arguments: {} }));

    expect(result).toEqual({ objetivo: 1000, reservado: 0, financiado: false, faltante: 1000 });
  });

  it("query_transactions excluye reversados por defecto y los incluye si se piden", async () => {
    const porDefecto = parse(await client.callTool({ name: "query_transactions", arguments: {} }));
    expect(porDefecto.count).toBe(3);
    expect(porDefecto.transactions.map((t: any) => t.gmail_msg_id)).not.toContain("m3");

    const conReversados = parse(
      await client.callTool({ name: "query_transactions", arguments: { include_reversed: true } })
    );
    expect(conReversados.count).toBe(4);
  });

  it("query_transactions trata `to` como dia inclusivo", async () => {
    // m2 ocurre el 11 a las 15:00Z: sin el final-del-dia se perderia.
    const result = parse(
      await client.callTool({ name: "query_transactions", arguments: { from: "2025-03-10", to: "2025-03-11" } })
    );

    expect(result.transactions.map((t: any) => t.gmail_msg_id).sort()).toEqual(["m1", "m2"]);
  });

  it("get_spending_by_category usa el mes local en curso cuando no se dan fechas", async () => {
    const result = parse(await client.callTool({ name: "get_spending_by_category", arguments: {} }));

    // 30 + 12 de marzo. Febrero (77) y el reversado (999) quedan afuera.
    const total = Object.values(result.spending_by_category as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(total).toBe(42);
  });

  it("set_rule reclasifica el gasto que despues reporta get_spending_by_category", async () => {
    const antes = parse(await client.callTool({ name: "get_spending_by_category", arguments: {} }));
    expect(antes.spending_by_category.mascota).toBeUndefined();

    const saved = parse(
      await client.callTool({ name: "set_rule", arguments: { pattern: "veterinaria", category: "mascota" } })
    );
    expect(saved).toEqual({ ok: true, pattern: "veterinaria", category: "mascota" });

    const despues = parse(await client.callTool({ name: "get_spending_by_category", arguments: {} }));
    expect(despues.spending_by_category.mascota).toBe(30);
  });

  it("apply_rules escribe la categoria en el historial ya sincronizado", async () => {
    await client.callTool({ name: "set_rule", arguments: { pattern: "veterinaria", category: "mascota" } });

    const result = parse(await client.callTool({ name: "apply_rules", arguments: {} }));

    // Las 4 filas del fixture entran sin categoria, asi que el backfill las
    // resuelve todas de una.
    expect(result).toEqual({ ok: true, updated: 4 });
    const fila = db.prepare("SELECT category FROM transactions WHERE gmail_msg_id = 'm1'").get() as {
      category: string;
    };
    expect(fila.category).toBe("mascota");
  });

  it("apply_rules es idempotente: la segunda corrida no repisa nada", async () => {
    expect(parse(await client.callTool({ name: "apply_rules", arguments: {} })).updated).toBe(4);
    expect(parse(await client.callTool({ name: "apply_rules", arguments: {} })).updated).toBe(0);
  });

  it("set_rule rechaza una categoria que no esta en el glosario", async () => {
    const result = (await client.callTool({
      name: "set_rule",
      arguments: { pattern: "veterinaria", category: "cripto" },
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it("suggest_profile lee el ledger y set_profile guarda lo confirmado", async () => {
    const sugerencia = parse(await client.callTool({ name: "suggest_profile", arguments: {} }));
    expect(sugerencia.titular).toBe("Persona Ejemplo");
    expect(sugerencia.uncategorized.map((u: any) => u.counterparty)).toContain("VETERINARIA CENTRAL");

    const escrito = parse(await client.callTool({ name: "set_profile", arguments: { colchonObjetivo: 1500 } }));
    expect(escrito).toEqual({ ok: true, written: ["colchonObjetivo"] });

    const colchon = parse(await client.callTool({ name: "get_colchon_status", arguments: {} }));
    expect(colchon.objetivo).toBe(1500);
  });

  it("set_profile falla en vez de escribir nada cuando no recibe campos", async () => {
    const result = (await client.callTool({ name: "set_profile", arguments: {} })) as { isError?: boolean };

    expect(result.isError).toBe(true);
  });

  it("onboarding_status marca el .env segun exista en la raiz del proyecto", async () => {
    const sinEnv = parse(await client.callTool({ name: "onboarding_status", arguments: {} }));
    expect(sinEnv.steps.find((s: any) => s.id === "env").done).toBe(false);
    // El ledger ya tiene filas, asi que ese paso si esta cerrado.
    expect(sinEnv.steps.find((s: any) => s.id === "sync").done).toBe(true);
    expect(sinEnv.complete).toBe(false);

    writeFileSync(path.join(projectRoot, ".env"), "");
    const conEnv = parse(await client.callTool({ name: "onboarding_status", arguments: {} }));
    expect(conEnv.steps.find((s: any) => s.id === "env").done).toBe(true);
  });

  it("onboarding_status manda a la tool `sync`, no a curl ni a `npm run dev`", async () => {
    // El CLI sugiere levantar el server porque es su unico camino; un cliente
    // MCP tiene la tool a un llamado de distancia, asi que la capa MCP
    // reescribe esa sugerencia para el contexto en el que se lee.
    const status = parse(await client.callTool({ name: "onboarding_status", arguments: {} }));
    const sync = status.steps.find((s: any) => s.id === "sync");

    expect(sync.action).toContain("sync");
    expect(sync.action).not.toContain("curl");
    expect(sync.action).not.toContain("npm run dev");
  });

  it("onboarding_status deja `next` identico a su paso en `steps`", async () => {
    // Reescribir la sugerencia no debe desincronizar las dos vistas del mismo
    // paso: si `next` y `steps` divergen, el agente lee dos instrucciones
    // distintas para lo mismo.
    const status = parse(await client.callTool({ name: "onboarding_status", arguments: {} }));

    expect(status.next).toEqual(status.steps.find((s: any) => s.id === status.next.id));
  });

  it("sync reporta gmail_not_configured sin tocar el ledger cuando faltan credenciales", async () => {
    const result = parse(await client.callTool({ name: "sync", arguments: {} }));

    expect(result).toMatchObject({ ok: false, error: "gmail_not_configured" });
    const after = parse(await client.callTool({ name: "query_transactions", arguments: {} }));
    expect(after.count).toBe(3);
  });

  it("sync delega en el runner del motor y devuelve su summary intacto", async () => {
    const summary = {
      seen: 3,
      inserted: 1,
      duplicates: 1,
      needsReview: 1,
      skipped: 0,
      statementsPersisted: 0,
      statementsNeedReview: 0,
      reversalsApplied: 0,
    };
    syncRunner = () => async () => ({
      ...summary,
      cumulative: summary,
      progress: { processed: 3, total: 3, remaining: 0, complete: true },
    });

    const result = parse(await client.callTool({ name: "sync", arguments: {} }));

    expect(result.ok).toBe(true);
    // Intacto: la tool no reformatea ni renombra nada del resumen del motor.
    expect(result.summary).toEqual(summary);
    expect(result.progress).toEqual({ processed: 3, total: 3, remaining: 0, complete: true });
  });

  it("sync avisa que falta backlog y hay que volver a llamarlo", async () => {
    const summary = {
      seen: 50,
      inserted: 50,
      duplicates: 0,
      needsReview: 0,
      skipped: 0,
      statementsPersisted: 0,
      statementsNeedReview: 0,
      reversalsApplied: 0,
    };
    syncRunner = () => async () => ({
      ...summary,
      cumulative: { ...summary, seen: 100, inserted: 100 },
      progress: { processed: 100, total: 1717, remaining: 1617, complete: false },
    });

    const result = parse(await client.callTool({ name: "sync", arguments: {} }));

    expect(result.progress).toMatchObject({ processed: 100, total: 1717, remaining: 1617, complete: false });
    // El agente tiene que poder decidir sin interpretar prosa: `complete`
    // manda, y el texto solo lo explica.
    expect(result.next_action).toContain("1617");
    expect(result.cumulative).toMatchObject({ seen: 100 });
  });

  it("sync le pasa batch_size al runner del motor", async () => {
    let recibido: unknown;
    syncRunner = () => async (options) => {
      recibido = options;
      return {
        seen: 5,
        inserted: 5,
        duplicates: 0,
        needsReview: 0,
        skipped: 0,
        statementsPersisted: 0,
        statementsNeedReview: 0,
        reversalsApplied: 0,
        cumulative: {
          seen: 5,
          inserted: 5,
          duplicates: 0,
          needsReview: 0,
          skipped: 0,
          statementsPersisted: 0,
          statementsNeedReview: 0,
          reversalsApplied: 0,
        },
        progress: { processed: 5, total: 5, remaining: 0, complete: true },
      };
    };

    await client.callTool({ name: "sync", arguments: { batch_size: 5 } });

    expect(recibido).toEqual({ batchSize: 5 });
  });

  it("get_review_queue devuelve solo las filas en needs_review", async () => {
    const vacio = parse(await client.callTool({ name: "get_review_queue", arguments: {} }));
    expect(vacio.count).toBe(0);

    insertTransaction(db, {
      gmail_msg_id: "m5",
      ts: "2025-03-13T15:00:00.000Z",
      direction: "out",
      type: "debito",
      amount: 0,
      counterparty: "MONTO ILEGIBLE",
      needs_review: true,
      source: "test",
    });

    const conFila = parse(await client.callTool({ name: "get_review_queue", arguments: {} }));
    expect(conFila.count).toBe(1);
    expect(conFila.transactions[0].gmail_msg_id).toBe("m5");
  });

  // La contraparte de `get_review_queue`: sin esta tool la cola es una lista
  // de la que no se sale. Ver review/resolve.ts.
  describe("resolve_review", () => {
    /** Devuelve el id de una fila recien puesta en la cola. */
    function enRevision(gmailMsgId: string, amount: number | null): number {
      return insertTransaction(db, {
        gmail_msg_id: gmailMsgId,
        ts: "2025-03-13T15:00:00.000Z",
        direction: "out",
        type: "debito",
        amount,
        needs_review: true,
        counterparty: "MONTO ILEGIBLE",
        source: "test",
      }).row.id;
    }

    it("confirma una fila y la saca de la cola", async () => {
      const id = enRevision("r1", 25);

      const result = parse(await client.callTool({ name: "resolve_review", arguments: { id, action: "confirm" } }));

      expect(result.ok).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.transaction.needs_review).toBe(0);
      expect(result.transaction.amount).toBe(25);

      const cola = parse(await client.callTool({ name: "get_review_queue", arguments: {} }));
      expect(cola.count).toBe(0);
    });

    it("corrige el monto cuando lo afirma un humano y lo deja anotado", async () => {
      const id = enRevision("r2", null);

      const result = parse(
        await client.callTool({
          name: "resolve_review",
          arguments: { id, action: "correct", amount: 41.07, resolved_by: "mato", note: "leido del correo" },
        })
      );

      expect(result.transaction.amount).toBe(41.07);
      expect(result.transaction.source).toBe("human");
      expect(result.resolution).toMatchObject({ action: "correct", resolved_by: "mato", previous_amount: 0 });
    });

    it("descarta sin devolver la fila a los totales", async () => {
      const id = enRevision("r3", 25);

      const result = parse(await client.callTool({ name: "resolve_review", arguments: { id, action: "discard" } }));

      expect(result.transaction.is_discarded).toBe(1);
      expect(result.transaction.needs_review).toBe(0);
    });

    it("es idempotente", async () => {
      const id = enRevision("r4", 25);
      await client.callTool({ name: "resolve_review", arguments: { id, action: "confirm" } });

      const segunda = parse(await client.callTool({ name: "resolve_review", arguments: { id, action: "confirm" } }));

      expect(segunda).toMatchObject({ ok: true, changed: false, reason: "already_resolved" });
    });

    // El error del motor tiene que llegar como error de la tool, no como un
    // `ok: true` que el agente lea como exito.
    it.each([
      ["una fila que no existe", { id: 9999, action: "confirm" }],
      ["correct sin monto", { id: -1, action: "correct" }],
      ["confirm con monto", { id: -1, action: "confirm", amount: 9 }],
    ])("falla en %s", async (_caso, args) => {
      const id = args.id === -1 ? enRevision(`err-${_caso}`, 25) : args.id;

      const raw = (await client.callTool({ name: "resolve_review", arguments: { ...args, id } })) as {
        isError?: boolean;
      };

      expect(raw.isError).toBe(true);
    });

    it("registra el historial de resoluciones", async () => {
      const id = enRevision("r5", 25);
      await client.callTool({ name: "resolve_review", arguments: { id, action: "confirm", resolved_by: "mato" } });

      const historial = parse(await client.callTool({ name: "get_review_queue", arguments: { history: true } }));
      expect(historial.resolutions).toHaveLength(1);
      expect(historial.resolutions[0]).toMatchObject({ transaction_id: id, action: "confirm", resolved_by: "mato" });
    });
  });

  it("get_overview responde el tablero completo del motor", async () => {
    const result = parse(await client.callTool({ name: "get_overview", arguments: {} }));

    expect(Object.keys(result).sort()).toEqual(
      [
        "balance",
        "buffer_status",
        "card",
        "card_status",
        "counts",
        "next_payday",
        "safe_to_spend_hoy",
        "spending_by_category",
        "transfers_summary",
      ].sort()
    );
    expect(result.next_payday).toBe("2025-03-30");
  });
});
