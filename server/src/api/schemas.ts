/**
 * Zod schemas validating query params at the HTTP boundary (F1-09 AC4).
 * Malformed input never reaches the SQL layer: `safeParse` failures become a
 * 400 JSON response in the route handler, not a broken query.
 */
import { z } from "zod";
import { REVIEW_ACTIONS } from "../review/resolve.js";

// Mirrors parser/types.ts TransactionType (spec catalog 5.1). Duplicated
// here rather than imported so the HTTP contract doesn't silently widen if
// the parser's internal type union ever grows a value not meant for the API.
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

/** Query flags arrive as the strings "true"/"false" (or absent); anything else is a 400. */
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
});

export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>;

/** :id path param for POST /debts/:id/paid -- a positive integer, or 400. */
export const debtIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** ?abono= for GET /strategy/projection -- optional, finite and >=0 when
 * present (mirrors strategy_config's `financeNumber` guard). Absent means
 * "no abono supplied", which the engine itself resolves to an undefined
 * projection rather than this schema guessing a default. */
export const projectionQuerySchema = z.object({
  abono: z.coerce.number().finite().nonnegative().optional(),
});

/** POST /buffer body -- the new 'colchon' reserved amount, >=0. */
export const bufferBodySchema = z.object({
  reserved: z.number().finite().nonnegative(),
});

/** :id path param for POST /review/:id/resolve. */
export const reviewIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * POST /review/:id/resolve body.
 *
 * `amount` se valida acá sólo en forma (finito, >= 0). **Que sea obligatorio en
 * `correct` y prohibido en el resto lo decide el motor** (`review/resolve.ts`),
 * no este schema: es una regla sobre la plata, y duplicarla en el borde HTTP la
 * dejaría con dos definiciones que en algún momento divergen. Acá sólo se
 * traduce el error del motor a un status.
 */
export const reviewResolveBodySchema = z.object({
  action: z.enum(REVIEW_ACTIONS),
  amount: z.number().finite().nonnegative().optional(),
  note: z.string().min(1).optional(),
  /** Sin valor, el registro de auditoría dice "http": la superficie por la que
   * entró. Un nombre concreto lo pisa. */
  resolved_by: z.string().min(1).optional(),
});
