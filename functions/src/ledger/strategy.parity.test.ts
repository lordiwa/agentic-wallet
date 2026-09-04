/**
 * **Paridad de los cinco indicadores de estrategia.**
 *
 * Son las cifras que el usuario lee como afirmaciones sobre su plata: cuánto
 * puede gastar hoy, cuánto debe la tarjeta, cuánto transfirió este mes, cuándo
 * cobra, en qué se le fue el mes. Un puerto que se corra un centavo en
 * cualquiera de ellas es peor que uno que no exista, porque no se nota.
 *
 * Cada caso monta el MISMO ledger en el SQLite del motor y en la forma del
 * puerto, y compara las cinco salidas con `toEqual`. El `now` se fija: un test
 * de plata que dependa del reloj de la máquina es un test que va a fallar un
 * martes cualquiera y nadie va a saber por qué.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { nextPayday as nextPaydayMotor } from "../../../server/src/strategy/calendar.js";
import { colchonStatus as colchonMotor, safeToSpendHoy as safeMotor } from "../../../server/src/strategy/balance.js";
import { tarjetaStatus as tarjetaMotor } from "../../../server/src/strategy/card.js";
import { transferenciasMes as transferenciasMotor } from "../../../server/src/strategy/transfers.js";
import { spendingByCategory as spendingMotor } from "../../../server/src/strategy/spending.js";
import { localMonthRange as mesMotor } from "../../../server/src/strategy/dates.js";
import { balanceActual as balanceMotor } from "../../../server/src/strategy/balance.js";
import {
  configDelPuerto,
  fila,
  ledgerGrande,
  montar,
  OFFSET,
  type LedgerDePrueba,
} from "../test-support/paridad.js";
import type { EstablishmentRule } from "./categorize.js";
import type { EntradaCalendario } from "./calendar.js";
import { nextPayday } from "./calendar.js";
import { localMonthRange } from "./derive.js";
import type { StatementDoc } from "./firestore-ledger.js";
import {
  balanceActual,
  categorizedSpendingRows,
  colchonStatus,
  safeToSpendHoy,
  spendingByCategory,
  tarjetaStatus,
  transferenciasMes,
} from "./strategy.js";

const AHORA = new Date("2026-06-10T15:00:00.000Z");

function comparar(ledger: LedgerDePrueba, now: Date = AHORA): void {
  const montado = montar(ledger);
  try {
    const config = configDelPuerto(ledger.config ?? {});
    const reglas = (ledger.reglas ?? []) as EstablishmentRule[];
    const reservado = ledger.colchonReservado ?? 0;

    // El extracto que el motor elige es el más reciente por `issue_date`.
    const e = [...(ledger.extractos ?? [])].sort((a, b) =>
      (a.issue_date ?? "") < (b.issue_date ?? "") ? 1 : -1
    )[0];
    const statement: StatementDoc | null =
      e === undefined
        ? null
        : {
            gmailMsgId: null,
            cardMask: e.card_mask ?? null,
            issueDate: e.issue_date ?? null,
            balance: e.balance ?? null,
            minPayment: e.min_payment ?? null,
            dueDate: e.due_date ?? null,
          };

    const calendario: EntradaCalendario = {
      diasPago: config.sueldo.diasPago,
      historicalDays: montado.docs
        .filter((d) => d.type === "sueldo" && d.day !== null)
        .map((d) => Number((d.day as string).slice(8, 10))),
      offsetHours: OFFSET,
    };

    expect(balanceActual(montado.contables, config, now, OFFSET)).toEqual(balanceMotor(montado.db, now));
    expect(colchonStatus(config, reservado)).toEqual(colchonMotor(montado.db));
    expect(nextPayday(calendario, now)).toEqual(nextPaydayMotor(montado.db, now));
    expect(tarjetaStatus(statement, config, montado.contables, calendario, now, OFFSET)).toEqual(
      tarjetaMotor(montado.db, now)
    );
    expect(transferenciasMes(montado.contables, config, now, OFFSET)).toEqual(
      transferenciasMotor(montado.db, now)
    );

    const mes = localMonthRange(now, OFFSET);
    expect({ from: mes.from.toISOString(), to: mes.to.toISOString() }).toEqual({
      from: mesMotor(now).from.toISOString(),
      to: mesMotor(now).to.toISOString(),
    });
    expect(spendingByCategory(categorizedSpendingRows(montado.contables, reglas, mes))).toEqual(
      spendingMotor(montado.db, mesMotor(now))
    );

    expect(
      safeToSpendHoy(montado.contables, config, statement, reservado, calendario, now, OFFSET)
    ).toEqual(safeMotor(montado.db, now));
  } finally {
    montado.cerrar();
  }
}

describe("los cinco indicadores portados dan lo mismo que el motor", () => {
  beforeAll(() => {
    process.env.WALLET_UTC_OFFSET_HOURS = String(OFFSET);
  });

  it("una billetera vacia: ni un NaN, ni una cifra inventada", () => {
    comparar({ filas: [] });
  });

  /** **R7.** Sin día de pago no hay contra qué dividir, y el motor devuelve 0
   * como guarda y no como afirmación. El puerto tiene que devolver el MISMO 0
   * por el MISMO motivo. */
  it("sin dia de pago configurado el safe-to-spend es 0 en los dos", () => {
    comparar({
      filas: [fila({ id: 1, amount: 100 })],
      config: { balanceSnapshot: { amount: 1000, at: "2026-05-01" } },
    });
  });

  it("con dia de pago, snapshot y gasto esencial: el numero grande del Resumen", () => {
    comparar({
      filas: [
        fila({ id: 1, type: "debito", amount: 40, ts: "2026-05-10T14:00:00.000Z" }),
        fila({ id: 2, type: "servicio", amount: 25, ts: "2026-05-20T14:00:00.000Z" }),
        fila({ id: 3, type: "retiro", amount: 60, ts: "2026-06-02T14:00:00.000Z" }),
        fila({ id: 4, type: "credito", amount: 90, ts: "2026-06-05T14:00:00.000Z" }),
        fila({ id: 5, type: "sueldo", direction: "in", amount: 1200, ts: "2026-05-15T14:00:00.000Z" }),
      ],
      colchonReservado: 200,
      config: {
        colchonObjetivo: 500,
        sueldo: { fuente: "", cadencia: "quincenal", montoEstimado: 1200, diasPago: ["15-15", "30-30"] },
        balanceSnapshot: { amount: 2000, at: "2026-05-01" },
      },
    });
  });

  it("con extracto de tarjeta: saldo de corte, cargos nuevos y a-tiempo", () => {
    comparar({
      filas: [
        fila({ id: 1, type: "credito", amount: 120, ts: "2026-06-03T14:00:00.000Z" }),
        fila({ id: 2, type: "credito", amount: 45, ts: "2026-05-20T14:00:00.000Z" }),
        fila({ id: 3, type: "sueldo", direction: "in", amount: 900, ts: "2026-05-15T14:00:00.000Z" }),
      ],
      extractos: [
        { card_mask: "****1234", issue_date: "2026-06-01", balance: 300, min_payment: 30, due_date: "2026-06-25" },
      ],
      config: {
        sueldo: { fuente: "", cadencia: "quincenal", montoEstimado: 900, diasPago: ["15-15", "30-30"] },
        balanceSnapshot: { amount: 1500, at: "2026-05-01" },
      },
    });
  });

  it("dos extractos: gana el mas reciente por issue_date", () => {
    comparar({
      filas: [fila({ id: 1, type: "credito", amount: 50, ts: "2026-06-05T14:00:00.000Z" })],
      extractos: [
        { card_mask: "****1111", issue_date: "2026-04-01", balance: 999, min_payment: 99, due_date: "2026-04-25" },
        { card_mask: "****2222", issue_date: "2026-06-01", balance: 300, min_payment: 30, due_date: "2026-06-25" },
      ],
      config: {
        sueldo: { fuente: "", cadencia: "quincenal", montoEstimado: 900, diasPago: ["15-15"] },
      },
    });
  });

  it("un extracto sin fecha de vencimiento: aTiempo es true porque no hay nada que perder", () => {
    comparar({
      filas: [fila({ id: 1, type: "credito", amount: 10 })],
      extractos: [{ card_mask: "****3333", issue_date: "2026-06-01", balance: 500, min_payment: 50, due_date: null }],
      config: { sueldo: { fuente: "", cadencia: "", montoEstimado: 100, diasPago: ["15-15"] } },
    });
  });

  it("transferencias del mes contra el tope, con sus contrapartes", () => {
    comparar({
      filas: [
        fila({ id: 1, type: "transferencia", counterparty: "Persona X", amount: 120, ts: "2026-06-02T14:00:00.000Z" }),
        fila({ id: 2, type: "transferencia", counterparty: "Persona Y", amount: 80, ts: "2026-06-05T14:00:00.000Z" }),
        fila({ id: 3, type: "transferencia", counterparty: "Persona X", amount: 40, ts: "2026-06-08T14:00:00.000Z" }),
        // Del mes pasado: no cuenta.
        fila({ id: 4, type: "transferencia", counterparty: "Persona Z", amount: 500, ts: "2026-05-08T14:00:00.000Z" }),
        // Interna: no es un comercio ni una persona.
        fila({ id: 5, type: "transferencia", counterparty: "Mi Cuenta", amount: 900, is_internal: 1, ts: "2026-06-08T14:00:00.000Z" }),
      ],
      config: { topeTransferenciasMensual: 200 },
    });
  });

  /** El borde del mes local: 02:00 UTC del 1 de junio son las 21:00 del 31 de
   * mayo con offset -5, así que esa compra es de MAYO. */
  it("el borde del mes es LOCAL y no UTC en los dos lados", () => {
    comparar({
      filas: [
        fila({ id: 1, amount: 10, ts: "2026-06-01T02:00:00.000Z", counterparty: "Tienda A" }),
        fila({ id: 2, amount: 20, ts: "2026-06-01T12:00:00.000Z", counterparty: "Tienda A" }),
        fila({ id: 3, amount: 30, ts: "2026-07-01T02:00:00.000Z", counterparty: "Tienda A" }),
      ],
    });
  });

  it("el gasto por categoria se recalcula con las reglas de hoy, no con la columna", () => {
    comparar({
      filas: [
        // La columna dice `comida`; la regla de hoy dice `salud`. Manda la regla.
        fila({ id: 1, counterparty: "FARMACIA SUR", amount: 40, category: "comida", ts: "2026-06-03T14:00:00.000Z" }),
        fila({ id: 2, counterparty: "Tienda A", amount: 15, ts: "2026-06-04T14:00:00.000Z" }),
        fila({ id: 3, type: "servicio", counterparty: "Luz", amount: 60, ts: "2026-06-05T14:00:00.000Z" }),
      ],
      reglas: [{ pattern: "farmacia", category: "salud" }],
    });
  });

  it("un snapshot de saldo ilegible no rompe: la ventana se abre desde la epoca", () => {
    comparar({
      filas: [fila({ id: 1, amount: 10, ts: "2020-01-01T14:00:00.000Z" })],
      config: { balanceSnapshot: { amount: 500, at: "no-es-una-fecha" } },
    });
  });

  it("un ledger grande y desordenado coincide en los cinco", () => {
    comparar({
      filas: ledgerGrande(),
      reglas: [{ pattern: "farmacia", category: "salud" }],
      colchonReservado: 150,
      extractos: [
        { card_mask: "****9999", issue_date: "2026-06-01", balance: 420.5, min_payment: 42, due_date: "2026-06-28" },
      ],
      config: {
        colchonObjetivo: 800,
        topeTransferenciasMensual: 300,
        sueldo: { fuente: "", cadencia: "quincenal", montoEstimado: 1500, diasPago: ["15-15", "<=5"] },
        balanceSnapshot: { amount: 3000, at: "2026-04-01" },
      },
    });
  });
});
