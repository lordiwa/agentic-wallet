/**
 * `api` — la función que sirve TODO el flujo del panel salvo el sync.
 *
 * ## Por qué una función y no dieciocho
 *
 * El pivot arrancó con una `onRequest` por ruta, que es lo correcto cuando hay
 * tres. Con el flujo entero portado serían dieciocho servicios de Cloud Run,
 * cada uno con su arranque en frío, su despliegue y su configuración — para
 * dieciocho handlers que comparten CORS, verificación de token y capa de datos.
 * Acá van juntos, con un router de treinta líneas, y las que quedan afuera lo
 * están por una razón concreta y no por inercia:
 *
 * - **`ingest` (`POST /api/sync`)** es la única que descifra el refresh token.
 *   Tenerla aparte es lo que hace que este proceso no tenga la clave maestra
 *   montada; además necesita 540 s de timeout y concurrencia 1, que serían un
 *   desperdicio para un `GET /overview`.
 * - **Las tres del OAuth**, por lo mismo, y porque el callback lo invoca el
 *   navegador siguiendo un redirect de Google.
 * - **`health`**, porque es la sonda pública y no tiene que compartir proceso
 *   con nada que lea un ledger.
 *
 * ## El path
 *
 * `req.path` se normaliza quitando un `/api` inicial **opcional**. Cloud
 * Functions entrega a veces el path completo (`/api/transactions`) y a veces
 * sólo la cola después del nombre de la función (`/transactions`) según por qué
 * URL se entró — la de `cloudfunctions.net` o la de Cloud Run. Aceptar las dos
 * formas hace que el enrutamiento no dependa de esa diferencia, que no está
 * bajo nuestro control y que un emulador reproduce distinto que producción.
 *
 * ## Cero lógica financiera acá
 *
 * Cada handler valida la forma del request, llama a una función del motor
 * portado (`ledger/`), y serializa. Si en este archivo aparece una suma de
 * plata, va en `ledger/` con su test de paridad. Es la misma regla que
 * `docs/mcp.md` le pone a las tools.
 */
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { authenticate, AuthError } from "../auth/verify.js";
import { instanteDesde, instanteHasta } from "../ledger/dates.js";
import { fromCents, localMonthRange, type TransactionDoc } from "../ledger/derive.js";
import { FirestoreLedger } from "../ledger/firestore-ledger.js";
import { planWriteProfile, readProfile } from "../ledger/profile.js";
import { computeProgress, groupUnclassified, type ClassifyGroup } from "../ledger/queue.js";
import { mesesDeHistorialDe, suggestRecurringExpenses } from "../ledger/recurring.js";
import { serializeTransaction, toLedgerRow, type LedgerRow } from "../ledger/rows.js";
import { categorizedSpendingRows, transferenciasMes } from "../ledger/strategy.js";
import {
  classifyCounterparty,
  resolveReview,
  silenceCounterparty,
  unsilenceCounterparty,
} from "../ledger/writes.js";
import { applyCors } from "./handlers.js";
import { buildFirebaseOverview } from "./overview.js";
import {
  bufferBodySchema,
  classifyBodySchema,
  classifyQueueQuerySchema,
  onboardingProfileBodySchema,
  reviewResolveBodySchema,
  silenceBodySchema,
  transactionsQuerySchema,
} from "./schemas.js";

export interface RouterDeps {
  auth: Auth;
  db: Firestore;
  /** Inyectable sólo para los tests: el "ahora" con el que se calcula todo. */
  now?: () => Date;
}

/** Quita el `/api` inicial y la barra final. Ver el doc del módulo. */
export function normalizarPath(raw: string): string {
  const sinQuery = (raw.split("?")[0] ?? "").trim();
  const sinApi = sinQuery.replace(/^\/api(?=\/|$)/, "");
  const path = sinApi === "" ? "/" : sinApi;
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** Un error que el handler contesta tal cual. */
class ErrorHttp extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>
  ) {
    super(String(body.error ?? status));
  }
}

function malaForma(error: string, details: unknown): ErrorHttp {
  return new ErrorHttp(400, { error, details });
}

/**
 * Todo lo que un handler necesita para contestar, ya resuelto una vez: el uid
 * del token, la capa de datos y el huso del tenant.
 *
 * El huso viaja acá y **nunca** por `process.env`: esta función atiende hasta
 * veinte peticiones concurrentes en el mismo proceso, y escribir el huso del
 * tenant en el entorno le cambiaría el calendario a la petición de otro, sin
 * error (ver el doc de `ledger/derive.ts`).
 */
interface Contexto {
  ledger: FirestoreLedger;
  offsetHours: number;
  moneda: string;
  now: Date;
}

/** Las filas sobre las que la cola puede opinar, y las reglas y silencios de
 * hoy. Una sola lectura del ledger para las tres rutas de clasificación. */
async function poblacionDeLaCola(ctx: Contexto): Promise<{
  clasificables: LedgerRow[];
  rules: Awaited<ReturnType<FirestoreLedger["rules"]>>;
  silenced: Set<string>;
}> {
  const [contables, rules, silenced] = await Promise.all([
    ctx.ledger.countableRows(),
    ctx.ledger.rules(),
    ctx.ledger.silencedPatterns(),
  ]);
  return { clasificables: FirestoreLedger.clasificables(contables), rules, silenced };
}

// --- los handlers -----------------------------------------------------------

async function getTransactions(ctx: Contexto, query: unknown): Promise<Record<string, unknown>> {
  const parsed = transactionsQuerySchema.safeParse(query);
  if (!parsed.success) throw malaForma("invalid query parameters", parsed.error.flatten());
  const q = parsed.data;

  const desde = instanteDesde(q.from, ctx.offsetHours);
  const hasta = instanteHasta(q.to, ctx.offsetHours);

  // Con `category` la lista es la de una barra del gráfico, y esa la arma el
  // motor recalculando (H21) — incluido qué período significa una barra sin
  // fechas: el mes local en curso, que es el que el Resumen dibuja.
  if (q.category) {
    const [contables, rules] = await Promise.all([ctx.ledger.countableRows(), ctx.ledger.rules()]);
    const mes = localMonthRange(ctx.now, ctx.offsetHours);
    const periodo = {
      from: desde ? new Date(desde) : mes.from,
      to: hasta ? new Date(hasta) : mes.to,
    };
    const matching = categorizedSpendingRows(contables, rules, periodo).filter(
      (row) => row.category === q.category
    );
    // Más recientes primero, igual que el listado general.
    const ordered = [...matching].sort((a, b) =>
      a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : b.id.localeCompare(a.id)
    );
    const page = ordered.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100));
    const docs = await ctx.ledger.docsByIds(page.map((row) => row.id));
    const porId = new Map(docs.map((doc) => [doc.gmailMsgId, doc]));
    const transactions = page
      .map((row) => porId.get(row.id))
      .filter((doc): doc is TransactionDoc => doc !== undefined)
      .map(serializeTransaction);

    return {
      transactions,
      count: transactions.length,
      // El número que contó la barra, y su plata: de acá sale que la lista y el
      // gráfico no puedan discrepar.
      total: matching.length,
      amount: fromCents(matching.reduce((sum, row) => sum + row.amountCents, 0)),
    };
  }

  const docs = await ctx.ledger.listTransactions({
    from: desde,
    to: hasta,
    type: q.type,
    direction: q.direction,
    counterparty: q.counterparty,
    limit: q.limit,
    offset: q.offset,
  });
  return { transactions: docs.map(serializeTransaction), count: docs.length };
}

async function getReview(ctx: Contexto): Promise<Record<string, unknown>> {
  const docs = await ctx.ledger.reviewDocs();
  return { transactions: docs.map(serializeTransaction), count: docs.length };
}

async function postReviewResolve(ctx: Contexto, id: string, body: unknown): Promise<Record<string, unknown>> {
  const parsed = reviewResolveBodySchema.safeParse(body ?? {});
  if (!parsed.success) throw malaForma("invalid resolve body", parsed.error.flatten());

  const resultado = await resolveReview(
    ctx.ledger,
    {
      id,
      action: parsed.data.action,
      amount: parsed.data.amount,
      note: parsed.data.note,
      resolvedBy: parsed.data.resolved_by ?? "http",
    },
    ctx.moneda,
    ctx.now
  );

  if (!resultado.ok) {
    // `not_found` es el único 404: el resto son afirmaciones del cliente que el
    // motor rechaza (un monto donde no va, un monto que falta) y ésos son 400.
    throw new ErrorHttp(resultado.error === "not_found" ? 404 : 400, { error: resultado.error });
  }
  if (!resultado.changed) {
    // **R13: 200 pero `changed:false`.** La fila ya estaba resuelta y esto no
    // movió nada; una pantalla que mire sólo `ok` festeja algo que no ocurrió.
    return {
      ok: true,
      changed: false,
      reason: resultado.reason,
      transaction: serializeTransaction(resultado.doc),
    };
  }
  return {
    ok: true,
    changed: true,
    action: resultado.action,
    transaction: serializeTransaction(resultado.doc),
    resolution: resultado.resolution,
  };
}

async function getReviewResolutions(ctx: Contexto): Promise<Record<string, unknown>> {
  const resolutions = await ctx.ledger.listResoluciones();
  return { resolutions, count: resolutions.length };
}

async function getClassifyQueue(ctx: Contexto, query: unknown): Promise<Record<string, unknown>> {
  const parsed = classifyQueueQuerySchema.safeParse(query);
  if (!parsed.success) throw malaForma("invalid query parameters", parsed.error.flatten());
  const { limit, transaction_ids: ids } = parsed.data;

  const [eligibles, rules, silenced] = await Promise.all([
    ctx.ledger.queueEligibleRows(),
    ctx.ledger.rules(),
    ctx.ledger.silencedPatterns(),
  ]);

  let groups: ClassifyGroup[] = groupUnclassified(eligibles, rules, silenced, ctx.offsetHours);

  if (ids !== undefined) {
    // Modo lote (D7-b): la cola acotada a lo que acabó de entrar, MÁS cuánto
    // tiene cada contraparte fuera del lote. La regla que se escriba las mueve a
    // todas, y sin decirlo la tarjeta prometía "2 movimientos" y la respuesta
    // contestaba "reclasificaste 47" (W23).
    const enElLedger = new Map(groups.map((g) => [g.pattern, g]));
    const docs = await ctx.ledger.docsByIds(ids);
    const delLote = docs.filter((doc) => doc.queueEligible).map(toLedgerRow);
    groups = groupUnclassified(delLote, rules, silenced, ctx.offsetHours).map((group) => {
      const completo = enElLedger.get(group.pattern);
      return {
        ...group,
        count_en_ledger: completo?.count ?? group.count,
        total_en_ledger: completo?.total ?? group.total,
      };
    });
  }

  const acotados = limit === undefined ? groups : groups.slice(0, limit);
  return { groups: acotados, count: acotados.length };
}

async function getClassifyProgress(ctx: Contexto): Promise<Record<string, unknown>> {
  const { clasificables, rules, silenced } = await poblacionDeLaCola(ctx);
  return computeProgress(clasificables, rules, silenced, ctx.offsetHours) as unknown as Record<string, unknown>;
}

async function postClassify(ctx: Contexto, body: unknown): Promise<Record<string, unknown>> {
  const parsed = classifyBodySchema.safeParse(body ?? {});
  if (!parsed.success) throw malaForma("invalid classify body", parsed.error.flatten());

  const resultado = await classifyCounterparty(ctx.ledger, parsed.data, ctx.now, ctx.offsetHours);
  if (!resultado.ok) {
    // Una contraparte que no existe en el ledger es una afirmación del cliente
    // que el motor rechaza: 400, no 404, igual que en el resolve.
    throw new ErrorHttp(400, { error: resultado.error });
  }
  return resultado as unknown as Record<string, unknown>;
}

async function postSilence(ctx: Contexto, body: unknown): Promise<Record<string, unknown>> {
  const parsed = silenceBodySchema.safeParse(body ?? {});
  if (!parsed.success) throw malaForma("invalid silence body", parsed.error.flatten());

  const resultado = await silenceCounterparty(ctx.ledger, parsed.data.counterparty, ctx.now);
  if (!resultado.ok) throw new ErrorHttp(400, { error: resultado.error });
  // `changed` viaja porque `changed:false` NO es éxito (R13): silenciar algo ya
  // silenciado no saca un solo movimiento de la cola.
  return {
    ok: true,
    counterparty: resultado.counterparty,
    pattern: resultado.pattern,
    changed: resultado.changed,
  };
}

async function deleteSilence(ctx: Contexto, body: unknown): Promise<Record<string, unknown>> {
  const parsed = silenceBodySchema.safeParse(body ?? {});
  if (!parsed.success) throw malaForma("invalid silence body", parsed.error.flatten());
  return { ok: true, changed: await unsilenceCounterparty(ctx.ledger, parsed.data.counterparty) };
}

async function getSilenced(ctx: Contexto): Promise<Record<string, unknown>> {
  const silenced = await ctx.ledger.listSilenced();
  return { silenced, count: silenced.length };
}

/**
 * `GET /api/sync/status` — "¿cuándo fue la última vez que leímos el buzón, y
 * quedó algo a medias?".
 *
 * Es lo único que `POST /api/sync` no puede contestar, porque su respuesta sólo
 * existe mientras corre la llamada. `running` sale de la guarda en Firestore
 * (R9): sin ella, un F5 en medio de un lote rehidrata en un estado limpio falso
 * y el reintento le pega a un lote de minutos. Un backlog a medias **no**
 * implica `running`: quedar a medias es el estado normal entre dos llamadas.
 */
async function getSyncStatus(ctx: Contexto): Promise<Record<string, unknown>> {
  const estado = await ctx.ledger.syncState();
  return {
    last_sync_ts: estado.lastSyncTs,
    running: estado.runningSince !== null,
    backlog: estado.backlog,
  };
}

async function getProfile(ctx: Contexto): Promise<Record<string, unknown>> {
  const perfil = readProfile(await ctx.ledger.strategyConfig());
  return {
    dias_pago: perfil.diasPago,
    dia_de_pago_fijado: perfil.diaDePagoFijado,
    colchon_objetivo: perfil.colchonObjetivo,
    // `colchon_fijado` no es derivable de `colchon_objetivo` sin repetir la
    // regla en el cliente (R25): quién decide que un cero no es un objetivo
    // cumplido es el motor.
    colchon_fijado: perfil.colchonFijado,
  };
}

async function postProfile(ctx: Contexto, body: unknown): Promise<Record<string, unknown>> {
  const parsed = onboardingProfileBodySchema.safeParse(body ?? {});
  if (!parsed.success) throw malaForma("invalid profile body", parsed.error.flatten());

  const plan = planWriteProfile({
    diasPago: parsed.data.dias_pago,
    colchonObjetivo: parsed.data.colchon_objetivo,
  });
  if (!plan.ok) throw new ErrorHttp(400, { error: plan.error });

  const config = await ctx.ledger.strategyConfig();
  const patch: Record<string, unknown> = {};
  if (plan.write.diasPago !== undefined) {
    // El resto del sueldo —fuente, cadencia, monto— lo leyó el motor del
    // historial y esta pantalla no lo edita: se relee y se reescribe igual.
    patch.sueldo = { ...config.sueldo, diasPago: plan.write.diasPago };
  }
  if (plan.write.colchonObjetivo !== undefined) patch.colchonObjetivo = plan.write.colchonObjetivo;

  await ctx.ledger.writeStrategyConfig(patch);
  return { ok: true, campos: plan.write.campos, ...(await getProfile(ctx)) };
}

/**
 * `GET /api/onboarding/recurring` — la lectura de gastos fijos (H30).
 *
 * Es un GET porque **no escribe nada**: el análisis propone y el usuario
 * confirma ítem por ítem, y cada confirmación va por `POST /api/classify`, que
 * es el único escritor de categoría del MVP.
 */
async function getRecurring(ctx: Contexto): Promise<Record<string, unknown>> {
  const [{ clasificables, rules, silenced }, span] = await Promise.all([
    poblacionDeLaCola(ctx),
    ctx.ledger.spanDeGasto(),
  ]);

  const salida = suggestRecurringExpenses({
    clasificables,
    rules,
    silenciadas: silenced,
    mesesDeHistorial: mesesDeHistorialDe(span.primero, span.ultimo),
    offsetHours: ctx.offsetHours,
  });

  return {
    propuestas: salida.propuestas.map((p) => ({
      pattern: p.pattern,
      counterparty: p.counterparty,
      monto_estimado: p.montoEstimado,
      dia_tipico: p.diaTipico,
      sample_size: p.sampleSize,
      count: p.count,
      total: p.total,
      last_ts: p.lastTs,
    })),
    candidatas: salida.candidatas,
    en_la_cola: salida.enLaCola,
    meses_de_historial: salida.mesesDeHistorial,
    meses_minimos: salida.mesesMinimos,
    suficiente_historial: salida.suficienteHistorial,
  };
}

async function postBuffer(ctx: Contexto, body: unknown): Promise<Record<string, unknown>> {
  const parsed = bufferBodySchema.safeParse(body ?? {});
  if (!parsed.success) throw malaForma("invalid buffer body", parsed.error.flatten());
  const reserved = await ctx.ledger.setColchonReservado(parsed.data.reserved, ctx.now);
  return { savings: { label: "colchon", reserved, updated_at: ctx.now.toISOString() } };
}

async function getTransfers(ctx: Contexto): Promise<Record<string, unknown>> {
  const [contables, config] = await Promise.all([
    ctx.ledger.countableRows(),
    ctx.ledger.strategyConfig(),
  ]);
  return transferenciasMes(contables, config, ctx.now, ctx.offsetHours) as unknown as Record<string, unknown>;
}

// --- el enrutador ------------------------------------------------------------

const RESOLVE = /^\/review\/(.+)\/resolve$/;

async function despachar(
  ctx: Contexto,
  method: string,
  path: string,
  query: unknown,
  body: unknown
): Promise<Record<string, unknown>> {
  const resolve = RESOLVE.exec(path);
  if (resolve && method === "POST") {
    return postReviewResolve(ctx, decodeURIComponent(resolve[1] as string), body);
  }

  const clave = `${method} ${path}`;
  switch (clave) {
    case "GET /overview":
      return (await buildFirebaseOverview(ctx.ledger, ctx.now)) as unknown as Record<string, unknown>;
    case "GET /transactions":
      return getTransactions(ctx, query);
    case "GET /review":
      return getReview(ctx);
    case "GET /review/resolutions":
      return getReviewResolutions(ctx);
    case "GET /classify/queue":
      return getClassifyQueue(ctx, query);
    case "GET /classify/progress":
      return getClassifyProgress(ctx);
    case "POST /classify":
      return postClassify(ctx, body);
    case "POST /classify/silence":
      return postSilence(ctx, body);
    case "DELETE /classify/silence":
      return deleteSilence(ctx, body);
    case "GET /classify/silenced":
      return getSilenced(ctx);
    case "GET /sync/status":
      return getSyncStatus(ctx);
    case "GET /onboarding/profile":
      return getProfile(ctx);
    case "POST /onboarding/profile":
      return postProfile(ctx, body);
    case "GET /onboarding/recurring":
      return getRecurring(ctx);
    case "POST /buffer":
      return postBuffer(ctx, body);
    case "GET /transfers":
      return getTransfers(ctx);
    default:
      break;
  }

  // Una ruta que no existe es un 404 con su nombre, no un 501: **no queda una
  // sola ruta del flujo sin portar**, así que "todavía no la sirvo" ya no es
  // una respuesta posible de este backend. Ver `docs/portado-completo.md`.
  throw new ErrorHttp(404, { error: "ruta_desconocida", path, method });
}

/** Las rutas que este backend expone, para el test que verifica que el panel
 * no le pide ninguna otra. */
export const RUTAS: readonly string[] = [
  "GET /overview",
  "GET /transactions",
  "GET /review",
  "POST /review/:id/resolve",
  "GET /review/resolutions",
  "GET /classify/queue",
  "GET /classify/progress",
  "POST /classify",
  "POST /classify/silence",
  "DELETE /classify/silence",
  "GET /classify/silenced",
  "GET /sync/status",
  "GET /onboarding/profile",
  "POST /onboarding/profile",
  "GET /onboarding/recurring",
  "POST /buffer",
  "GET /transfers",
];

export function apiHandler(deps: RouterDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    if (applyCors(req, res)) return;

    let uid: string;
    try {
      ({ uid } = await authenticate(deps.auth, req));
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(error.status).json({ error: error.code, detalle: error.message });
        return;
      }
      throw error;
    }

    // El uid sale del token y de ningún otro lado. Si alguna vez aparece un
    // `?uid=` en este backend, es un bug de seguridad, no una feature.
    const ledger = new FirestoreLedger(deps.db, uid);
    const config = await ledger.strategyConfig();
    const ctx: Contexto = {
      ledger,
      offsetHours: config.utcOffsetHours,
      moneda: config.moneda,
      now: deps.now?.() ?? new Date(),
    };

    try {
      const body = await despachar(ctx, req.method, normalizarPath(req.path), req.query, req.body);
      // Nada de este backend se cachea: son cifras de dinero que cambian con
      // cada sync y con cada respuesta del usuario.
      res.set("Cache-Control", "no-store");
      res.status(200).json(body);
    } catch (error) {
      if (error instanceof ErrorHttp) {
        res.status(error.status).json(error.body);
        return;
      }
      throw error;
    }
  };
}
