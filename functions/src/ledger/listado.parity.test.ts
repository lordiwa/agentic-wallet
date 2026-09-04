/**
 * **Paridad del listado de movimientos**, contra el emulador.
 *
 * Es el puerto menos obvio de todos. El motor lo resuelve con un `WHERE` de
 * cinco cláusulas y un `LIMIT/OFFSET`; Firestore no sabe expresar
 * `type != 'reverso'` junto a otras igualdades sin arrastrar el orden, así que
 * el puerto lo arma como la unión de dos consultas disjuntas —los contables y
 * los que esperan revisión— y filtra el resto en memoria. Que esa unión sea
 * **exactamente** el conjunto del motor es una afirmación que hay que probar,
 * no creer: si le sobra una fila, el panel lista un reverso como si fuera un
 * ingreso; si le falta una, esconde plata.
 *
 * Los `ts` de los fixtures son todos distintos a propósito: el motor ordena
 * sólo por `ts DESC` y deja el desempate a la implementación, así que comparar
 * un orden con empates sería comparar dos detalles internos y no un contrato.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { queryTransactions, queryReviewTransactions } from "../../../server/src/api/queries.js";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../test-support/emulator.js";
import { fila, OFFSET, sembrarEnFirestore, type LedgerDePrueba } from "../test-support/paridad.js";
import { montar } from "../test-support/paridad.js";
import { FirestoreLedger, type TransactionsFilter } from "./firestore-ledger.js";

/**
 * Un ledger con una fila de cada clase que el filtro por defecto tiene que
 * decidir: contable, en revisión, reversada, la fila de auditoría del reverso,
 * interna, descartada, y un ingreso.
 */
const LEDGER: LedgerDePrueba = {
  filas: [
    fila({ id: 1, counterparty: "Tienda A", amount: 40, ts: "2026-06-01T10:00:00.000Z" }),
    fila({ id: 2, counterparty: "Tienda B", amount: 25, ts: "2026-06-02T10:00:00.000Z", type: "credito" }),
    fila({ id: 3, counterparty: "Tienda C", amount: 0, needs_review: 1, ts: "2026-06-03T10:00:00.000Z" }),
    fila({ id: 4, counterparty: "Tienda D", amount: 99, is_reversed: 1, ts: "2026-06-04T10:00:00.000Z" }),
    fila({ id: 5, counterparty: "Tienda D", amount: 99, type: "reverso", direction: "in", ts: "2026-06-05T10:00:00.000Z" }),
    fila({ id: 6, counterparty: "Mi Cuenta", amount: 500, is_internal: 1, type: "transferencia", ts: "2026-06-06T10:00:00.000Z" }),
    fila({ id: 7, counterparty: "Tienda E", amount: 12, is_discarded: 1, ts: "2026-06-07T10:00:00.000Z" }),
    fila({ id: 8, counterparty: "Sueldo SA", amount: 1200, direction: "in", type: "sueldo", ts: "2026-06-08T10:00:00.000Z" }),
    fila({ id: 9, counterparty: "Persona X", amount: 60, type: "transferencia", ts: "2026-06-09T10:00:00.000Z" }),
    // Una fila en revisión que ADEMÁS es interna: no entra por ninguno de los
    // dos caminos, y es el caso que una unión mal hecha deja pasar.
    fila({ id: 10, counterparty: "Mi Cuenta", amount: 300, is_internal: 1, needs_review: 1, ts: "2026-06-10T10:00:00.000Z" }),
    // Otra en revisión, ésta sí visible, para que la cola tenga dos.
    fila({ id: 11, counterparty: "Tienda F", amount: 0, needs_review: 1, ts: "2026-06-11T10:00:00.000Z" }),
  ],
};

describe.skipIf(!hayEmulador)("el listado portado devuelve el mismo conjunto que el motor", () => {
  const handle = hayEmulador ? conectarEmulador() : null;
  const tenants: string[] = [];

  beforeAll(() => {
    process.env.WALLET_UTC_OFFSET_HOURS = String(OFFSET);
  });

  afterEach(async () => {
    if (handle === null) return;
    for (const uid of tenants.splice(0)) await limpiarTenant(handle.db, uid);
  });

  async function comparar(filtro: TransactionsFilter): Promise<void> {
    const uid = uidDePrueba("listado");
    tenants.push(uid);
    const montado = montar(LEDGER);
    try {
      await sembrarEnFirestore(handle!.db, uid, LEDGER);
      const ledger = new FirestoreLedger(handle!.db, uid);

      const puerto = (await ledger.listTransactions(filtro)).map((d) => d.gmailMsgId);
      const motor = queryTransactions(montado.db, filtro).map((r) => r.gmail_msg_id);
      expect(puerto).toEqual(motor);
    } finally {
      montado.cerrar();
    }
  }

  it("sin filtros: contables y en revision, sin reversos, internas ni descartadas", async () => {
    await comparar({});
  });

  it("por tipo", async () => {
    await comparar({ type: "debito" });
    await comparar({ type: "transferencia" });
    await comparar({ type: "credito" });
  });

  it("por direccion", async () => {
    await comparar({ direction: "out" });
    await comparar({ direction: "in" });
  });

  it("por contraparte exacta", async () => {
    await comparar({ counterparty: "Tienda A" });
  });

  it("por rango de fechas, con el `to` INCLUSIVE como el motor", async () => {
    await comparar({ from: "2026-06-03T00:00:00.000Z" });
    await comparar({ to: "2026-06-05T10:00:00.000Z" });
    await comparar({ from: "2026-06-02T00:00:00.000Z", to: "2026-06-08T23:59:59.999Z" });
  });

  it("paginado: cada pagina y la de mas alla del final", async () => {
    await comparar({ limit: 2 });
    await comparar({ limit: 2, offset: 2 });
    await comparar({ limit: 2, offset: 4 });
    await comparar({ limit: 3, offset: 6 });
    await comparar({ limit: 5, offset: 50 });
  });

  it("un filtro combinado", async () => {
    await comparar({ type: "debito", direction: "out", from: "2026-06-01T00:00:00.000Z", limit: 3 });
  });

  it("la cola de revision es la misma en los dos", async () => {
    const uid = uidDePrueba("revision");
    tenants.push(uid);
    const montado = montar(LEDGER);
    try {
      await sembrarEnFirestore(handle!.db, uid, LEDGER);
      const ledger = new FirestoreLedger(handle!.db, uid);
      expect((await ledger.reviewDocs()).map((d) => d.gmailMsgId)).toEqual(
        queryReviewTransactions(montado.db).map((r) => r.gmail_msg_id)
      );
    } finally {
      montado.cerrar();
    }
  });

  /**
   * El caso que una unión mal hecha deja pasar: una fila en revisión que además
   * es interna. No es contable (por las dos razones) y el segundo camino la
   * traería si no se le aplicaran las exclusiones del listado.
   */
  it("una fila en revision que ademas es interna no entra por la puerta de atras", async () => {
    const uid = uidDePrueba("revision-interna");
    tenants.push(uid);
    const montado = montar(LEDGER);
    try {
      await sembrarEnFirestore(handle!.db, uid, LEDGER);
      const ledger = new FirestoreLedger(handle!.db, uid);
      const ids = (await ledger.listTransactions({})).map((d) => d.gmailMsgId);
      expect(ids).not.toContain("msg-10");
      // Pero la que SÍ es visible y espera revisión, entra.
      expect(ids).toContain("msg-11");
    } finally {
      montado.cerrar();
    }
  });
});
