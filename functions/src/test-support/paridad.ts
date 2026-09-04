/**
 * El andamio de los tests de PARIDAD: un mismo ledger ficticio, montado a la
 * vez en el SQLite del motor y en la forma que consume el puerto.
 *
 * La pregunta que estos tests contestan no es "¿el puerto anda?" sino "¿el
 * puerto dice **lo mismo**?". Por eso el fixture es uno solo y se materializa
 * dos veces con la misma función de derivación (`toTransactionDoc`, la que usó
 * la migración): si las dos entradas no fueran la misma fila, comparar las
 * salidas no probaría nada.
 *
 * **El huso se fija en -5 en los dos lados.** El motor lo lee de
 * `process.env.WALLET_UTC_OFFSET_HOURS` (vía el `.env` que `config.ts` carga al
 * importar) y el puerto lo recibe por parámetro. Sin fijarlo, el resultado
 * dependería del `.env` de la máquina que corre el test — que es exactamente el
 * tipo de test que miente en CI.
 *
 * Nombres ficticios y montos redondos, siempre: CLAUDE.md regla 2.
 */
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../../server/src/db/schema.js";
import { setStrategyConfig } from "../../../server/src/db/strategy-config.js";
import { toTransactionDoc, type RawTransaction, type TransactionDoc } from "../ledger/derive.js";
import { encodeDocId } from "../ledger/paths.js";
import { toLedgerRow, type LedgerRow } from "../ledger/rows.js";

/** El huso con el que corren los dos lados. */
export const OFFSET = -5;

export interface Regla {
  pattern: string;
  category: string;
}

export interface Extracto {
  card_mask?: string | null;
  issue_date?: string | null;
  balance?: number | null;
  min_payment?: number | null;
  due_date?: string | null;
}

export interface LedgerDePrueba {
  filas: (RawTransaction & { id: number })[];
  reglas?: Regla[];
  silenciadas?: { pattern: string; counterparty: string }[];
  extractos?: Extracto[];
  colchonReservado?: number;
  config?: Record<string, unknown>;
}

/** Una fila con todos los campos, para no repetirlos en cada caso. */
export function fila(overrides: Partial<RawTransaction> & { id: number }): RawTransaction & { id: number } {
  return {
    gmail_msg_id: `msg-${overrides.id}`,
    gmail_thread_id: null,
    ts: "2026-05-15T14:00:00.000Z",
    direction: "out",
    type: "debito",
    amount: 10,
    currency: "USD",
    counterparty: "Comercio Ficticio",
    account: null,
    account_holder: null,
    category: null,
    raw_subject: null,
    is_reversed: 0,
    is_internal: 0,
    needs_review: 0,
    is_discarded: 0,
    source: "parser",
    created_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

export interface Montado {
  db: Database.Database;
  cerrar: () => void;
  /** Los documentos, ya derivados con el mismo `toTransactionDoc` de la
   * migración y de la ingesta. */
  docs: TransactionDoc[];
  /** Los contables (`countable`), que es lo que consume `strategy.ts`. */
  contables: LedgerRow[];
  /** La población de la cola: gasto contable con contraparte. */
  clasificables: LedgerRow[];
  /** Sólo las que la cola PUEDE preguntar (`queueEligible`). */
  elegibles: LedgerRow[];
}

/**
 * Monta el ledger en un SQLite real con el esquema del motor, y devuelve
 * además las filas en la forma del puerto.
 *
 * El SQLite va a un directorio temporal y no en memoria porque `migrate()` es
 * el esquema real y los tests que comparan quieren correr contra él, no contra
 * una versión simplificada.
 */
export function montar(ledger: LedgerDePrueba): Montado {
  process.env.WALLET_UTC_OFFSET_HOURS = String(OFFSET);

  const dir = mkdtempSync(join(tmpdir(), "paridad-"));
  const db = new Database(join(dir, "ledger.sqlite"));
  migrate(db);

  const insertar = db.prepare(
    `INSERT INTO transactions (
       id, gmail_msg_id, gmail_thread_id, ts, direction, type, amount, currency, counterparty,
       account, account_holder, category, raw_subject, is_reversed, is_internal, needs_review,
       is_discarded, source, created_at
     ) VALUES (
       @id, @gmail_msg_id, @gmail_thread_id, @ts, @direction, @type, @amount, @currency, @counterparty,
       @account, @account_holder, @category, @raw_subject, @is_reversed, @is_internal, @needs_review,
       @is_discarded, @source, @created_at
     )`
  );
  for (const f of ledger.filas) insertar.run(f);

  for (const regla of ledger.reglas ?? []) {
    db.prepare("INSERT INTO category_rules (pattern, category, created_at) VALUES (?, ?, ?)").run(
      regla.pattern,
      regla.category,
      "2026-05-01T00:00:00.000Z"
    );
  }

  for (const s of ledger.silenciadas ?? []) {
    db.prepare(
      "INSERT INTO classify_silenced (pattern, counterparty, created_at) VALUES (?, ?, ?)"
    ).run(s.pattern, s.counterparty, "2026-05-01T00:00:00.000Z");
  }

  for (const e of ledger.extractos ?? []) {
    db.prepare(
      `INSERT INTO statements (card_mask, issue_date, balance, min_payment, due_date)
       VALUES (@card_mask, @issue_date, @balance, @min_payment, @due_date)`
    ).run({
      card_mask: e.card_mask ?? null,
      issue_date: e.issue_date ?? null,
      balance: e.balance ?? null,
      min_payment: e.min_payment ?? null,
      due_date: e.due_date ?? null,
    });
  }

  if (ledger.colchonReservado !== undefined) {
    db.prepare("INSERT INTO savings (label, target, reserved, updated_at) VALUES (?, ?, ?, ?)").run(
      "colchon",
      null,
      ledger.colchonReservado,
      "2026-05-01T00:00:00.000Z"
    );
  }

  if (ledger.config !== undefined) {
    // `utcOffsetHours` es una clave del documento de Firestore y no de
    // `strategy_config`: el motor lee el huso del entorno. Escribirla acá sería
    // un `safeParse` sobre un schema que no existe.
    const { utcOffsetHours: _huso, ...delMotor } = ledger.config;
    setStrategyConfig(db, delMotor as never);
  }

  const docs = ledger.filas.map((f) => toTransactionDoc(f, OFFSET));
  const contables = docs.filter((d) => d.countable).map(toLedgerRow);
  const clasificables = contables.filter(
    (row) => row.direction === "out" && (row.counterparty ?? "").trim() !== ""
  );
  const elegibles = docs.filter((d) => d.queueEligible).map(toLedgerRow);

  return {
    db,
    docs,
    contables,
    clasificables,
    elegibles,
    cerrar: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * La config del puerto equivalente a la que se escribió en el SQLite. Los
 * defaults son los mismos de `seed/default-config.ts`: todo en cero/vacío,
 * nada precargado (CLAUDE.md regla 3).
 */
export function configDelPuerto(patch: Record<string, unknown> = {}) {
  const sueldo = (patch.sueldo ?? {}) as Record<string, unknown>;
  const snapshot = (patch.balanceSnapshot ?? {}) as Record<string, unknown>;
  return {
    moneda: (patch.moneda as string) ?? "USD",
    zonaHoraria: (patch.zonaHoraria as string) ?? "",
    utcOffsetHours: OFFSET,
    colchonObjetivo: (patch.colchonObjetivo as number) ?? 0,
    topeTransferenciasMensual: (patch.topeTransferenciasMensual as number) ?? 0,
    titular: (patch.titular as string) ?? "",
    sueldo: {
      fuente: (sueldo.fuente as string) ?? "",
      cadencia: (sueldo.cadencia as string) ?? "",
      montoEstimado: (sueldo.montoEstimado as number) ?? 0,
      diasPago: (sueldo.diasPago as string[]) ?? [],
    },
    balanceSnapshot: {
      amount: (snapshot.amount as number) ?? 0,
      at: (snapshot.at as string) ?? "",
    },
  };
}

/**
 * Siembra en Firestore el MISMO ledger que `montar` puso en el SQLite.
 *
 * Escribe con `toTransactionDoc`, que es la función que usaron la migración y
 * la ingesta: una fila sembrada por un test y una migrada en producción son el
 * mismo documento, así que un test que pase acá dice algo sobre el ledger real.
 */
export async function sembrarEnFirestore(
  db: FirebaseFirestore.Firestore,
  uid: string,
  ledger: LedgerDePrueba
): Promise<void> {
  const docs = ledger.filas.map((f) => toTransactionDoc(f, OFFSET));
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + 400)) {
      batch.set(
        db.collection("users").doc(uid).collection("transactions").doc(doc.gmailMsgId),
        doc as unknown as Record<string, unknown>
      );
    }
    await batch.commit();
  }

  const batch = db.batch();
  for (const regla of ledger.reglas ?? []) {
    batch.set(db.collection("users").doc(uid).collection("rules").doc(encodeDocId(regla.pattern)), {
      pattern: regla.pattern,
      category: regla.category,
      createdAt: "2026-05-01T00:00:00.000Z",
    });
  }
  for (const s of ledger.silenciadas ?? []) {
    batch.set(db.collection("users").doc(uid).collection("silenced").doc(encodeDocId(s.pattern)), {
      pattern: s.pattern,
      counterparty: s.counterparty,
      createdAt: "2026-05-01T00:00:00.000Z",
    });
  }
  (ledger.extractos ?? []).forEach((e, i) => {
    batch.set(db.collection("users").doc(uid).collection("statements").doc(`extracto-${i}`), {
      gmailMsgId: null,
      cardMask: e.card_mask ?? null,
      issueDate: e.issue_date ?? null,
      balance: e.balance ?? null,
      minPayment: e.min_payment ?? null,
      dueDate: e.due_date ?? null,
    });
  });
  if (ledger.colchonReservado !== undefined) {
    batch.set(db.collection("users").doc(uid).collection("savings").doc("colchon"), {
      label: "colchon",
      reservedCents: Math.round(ledger.colchonReservado * 100),
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
  }
  batch.set(
    db.collection("users").doc(uid).collection("config").doc("strategy"),
    configDelPuerto(ledger.config ?? {})
  );
  await batch.commit();
}

/**
 * Un ledger sintético grande y desordenado. Existe porque los casos a mano
 * prueban lo que uno pensó y éste prueba lo que uno no: mezcla tipos,
 * direcciones, banderas de exclusión, grafías distintas del mismo comercio y
 * montos con centavos, a lo largo de varios meses.
 */
export function ledgerGrande(): (RawTransaction & { id: number })[] {
  const nombres = [
    "Tienda A",
    "tienda a",
    "FARMACIA SUR",
    "Clinica Norte",
    "Persona X",
    "Servicio Luz",
    "Comercio Mixto",
  ];
  const tipos = ["debito", "credito", "transferencia", "servicio", "recarga", "retiro", "sueldo"];
  const filas: (RawTransaction & { id: number })[] = [];
  for (let i = 0; i < 240; i += 1) {
    const tipo = tipos[i % tipos.length]!;
    filas.push(
      fila({
        id: i + 1,
        counterparty: nombres[i % nombres.length]!,
        type: tipo,
        direction: tipo === "sueldo" ? "in" : "out",
        amount: ((i * 7) % 97) + 0.37,
        ts: `2026-0${(i % 5) + 3}-${String((i % 27) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
        needs_review: i % 23 === 0 ? 1 : 0,
        is_internal: i % 31 === 0 ? 1 : 0,
        is_reversed: i % 37 === 0 ? 1 : 0,
        is_discarded: i % 41 === 0 ? 1 : 0,
      })
    );
  }
  return filas;
}
