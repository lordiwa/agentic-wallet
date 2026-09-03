/**
 * Las rutas de la cola de clasificación (N1). Acá sólo se prueba lo que la capa
 * HTTP hace: validar, llamar al motor y serializar. Las reglas de la cola, del
 * escritor, del silenciador y del progreso tienen sus tests en
 * `server/src/classify/`, que es donde vive la decisión.
 */
import Database from "better-sqlite3";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { insertTransaction, type NewTransaction } from "../db/repository.js";
import { migrate } from "../db/schema.js";
import { createApp } from "../index.js";

let db: Database.Database;
let app: ReturnType<typeof createApp>;

function tx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    gmail_msg_id: `tx-${Math.random()}`,
    ts: "2026-07-10T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: 10,
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  app = createApp(db);
});

describe("GET /api/classify/queue", () => {
  it("devuelve grupos por contraparte, ordenados por plata", async () => {
    insertTransaction(db, tx({ gmail_msg_id: "a1", counterparty: "TIENDA AURORA", amount: 100 }));
    insertTransaction(db, tx({ gmail_msg_id: "a2", counterparty: "Tienda Aurora", amount: 30 }));
    insertTransaction(db, tx({ gmail_msg_id: "b1", counterparty: "KIOSCO BELEN", amount: 40 }));

    const res = await request(app).get("/api/classify/queue").expect(200);

    expect(res.body.count).toBe(2);
    expect(res.body.groups[0]).toMatchObject({ pattern: "tienda aurora", count: 2, total: 130 });
  });

  it("acepta ?transaction_ids= para la cola del lote de un sync (D7-b)", async () => {
    const lote = insertTransaction(db, tx({ gmail_msg_id: "l1", counterparty: "TIENDA AURORA", amount: 20 }));
    insertTransaction(db, tx({ gmail_msg_id: "viejo", counterparty: "KIOSCO BELEN", amount: 900 }));

    const res = await request(app)
      .get("/api/classify/queue")
      .query({ transaction_ids: String(lote.row.id) })
      .expect(200);

    expect(res.body.groups.map((group: any) => group.pattern)).toEqual(["tienda aurora"]);
  });

  it("rechaza un ?transaction_ids= que no son enteros positivos", async () => {
    await request(app).get("/api/classify/queue").query({ transaction_ids: "1,abc" }).expect(400);
  });
});

describe("POST /api/classify", () => {
  beforeEach(() => {
    insertTransaction(db, tx({ gmail_msg_id: "f1", counterparty: "FARMACIA LIMA", amount: 60 }));
  });

  it("escribe la regla y devuelve el efecto, con el corte del mes en curso", async () => {
    const res = await request(app)
      .post("/api/classify")
      .send({ counterparty: "FARMACIA LIMA", category: "salud" })
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, pattern: "farmacia lima", category: "salud", reclassified: 1 });
    expect(res.body).toHaveProperty("reclassified_this_month");
    await request(app).get("/api/classify/queue").expect(200).then((queue) => {
      expect(queue.body.count).toBe(0);
    });
  });

  it("400 con una categoría que no es del glosario", async () => {
    await request(app)
      .post("/api/classify")
      .send({ counterparty: "FARMACIA LIMA", category: "criptomonedas" })
      .expect(400);
  });

  /**
   * Wargaming del MVP (W8). Los dos fallbacks son lo que `categorize` devuelve
   * cuando NO sabe, o sea la definición de la cola. Responder con uno escribía
   * la regla, devolvía `ok: true` con su conteo, y el grupo **seguía en la
   * cola**: un 200 que no hace nada, y por la API o la tool MCP un bucle
   * infinito de preguntas. El selector del panel ya los excluía; ahora el borde
   * también, así que la garantía no depende de qué cliente llame.
   */
  it.each(["otros", "transferencia_persona"])("400 con el fallback %s, que dejaría el grupo en la cola", async (category) => {
    await request(app).post("/api/classify").send({ counterparty: "FARMACIA LIMA", category }).expect(400);

    await request(app)
      .get("/api/classify/queue")
      .expect(200)
      .then((queue) => {
        expect(queue.body.count).toBe(1);
      });
  });

  /** La contraparte inventada es un rechazo del motor, no un 404: el cliente
   * afirmó algo que el ledger no respalda. */
  it("400 con una contraparte que no existe en el ledger", async () => {
    const res = await request(app)
      .post("/api/classify")
      .send({ counterparty: "FARMACIA LIMA SUCURSAL 3", category: "salud" })
      .expect(400);

    expect(res.body.error).toBe("counterparty_not_found");
  });
});

describe("POST /api/classify/silence", () => {
  it("saca la contraparte de la cola, la lista, y la devuelve con DELETE", async () => {
    insertTransaction(db, tx({ gmail_msg_id: "p1", type: "transferencia", counterparty: "PERSONA UNO", amount: 300 }));

    await request(app).post("/api/classify/silence").send({ counterparty: "PERSONA UNO" }).expect(200);
    await request(app).get("/api/classify/queue").expect(200).then((res) => expect(res.body.count).toBe(0));

    const silenced = await request(app).get("/api/classify/silenced").expect(200);
    expect(silenced.body.silenced[0]).toMatchObject({ pattern: "persona uno" });

    await request(app).delete("/api/classify/silence").send({ counterparty: "PERSONA UNO" }).expect(200);
    await request(app).get("/api/classify/queue").expect(200).then((res) => expect(res.body.count).toBe(1));
  });

  it("400 sin contraparte", async () => {
    await request(app).post("/api/classify/silence").send({}).expect(400);
  });
});

describe("GET /api/classify/progress", () => {
  it("responde el progreso por plata y el criterio de terminado", async () => {
    insertTransaction(db, tx({ gmail_msg_id: "a", counterparty: "COMERCIO A", amount: 100 }));
    insertTransaction(db, tx({ gmail_msg_id: "b", counterparty: "COMERCIO B", amount: 25 }));

    const res = await request(app).get("/api/classify/progress").expect(200);

    expect(res.body).toMatchObject({
      unclassified_total: 125,
      covered_ratio: 0,
      target_ratio: 0.8,
      groups: 2,
      answers_to_target: 1,
      done: false,
    });
  });
});

describe("GET /api/transactions?category= (H21)", () => {
  it("filtra por la categoría RECALCULADA y devuelve el total de la barra", async () => {
    // El mes en curso del período por defecto es el del reloj real, así que el
    // rango va explícito: lo mismo que hace el panel al tocar una barra.
    insertTransaction(db, tx({ gmail_msg_id: "e1", type: "retiro", amount: 40, category: "otros" }));
    insertTransaction(db, tx({ gmail_msg_id: "e2", type: "retiro", amount: 60, category: null }));
    insertTransaction(db, tx({ gmail_msg_id: "otra", counterparty: "TIENDA AURORA", amount: 5 }));

    const res = await request(app)
      .get("/api/transactions")
      .query({ category: "efectivo", from: "2026-07-01T05:00:00.000Z", to: "2026-08-01T05:00:00.000Z" })
      .expect(200);

    expect(res.body.total).toBe(2);
    expect(res.body.amount).toBe(100);
    expect(res.body.transactions.map((row: any) => row.gmail_msg_id)).toEqual(["e2", "e1"]);
  });

  it("rechaza una categoría fuera del glosario", async () => {
    await request(app).get("/api/transactions").query({ category: "criptomonedas" }).expect(400);
  });
});
