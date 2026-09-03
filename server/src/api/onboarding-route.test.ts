/**
 * Las rutas del perfil y del análisis del historial (N4). Acá sólo se prueba lo
 * que la capa HTTP hace: validar, llamar al motor y serializar. Las reglas —qué
 * día de pago es válido, qué significa un objetivo en cero, cómo se lee un
 * gasto fijo— tienen sus tests en `server/src/onboard/`, que es donde viven.
 */
import Database from "better-sqlite3";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { insertTransaction, type NewTransaction } from "../db/repository.js";
import { migrate } from "../db/schema.js";
import { getStrategyConfig, setStrategyConfig } from "../db/strategy-config.js";
import { createApp } from "../index.js";

let db: Database.Database;
let app: ReturnType<typeof createApp>;

let seq = 0;
function tx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  seq += 1;
  return {
    gmail_msg_id: `tx-${seq}`,
    ts: "2026-07-10T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: 10,
    ...overrides,
  };
}

function gasto(counterparty: string, mes: number, dia: number, amount: number): NewTransaction {
  const mm = String(mes).padStart(2, "0");
  const dd = String(dia).padStart(2, "0");
  return tx({ ts: `2026-${mm}-${dd}T12:00:00Z`, counterparty, amount });
}

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  app = createApp(db);
});

describe("GET /api/onboarding/profile", () => {
  it("un perfil sin configurar dice que no está fijado, no que vale cero (R25)", async () => {
    const res = await request(app).get("/api/onboarding/profile").expect(200);

    expect(res.body).toEqual({
      dias_pago: [],
      dia_de_pago_fijado: false,
      colchon_objetivo: 0,
      colchon_fijado: false,
    });
  });

  it("devuelve los dos campos una vez escritos", async () => {
    await request(app)
      .post("/api/onboarding/profile")
      .send({ dias_pago: ["15", "30"], colchon_objetivo: 500 })
      .expect(200);

    const res = await request(app).get("/api/onboarding/profile").expect(200);

    expect(res.body).toEqual({
      dias_pago: ["15-15", "30-30"],
      dia_de_pago_fijado: true,
      colchon_objetivo: 500,
      colchon_fijado: true,
    });
  });
});

describe("POST /api/onboarding/profile", () => {
  it("escribe exactamente los dos campos del perfil (criterio 6)", async () => {
    setStrategyConfig(db, {
      titular: "PEREZ GOMEZ ANA MARIA",
      moneda: "USD",
      sueldo: { fuente: "EMPRESA FICTICIA SA", cadencia: "quincenal", montoEstimado: 1200, diasPago: [] },
    });

    const res = await request(app)
      .post("/api/onboarding/profile")
      .send({ dias_pago: ["15", "30"], colchon_objetivo: 500 })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.campos).toEqual(["diasPago", "colchonObjetivo"]);

    const config = getStrategyConfig(db);
    expect(config.colchonObjetivo).toBe(500);
    expect(config.sueldo.diasPago).toEqual(["15-15", "30-30"]);
    // Lo que el motor leyó del historial y esta pantalla no edita.
    expect(config.titular).toBe("PEREZ GOMEZ ANA MARIA");
    expect(config.sueldo.montoEstimado).toBe(1200);
    expect(config.sueldo.fuente).toBe("EMPRESA FICTICIA SA");
  });

  it("es parcial: mandar sólo el colchón no borra el día de pago", async () => {
    await request(app).post("/api/onboarding/profile").send({ dias_pago: ["15"] }).expect(200);
    await request(app).post("/api/onboarding/profile").send({ colchon_objetivo: 900 }).expect(200);

    const res = await request(app).get("/api/onboarding/profile").expect(200);
    expect(res.body).toMatchObject({ dias_pago: ["15-15"], colchon_objetivo: 900 });
  });

  it("un día de pago que el calendario no sabría leer es 400, no un guardado mudo", async () => {
    const res = await request(app)
      .post("/api/onboarding/profile")
      .send({ dias_pago: ["quincena"] })
      .expect(400);

    expect(res.body.error).toBe("dias_pago_invalidos");
    expect(getStrategyConfig(db).sueldo.diasPago).toEqual([]);
  });

  it("un cuerpo sin ningún campo es 400: guardar nada no es guardar", async () => {
    const res = await request(app).post("/api/onboarding/profile").send({}).expect(400);

    expect(res.body.error).toBe("sin_campos");
  });

  it("un colchón negativo lo rechaza el borde, sin llegar al motor", async () => {
    await request(app).post("/api/onboarding/profile").send({ colchon_objetivo: -5 }).expect(400);
  });

  it("un colchón que no es número es 400", async () => {
    await request(app).post("/api/onboarding/profile").send({ colchon_objetivo: "mucho" }).expect(400);
  });
});

describe("GET /api/onboarding/recurring", () => {
  it("un ledger vacío no propone nada y dice que el historial no alcanza", async () => {
    const res = await request(app).get("/api/onboarding/recurring").expect(200);

    expect(res.body).toEqual({
      propuestas: [],
      candidatas: 0,
      en_la_cola: 0,
      meses_de_historial: 0,
      meses_minimos: 3,
      suficiente_historial: false,
    });
  });

  it("serializa la propuesta con su día típico y su tamaño de muestra", async () => {
    for (const mes of [1, 2, 3, 4, 5, 6]) {
      insertTransaction(db, gasto(`FONDO FICTICIO DE MES ${mes}`, mes, 2, 1));
    }
    for (const mes of [1, 2, 3, 4]) {
      insertTransaction(db, gasto("SERVICIO FICTICIO UNO", mes, 12, 25));
    }

    const res = await request(app).get("/api/onboarding/recurring").expect(200);

    expect(res.body.suficiente_historial).toBe(true);
    expect(res.body.propuestas[0]).toEqual({
      pattern: "servicio ficticio uno",
      counterparty: "SERVICIO FICTICIO UNO",
      monto_estimado: 25,
      dia_tipico: 12,
      sample_size: 4,
      count: 4,
      total: 100,
      last_ts: "2026-04-12T12:00:00Z",
    });
  });

  it("no escribe nada: el análisis propone y confirma el usuario (criterio 4)", async () => {
    for (const mes of [1, 2, 3, 4, 5, 6]) {
      insertTransaction(db, gasto("SERVICIO FICTICIO DOS", mes, 12, 25));
    }

    await request(app).get("/api/onboarding/recurring").expect(200);

    const reglas = db.prepare("SELECT COUNT(*) as c FROM category_rules").get() as { c: number };
    expect(reglas.c).toBe(0);
  });
});
