/**
 * Zod schemas validating query params at the HTTP boundary (F1-09 AC4).
 * Malformed input never reaches the SQL layer: `safeParse` failures become a
 * 400 JSON response in the route handler, not a broken query.
 */
import { z } from "zod";
import { CATEGORIES } from "../category/categorize.js";
// Las que se pueden responder viven en el motor, no acá: son la definición de
// la cola dicha al revés, y toda superficie que escriba una respuesta usa la
// misma lista. Tenerla en este archivo dejó la tool MCP aceptando los dos
// fallbacks después de W8 (wargaming ronda 2, W14).
import { RESPONDABLE_CATEGORIES } from "../classify/queue.js";
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
  /**
   * La categoría **recalculada** (H21): se llega acá tocando una barra del
   * gráfico del Resumen, y la lista tiene que devolver las filas que esa barra
   * contó. No es un `WHERE category = ?` — ver `classify/movements.ts`. Cuando
   * viene, `from`/`to` acotan el mismo período que dibujó la barra y el resto de
   * los filtros no aplica (la barra ya es sólo gasto contable).
   */
  category: z.enum(CATEGORIES).optional(),
});

export type TransactionsQuery = z.infer<typeof transactionsQuerySchema>;

/**
 * POST /classify — la respuesta a "qué es esto".
 *
 * `counterparty` se valida acá sólo en forma. **Que tenga que existir en el
 * ledger lo decide el motor** (`classify/apply.ts`), no este schema: es la regla
 * que hace imposible la trampa del patrón más largo que la contraparte, y vive
 * en un solo lugar.
 */
export const classifyBodySchema = z.object({
  counterparty: z.string().min(1),
  /** El glosario **menos los dos fallbacks** — ver `RESPONDABLE_CATEGORIES`. */
  category: z.enum(RESPONDABLE_CATEGORIES),
});

/**
 * POST /sync (H19). Un solo campo opcional: cuantos correos drena esta
 * llamada. El tope de 500 no es una politica nueva — es la misma cota que ya
 * usan las consultas de este archivo, y existe para que un `batch_size`
 * absurdo sea un 400 y no un lote que corre media hora contra Gmail y Claude.
 * Ausente significa "el default del motor" (`DEFAULT_SYNC_BATCH_SIZE`), nunca
 * un numero elegido en esta capa.
 */
export const syncBodySchema = z.object({
  batch_size: z.coerce.number().int().positive().max(500).optional(),
});

/** POST /classify/silence y DELETE /classify/silence/:counterparty (H33, M5). */
export const silenceBodySchema = z.object({
  counterparty: z.string().min(1),
});

/**
 * GET /classify/queue. `transaction_ids` llega como lista separada por comas
 * (el lote de un sync, D7-b) porque es una query string, no un body.
 */
export const classifyQueueQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  transaction_ids: z
    .string()
    .min(1)
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      const ids = value.split(",").map((part) => Number(part.trim()));
      if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "transaction_ids must be positive integers" });
        return z.NEVER;
      }
      return ids;
    }),
});

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

/**
 * `POST /api/onboarding/profile` (N4, H2 mínimo).
 *
 * Los dos campos son opcionales porque la escritura es parcial: el colchón se
 * fija hoy y el día de pago cuando el primer sueldo aparece en el ledger. Que
 * un cuerpo sin ninguno de los dos sea un rechazo lo decide el motor
 * (`onboard/profile.ts`, error `sin_campos`), igual que **qué día de pago es
 * válido** — acá sólo se valida que sean strings y un número finito, no lo que
 * significan. Duplicar esa regla en el borde HTTP la dejaría con dos
 * definiciones que en algún momento divergen.
 */
export const onboardingProfileBodySchema = z.object({
  dias_pago: z.array(z.string()).optional(),
  colchon_objetivo: z.number().finite().nonnegative().optional(),
});
