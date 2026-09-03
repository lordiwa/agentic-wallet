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
