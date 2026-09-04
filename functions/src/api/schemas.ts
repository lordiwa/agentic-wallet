/**
 * La validación de forma del borde HTTP — copia de `server/src/api/schemas.ts`.
 *
 * Lo que se valida acá es **la forma y nada más**. Lo que significa cada valor
 * lo decide el motor: que la contraparte tenga que existir en el ledger, que
 * `amount` sea obligatorio en `correct` y prohibido en el resto, qué es un día
 * de pago válido. Duplicar esas reglas en este archivo las dejaría con dos
 * definiciones que en algún momento divergen — y ya pasó: tener la lista de
 * categorías respondibles sólo acá dejó a la tool MCP aceptando los dos
 * fallbacks (W14).
 */
import { z } from "zod";
import { CATEGORIES } from "../ledger/categorize.js";
import { RESPONDABLE_CATEGORIES } from "../ledger/queue.js";
import { REVIEW_ACTIONS } from "../ledger/writes.js";

/** Espeja `parser/types.ts`. Duplicado y no importado para que el contrato HTTP
 * no se ensanche solo si la unión interna del parser crece un valor que no era
 * para la API. */
const TRANSACTION_TYPES = [
  "debito",
  "credito",
  "transferencia",
  "servicio",
  "retiro",
  "recarga",
  "sueldo",
  "recibido",
] as const;

const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
  message: "must be a valid ISO 8601 date/time",
});

/** Las banderas llegan como los strings "true"/"false" (o ausentes). */
const boolFlag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

export const transactionsQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  direction: z.enum(["in", "out"]).optional(),
  counterparty: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  include_reversed: boolFlag,
  include_internal: boolFlag,
  include_discarded: boolFlag,
  /** La categoría **recalculada** (H21): se llega acá tocando una barra del
   * gráfico, y la lista tiene que devolver las filas que esa barra contó. No es
   * un filtro por la columna `category`. */
  category: z.enum(CATEGORIES).optional(),
});

export const classifyBodySchema = z.object({
  counterparty: z.string().min(1),
  /** El glosario **menos los dos fallbacks**: responder con uno de ellos
   * escribiría la regla y dejaría al grupo en la cola para siempre. */
  category: z.enum(RESPONDABLE_CATEGORIES),
});

export const silenceBodySchema = z.object({
  counterparty: z.string().min(1),
});

/**
 * Cuántos ids acepta el filtro por lote. El mismo tope que un `batch_size` de
 * sync, que es su único productor legítimo (D7-b): pedir más ids que
 * movimientos puede traer un sync no es un caso de uso, es una lista armada a
 * mano.
 */
export const MAX_TRANSACTION_IDS = 500;

export const classifyQueueQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  transaction_ids: z
    .string()
    .min(1)
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      // Ahora son ids de documento (el `gmail_msg_id`), no enteros: ver el doc
      // de `ledger/rows.ts`.
      const ids = value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "");
      if (ids.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "transaction_ids vacio" });
        return z.NEVER;
      }
      if (ids.length > MAX_TRANSACTION_IDS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `transaction_ids admite hasta ${MAX_TRANSACTION_IDS} ids`,
        });
        return z.NEVER;
      }
      return ids;
    }),
});

/** POST /buffer — el nuevo `reserved` del colchón. */
export const bufferBodySchema = z.object({
  reserved: z.number().finite().nonnegative(),
});

/**
 * POST /review/:id/resolve.
 *
 * `amount` se valida acá sólo en forma. Que sea obligatorio en `correct` y
 * prohibido en el resto **lo decide el motor**: es una regla sobre la plata.
 */
export const reviewResolveBodySchema = z.object({
  action: z.enum(REVIEW_ACTIONS),
  amount: z.number().finite().nonnegative().optional(),
  note: z.string().min(1).optional(),
  /** Sin valor, la auditoría dice "http": la superficie por la que entró. */
  resolved_by: z.string().min(1).optional(),
});

/**
 * POST /onboarding/profile.
 *
 * Los dos campos son opcionales porque la escritura es parcial: el colchón se
 * fija hoy y el día de pago cuando el primer sueldo aparece en el ledger. Que
 * un cuerpo sin ninguno de los dos sea un rechazo lo decide el motor.
 */
export const onboardingProfileBodySchema = z.object({
  dias_pago: z.array(z.string()).optional(),
  colchon_objetivo: z.number().finite().nonnegative().optional(),
});
