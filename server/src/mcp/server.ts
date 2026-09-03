/**
 * MCP server del wallet: expone el motor como herramientas nativas para
 * cualquier agente que hable Model Context Protocol.
 *
 * Esta capa NO tiene logica financiera. Cada tool es un envoltorio delgado
 * sobre una funcion que ya existe y ya esta testeada (`strategy/`, `api/
 * queries.ts`, `onboard/`, `sync/`): valida argumentos con zod, llama, y
 * serializa el resultado a JSON. Si un numero no cuadra, el bug esta en el
 * motor, nunca aqui — es la misma disciplina que sigue `api/routes.ts`, que
 * tampoco recalcula nada.
 *
 * Se construye con `createWalletMcpServer(deps)` en vez de armarse al
 * importar el modulo, para que el test pueda inyectar una base temporal y un
 * reloj fijo sin depender del `.env` ni de la sqlite real del usuario. El
 * arranque por stdio vive en `main()`, al final.
 */
import path from "node:path";
import type Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig, repoRoot } from "../config.js";
import { openDb } from "../db/open.js";
import { CATEGORIES } from "../category/categorize.js";
import { backfillCategories } from "../category/backfill.js";
import { reclassifyTransactions } from "../category/reclassify.js";
import { upsertCategoryRule } from "../category/rules-repository.js";
import {
  classifyCounterparty,
  classifyProgress,
  classifyQueue,
  listSilencedCounterparties,
  RESPONDABLE_CATEGORIES,
  silenceCounterparty,
  unsilenceCounterparty,
} from "../classify/index.js";
import { buildOverview } from "../api/routes.js";
import { MAX_TRANSACTION_IDS } from "../api/schemas.js";
import { countTransactions, getBalanceSnapshot, queryReviewTransactions, queryTransactions } from "../api/queries.js";
import { getStrategyConfig, setStrategyConfig, type StrategyConfig } from "../db/strategy-config.js";
import { listReviewResolutions, resolveReview, REVIEW_ACTIONS } from "../review/resolve.js";
import { onboardStatus, type OnboardStatus } from "../onboard/status.js";
import { buildSuggestions } from "../onboard/suggest.js";
import { buildProductionSyncRunner } from "../sync/index.js";
import { createGoogleapisGmailClient, healCounterparties } from "../ingest/index.js";
import type { GmailClient } from "../ingest/index.js";
import type { SyncRunner } from "../api/sync-route.js";
import {
  addDays,
  balanceActual,
  colchonStatus,
  instanteDesde,
  instanteHasta,
  localMonthRange,
  nextPayday,
  parseLocalDay,
  safeToSpendHoy,
  spendingByCategory,
} from "../strategy/index.js";

export const WALLET_MCP_NAME = "agentic-wallet";
export const WALLET_MCP_VERSION = "0.1.0";

export interface WalletMcpDeps {
  /** Perezoso a proposito: registrar las tools no debe abrir la base. */
  getDb: () => Database.Database;
  /** Raiz del repo — de donde cuelgan `.env` y la sqlite. */
  projectRoot: string;
  env: NodeJS.ProcessEnv;
  /** Devuelve null cuando faltan credenciales de Gmail/Claude. */
  buildSyncRunner: (db: Database.Database) => SyncRunner | null;
  /**
   * Cliente de Gmail para `heal_counterparties`. Va aparte de
   * `buildSyncRunner` porque las credenciales que necesita son un subconjunto:
   * releer un correo ya conocido no pasa por Claude, asi que esta tool
   * funciona en un wallet con Gmail configurado y sin credencial de Claude.
   * Devuelve null cuando faltan las de Gmail.
   */
  buildGmailClient: () => Promise<Pick<GmailClient, "getMessage"> | null>;
  now: () => Date;
}

/** Todo resultado de tool viaja como un bloque de texto con JSON adentro. */
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * El onboarding manda a levantar el server y pegarle con curl porque desde el
 * CLI ese es el unico camino. Quien lee esto por MCP tiene la tool `sync` a un
 * llamado de distancia, asi que decirle que abra una terminal aparte lo manda
 * por el camino largo. Se reescribe la sugerencia, no el estado: que el paso
 * este hecho o no lo sigue decidiendo `onboard/status.ts`.
 */
const SYNC_ACTION_MCP =
  "Llama a la tool `sync` de este mismo servidor MCP: trae los correos nuevos y los incorpora al ledger.";

function withMcpActions(status: OnboardStatus): OnboardStatus {
  const steps = status.steps.map((step) => (step.id === "sync" ? { ...step, action: SYNC_ACTION_MCP } : step));
  // `next` apunta al mismo paso que `steps`, no a la copia vieja.
  return { ...status, steps, next: steps.find((step) => step.id === status.next?.id) ?? null };
}

/** Los campos de `strategy_config` que el onboarding puede escribir. Mismo
 * conjunto que valida `--set` en `onboard/cli.ts`. */
const SETTABLE_CONFIG_KEYS = [
  "moneda",
  "zonaHoraria",
  "colchonObjetivo",
  "topeTransferenciasMensual",
  "sueldo",
  "titular",
  "balanceSnapshot",
] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convierte `from`/`to` (dias locales, `to` INCLUSIVO como lo entiende un
 * humano) al rango medio-abierto `[from, to)` que consume el motor. Sin
 * argumentos devuelve el mes local en curso, igual que hace `/api/overview`.
 */
function resolvePeriodo(now: Date, from?: string, to?: string): { from: Date; to: Date } {
  const mes = localMonthRange(now);
  const desde = from ? parseLocalDay(from) : null;
  const hasta = to ? parseLocalDay(to) : null;
  return {
    from: desde ?? mes.from,
    // +1 dia: el usuario que pide "hasta el 31" espera que el 31 cuente.
    to: hasta ? addDays(hasta, 1) : mes.to,
  };
}

export function createWalletMcpServer(deps: WalletMcpDeps): McpServer {
  const server = new McpServer({ name: WALLET_MCP_NAME, version: WALLET_MCP_VERSION });

  // Un sync a la vez, misma proteccion que POST /api/sync: dos corridas
  // solapadas leerian los mismos correos y pelearian por las mismas filas.
  let syncing = false;

  server.registerTool(
    "get_balance",
    {
      title: "Saldo y disponible de hoy",
      description:
        "Saldo actual del ledger (snapshot del banco + movimientos posteriores), cuanto se puede gastar hoy " +
        "sin romper el colchon, y la fecha del proximo pago. Excluye reversos, transferencias internas y " +
        "filas en needs_review.",
      inputSchema: {},
    },
    async () => {
      const db = deps.getDb();
      const now = deps.now();
      const counts = countTransactions(db);
      return json({
        balance_actual: balanceActual(db, now),
        snapshot: getBalanceSnapshot(db),
        safe_to_spend_hoy: safeToSpendHoy(db, now),
        next_payday: nextPayday(db, now),
        counts: { total: counts.total, needs_review: counts.needsReview },
      });
    }
  );

  server.registerTool(
    "get_colchon_status",
    {
      title: "Estado del colchon",
      description:
        "Objetivo del colchon (fondo de emergencia), cuanto hay reservado, si ya esta financiado y cuanto falta. " +
        "Mira `fijado` antes que `financiado`: con `fijado: false` el usuario NO configuro ningun objetivo, y " +
        "`financiado: true` ahi solo dice que cero es mayor o igual que cero. No le digas que cumplio una meta " +
        "que no fijo (R25).",
      inputSchema: {},
    },
    async () => json(colchonStatus(deps.getDb()))
  );

  server.registerTool(
    "get_overview",
    {
      title: "Panorama completo",
      description:
        "El tablero entero de una sola llamada: saldo, tarjeta, disponible de hoy, colchon, transferencias del " +
        "mes, proximo pago y gasto por categoria. Es exactamente lo que responde GET /api/overview.",
      inputSchema: {},
    },
    async () => json(buildOverview(deps.getDb(), deps.now()))
  );

  server.registerTool(
    "query_transactions",
    {
      title: "Consultar movimientos",
      description:
        "Lista movimientos del ledger, mas recientes primero. Por defecto excluye reversados e internos " +
        "(transferencias del usuario a si mismo), que es lo correcto para cualquier total.",
      inputSchema: {
        from: z.string().regex(DAY).optional().describe("Desde, YYYY-MM-DD (dia local, inclusive)"),
        to: z.string().regex(DAY).optional().describe("Hasta, YYYY-MM-DD (dia local, inclusive)"),
        type: z.string().optional().describe("Tipo de movimiento, p.ej. debito, transferencia, servicio, retiro"),
        direction: z.enum(["in", "out"]).optional().describe("in = entra plata, out = sale plata"),
        counterparty: z.string().optional().describe("Contraparte exacta como la escribe el banco"),
        limit: z.number().int().min(1).max(500).optional().describe("Default 100"),
        offset: z.number().int().min(0).optional(),
        include_reversed: z.boolean().optional().describe("Default false"),
        include_internal: z.boolean().optional().describe("Default false"),
        include_discarded: z
          .boolean()
          .optional()
          .describe("Incluye las filas que un humano descarto al revisarlas. Default false."),
      },
    },
    async (args) => {
      // `from`/`to` son DIAS LOCALES, con `to` inclusivo, y qué es un día local
      // lo decide el motor: son las mismas dos funciones que usa el filtro del
      // panel. Cortar aca en `T00:00:00Z`/`T23:59:59Z` corria la ventana las
      // horas del offset por los dos extremos, asi que esta tool y
      // `get_spending_by_category` contestaban por periodos distintos con el
      // mismo argumento (wargaming ronda 4, W29).
      const rows = queryTransactions(deps.getDb(), {
        from: instanteDesde(args.from),
        to: instanteHasta(args.to),
        type: args.type,
        direction: args.direction,
        counterparty: args.counterparty,
        limit: args.limit,
        offset: args.offset,
        includeReversed: args.include_reversed,
        includeInternal: args.include_internal,
        includeDiscarded: args.include_discarded,
      });
      return json({ transactions: rows, count: rows.length });
    }
  );

  server.registerTool(
    "get_review_queue",
    {
      title: "Movimientos por revisar",
      description:
        "Filas con needs_review=1: el parser y Claude no coincidieron en el monto, o no se pudo leer. " +
        "Estan excluidas de todos los totales hasta que un humano las resuelva.",
      inputSchema: {
        history: z
          .boolean()
          .optional()
          .describe("Ademas de la cola, devuelve el historial de resoluciones ya hechas. Default false."),
      },
    },
    async ({ history }) => {
      const db = deps.getDb();
      const rows = queryReviewTransactions(db);
      return json({
        transactions: rows,
        count: rows.length,
        ...(history ? { resolutions: listReviewResolutions(db) } : {}),
      });
    }
  );

  server.registerTool(
    "resolve_review",
    {
      title: "Resolver un movimiento de la cola de revision",
      description:
        "Saca UNA fila de `needs_review`, que es lo unico que la devuelve a los totales. Tres acciones: " +
        "`confirm` (el monto del parser esta bien -> la fila entra a los totales tal cual), `correct` (el " +
        "monto esta mal y el HUMANO afirma otro -> requiere `amount`, y la fila queda marcada `source: human`), " +
        "y `discard` (no es un movimiento real -> sale de la cola y NO vuelve a los totales). " +
        "`confirm` y `discard` RECHAZAN un `amount` en vez de ignorarlo. Nunca inventes un monto ni lo deduzcas " +
        "vos: `correct` es para el numero que dice la persona, leido del correo o del banco. Idempotente: " +
        "resolver dos veces la misma fila devuelve `changed: false`. Toda resolucion queda auditada con quien " +
        "y cuando; pasa `resolved_by` con el nombre de la persona si lo sabes.",
      inputSchema: {
        id: z.number().int().positive().describe("El `id` de la fila, tal como lo devuelve get_review_queue"),
        action: z.enum(REVIEW_ACTIONS),
        amount: z.number().nonnegative().optional().describe("Solo (y siempre) con action='correct'"),
        note: z.string().min(1).optional().describe("Por que se resolvio asi"),
        resolved_by: z.string().min(1).optional().describe("Quien resuelve. Sin valor queda 'mcp'."),
      },
    },
    async ({ id, action, amount, note, resolved_by }) => {
      const result = resolveReview(deps.getDb(), {
        id,
        action,
        amount,
        note,
        resolvedBy: resolved_by ?? "mcp",
      });
      // Un error del motor tiene que llegar como error de la tool: devolverlo
      // como un `ok: false` dentro de un resultado exitoso invita al agente a
      // leerlo por arriba y seguir como si hubiera resuelto algo.
      if (!result.ok) throw new Error(`resolve_review: ${result.error}`);
      return json(result);
    }
  );

  server.registerTool(
    "get_spending_by_category",
    {
      title: "Gasto por categoria",
      description:
        "Suma solo gasto (direction='out') agrupado por categoria. Sin fechas usa el mes local en curso. " +
        "Solo aparecen las categorias con al menos un movimiento.",
      inputSchema: {
        from: z.string().regex(DAY).optional().describe("Desde, YYYY-MM-DD (dia local, inclusive)"),
        to: z.string().regex(DAY).optional().describe("Hasta, YYYY-MM-DD (dia local, inclusive)"),
      },
    },
    async ({ from, to }) => {
      const periodo = resolvePeriodo(deps.now(), from, to);
      return json({
        periodo: { from: periodo.from.toISOString(), to: periodo.to.toISOString() },
        spending_by_category: spendingByCategory(deps.getDb(), periodo),
      });
    }
  );

  server.registerTool(
    "sync",
    {
      title: "Sincronizar con Gmail",
      description:
        "Lee los correos de notificacion bancaria nuevos y los incorpora al ledger. Cada llamada procesa UN " +
        "LOTE y devuelve `progress` {processed, total, remaining, complete}: si `complete` es false, volve a " +
        "llamarla — el avance queda guardado y no se reprocesa nada. El primer sync de un buzon con anios de " +
        "historial necesita varias llamadas. Requiere credenciales de Gmail y de Claude en .env; sin ellas " +
        "responde gmail_not_configured sin tocar nada. Es la unica tool que sale a la red y puede tardar.",
      inputSchema: {
        batch_size: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Correos como maximo en esta llamada. Sin valor usa el default del motor."),
      },
    },
    async ({ batch_size }) => {
      const db = deps.getDb();
      const runner = deps.buildSyncRunner(db);
      if (!runner) {
        return json({
          ok: false,
          error: "gmail_not_configured",
          hint: "Corre `npm run onboard` para ver que credencial falta en .env.",
        });
      }
      if (syncing) return json({ ok: false, error: "sync_already_running" });

      syncing = true;
      try {
        // `progress` y `cumulative` salen del resumen del lote para que el
        // agente no tenga que conocer la forma interna del motor; `summary`
        // queda con los contadores de ESTA llamada, tal cual los emite.
        // `insertedIds` sale afuera como `inserted_ids` por lo mismo que
        // `progress`: son las filas de ESTE lote, y es a lo que se acota la
        // cola de clasificacion despues de sincronizar (D7-b).
        const { progress, cumulative, insertedIds, ...summary } = await runner({ batchSize: batch_size });
        return json({
          ok: true,
          summary,
          cumulative,
          progress,
          inserted_ids: insertedIds,
          next_action: progress.complete
            ? "Sync al dia: no queda backlog."
            : `Faltan ${progress.remaining} correos: volve a llamar \`sync\`.`,
        });
      } finally {
        syncing = false;
      }
    }
  );

  server.registerTool(
    "onboarding_status",
    {
      title: "Estado del onboarding",
      description:
        "En que punto de la configuracion esta el usuario: .env, credencial de Claude, Gmail conectado, primer " +
        "sync y perfil financiero. Devuelve el siguiente paso pendiente y que hay que hacer para cerrarlo. " +
        "Si el primer sync quedo a medias, el paso `sync` trae `progress` {processed, total, remaining} para " +
        "poder decir 'procesando 340/1717'.",
      inputSchema: {},
    },
    async () => {
      // La base puede no existir todavia — es un estado legitimo aqui (el
      // usuario aun no sincronizo), no un error.
      let db: Database.Database | null = null;
      try {
        db = deps.getDb();
      } catch {
        db = null;
      }
      return json(
        withMcpActions(onboardStatus({ envPath: path.join(deps.projectRoot, ".env"), env: deps.env, db }))
      );
    }
  );

  server.registerTool(
    "suggest_profile",
    {
      title: "Proponer perfil financiero",
      description:
        "Lee el ledger del usuario y propone titular, sueldo, dias de pago, gasto mensual promedio y los " +
        "comercios sin categorizar. Es una LECTURA, no escribe nada: el usuario confirma y despues se guarda " +
        "con set_profile. Si no hay evidencia, devuelve null en vez de inventar una cifra.",
      inputSchema: {},
    },
    async () => json(buildSuggestions(deps.getDb()))
  );

  server.registerTool(
    "set_profile",
    {
      title: "Guardar perfil financiero",
      description:
        "Escribe campos de strategy_config. Toma la misma forma que emite suggest_profile, para que el ciclo " +
        "sea: proponer -> el usuario corrige -> guardar. Escribi solo valores que el usuario confirmo.",
      inputSchema: {
        moneda: z.string().optional(),
        zonaHoraria: z.string().optional(),
        colchonObjetivo: z.number().optional().describe("Meta del fondo de emergencia"),
        topeTransferenciasMensual: z.number().optional(),
        titular: z.string().optional().describe("El titular como lo escribe el banco"),
        // `sueldo` y `balanceSnapshot` van completos o no van: el motor los
        // valida como objeto entero, asi que mandar la mitad no "actualiza un
        // campo", falla. Los sobrantes se descartan solos — eso es lo que
        // permite pasarle de vuelta la salida de suggest_profile tal cual,
        // con su `sampleSize` incluido.
        sueldo: z
          .object({
            fuente: z.string(),
            cadencia: z.string().describe("quincenal | mensual"),
            montoEstimado: z.number(),
            // El motor lee ventanas, no dias sueltos: "15-15" es el 15,
            // "18-20" es "entre el 18 y el 20", "<=5" es "los primeros 5".
            // Un "15" pelado NO parsea y deja el calendario de pagos en null,
            // y por eso el motor lo RECHAZA en vez de guardarlo (W30): el dia
            // tiene que estar entre 1 y 31, que es lo unico que un mes tiene.
            diasPago: z
              .array(z.string().regex(/^(<=\d{1,2}|\d{1,2}-\d{1,2})$/))
              .describe('Ventanas de pago con dias entre 1 y 31: ["15-15", "30-30"], ["18-20"] o ["<=5"]'),
          })
          .optional(),
        balanceSnapshot: z
          .object({ amount: z.number(), at: z.string().describe("YYYY-MM-DD") })
          .optional()
          .describe("Saldo real del banco en una fecha, base de todo calculo de saldo"),
      },
    },
    async (args) => {
      const patch: Record<string, unknown> = {};
      for (const key of SETTABLE_CONFIG_KEYS) {
        if (args[key] !== undefined) patch[key] = args[key];
      }
      if (Object.keys(patch).length === 0) {
        throw new Error("set_profile: no se recibio ningun campo para escribir.");
      }
      // setStrategyConfig valida la forma de cada campo y devuelve las claves
      // que realmente escribio.
      const written = setStrategyConfig(deps.getDb(), patch as Partial<StrategyConfig>);
      return json({ ok: true, written });
    }
  );

  server.registerTool(
    "set_rule",
    {
      title: "Regla de categoria para un comercio",
      description:
        "Asocia un patron de comercio a una categoria, p.ej. 'veterinaria' -> mascota. El patron matchea por " +
        "substring y el mas largo gana. Aplica a movimientos futuros; para el historial ya sincronizado llama " +
        "despues a la tool `apply_rules`.",
      inputSchema: {
        pattern: z.string().min(1).describe("Substring del nombre del comercio"),
        category: z.enum(CATEGORIES),
      },
    },
    async ({ pattern, category }) => {
      const saved = upsertCategoryRule(deps.getDb(), pattern, category);
      if (!saved) throw new Error("set_rule: el patron queda vacio al normalizarlo; da un texto con contenido.");
      return json({ ok: true, pattern, category });
    }
  );

  server.registerTool(
    "get_classify_queue",
    {
      title: "Cola de clasificacion, agrupada por comercio",
      description:
        "Los movimientos de gasto cuya categoria RECALCULADA sigue siendo un fallback ('otros' o " +
        "'transferencia_persona'), agrupados por CONTRAPARTE y ordenados por plata descendente. Cada grupo trae " +
        "cuantos movimientos tiene, cuanta plata mueve y en cuantos meses distintos aparece: con eso alcanza para " +
        "preguntarle al humano UNA vez por comercio en vez de una vez por fila. Responde con `classify_counterparty`. " +
        "No lee la columna `category` — lee lo mismo que el grafico del Resumen.",
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional().describe("Tope de grupos, del que mas plata mueve al que menos"),
        transaction_ids: z
          .array(z.number().int().positive())
          .max(MAX_TRANSACTION_IDS)
          .optional()
          .describe(
            `Acota la cola a estos movimientos, p.ej. los que entraron en un sync. Hasta ${MAX_TRANSACTION_IDS}: ` +
              "por encima de eso la consulta pasa el limite de variables de SQLite."
          ),
      },
    },
    async ({ limit, transaction_ids }) => {
      const groups = classifyQueue(deps.getDb(), { limit, transactionIds: transaction_ids });
      return json({ groups, count: groups.length });
    }
  );

  server.registerTool(
    "get_classify_progress",
    {
      title: "Cuanto falta de la cola de clasificacion, medido en plata",
      description:
        "Cuanta plata sigue sin clasificar, que porcentaje de la que habia al principio ya esta cubierta, y " +
        "cuantas respuestas mas hacen falta para llegar al 80 %. El criterio de terminado es ESE 80 % de la plata, " +
        "no cero filas: con decenas de comercios de un solo movimiento, cero no es un estado alcanzable. La plata " +
        "de un comercio silenciado cuenta como cubierta — la pregunta quedo cerrada.",
      inputSchema: {},
    },
    async () => json(classifyProgress(deps.getDb()))
  );

  server.registerTool(
    "classify_counterparty",
    {
      title: "Decir que es un comercio de la cola",
      description:
        "Responde 'que es esto' por UN comercio: escribe una regla de categoria y devuelve cuantos movimientos " +
        "quedaron reclasificados y cuantos de ellos son del mes en curso (el grafico del Resumen es solo del mes " +
        "en curso, asi que sin ese segundo numero no se puede decir por que una barra no se movio). " +
        "`counterparty` tiene que ser una contraparte que EXISTE en el ledger, tal como la devuelve " +
        "`get_classify_queue`: el patron de la regla se deriva de la fila real, y por eso es imposible escribir " +
        "un patron mas largo que la contraparte, que nunca matchearia nada. Para un patron ancho a proposito " +
        "('farmacia' para todas las farmacias) usa `set_rule`. Ojo con `otras_contrapartes`: la regla matchea por " +
        "substring, asi que responder por un nombre corto tambien mueve —y saca de la cola— los grupos cuyo nombre " +
        "lo contiene. Ese campo dice cuantos fueron; el conteo de arriba ya los incluye.",
      inputSchema: {
        counterparty: z.string().min(1).describe("La contraparte tal cual la devuelve get_classify_queue"),
        // Los dos fallbacks NO se pueden responder: escriben la regla, devuelven
        // `ok` y dejan el grupo en la cola para siempre. Misma lista que el
        // borde HTTP, y por eso sale del motor (W8/W14).
        category: z.enum(RESPONDABLE_CATEGORIES),
      },
    },
    async ({ counterparty, category }) => {
      const result = classifyCounterparty(deps.getDb(), { counterparty, category }, deps.now());
      // Igual que `resolve_review`: un rechazo del motor tiene que llegar como
      // error de la tool, no como un `ok: false` dentro de un exito.
      if (!result.ok) throw new Error(`classify_counterparty: ${result.error}`);
      return json(result);
    }
  );

  server.registerTool(
    "silence_counterparty",
    {
      title: "No preguntar mas por este comercio",
      description:
        "Saca una contraparte de la cola de clasificacion para siempre, sin escribir ninguna categoria. Es la " +
        "salida honesta para las contrapartes que tienen dos verdades (la misma persona que un mes cobra una " +
        "consulta y otro devuelve un prestamo): ninguna categoria seria correcta para todas sus filas. Sin esto " +
        "esa contraparte vuelve a la cola para siempre. Con `undo: true` la devuelve a la cola. El nombre se " +
        "valida contra el ledger igual que en `classify_counterparty`: si no corresponde a una contraparte real " +
        "no se escribe nada, porque un patron que no matchea ninguna fila no silencia nada. `changed: false` " +
        "significa que ya estaba silenciada y esta llamada no saco ningun movimiento de la cola.",
      inputSchema: {
        counterparty: z.string().min(1),
        undo: z.boolean().optional().describe("Devuelve a la cola algo silenciado por error. Default false."),
      },
    },
    async ({ counterparty, undo }) => {
      const db = deps.getDb();
      if (undo) {
        const changed = unsilenceCounterparty(db, counterparty);
        return json({ ok: true, silenced: false, changed });
      }
      const silenciado = silenceCounterparty(db, counterparty);
      if (!silenciado.ok) {
        throw new Error(
          silenciado.error === "empty_pattern"
            ? "silence_counterparty: el nombre queda vacio al normalizarlo; da un texto con contenido."
            : "silence_counterparty: esa contraparte no existe en el ledger, asi que el patron no silenciaria " +
              "ninguna fila. Pasa el nombre tal como lo devuelve get_classify_queue."
        );
      }
      return json({
        ok: true,
        silenced: true,
        changed: silenciado.changed,
        counterparty: silenciado.counterparty,
        pattern: silenciado.pattern,
        count: listSilencedCounterparties(db).length,
      });
    }
  );

  server.registerTool(
    "apply_rules",
    {
      title: "Aplicar las reglas al historial",
      description:
        "Categoriza los movimientos ya sincronizados que todavia no tienen categoria, usando las reglas " +
        "vigentes. Es el equivalente de `npm run onboard -- --backfill`. Idempotente: nunca repisa una " +
        "categoria ya asignada, asi que correrlo dos veces no cambia nada. Devuelve cuantas filas actualizo. " +
        "Con `reclassify: true` ademas RECALCULA las categorias ya asignadas y marca las transferencias a " +
        "cuentas del titular como internas: usalo cuando cambio el insumo del calculo (se configuro el " +
        "titular, se agrego una regla) y el historial quedo con categorias viejas. Nunca desmarca una " +
        "interna ni toca montos.",
      inputSchema: {
        reclassify: z
          .boolean()
          .optional()
          .describe("Ademas de categorizar lo que falta, repisa lo ya asignado. Default false."),
      },
    },
    async ({ reclassify }) => {
      const db = deps.getDb();
      const updated = await backfillCategories(db);
      if (!reclassify) return json({ ok: true, updated });
      const result = await reclassifyTransactions(db, { titular: getStrategyConfig(db).titular });
      return json({ ok: true, updated, ...result });
    }
  );

  server.registerTool(
    "heal_counterparties",
    {
      title: "Recuperar el comercio de los movimientos que quedaron sin nombre",
      description:
        "Relee en Gmail el correo original de cada movimiento guardado SIN nombre de comercio y le devuelve el " +
        "nombre, usando el parser actual. Sirve para el historial que entro con un parser mas viejo o migrado " +
        "desde otra base: esos movimientos no tienen contra que enganchar una regla de `set_rule`, asi que caen " +
        "todos en 'otros' y ninguna regla los saca de ahi. Solo escribe la contraparte, jamas el monto, y solo " +
        "sobre las filas que la tienen vacia. No recategoriza: despues de esto llama a `apply_rules` con " +
        "`reclassify: true`. Idempotente.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Tope de correos a releer en esta corrida, del gasto mas caro al mas barato."),
      },
    },
    async ({ limit }) => {
      const db = deps.getDb();
      const gmailClient = await deps.buildGmailClient();
      if (!gmailClient) {
        throw new Error(
          "heal_counterparties: faltan credenciales de Gmail. Pon GMAIL_OAUTH_CLIENT_ID/SECRET en el .env y " +
            "corre `npm run gmail-auth` para el refresh token."
        );
      }
      const result = await healCounterparties({ db, gmailClient }, { limit });
      return json({ ok: true, ...result, next: "apply_rules con reclassify: true" });
    }
  );

  return server;
}

/**
 * Dependencias reales: base del usuario y credenciales del `.env` del repo.
 *
 * `projectRoot` sale de `CLAUDE_PROJECT_DIR` (lo inyecta el cliente MCP via
 * `.mcp.json`) porque el proceso se lanza con un cwd arbitrario — el del
 * agente, no el del repo. Por lo mismo, un `WALLET_DB_PATH` relativo se
 * resuelve contra la raiz del repo: si no, "./wallet.sqlite" crearia una base
 * vacia en cualquier carpeta desde donde arranque el agente.
 */
export function productionDeps(): WalletMcpDeps {
  const projectRoot = repoRoot();
  const config = loadConfig();
  const dbPath = path.resolve(projectRoot, config.WALLET_DB_PATH);

  let db: Database.Database | null = null;
  const getDb = () => (db ??= openDb(dbPath));

  return {
    getDb,
    projectRoot,
    env: process.env,
    buildSyncRunner: (handle) => buildProductionSyncRunner(config, () => handle),
    buildGmailClient: async () => {
      const { GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN } = config;
      if (!GMAIL_OAUTH_CLIENT_ID || !GMAIL_OAUTH_CLIENT_SECRET || !GMAIL_OAUTH_REFRESH_TOKEN) return null;
      return createGoogleapisGmailClient({
        clientId: GMAIL_OAUTH_CLIENT_ID,
        clientSecret: GMAIL_OAUTH_CLIENT_SECRET,
        refreshToken: GMAIL_OAUTH_REFRESH_TOKEN,
      });
    },
    now: () => new Date(),
  };
}

export async function main(): Promise<void> {
  // stdout es el canal JSON-RPC: cualquier span impreso ahi corrompe el
  // protocolo. Mismo motivo por el que los CLIs lo silencian.
  process.env.WALLET_TELEMETRY_SILENT ??= "1";

  const server = createWalletMcpServer(productionDeps());
  await server.connect(new StdioServerTransport());
  console.error(`${WALLET_MCP_NAME} MCP server escuchando en stdio`);
}
