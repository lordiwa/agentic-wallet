/**
 * Le devuelve el nombre del comercio a las filas que quedaron sin
 * `counterparty`, releyendo el correo original y volviendolo a pasar por el
 * parser de hoy.
 *
 * POR QUE HACE FALTA UNA HERRAMIENTA APARTE
 * -----------------------------------------
 * El parser ya sabe leer el campo "Establecimiento" de un consumo. Lo que no
 * existe en ningun otro lado es la forma de APLICAR ese conocimiento sobre
 * historial ya persistido: `insertTransaction` es insert-only (`ON CONFLICT
 * DO NOTHING`) y el unico camino de actualizacion del ingest
 * (`updateTransactionReviewFlags`) toca `is_reversed`/`needs_review` y nada
 * mas. Volver a sincronizar el mismo correo, entonces, no repara nada: la
 * fila vieja se cuenta como duplicado y su `counterparty` NULL se queda ahi
 * para siempre.
 *
 * Eso deja sin arreglo al historial que entro con un parser mas viejo (o
 * migrado desde otra base), donde el consumo se guardo sin comercio. Y un
 * consumo sin comercio es un agujero que se propaga: `categorize` solo sabe
 * clasificar mirando la contraparte, `matchEstablishment` nunca matchea
 * contra vacio, y `category_rules` no tiene contra que enganchar. Todas esas
 * filas caen en 'otros' y ninguna regla del usuario puede sacarlas de ahi.
 * El problema no era la falta de un mecanismo de clasificacion por fila: era
 * un dato faltante que el correo todavia tiene.
 *
 * QUE HACE Y QUE NO
 * -----------------
 * 1. **No toca plata.** Ni `amount`, ni `direction`, ni `type`, ni
 *    `needs_review`. Escribe exactamente una columna: `counterparty`.
 * 2. **Solo escribe sobre el vacio.** Una contraparte que ya existe puede
 *    haberla corregido una persona; esto nunca la pisa.
 * 3. **Guarda de monto.** Se escribe el comercio solo si el correo,
 *    reparseado hoy, rinde el MISMO monto que la fila guardada. Si no
 *    coincide -- o si el correo no rinde monto alguno -- la fila y el correo
 *    no son la misma transaccion (o el parser cambio de criterio), y pegarle
 *    un comercio ahi seria atribuirle el gasto a un nombre equivocado. La
 *    fila queda intacta y se reporta en `skippedAmountMismatch`.
 * 4. **No recategoriza.** La categoria guardada queda vieja a proposito:
 *    recalcularla es trabajo de `reclassifyTransactions`, que ya sabe cuando
 *    puede repisar y cuando no. El par correcto es
 *    `healCounterparties` -> `reclassifyTransactions`.
 *
 * Idempotente: la segunda corrida no encuentra candidatos. Los correos se
 * piden de a uno y el mas caro primero, para que un tope por corrida deje
 * afuera el gasto que menos pesa y nunca al que mas.
 */
import type Database from "better-sqlite3";
import { parseEmail } from "../parser/index.js";
import { emitMetric, withSpan } from "./telemetry.js";
import type { GmailClient } from "./types.js";

export interface HealCounterpartiesDeps {
  db: Database.Database;
  /** Solo se usa `getMessage`: esto relee correos puntuales por id, nunca busca. */
  gmailClient: Pick<GmailClient, "getMessage">;
}

export interface HealCounterpartiesOptions {
  /** Tope de correos por corrida. Ver `DEFAULT_HEAL_LIMIT`. */
  limit?: number;
}

export interface HealCounterpartiesResult {
  /** Filas sin contraparte que esta corrida se propuso reparar (ya con el tope aplicado). */
  candidates: number;
  /** Filas que ganaron el nombre del comercio. */
  healed: number;
  /** El correo se leyo bien pero de verdad no nombra a nadie. */
  unnamed: number;
  /** El correo no rinde el mismo monto que la fila: no se escribio nada. */
  skippedAmountMismatch: number;
  /** El correo no se pudo leer, o ya no se reconoce como transaccion. */
  failed: number;
  /** Filas sin contraparte que siguen pendientes despues de esta corrida. */
  remaining: number;
}

/**
 * Cuantos correos como maximo por corrida. Es alto porque, a diferencia del
 * sync, aca no interviene Claude: es una lectura de Gmail y una funcion pura,
 * del orden de decenas de milisegundos por correo.
 */
export const DEFAULT_HEAL_LIMIT = 500;

/** Tolerancia al comparar montos: medio centavo. Los dos lados salen del
 * mismo `Number("12.34")`, pero comparar floats por igualdad exacta es una
 * fragilidad gratuita. */
const AMOUNT_EPSILON = 0.005;

interface HealableRow {
  id: number;
  gmail_msg_id: string;
  amount: number;
}

/**
 * Las filas sin contraparte, mas caras primero.
 *
 * Se excluye `type = 'reverso'`: esas filas son el rastro auditable de un
 * reverso (ver `pipeline.ts`), no un consumo, y su correo no trae
 * establecimiento. Pedirle el correo a Gmail para cada una seria trabajo
 * garantizadamente inutil.
 */
function listHealableRows(db: Database.Database, limit: number): HealableRow[] {
  return db
    .prepare(
      `SELECT id, gmail_msg_id, amount
         FROM transactions
        WHERE (counterparty IS NULL OR TRIM(counterparty) = '')
          AND type != 'reverso'
        ORDER BY amount DESC, id ASC
        LIMIT ?`
    )
    .all(limit) as HealableRow[];
}

function countHealableRows(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM transactions
        WHERE (counterparty IS NULL OR TRIM(counterparty) = '')
          AND type != 'reverso'`
    )
    .get() as { n: number };
  return row.n;
}

export async function healCounterparties(
  { db, gmailClient }: HealCounterpartiesDeps,
  options: HealCounterpartiesOptions = {}
): Promise<HealCounterpartiesResult> {
  return withSpan("ingest.heal_counterparty", {}, async () => {
    const rows = listHealableRows(db, options.limit ?? DEFAULT_HEAL_LIMIT);

    const update = db.prepare("UPDATE transactions SET counterparty = @counterparty WHERE id = @id");

    let healed = 0;
    let unnamed = 0;
    let skippedAmountMismatch = 0;
    let failed = 0;

    for (const row of rows) {
      let counterparty: string | null;
      try {
        const message = await gmailClient.getMessage(row.gmail_msg_id);
        const parsed = parseEmail({
          subject: message.subject,
          body: message.body,
          gmail_msg_id: message.gmail_msg_id,
          gmail_thread_id: message.gmail_thread_id,
          ts: message.ts,
        });
        if (parsed.kind !== "transaction") {
          failed += 1;
          continue;
        }
        // Guarda de monto: ver invariante 3 en el doc del modulo.
        if (parsed.amount === null || Math.abs(parsed.amount - row.amount) >= AMOUNT_EPSILON) {
          skippedAmountMismatch += 1;
          continue;
        }
        counterparty = parsed.counterparty?.trim() || null;
      } catch {
        // Un correo borrado, o un hipo de la API, no puede abortar la
        // reparacion de todos los demas.
        failed += 1;
        continue;
      }

      if (counterparty === null) {
        unnamed += 1;
        continue;
      }
      update.run({ id: row.id, counterparty });
      healed += 1;
    }

    const result: HealCounterpartiesResult = {
      candidates: rows.length,
      healed,
      unnamed,
      skippedAmountMismatch,
      failed,
      remaining: countHealableRows(db),
    };
    // Solo conteos: ni un nombre de comercio en la telemetria.
    emitMetric("ingest.heal_counterparty.summary", { ...result });
    return result;
  });
}
