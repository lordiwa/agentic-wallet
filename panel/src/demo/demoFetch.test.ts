/**
 * T4: el modo demo tiene que cubrir las rutas que el andamio necesita. Lo que
 * se prueba acá no es que los números sean lindos — es que la demo pueda
 * recorrer el ciclo entero del chip (disparar, quedar a medias, Seguir,
 * terminar), porque si no puede, el modo demo publica una interfaz que oculta
 * la mitad de lo que N2 entrega.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { demoFetch } from "./demoFetch";

async function json<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const res = await demoFetch(path, init);
  return (await res.json()) as T;
}

interface DemoStatus {
  last_sync_ts: string | null;
  running?: boolean;
  backlog: { processed: number; total: number; remaining: number } | null;
}

interface DemoSync {
  summary: { seen: number; inserted: number; needsReview: number };
  progress: { processed: number; total: number; remaining: number; complete: boolean };
  inserted_ids: number[];
}

/** El estado del sync de la demo vive en el módulo: cada test lo drena hasta
 * el final para no dejárselo al siguiente. */
async function drenarHastaElFinal(): Promise<number> {
  let llamadas = 0;
  for (;;) {
    const res = await json<DemoSync>("/api/sync", { method: "POST" });
    llamadas += 1;
    if (res.progress.complete) return llamadas;
    if (llamadas > 20) throw new Error("la demo nunca termina de sincronizar");
  }
}

beforeEach(async () => {
  await drenarHastaElFinal();
});

describe("las rutas que el andamio de N2 necesita", () => {
  it("el overview sigue contestando lo mismo que en web/", async () => {
    const overview = await json("/api/overview");
    expect(overview).toHaveProperty("safe_to_spend_hoy");
    expect(overview).toHaveProperty("spending_by_category");
  });

  it("GET /api/sync/status expone running (R9)", async () => {
    const status = await json<DemoStatus>("/api/sync/status");
    expect(status.running).toBe(false);
  });

  it("el progreso de la cola contesta el 'M sin clasificar en K comercios'", async () => {
    const progress = await json<{ groups: number; transactions: number }>("/api/classify/progress");
    expect(progress.groups).toBeGreaterThan(0);
    expect(progress.transactions).toBeGreaterThanOrEqual(progress.groups);
  });

  it("la cola se acota al lote: ?transaction_ids= devuelve menos que la cola entera", async () => {
    const entera = await json<{ count: number }>("/api/classify/queue");
    const acotada = await json<{ count: number }>("/api/classify/queue?transaction_ids=1");
    expect(acotada.count).toBeLessThan(entera.count);
  });
});

describe("el ciclo del sync, que es lo que el chip dibuja", () => {
  it("una llamada NO termina el buzón: queda a medias con su conteo", async () => {
    const primera = await json<DemoSync>("/api/sync", { method: "POST" });

    expect(primera.progress.complete).toBe(false);
    expect(primera.progress.processed).toBeGreaterThan(0);
    expect(primera.progress.remaining).toBe(primera.progress.total - primera.progress.processed);
  });

  it("estando a medias, el status lo reporta como backlog", async () => {
    await json("/api/sync", { method: "POST" });

    const status = await json<DemoStatus>("/api/sync/status");
    expect(status.backlog).not.toBeNull();
    expect(status.backlog?.remaining).toBeGreaterThan(0);
    // A medias no es corriendo: son dos estados distintos (R9).
    expect(status.running).toBe(false);
  });

  it("Seguir hasta el final deja 'al día': con fecha y sin backlog", async () => {
    await drenarHastaElFinal();

    const status = await json<DemoStatus>("/api/sync/status");
    expect(status.backlog).toBeNull();
    expect(status.last_sync_ts).not.toBeNull();
  });

  it("cada lote devuelve los ids que entraron, para el aviso de categoría (D7-b)", async () => {
    const lote = await json<DemoSync>("/api/sync", { method: "POST" });
    expect(lote.inserted_ids.length).toBeGreaterThan(0);
    expect(lote.summary.needsReview).toBeGreaterThan(0);
  });
});

/*
 * N3. La pantalla de Preguntas ESCRIBE, y una demo que sólo lee dibuja botones
 * que no hacen nada. Lo que se prueba es que las tres escrituras cambien el
 * estado de la demo y que las respuestas tengan la forma que la pantalla
 * ramifica — sobre todo las dos que NO son éxito (R13 y R14).
 *
 * Estos tests van al final del archivo a propósito: el estado de la demo vive
 * en el módulo, y responder saca contrapartes de la cola para siempre.
 */
interface DemoCola {
  groups: { pattern: string; counterparty: string; total: number }[];
  count: number;
}

interface DemoProgreso {
  groups: number;
  covered_total: number;
  covered_ratio: number;
  done: boolean;
}

function post(path: string, body: unknown): Promise<Response> {
  return demoFetch(path, { method: "POST", body: JSON.stringify(body) });
}

describe("N3 — la demo puede responder, no sólo mirar", () => {
  it("clasificar saca la contraparte de la cola y devuelve los dos conteos de R19", async () => {
    const antes = await json<DemoCola>("/api/classify/queue");
    const elegida = antes.groups[0];

    const res = await post("/api/classify", { counterparty: elegida.counterparty, category: "comida" });
    const cuerpo = (await res.json()) as { ok: boolean; reclassified: number; reclassified_this_month: number };
    expect(res.status).toBe(200);
    expect(cuerpo.ok).toBe(true);
    expect(cuerpo.reclassified).toBeGreaterThan(0);
    expect(cuerpo.reclassified_this_month).toBeGreaterThanOrEqual(0);

    const despues = await json<DemoCola>("/api/classify/queue");
    expect(despues.count).toBe(antes.count - 1);
    expect(despues.groups.map((g) => g.pattern)).not.toContain(elegida.pattern);
  });

  it("el progreso por plata sube con la respuesta: no es una constante", async () => {
    const antes = await json<DemoProgreso>("/api/classify/progress");
    const cola = await json<DemoCola>("/api/classify/queue");

    await post("/api/classify/silence", { counterparty: cola.groups[0].counterparty });

    const despues = await json<DemoProgreso>("/api/classify/progress");
    expect(despues.covered_total).toBeGreaterThan(antes.covered_total);
    expect(despues.groups).toBe(antes.groups - 1);
  });

  it("una contraparte que no está en el ledger no escribe ninguna regla", async () => {
    const res = await post("/api/classify", { counterparty: "Nombre Que No Existe", category: "salud" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "counterparty_not_found" });
  });

  it("R14: confirmar una fila en otra moneda es un 400 con su motivo", async () => {
    const cola = await json<{ transactions: { id: number; currency: string }[] }>("/api/review");
    const enOtraMoneda = cola.transactions.find((t) => t.currency !== "USD");
    expect(enOtraMoneda).toBeDefined();

    const res = await post(`/api/review/${enOtraMoneda?.id}/resolve`, { action: "confirm" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "foreign_currency" });
  });

  it("corregir esa misma fila sí es una salida, y la saca de la cola", async () => {
    const antes = await json<{ count: number; transactions: { id: number; currency: string }[] }>("/api/review");
    const enOtraMoneda = antes.transactions.find((t) => t.currency !== "USD");

    const res = await post(`/api/review/${enOtraMoneda?.id}/resolve`, { action: "correct", amount: 30 });
    const cuerpo = (await res.json()) as { changed: boolean };
    expect(cuerpo.changed).toBe(true);

    const despues = await json<{ count: number }>("/api/review");
    expect(despues.count).toBe(antes.count - 1);
  });

  it("R13: resolver dos veces la misma fila devuelve 200 con changed:false", async () => {
    const cola = await json<{ transactions: { id: number }[] }>("/api/review");
    const id = cola.transactions[0].id;

    const primera = (await (await post(`/api/review/${id}/resolve`, { action: "confirm" })).json()) as {
      changed: boolean;
    };
    expect(primera.changed).toBe(true);

    const segunda = await post(`/api/review/${id}/resolve`, { action: "confirm" });
    expect(segunda.status).toBe(200);
    expect(await segunda.json()).toMatchObject({ ok: true, changed: false, reason: "already_resolved" });
  });

  it("resolver baja el 'sin confirmar' del overview: los conteos no quedan viejos", async () => {
    const antes = await json<{ counts: { needs_review: number } }>("/api/overview");
    const cola = await json<{ transactions: { id: number }[] }>("/api/review");
    if (cola.transactions.length === 0) return;

    await post(`/api/review/${cola.transactions[0].id}/resolve`, { action: "discard" });

    const despues = await json<{ counts: { needs_review: number } }>("/api/overview");
    expect(despues.counts.needs_review).toBe(antes.counts.needs_review - 1);
  });
});
