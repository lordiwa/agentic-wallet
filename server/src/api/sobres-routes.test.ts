/**
 * Las tres rutas de sobres del motor local, de punta a punta.
 *
 * Lo que este archivo custodia **no son las cifras** —de ésas se ocupa
 * `strategy/sobres.test.ts`, que prueba el módulo puro— sino las dos cosas que
 * sólo se ven con la base delante:
 *
 * 1. Que el sobre del colchón sea **el** colchón: la misma fila que
 *    `colchonStatus` lee, no una copia. Si esto se rompiera, la pantalla de
 *    sobres y el Resumen mostrarían dos cifras distintas de la misma plata.
 * 2. Que crear un sobre **no mueva ninguna otra cifra**. Un sobre es
 *    contabilidad; el único que baja el safe-to-spend es el colchón.
 */
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../index.js";
import { migrate } from "../db/schema.js";
import { colchonStatus } from "../strategy/index.js";

let db: Database.Database;
let app: ReturnType<typeof createApp>;

function setConfig(clave: string, valor: unknown): void {
  db.prepare("INSERT INTO strategy_config (key, value) VALUES (@key, @value)").run({
    key: clave,
    value: JSON.stringify(valor),
  });
}

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  app = createApp(db);
});

describe("GET /api/sobres", () => {
  it("el colchon esta aunque nadie haya reservado nada: cero, no ausente", async () => {
    const res = await request(app).get("/api/sobres").expect(200);
    expect(res.body.sobres).toHaveLength(1);
    expect(res.body.sobres[0]).toMatchObject({
      id: "colchon",
      nombre: "Emergencia",
      monto: 0,
      // R25: sin objetivo fijado es `null`, no 0 — un cero se lee como meta
      // cumplida y dibuja la barra llena.
      objetivo: null,
      sistema: true,
    });
    expect(res.body.total).toBe(0);
  });

  it("el sobre del colchon es la fila del colchon, no una copia", async () => {
    setConfig("colchonObjetivo", 1000);
    db.prepare(
      "INSERT INTO savings (label, target, reserved, updated_at) VALUES ('colchon', NULL, 200, datetime('now'))"
    ).run();

    const res = await request(app).get("/api/sobres").expect(200);
    const motor = colchonStatus(db);
    expect({ monto: res.body.sobres[0].monto, objetivo: res.body.sobres[0].objetivo }).toEqual({
      monto: motor.reservado,
      objetivo: motor.objetivo,
    });
  });

  it("suma el total y ordena por monto, con el colchon siempre primero", async () => {
    await request(app).post("/api/sobres").send({ nombre: "Regalos", monto: 25 }).expect(200);
    await request(app).post("/api/sobres").send({ nombre: "FlexiAhorro", monto: 1105.73 }).expect(200);

    const res = await request(app).get("/api/sobres").expect(200);
    expect(res.body.sobres.map((s: { id: string }) => s.id)).toEqual([
      "colchon",
      "flexiahorro",
      "regalos",
    ]);
    expect(res.body.total).toBe(1130.73);
  });
});

describe("POST /api/sobres", () => {
  it("crea con el id derivado del nombre y lo devuelve entero", async () => {
    const res = await request(app)
      .post("/api/sobres")
      .send({ nombre: "Viaje a Perú", monto: 300, objetivo: 1200 })
      .expect(200);
    expect(res.body.sobre).toMatchObject({
      id: "viaje-a-peru",
      nombre: "Viaje a Perú",
      monto: 300,
      objetivo: 1200,
      sistema: false,
    });
  });

  it("un sobre nuevo NO mueve el safe-to-spend: es contabilidad, no plata movida", async () => {
    setConfig("colchonObjetivo", 1000);
    setConfig("sueldo", { fuente: "", cadencia: "quincenal", montoEstimado: 2000, diasPago: ["15-15"] });
    setConfig("balanceSnapshot", { amount: 1000, at: "2026-06-30" });

    const antes = (await request(app).get("/api/overview").expect(200)).body.safe_to_spend_hoy;
    await request(app).post("/api/sobres").send({ nombre: "Viaje", monto: 500 }).expect(200);
    const despues = (await request(app).get("/api/overview").expect(200)).body.safe_to_spend_hoy;
    expect(despues).toBe(antes);
  });

  it("sin monto arranca en cero: no se inventa un saldo plausible", async () => {
    const res = await request(app).post("/api/sobres").send({ nombre: "Regalos" }).expect(200);
    expect(res.body.sobre.monto).toBe(0);
    expect(res.body.sobre.objetivo).toBeNull();
  });

  it("el mismo sobre dos veces es un rechazo, no un segundo sobre", async () => {
    await request(app).post("/api/sobres").send({ nombre: "Viaje a Perú" }).expect(200);
    const res = await request(app).post("/api/sobres").send({ nombre: "viaje a peru" }).expect(400);
    expect(res.body.error).toBe("sobre_duplicado");
    expect((await request(app).get("/api/sobres")).body.sobres).toHaveLength(2);
  });

  it("nadie crea un segundo colchon, ni llamandolo Emergencia", async () => {
    const res = await request(app).post("/api/sobres").send({ nombre: "Emergencia" }).expect(400);
    expect(res.body.error).toBe("sobre_reservado");
  });

  it("un cuerpo sin nombre es 400 con su detalle, no un 500", async () => {
    const res = await request(app).post("/api/sobres").send({ monto: 10 }).expect(400);
    expect(res.body.error).toBe("invalid sobre body");
  });
});

describe("PATCH /api/sobres/:id", () => {
  it("un aporte suma sobre lo que habia y un retiro resta", async () => {
    await request(app).post("/api/sobres").send({ nombre: "Viaje", monto: 100 }).expect(200);

    const sumado = await request(app).patch("/api/sobres/viaje").send({ aporte: 50 }).expect(200);
    expect(sumado.body.sobre.monto).toBe(150);

    const restado = await request(app).patch("/api/sobres/viaje").send({ aporte: -20 }).expect(200);
    expect(restado.body.sobre.monto).toBe(130);
  });

  it("no se puede retirar mas de lo que hay adentro", async () => {
    await request(app).post("/api/sobres").send({ nombre: "Viaje", monto: 100 }).expect(200);
    const res = await request(app).patch("/api/sobres/viaje").send({ aporte: -101 }).expect(400);
    expect(res.body.error).toBe("monto_negativo");
  });

  it("renombrar cambia el nombre y NO el id: los aportes no se pierden", async () => {
    await request(app).post("/api/sobres").send({ nombre: "Viaje", monto: 100 }).expect(200);
    const res = await request(app).patch("/api/sobres/viaje").send({ nombre: "Viaje largo" }).expect(200);
    expect(res.body.sobre).toMatchObject({ id: "viaje", nombre: "Viaje largo", monto: 100 });

    const lista = await request(app).get("/api/sobres").expect(200);
    expect(lista.body.sobres[1]).toMatchObject({ id: "viaje", nombre: "Viaje largo", monto: 100 });
  });

  it("el monto del colchon se escribe donde el motor lo lee", async () => {
    setConfig("colchonObjetivo", 1000);
    await request(app).patch("/api/sobres/colchon").send({ monto: 250 }).expect(200);
    expect(colchonStatus(db).reservado).toBe(250);
  });

  it("el objetivo del colchon va al perfil, no a la columna target", async () => {
    await request(app).patch("/api/sobres/colchon").send({ objetivo: 800 }).expect(200);
    expect(colchonStatus(db).objetivo).toBe(800);
    // Y el perfil lo ve: es el mismo campo que fija la pantalla de alta.
    const perfil = await request(app).get("/api/onboarding/profile").expect(200);
    expect(perfil.body).toMatchObject({ colchon_objetivo: 800, colchon_fijado: true });
  });

  it("el colchon no se renombra", async () => {
    const res = await request(app).patch("/api/sobres/colchon").send({ nombre: "Vacaciones" }).expect(400);
    expect(res.body.error).toBe("sobre_del_sistema");
  });

  it("monto y aporte juntos, y un patch vacio, son rechazos con nombre", async () => {
    await request(app).post("/api/sobres").send({ nombre: "Viaje" }).expect(200);
    expect((await request(app).patch("/api/sobres/viaje").send({ monto: 1, aporte: 1 }).expect(400)).body.error).toBe(
      "monto_y_aporte"
    );
    expect((await request(app).patch("/api/sobres/viaje").send({}).expect(400)).body.error).toBe("sin_cambios");
  });

  it("ajustar un sobre que no existe es 404, no un sobre nuevo", async () => {
    const res = await request(app).patch("/api/sobres/no-existe").send({ aporte: 10 }).expect(404);
    expect(res.body.error).toBe("sobre_no_existe");
    expect((await request(app).get("/api/sobres")).body.sobres).toHaveLength(1);
  });
});
