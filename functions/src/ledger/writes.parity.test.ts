/**
 * **Paridad de los tres escritores**, contra el emulador de Firestore.
 *
 * Los tres tests de este archivo hacen lo mismo: montan el ledger en el SQLite
 * del motor y en Firestore, ejecutan la MISMA escritura en los dos, y comparan
 * (a) lo que cada uno contestó y (b) en qué estado quedó cada ledger. Que sólo
 * coincida la respuesta no alcanzaría: lo que le importa al usuario es que la
 * cola se vacíe igual y que el gráfico se mueva igual.
 *
 * Las dos invariantes que estos tests custodian:
 *
 * - **El patrón sale del ledger, no del teclado.** Un texto que no corresponde
 *   a una contraparte real no escribe nada, en los dos.
 * - **El monto sale del parser.** La única escritura de monto es `correct`, y
 *   sólo sobre una fila que el motor ya marcó.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { classifyCounterparty as classifyMotor } from "../../../server/src/classify/apply.js";
import { classifyQueue as colaMotor } from "../../../server/src/classify/queue.js";
import {
  listSilencedCounterparties as silenciadasMotor,
  silenceCounterparty as silenciarMotor,
} from "../../../server/src/classify/silenced.js";
import { resolveReview as resolveMotor } from "../../../server/src/review/resolve.js";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../test-support/emulator.js";
import {
  fila,
  montar,
  OFFSET,
  sembrarEnFirestore,
  type LedgerDePrueba,
} from "../test-support/paridad.js";
import { FirestoreLedger } from "./firestore-ledger.js";
import { groupUnclassified } from "./queue.js";
import { classifyCounterparty, resolveReview, silenceCounterparty } from "./writes.js";

const AHORA = new Date("2026-06-10T15:00:00.000Z");

describe.skipIf(!hayEmulador)("los escritores portados dejan el mismo ledger que el motor", () => {
  const handle = hayEmulador ? conectarEmulador() : null;
  const tenants: string[] = [];

  beforeAll(() => {
    process.env.WALLET_UTC_OFFSET_HOURS = String(OFFSET);
  });

  afterEach(async () => {
    if (handle === null) return;
    for (const uid of tenants.splice(0)) await limpiarTenant(handle.db, uid);
  });

  async function preparar(ledger: LedgerDePrueba) {
    const uid = uidDePrueba("writes");
    tenants.push(uid);
    const montado = montar(ledger);
    await sembrarEnFirestore(handle!.db, uid, ledger);
    return { uid, montado, ledger: new FirestoreLedger(handle!.db, uid) };
  }

  /** La cola de los dos lados, en la misma forma, para compararlas. */
  async function colas(montado: ReturnType<typeof montar>, ledger: FirestoreLedger) {
    const [elegibles, reglas, silenciadas] = await Promise.all([
      ledger.queueEligibleRows(),
      ledger.rules(),
      ledger.silencedPatterns(),
    ]);
    return {
      firestore: groupUnclassified(elegibles, reglas, silenciadas, OFFSET),
      motor: colaMotor(montado.db),
    };
  }

  const LEDGER_BASE: LedgerDePrueba = {
    filas: [
      fila({ id: 1, counterparty: "FARMACIA SUR", amount: 40, ts: "2026-06-03T14:00:00.000Z" }),
      fila({ id: 2, counterparty: "Farmacia Sur", amount: 25, ts: "2026-05-11T14:00:00.000Z" }),
      fila({ id: 3, counterparty: "Farmacia Centro", amount: 15, ts: "2026-06-05T14:00:00.000Z" }),
      fila({ id: 4, counterparty: "Tienda A", amount: 90, ts: "2026-06-07T14:00:00.000Z" }),
      fila({ id: 5, counterparty: "Persona X", type: "transferencia", amount: 60, ts: "2026-06-08T14:00:00.000Z" }),
    ],
  };

  it("responder 'que es esto' devuelve los mismos conteos y deja la misma cola", async () => {
    const { montado, ledger } = await preparar(LEDGER_BASE);
    try {
      const puerto = await classifyCounterparty(
        ledger,
        { counterparty: "FARMACIA SUR", category: "salud" },
        AHORA,
        OFFSET
      );
      const motor = classifyMotor(montado.db, { counterparty: "FARMACIA SUR", category: "salud" }, AHORA);

      expect(puerto).toEqual(motor);
      const { firestore, motor: colaDelMotor } = await colas(montado, ledger);
      expect(firestore).toEqual(colaDelMotor);
    } finally {
      montado.cerrar();
    }
  });

  /**
   * El alcance de una regla corta. `"farmacia sur"` no toca a
   * `"Farmacia Centro"`, pero una regla escrita sobre un nombre que otros
   * contienen sí, y el conteo lo tiene que decir (`otras_contrapartes`).
   */
  it("una regla que alcanza a otras contrapartes lo dice igual en los dos", async () => {
    const { montado, ledger } = await preparar({
      filas: [
        fila({ id: 1, counterparty: "Farmacia", amount: 10, ts: "2026-06-03T14:00:00.000Z" }),
        fila({ id: 2, counterparty: "Farmacia Sur", amount: 20, ts: "2026-06-04T14:00:00.000Z" }),
        fila({ id: 3, counterparty: "Farmacia Centro", amount: 30, ts: "2026-06-05T14:00:00.000Z" }),
      ],
    });
    try {
      const puerto = await classifyCounterparty(
        ledger,
        { counterparty: "Farmacia", category: "salud" },
        AHORA,
        OFFSET
      );
      const motor = classifyMotor(montado.db, { counterparty: "Farmacia", category: "salud" }, AHORA);
      expect(puerto).toEqual(motor);
      expect(puerto.ok && puerto.otras_contrapartes).toBe(2);
    } finally {
      montado.cerrar();
    }
  });

  /**
   * **La trampa fundacional del proyecto.** Un patrón más largo que la
   * contraparte no matchea nunca; los dos lados lo rechazan en vez de guardar
   * una regla que se ve bien y no clasifica una sola fila.
   */
  it("una contraparte que no existe en el ledger se rechaza en los dos", async () => {
    const { montado, ledger } = await preparar(LEDGER_BASE);
    try {
      const puerto = await classifyCounterparty(
        ledger,
        { counterparty: "farmacia sur sucursal 3", category: "salud" },
        AHORA,
        OFFSET
      );
      const motor = classifyMotor(
        montado.db,
        { counterparty: "farmacia sur sucursal 3", category: "salud" },
        AHORA
      );
      expect(puerto).toEqual(motor);
      expect(puerto).toEqual({ ok: false, error: "counterparty_not_found" });
      // Y no escribió una regla que después no matchearía nada.
      expect(await ledger.rules()).toEqual([]);
    } finally {
      montado.cerrar();
    }
  });

  it("reclassified_this_month cuenta solo lo que el grafico del mes va a mover", async () => {
    const { montado, ledger } = await preparar({
      filas: [
        // Del mes en curso (junio, con el `now` fijado).
        fila({ id: 1, counterparty: "Tienda A", amount: 10, ts: "2026-06-03T14:00:00.000Z" }),
        // De meses anteriores: la regla los mueve, el gráfico no.
        fila({ id: 2, counterparty: "Tienda A", amount: 20, ts: "2026-04-03T14:00:00.000Z" }),
        fila({ id: 3, counterparty: "Tienda A", amount: 30, ts: "2026-03-03T14:00:00.000Z" }),
      ],
    });
    try {
      const puerto = await classifyCounterparty(
        ledger,
        { counterparty: "Tienda A", category: "comida" },
        AHORA,
        OFFSET
      );
      const motor = classifyMotor(montado.db, { counterparty: "Tienda A", category: "comida" }, AHORA);
      expect(puerto).toEqual(motor);
      expect(puerto.ok && puerto.reclassified).toBe(3);
      expect(puerto.ok && puerto.reclassified_this_month).toBe(1);
    } finally {
      montado.cerrar();
    }
  });

  it("silenciar dice lo mismo, y silenciar dos veces dice changed:false en los dos", async () => {
    const { montado, ledger } = await preparar(LEDGER_BASE);
    try {
      const primera = await silenceCounterparty(ledger, "Persona X", AHORA);
      const primeraMotor = silenciarMotor(montado.db, "Persona X");
      expect(primera).toEqual(primeraMotor);
      expect(primera.ok && primera.changed).toBe(true);

      // **R13**: la segunda no saca un solo movimiento de la cola.
      const segunda = await silenceCounterparty(ledger, "persona x", AHORA);
      const segundaMotor = silenciarMotor(montado.db, "persona x");
      expect(segunda).toEqual(segundaMotor);
      expect(segunda.ok && segunda.changed).toBe(false);

      const { firestore, motor } = await colas(montado, ledger);
      expect(firestore).toEqual(motor);
      expect((await ledger.listSilenced()).map((s) => s.pattern)).toEqual(
        silenciadasMotor(montado.db).map((s) => s.pattern)
      );
    } finally {
      montado.cerrar();
    }
  });

  /** W22: `toRulePattern` perdona la caja y los acentos pero NO el espaciado
   * interno. El patrón sale de la contraparte real, así que el espaciado del
   * usuario no puede guardar un silencio que no silencia nada. */
  it("silenciar con espaciado raro se resuelve contra el ledger en los dos", async () => {
    const { montado, ledger } = await preparar(LEDGER_BASE);
    try {
      const puerto = await silenceCounterparty(ledger, "  persona   x ", AHORA);
      const motor = silenciarMotor(montado.db, "  persona   x ");
      expect(puerto).toEqual(motor);
      expect(puerto).toEqual({ ok: false, error: "counterparty_not_found" });
    } finally {
      montado.cerrar();
    }
  });
});

describe.skipIf(!hayEmulador)("la salida de la cola de monto, contra el motor", () => {
  const handle = hayEmulador ? conectarEmulador() : null;
  const tenants: string[] = [];

  beforeAll(() => {
    process.env.WALLET_UTC_OFFSET_HOURS = String(OFFSET);
  });

  afterEach(async () => {
    if (handle === null) return;
    for (const uid of tenants.splice(0)) await limpiarTenant(handle.db, uid);
  });

  const EN_REVISION: LedgerDePrueba = {
    filas: [
      fila({ id: 1, counterparty: "Tienda A", amount: 0, needs_review: 1, ts: "2026-06-03T14:00:00.000Z" }),
      fila({ id: 2, counterparty: "Tienda B", amount: 12, needs_review: 1, currency: "ARS", ts: "2026-06-04T14:00:00.000Z" }),
      fila({ id: 3, counterparty: "Tienda C", amount: 30, ts: "2026-06-05T14:00:00.000Z" }),
    ],
    config: { moneda: "USD" },
  };

  async function preparar() {
    const uid = uidDePrueba("resolve");
    tenants.push(uid);
    const montado = montar(EN_REVISION);
    await sembrarEnFirestore(handle!.db, uid, EN_REVISION);
    return { montado, ledger: new FirestoreLedger(handle!.db, uid) };
  }

  it("confirmar devuelve la fila a los totales en los dos", async () => {
    const { montado, ledger } = await preparar();
    try {
      const puerto = await resolveReview(
        ledger,
        { id: "msg-1", action: "confirm", resolvedBy: "http" },
        "USD",
        AHORA
      );
      const motor = resolveMotor(montado.db, { id: 1, action: "confirm", resolvedBy: "http" }, { now: AHORA });

      expect(puerto.ok && puerto.changed).toBe(true);
      expect(motor.ok && motor.changed).toBe(true);
      // Lo que importa: la fila vuelve a contar, con el monto del parser.
      const doc = await ledger.transactionDoc("msg-1");
      expect(doc!.needsReview).toBe(false);
      expect(doc!.countable).toBe(true);
      expect(doc!.amountCents).toBe(0); // cero es un monto válido (regla 4)
      expect((await ledger.countableRows()).map((r) => r.id).sort()).toEqual(["msg-1", "msg-3"]);
    } finally {
      montado.cerrar();
    }
  });

  it("corregir escribe el monto que una persona afirma, y deja source human", async () => {
    const { montado, ledger } = await preparar();
    try {
      const puerto = await resolveReview(
        ledger,
        { id: "msg-1", action: "correct", amount: 42.5, resolvedBy: "http" },
        "USD",
        AHORA
      );
      const motor = resolveMotor(
        montado.db,
        { id: 1, action: "correct", amount: 42.5, resolvedBy: "http" },
        { now: AHORA }
      );
      expect(puerto.ok && puerto.changed).toBe(true);
      expect(motor.ok && motor.changed).toBe(true);

      const doc = await ledger.transactionDoc("msg-1");
      expect(doc!.amountCents).toBe(4250);
      expect(doc!.source).toBe("human");
      expect(doc!.needsReview).toBe(false);
      expect(doc!.countable).toBe(true);
    } finally {
      montado.cerrar();
    }
  });

  it("descartar la saca de la cola SIN devolverla a los totales", async () => {
    const { montado, ledger } = await preparar();
    try {
      await resolveReview(ledger, { id: "msg-1", action: "discard", resolvedBy: "http" }, "USD", AHORA);
      resolveMotor(montado.db, { id: 1, action: "discard", resolvedBy: "http" }, { now: AHORA });

      const doc = await ledger.transactionDoc("msg-1");
      expect(doc!.needsReview).toBe(false);
      expect(doc!.isDiscarded).toBe(true);
      // Descartar y confirmar NO pueden hacer lo mismo.
      expect(doc!.countable).toBe(false);
      expect((await ledger.countableRows()).map((r) => r.id)).toEqual(["msg-3"]);
    } finally {
      montado.cerrar();
    }
  });

  /** Los totales suman sin mirar `currency`: confirmar una compra en otra
   * moneda metería el número crudo como si fuera moneda base. */
  it("confirmar en otra moneda se rechaza en los dos", async () => {
    const { montado, ledger } = await preparar();
    try {
      const puerto = await resolveReview(
        ledger,
        { id: "msg-2", action: "confirm", resolvedBy: "http" },
        "USD",
        AHORA
      );
      const motor = resolveMotor(montado.db, { id: 2, action: "confirm", resolvedBy: "http" }, { now: AHORA });
      expect(puerto).toEqual({ ok: false, error: "foreign_currency" });
      expect(motor).toEqual({ ok: false, error: "foreign_currency" });
    } finally {
      montado.cerrar();
    }
  });

  /** W15: corregir en otra moneda ES una persona afirmando el equivalente
   * convertido, así que el rótulo tiene que quedar en la moneda base. */
  it("corregir en otra moneda deja la fila rotulada en la moneda base", async () => {
    const { montado, ledger } = await preparar();
    try {
      await resolveReview(
        ledger,
        { id: "msg-2", action: "correct", amount: 9.9, resolvedBy: "http" },
        "USD",
        AHORA
      );
      const doc = await ledger.transactionDoc("msg-2");
      expect(doc!.currency).toBe("USD");
      expect(doc!.amountCents).toBe(990);
    } finally {
      montado.cerrar();
    }
  });

  it("resolver dos veces la misma fila no vuelve a mover nada (R13)", async () => {
    const { montado, ledger } = await preparar();
    try {
      await resolveReview(ledger, { id: "msg-1", action: "confirm", resolvedBy: "http" }, "USD", AHORA);
      const segunda = await resolveReview(
        ledger,
        { id: "msg-1", action: "confirm", resolvedBy: "http" },
        "USD",
        AHORA
      );
      expect(segunda.ok && segunda.changed).toBe(false);
      expect(segunda.ok && !segunda.changed && segunda.reason).toBe("already_resolved");
      // Y NO deja una segunda fila de auditoría.
      expect(await ledger.listResoluciones()).toHaveLength(1);
    } finally {
      montado.cerrar();
    }
  });

  /**
   * **La invariante 1 del proyecto, custodiada acá.** La única puerta por la
   * que se escribe un monto se abre sólo para una fila que el motor marcó. Una
   * fila sana no se puede editar por esta ruta.
   */
  it("una fila SANA no se puede editar por esta puerta", async () => {
    const { montado, ledger } = await preparar();
    try {
      const puerto = await resolveReview(
        ledger,
        { id: "msg-3", action: "correct", amount: 999, resolvedBy: "http" },
        "USD",
        AHORA
      );
      expect(puerto.ok && puerto.changed).toBe(false);
      expect((await ledger.transactionDoc("msg-3"))!.amountCents).toBe(3000);
    } finally {
      montado.cerrar();
    }
  });

  it("un monto donde no va, y un monto que falta, se rechazan igual que en el motor", async () => {
    const { montado, ledger } = await preparar();
    try {
      expect(
        await resolveReview(ledger, { id: "msg-1", action: "confirm", amount: 5, resolvedBy: "http" }, "USD", AHORA)
      ).toEqual(resolveMotor(montado.db, { id: 1, action: "confirm", amount: 5, resolvedBy: "http" }));
      expect(await resolveReview(ledger, { id: "msg-1", action: "correct", resolvedBy: "http" }, "USD", AHORA)).toEqual(
        resolveMotor(montado.db, { id: 1, action: "correct", resolvedBy: "http" })
      );
      expect(
        await resolveReview(ledger, { id: "msg-1", action: "confirm", resolvedBy: "  " }, "USD", AHORA)
      ).toEqual(resolveMotor(montado.db, { id: 1, action: "confirm", resolvedBy: "  " }));
    } finally {
      montado.cerrar();
    }
  });

  it("una fila que no existe es not_found en los dos", async () => {
    const { montado, ledger } = await preparar();
    try {
      expect(
        await resolveReview(ledger, { id: "no-existe", action: "confirm", resolvedBy: "http" }, "USD", AHORA)
      ).toEqual({ ok: false, error: "not_found" });
      expect(resolveMotor(montado.db, { id: 9999, action: "confirm", resolvedBy: "http" })).toEqual({
        ok: false,
        error: "not_found",
      });
    } finally {
      montado.cerrar();
    }
  });
});
