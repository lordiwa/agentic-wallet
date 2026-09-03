/**
 * La capa de datos del ledger sobre Firestore: **el mínimo que las dos
 * funciones de muestra necesitan**, con la interfaz pensada para que el resto
 * del motor se porte encima sin reescribirla.
 *
 * Lo que este archivo NO hace, a propósito: no calcula plata. Devuelve filas y
 * conteos; quién los suma es `api/overview.ts`, que es la copia del
 * `buildOverview` del server. La regla que se está protegiendo es la misma que
 * separa `db/repository.ts` de `strategy/` en el motor actual — si acá empieza
 * a haber aritmética financiera, la invariante deja de tener un solo dueño.
 *
 * Las tres decisiones que explican la forma de cada método:
 *
 * 1. **Todo colgado de `uid`**, que viene del token verificado (`paths.ts`).
 * 2. **Se filtra por los campos derivados** (`countable`, `month`), no por los
 *    cinco booleanos crudos. Ver `derive.ts` para el porqué.
 * 3. **La categoría se recalcula en la función, no se lee de Firestore.** La
 *    columna `storedCategory` viaja para poder auditar la migración y nada
 *    más. Es exactamente el criterio de `strategy/spending.ts`: el gráfico
 *    muestra `categorize()` + las reglas de HOY, porque una regla que el
 *    usuario acaba de escribir tiene que mover la barra sin un backfill.
 */
import type { Firestore } from "firebase-admin/firestore";
import type { Category, EstablishmentRule } from "./categorize.js";
import { categorize } from "./categorize.js";
import { DEFAULT_UTC_OFFSET_HOURS, fromCents, type TransactionDoc } from "./derive.js";
import * as paths from "./paths.js";

/** La config de estrategia, con los mismos nombres y defaults que
 * `server/src/seed/default-config.ts`. Un tenant recién creado la tiene toda
 * en cero/vacío: CLAUDE.md regla 3. */
export interface StrategyConfigDoc {
  moneda: string;
  zonaHoraria: string;
  utcOffsetHours: number;
  colchonObjetivo: number;
  topeTransferenciasMensual: number;
  titular: string;
  sueldo: {
    fuente: string;
    cadencia: string;
    montoEstimado: number;
    diasPago: string[];
  };
  balanceSnapshot: { amount: number; at: string };
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfigDoc = {
  moneda: "USD",
  zonaHoraria: "",
  utcOffsetHours: DEFAULT_UTC_OFFSET_HOURS,
  colchonObjetivo: 0,
  topeTransferenciasMensual: 0,
  titular: "",
  sueldo: { fuente: "", cadencia: "", montoEstimado: 0, diasPago: [] },
  balanceSnapshot: { amount: 0, at: "" },
};

export interface StatementDoc {
  gmailMsgId: string | null;
  cardMask: string | null;
  issueDate: string | null;
  balance: number | null;
  minPayment: number | null;
  dueDate: string | null;
}

/** Un gasto del período con su categoría YA recalculada — el equivalente de
 * `CategorizedSpendingRow` del motor. */
export interface CategorizedSpendingRow {
  gmailMsgId: string;
  ts: string;
  amountCents: number;
  category: Category;
}

export interface LedgerCounts {
  total: number;
  needsReview: number;
}

export class FirestoreLedger {
  constructor(
    private readonly db: Firestore,
    private readonly uid: string
  ) {
    paths.assertUid(uid);
  }

  /**
   * La config del tenant. Un tenant sin documento devuelve los defaults en
   * vez de tirar: una billetera recién creada no está rota, está vacía, y el
   * panel tiene que poder dibujarla.
   */
  async strategyConfig(): Promise<StrategyConfigDoc> {
    const snap = await paths.configDoc(this.db, this.uid, "strategy").get();
    if (!snap.exists) return { ...DEFAULT_STRATEGY_CONFIG };
    const data = snap.data() as Partial<StrategyConfigDoc>;
    return {
      ...DEFAULT_STRATEGY_CONFIG,
      ...data,
      sueldo: { ...DEFAULT_STRATEGY_CONFIG.sueldo, ...(data.sueldo ?? {}) },
      balanceSnapshot: { ...DEFAULT_STRATEGY_CONFIG.balanceSnapshot, ...(data.balanceSnapshot ?? {}) },
    };
  }

  /**
   * Total de movimientos y cuántos esperan revisión.
   *
   * Usa `count()` (agregación server-side de Firestore): se factura una
   * lectura por cada 1000 documentos contados, no una por documento. Sobre el
   * ledger real de 1159 filas son 2 lecturas facturadas en vez de 1159. Es la
   * diferencia entre un `/overview` que cuesta centavos y uno que no.
   */
  async counts(): Promise<LedgerCounts> {
    const col = paths.transactions(this.db, this.uid);
    const [total, needsReview] = await Promise.all([
      col.count().get(),
      col.where("needsReview", "==", true).count().get(),
    ]);
    return { total: total.data().count, needsReview: needsReview.data().count };
  }

  /** Las reglas de comercio del usuario, en el orden en que se escribieron
   * (`matchEstablishment` es "la primera que matchea gana"). */
  async rules(): Promise<EstablishmentRule[]> {
    const snap = await paths.rules(this.db, this.uid).orderBy("createdAt").get();
    return snap.docs.map((d) => ({
      pattern: d.id,
      category: (d.data() as { category: Category }).category,
    }));
  }

  /**
   * Los gastos contables de un mes local, con la categoría recalculada.
   *
   * Filtra por `month` (igualdad) y no por un rango sobre `ts`, que es lo que
   * hace el SQL. No es una optimización: es la corrección. `ts` está en UTC y
   * el mes del motor es el mes LOCAL del usuario; un rango en UTC pone las
   * compras de la última noche del mes en el mes siguiente. El campo `month`
   * se escribe ya bucketeado con el huso del tenant (`derive.ts`).
   *
   * Índice compuesto necesario: (countable ASC, direction ASC, month ASC).
   */
  async spendingRowsForMonth(month: string): Promise<CategorizedSpendingRow[]> {
    const [snap, rules] = await Promise.all([
      paths
        .transactions(this.db, this.uid)
        .where("countable", "==", true)
        .where("direction", "==", "out")
        .where("month", "==", month)
        .get(),
      this.rules(),
    ]);

    return snap.docs.map((doc) => {
      const tx = doc.data() as TransactionDoc;
      return {
        gmailMsgId: tx.gmailMsgId,
        ts: tx.ts,
        amountCents: tx.amountCents,
        category: categorize(
          { type: tx.type, counterparty: tx.counterparty, is_internal: tx.isInternal },
          rules
        ),
      };
    });
  }

  /** El último extracto de tarjeta cargado, o `null`. `issueDate` faltante va
   * al final, igual que el `ORDER BY (issue_date IS NULL) ASC` del SQL: se
   * consigue con un segundo query sólo si el primero viene vacío. */
  async latestStatement(): Promise<StatementDoc | null> {
    const col = paths.statements(this.db, this.uid);
    const withDate = await col.orderBy("issueDate", "desc").limit(1).get();
    if (!withDate.empty) return withDate.docs[0]!.data() as StatementDoc;
    const any = await col.limit(1).get();
    return any.empty ? null : (any.docs[0]!.data() as StatementDoc);
  }

  /** Lo reservado en el colchón, o 0 si el usuario todavía no reservó nada. */
  async colchonReservado(): Promise<number> {
    const snap = await paths.savings(this.db, this.uid).doc("colchon").get();
    if (!snap.exists) return 0;
    const data = snap.data() as { reservedCents?: number };
    return fromCents(data.reservedCents ?? 0);
  }
}
