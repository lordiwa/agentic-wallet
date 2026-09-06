/**
 * La función `api` de punta a punta, contra el emulador.
 *
 * Lo que se prueba acá es el BORDE, no la aritmética: quién puede llamar, qué
 * ruta existe, qué status devuelve cada rechazo, y —lo más importante— que el
 * ledger que se lee sea el del uid del token y de ningún otro. Las cifras
 * tienen sus tests de paridad; repetirlas acá sería probar dos veces lo mismo y
 * ninguna vez lo que este archivo tiene que custodiar.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Auth } from "firebase-admin/auth";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../test-support/emulator.js";
import { fila, OFFSET, sembrarEnFirestore, type LedgerDePrueba } from "../test-support/paridad.js";
import { apiHandler, normalizarPath, RUTAS } from "./router.js";

const AHORA = new Date("2026-06-10T15:00:00.000Z");

function authQueDevuelve(uid: string): Auth {
  return {
    verifyIdToken: vi.fn(async () => ({ uid, email: `${uid}@ejemplo.test`, email_verified: true })),
  } as unknown as Auth;
}

/** Un `Auth` que rechaza todo, como haría uno real con un token inventado. */
function authQueRechaza(): Auth {
  return {
    verifyIdToken: vi.fn(async () => {
      throw new Error("token invalido");
    }),
  } as unknown as Auth;
}

interface Peticion {
  method?: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
}

function parHttp(p: Peticion) {
  const estado = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) {
      estado.status = code;
      return res;
    },
    json(payload: unknown) {
      estado.body = payload;
      return res;
    },
    send(payload: unknown) {
      estado.body = payload;
      return res;
    },
    set(key: string, value: string) {
      estado.headers[key] = value;
      return res;
    },
  };
  const req = {
    method: p.method ?? "GET",
    path: p.path,
    query: p.query ?? {},
    body: p.body ?? {},
    headers: p.headers ?? { authorization: "Bearer un-id-token" },
  };
  return { req: req as never, res: res as never, estado };
}

describe("normalizarPath", () => {
  it("acepta el path con y sin el prefijo /api", () => {
    expect(normalizarPath("/api/transactions")).toBe("/transactions");
    expect(normalizarPath("/transactions")).toBe("/transactions");
    expect(normalizarPath("/api/classify/queue")).toBe("/classify/queue");
    expect(normalizarPath("/classify/queue")).toBe("/classify/queue");
  });

  it("no confunde una ruta que EMPIEZA con 'api' con el prefijo", () => {
    // `/apis` no es `/api` + `/s`: el prefijo es un segmento entero.
    expect(normalizarPath("/apis")).toBe("/apis");
    expect(normalizarPath("/apifoo/bar")).toBe("/apifoo/bar");
  });

  it("tira la query y la barra final", () => {
    expect(normalizarPath("/api/transactions?limit=10")).toBe("/transactions");
    expect(normalizarPath("/api/review/")).toBe("/review");
  });

  it("el prefijo solo es la raiz", () => {
    expect(normalizarPath("/api")).toBe("/");
    expect(normalizarPath("/")).toBe("/");
  });
});

const LEDGER: LedgerDePrueba = {
  filas: [
    fila({ id: 1, counterparty: "Tienda A", amount: 40, ts: "2026-06-03T14:00:00.000Z" }),
    fila({ id: 2, counterparty: "FARMACIA SUR", amount: 25, ts: "2026-06-04T14:00:00.000Z" }),
    fila({ id: 3, counterparty: "Persona X", type: "transferencia", amount: 60, ts: "2026-06-05T14:00:00.000Z" }),
    fila({ id: 4, counterparty: "Tienda B", amount: 0, needs_review: 1, ts: "2026-06-06T14:00:00.000Z" }),
    fila({ id: 5, counterparty: "Interna", type: "transferencia", is_internal: 1, amount: 500, ts: "2026-06-07T14:00:00.000Z" }),
    fila({ id: 6, counterparty: "Sueldo SA", type: "sueldo", direction: "in", amount: 1200, ts: "2026-06-01T14:00:00.000Z" }),
  ],
  config: {
    moneda: "USD",
    colchonObjetivo: 500,
    topeTransferenciasMensual: 200,
    sueldo: { fuente: "", cadencia: "quincenal", montoEstimado: 1200, diasPago: ["15-15", "30-30"] },
    balanceSnapshot: { amount: 2000, at: "2026-05-01" },
  },
  colchonReservado: 100,
};

describe.skipIf(!hayEmulador)("la funcion api contra el emulador", () => {
  const handle = hayEmulador ? conectarEmulador() : null;
  const uid = uidDePrueba("api");
  const otro = uidDePrueba("api-otro");

  beforeAll(async () => {
    process.env.WALLET_UTC_OFFSET_HOURS = String(OFFSET);
    await sembrarEnFirestore(handle!.db, uid, LEDGER);
    // El otro tenant tiene UNA fila y otro perfil: sirve para probar que nadie
    // ve el ledger de nadie.
    await sembrarEnFirestore(handle!.db, otro, {
      filas: [fila({ id: 99, counterparty: "Solo Del Otro", amount: 777, ts: "2026-06-02T14:00:00.000Z" })],
    });
  });

  afterAll(async () => {
    if (handle === null) return;
    await limpiarTenant(handle.db, uid);
    await limpiarTenant(handle.db, otro);
  });

  function llamar(p: Peticion, quien = uid) {
    const par = parHttp(p);
    return apiHandler({ auth: authQueDevuelve(quien), db: handle!.db, now: () => AHORA })(
      par.req,
      par.res
    ).then(() => par.estado);
  }

  /** Las rutas del flujo, en la forma en que el panel las pide. */
  const DEL_PANEL: { method: string; path: string; body?: unknown }[] = [
    { method: "GET", path: "/api/overview" },
    { method: "GET", path: "/api/transactions" },
    { method: "GET", path: "/api/review" },
    { method: "POST", path: "/api/review/msg-4/resolve", body: { action: "confirm" } },
    { method: "GET", path: "/api/review/resolutions" },
    { method: "GET", path: "/api/classify/queue" },
    { method: "GET", path: "/api/classify/progress" },
    { method: "POST", path: "/api/classify", body: { counterparty: "Tienda A", category: "comida" } },
    { method: "POST", path: "/api/classify/silence", body: { counterparty: "Persona X" } },
    { method: "DELETE", path: "/api/classify/silence", body: { counterparty: "Persona X" } },
    { method: "GET", path: "/api/classify/silenced" },
    { method: "GET", path: "/api/sync/status" },
    { method: "GET", path: "/api/onboarding/profile" },
    { method: "POST", path: "/api/onboarding/profile", body: { colchon_objetivo: 600 } },
    { method: "GET", path: "/api/onboarding/recurring" },
    { method: "POST", path: "/api/buffer", body: { reserved: 120 } },
    { method: "GET", path: "/api/sobres" },
    { method: "POST", path: "/api/sobres", body: { nombre: "Viaje" } },
    // El colchón sirve para el humo porque es el único sobre que existe
    // siempre, en cualquier tenant: no hace falta crear nada antes.
    { method: "PATCH", path: "/api/sobres/colchon", body: { aporte: 10 } },
    { method: "GET", path: "/api/transfers" },
  ];

  /**
   * **Ninguna ruta del flujo contesta 501.** Ése era el estado del pivot: el
   * panel pedía y el backend decía "todavía no". La lista de arriba es la que
   * `panel/src/api/endpoints.ts` consume, y este test la recorre entera.
   */
  it("las veinte rutas del panel existen y ninguna contesta 501", async () => {
    expect(DEL_PANEL).toHaveLength(RUTAS.length);
    // En su propio tenant: ocho de las veinte ESCRIBEN, y correrlas sobre el
    // ledger compartido dejaría a los tests de abajo mirando un estado que este
    // test acaba de mover (la cola de revisión vacía, una regla escrita).
    const solo = uidDePrueba("api-humo");
    await sembrarEnFirestore(handle!.db, solo, LEDGER);
    try {
      for (const ruta of DEL_PANEL) {
        const estado = await llamar({ method: ruta.method, path: ruta.path, body: ruta.body }, solo);
        expect({ ruta: `${ruta.method} ${ruta.path}`, status: estado.status }).toEqual({
          ruta: `${ruta.method} ${ruta.path}`,
          status: 200,
        });
      }
    } finally {
      await limpiarTenant(handle!.db, solo);
    }
  });

  it("sin token TODAS contestan 401, no un cuerpo vacio ni un 200", async () => {
    for (const ruta of DEL_PANEL) {
      const par = parHttp({ method: ruta.method, path: ruta.path, body: ruta.body, headers: {} });
      await apiHandler({ auth: authQueRechaza(), db: handle!.db })(par.req, par.res);
      expect({ ruta: ruta.path, status: par.estado.status }).toEqual({ ruta: ruta.path, status: 401 });
      expect((par.estado.body as { error: string }).error).toBe("sin_token");
    }
  });

  it("con un token que no verifica tambien es 401 y sin detalle util para quien prueba tokens", async () => {
    const par = parHttp({ path: "/api/overview" });
    await apiHandler({ auth: authQueRechaza(), db: handle!.db })(par.req, par.res);
    expect(par.estado.status).toBe(401);
    expect((par.estado.body as { error: string }).error).toBe("token_invalido");
  });

  it("una ruta que no existe es 404 con su nombre, NO 501", async () => {
    const estado = await llamar({ path: "/api/lo-que-sea" });
    expect(estado.status).toBe(404);
    expect((estado.body as { error: string }).error).toBe("ruta_desconocida");
  });

  it("el preflight se contesta 204 sin tocar el ledger", async () => {
    const par = parHttp({ method: "OPTIONS", path: "/api/overview", headers: {} });
    await apiHandler({ auth: authQueRechaza(), db: handle!.db })(par.req, par.res);
    expect(par.estado.status).toBe(204);
  });

  it("el mismo path con y sin /api llega al mismo handler", async () => {
    const con = await llamar({ path: "/api/classify/progress" });
    const sin = await llamar({ path: "/classify/progress" });
    expect(sin.body).toEqual(con.body);
  });

  /** El uid sale del token y de ningún otro lado. */
  it("cada tenant ve SOLO su ledger", async () => {
    const mio = await llamar({ path: "/api/transactions" }, uid);
    const ajeno = await llamar({ path: "/api/transactions" }, otro);

    const contrapartesMias = (mio.body as { transactions: { counterparty: string }[] }).transactions.map(
      (t) => t.counterparty
    );
    const contrapartesAjenas = (
      ajeno.body as { transactions: { counterparty: string }[] }
    ).transactions.map((t) => t.counterparty);

    expect(contrapartesMias).not.toContain("Solo Del Otro");
    expect(contrapartesAjenas).toEqual(["Solo Del Otro"]);
  });

  it("el listado excluye internas y descartadas pero SI muestra las que esperan revision", async () => {
    const estado = await llamar({ path: "/api/transactions" });
    const filas = (estado.body as { transactions: { counterparty: string; needs_review: number }[] })
      .transactions;
    expect(filas.map((f) => f.counterparty)).not.toContain("Interna");
    expect(filas.some((f) => f.needs_review === 1)).toBe(true);
  });

  it("el id de una fila es su gmail_msg_id, y con el se puede resolver", async () => {
    const estado = await llamar({ path: "/api/review" });
    const filas = (estado.body as { transactions: { id: string; gmail_msg_id: string }[] }).transactions;
    expect(filas[0]!.id).toBe(filas[0]!.gmail_msg_id);
  });

  /* --- sobres ---------------------------------------------------------------
   *
   * Lo que este bloque custodia no son las cifras —ésas las prueba
   * `ledger/sobres.test.ts`— sino las dos cosas que sólo se ven de punta a
   * punta: que el sobre del colchón sea EL colchón (el mismo que el resumen
   * descuenta, no una copia), y que un sobre nuevo no le mueva una cifra a
   * nadie.
   */
  describe("sobres", () => {
    /** Cada test con su tenant: todos escriben. */
    async function conTenant<T>(fn: (uid: string) => Promise<T>): Promise<T> {
      const solo = uidDePrueba("sobres");
      await sembrarEnFirestore(handle!.db, solo, LEDGER);
      try {
        return await fn(solo);
      } finally {
        await limpiarTenant(handle!.db, solo);
      }
    }

    interface SobreHttp {
      id: string;
      nombre: string;
      monto: number;
      objetivo: number | null;
      sistema: boolean;
    }

    it("el sobre del colchon ES el colchon: los mismos dos numeros que el overview", async () => {
      await conTenant(async (solo) => {
        const estado = await llamar({ path: "/api/sobres" }, solo);
        const { sobres, total, moneda } = estado.body as {
          sobres: SobreHttp[];
          total: number;
          moneda: string;
        };

        expect(sobres[0]).toMatchObject({
          id: "colchon",
          nombre: "Emergencia",
          sistema: true,
          // Los del LEDGER de arriba: reservado 100, objetivo 500.
          monto: 100,
          objetivo: 500,
        });
        expect(total).toBe(100);
        expect(moneda).toBe("USD");

        const overview = await llamar({ path: "/api/overview" }, solo);
        const buffer = (overview.body as { buffer_status: { reservado: number; objetivo: number } })
          .buffer_status;
        expect({ monto: buffer.reservado, objetivo: buffer.objetivo }).toEqual({
          monto: sobres[0]!.monto,
          objetivo: sobres[0]!.objetivo,
        });
      });
    });

    it("un aporte al colchon mueve el safe-to-spend; uno a otro sobre NO", async () => {
      await conTenant(async (solo) => {
        const inicial = (
          (await llamar({ path: "/api/overview" }, solo)).body as { safe_to_spend_hoy: number }
        ).safe_to_spend_hoy;

        await llamar({ method: "POST", path: "/api/sobres", body: { nombre: "Viaje", monto: 300 } }, solo);
        const conSobre = (
          (await llamar({ path: "/api/overview" }, solo)).body as { safe_to_spend_hoy: number }
        ).safe_to_spend_hoy;
        // Un sobre nuevo es contabilidad: no hay plata que se haya movido.
        expect(conSobre).toBe(inicial);

        await llamar({ method: "PATCH", path: "/api/sobres/colchon", body: { aporte: 300 } }, solo);
        const conColchon = (
          (await llamar({ path: "/api/overview" }, solo)).body as { safe_to_spend_hoy: number }
        ).safe_to_spend_hoy;
        // El colchón sí: es el piso que el motor descuenta.
        expect(conColchon).toBeLessThan(inicial);
      });
    });

    it("crear un sobre lo deja en la lista, con su monto y su total", async () => {
      await conTenant(async (solo) => {
        const creado = await llamar(
          { method: "POST", path: "/api/sobres", body: { nombre: "FlexiAhorro", monto: 1105.73, objetivo: 2000 } },
          solo
        );
        expect(creado.status).toBe(200);
        expect((creado.body as { sobre: SobreHttp }).sobre).toMatchObject({
          id: "flexiahorro",
          nombre: "FlexiAhorro",
          monto: 1105.73,
          objetivo: 2000,
          sistema: false,
        });

        const lista = (await llamar({ path: "/api/sobres" }, solo)).body as {
          sobres: SobreHttp[];
          total: number;
        };
        expect(lista.sobres.map((s) => s.id)).toEqual(["colchon", "flexiahorro"]);
        expect(lista.total).toBe(1205.73);
      });
    });

    it("el mismo sobre dos veces es un rechazo, no un segundo sobre", async () => {
      await conTenant(async (solo) => {
        await llamar({ method: "POST", path: "/api/sobres", body: { nombre: "Viaje a Perú" } }, solo);
        const repetido = await llamar(
          { method: "POST", path: "/api/sobres", body: { nombre: "viaje a peru" } },
          solo
        );
        expect(repetido.status).toBe(400);
        expect((repetido.body as { error: string }).error).toBe("sobre_duplicado");
      });
    });

    it("nadie crea un segundo colchon llamandolo Emergencia", async () => {
      await conTenant(async (solo) => {
        const estado = await llamar(
          { method: "POST", path: "/api/sobres", body: { nombre: "Emergencia" } },
          solo
        );
        expect(estado.status).toBe(400);
        expect((estado.body as { error: string }).error).toBe("sobre_reservado");
      });
    });

    it("el objetivo del colchon se escribe donde el motor lo lee", async () => {
      await conTenant(async (solo) => {
        await llamar({ method: "PATCH", path: "/api/sobres/colchon", body: { objetivo: 800 } }, solo);
        // No en `savings/colchon.targetCents`: en el perfil, que es de donde
        // salen `colchon_objetivo` y `colchon_fijado`.
        const perfil = (await llamar({ path: "/api/onboarding/profile" }, solo)).body as {
          colchon_objetivo: number;
          colchon_fijado: boolean;
        };
        expect(perfil).toMatchObject({ colchon_objetivo: 800, colchon_fijado: true });
      });
    });

    it("renombrar y retirar de un sobre propio; el colchon no se renombra", async () => {
      await conTenant(async (solo) => {
        await llamar({ method: "POST", path: "/api/sobres", body: { nombre: "Viaje", monto: 100 } }, solo);

        const ajustado = await llamar(
          { method: "PATCH", path: "/api/sobres/viaje", body: { nombre: "Viaje largo", aporte: -40 } },
          solo
        );
        expect((ajustado.body as { sobre: SobreHttp }).sobre).toMatchObject({
          id: "viaje",
          nombre: "Viaje largo",
          monto: 60,
        });

        const vaciado = await llamar(
          { method: "PATCH", path: "/api/sobres/viaje", body: { aporte: -100 } },
          solo
        );
        expect(vaciado.status).toBe(400);
        expect((vaciado.body as { error: string }).error).toBe("monto_negativo");

        const colchon = await llamar(
          { method: "PATCH", path: "/api/sobres/colchon", body: { nombre: "Vacaciones" } },
          solo
        );
        expect(colchon.status).toBe(400);
        expect((colchon.body as { error: string }).error).toBe("sobre_del_sistema");
      });
    });

    it("ajustar un sobre que no existe es 404, no un sobre nuevo", async () => {
      await conTenant(async (solo) => {
        const estado = await llamar(
          { method: "PATCH", path: "/api/sobres/no-existe", body: { aporte: 10 } },
          solo
        );
        expect(estado.status).toBe(404);
        expect((estado.body as { error: string }).error).toBe("sobre_no_existe");
      });
    });

    it("los sobres son de su dueno y de nadie mas", async () => {
      await conTenant(async (solo) => {
        await llamar({ method: "POST", path: "/api/sobres", body: { nombre: "Secreto" } }, solo);
        const ajeno = (await llamar({ path: "/api/sobres" }, otro)).body as { sobres: SobreHttp[] };
        expect(ajeno.sobres.map((s) => s.id)).toEqual(["colchon"]);
      });
    });
  });

  it("un cuerpo mal formado es 400 con el detalle, no un 500", async () => {
    const estado = await llamar({
      method: "POST",
      path: "/api/classify",
      body: { counterparty: "Tienda A", category: "no-es-una-categoria" },
    });
    expect(estado.status).toBe(400);
    expect((estado.body as { error: string }).error).toBe("invalid classify body");
  });

  /**
   * La contracara del caso de arriba: las seis categorías que se sumaron al
   * glosario después del MVP entran por el borde. El panel las ofrece desde su
   * propia lista (`panel/src/lib/categorias.ts`) — no hay ruta que se las
   * dicte —, así que si el enum del server no las tuviera, la tarjeta mostraría
   * el botón y la respuesta sería un 400 sin explicación.
   */
  it("las categorias nuevas del glosario se aceptan, no son un 400", async () => {
    for (const category of ["vivienda", "entretenimiento", "limpieza", "deuda", "prestamo", "regalo"]) {
      const estado = await llamar({
        method: "POST",
        path: "/api/classify",
        body: { counterparty: "Tienda A", category },
      });
      expect(estado.status).toBe(200);
    }
  });

  /** Los dos fallbacks no se pueden responder: escribirían una regla y dejarían
   * al grupo en la cola para siempre. */
  it("responder con un fallback se rechaza en el borde", async () => {
    for (const category of ["otros", "transferencia_persona"]) {
      const estado = await llamar({
        method: "POST",
        path: "/api/classify",
        body: { counterparty: "Tienda A", category },
      });
      expect(estado.status).toBe(400);
    }
  });

  it("resolver una fila que no existe es 404; un monto donde no va es 400", async () => {
    expect(
      (await llamar({ method: "POST", path: "/api/review/no-existe/resolve", body: { action: "confirm" } }))
        .status
    ).toBe(404);
    expect(
      (
        await llamar({
          method: "POST",
          path: "/api/review/msg-4/resolve",
          body: { action: "confirm", amount: 5 },
        })
      ).status
    ).toBe(400);
  });

  it("nada de este backend se cachea: son cifras que cambian con cada sync", async () => {
    const par = parHttp({ path: "/api/overview" });
    await apiHandler({ auth: authQueDevuelve(uid), db: handle!.db, now: () => AHORA })(par.req, par.res);
    expect(par.estado.headers["Cache-Control"]).toBe("no-store");
  });

  it("el estado del sync arranca en 'nunca sincronizaste', que no es 'hoy'", async () => {
    const estado = await llamar({ path: "/api/sync/status" });
    expect(estado.body).toEqual({ last_sync_ts: null, running: false, backlog: null });
  });

  it("el perfil se escribe parcial: el colchon no pisa el dia de pago", async () => {
    await llamar({ method: "POST", path: "/api/onboarding/profile", body: { colchon_objetivo: 900 } });
    const estado = await llamar({ path: "/api/onboarding/profile" });
    expect(estado.body).toMatchObject({
      colchon_objetivo: 900,
      colchon_fijado: true,
      dias_pago: ["15-15", "30-30"],
      dia_de_pago_fijado: true,
    });
  });

  it("un dia de pago que el calendario no sabria leer se rechaza en vez de guardarse mudo", async () => {
    const estado = await llamar({
      method: "POST",
      path: "/api/onboarding/profile",
      body: { dias_pago: ["quincena"] },
    });
    expect(estado.status).toBe(400);
    expect((estado.body as { error: string }).error).toBe("dias_pago_invalidos");
  });

  it("un cuerpo de perfil sin ningun campo es 400: guardar nada no es guardar", async () => {
    const estado = await llamar({ method: "POST", path: "/api/onboarding/profile", body: {} });
    expect(estado.status).toBe(400);
    expect((estado.body as { error: string }).error).toBe("sin_campos");
  });

  it("el colchon se fija por POST /buffer y el overview lo refleja", async () => {
    await llamar({ method: "POST", path: "/api/buffer", body: { reserved: 250 } });
    const estado = await llamar({ path: "/api/overview" });
    expect((estado.body as { buffer_status: { reservado: number } }).buffer_status.reservado).toBe(250);
  });

  it("la cola por lote dice cuanto tiene la contraparte FUERA del lote (W23)", async () => {
    const estado = await llamar({
      path: "/api/classify/queue",
      query: { transaction_ids: "msg-3" },
    });
    const grupos = (estado.body as { groups: { pattern: string; count: number; count_en_ledger?: number }[] })
      .groups;
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.count_en_ledger).toBeDefined();
  });

  it("sin lote, la cola no inventa los campos del lote", async () => {
    const estado = await llamar({ path: "/api/classify/queue" });
    const grupos = (estado.body as { groups: { count_en_ledger?: number }[] }).groups;
    expect(grupos.every((g) => g.count_en_ledger === undefined)).toBe(true);
  });

  /**
   * El circuito entero de una categoría nueva, en el orden en que lo recorre
   * una persona: la contraparte está en la cola, se responde con la categoría,
   * y **el Resumen se mueve**. Es el test que faltaba: los de arriba prueban
   * que responder no da 400, y los de paridad prueban la aritmética, pero
   * ninguno probaba que la respuesta llegara hasta el gráfico. Sin este, que
   * una categoría del glosario quedara fuera de los totales sería un cambio
   * silencioso.
   *
   * Corre en su propio tenant porque escribe una regla, y sobre el ledger
   * compartido dejaría a los demás mirando una categoría que este test movió.
   */
  it("responder con una categoria nueva la hace aparecer en el Resumen y en la lista", async () => {
    const solo = uidDePrueba("api-nueva");
    await sembrarEnFirestore(handle!.db, solo, LEDGER);
    try {
      const antes = await llamar({ path: "/api/overview" }, solo);
      const gastoAntes = (antes.body as { spending_by_category: Record<string, number> })
        .spending_by_category;
      expect(gastoAntes.implementos_trabajo).toBeUndefined();

      const respuesta = await llamar(
        {
          method: "POST",
          path: "/api/classify",
          body: { counterparty: "Tienda A", category: "implementos_trabajo" },
        },
        solo
      );
      expect(respuesta.status).toBe(200);
      // La tarjeta promete que el gráfico se va a mover; si prometiera cero, la
      // asersión de abajo estaría midiendo otra cosa.
      expect((respuesta.body as { reclassified_this_month: number }).reclassified_this_month).toBe(1);

      const despues = await llamar({ path: "/api/overview" }, solo);
      const gasto = (despues.body as { spending_by_category: Record<string, number> })
        .spending_by_category;
      // Los 40 de "Tienda A" (fila 1), que antes estaban en el bucket de 'otros'.
      expect(gasto.implementos_trabajo).toBe(40);

      // Y la barra lleva a una lista que cuenta lo mismo (H21).
      const lista = await llamar(
        { path: "/api/transactions", query: { category: "implementos_trabajo" } },
        solo
      );
      const filas = (lista.body as { transactions: { counterparty: string | null; amount: number }[] })
        .transactions;
      expect(filas).toHaveLength(1);
      expect(filas[0]!.amount).toBe(40);
    } finally {
      await limpiarTenant(handle!.db, solo);
    }
  });
});
