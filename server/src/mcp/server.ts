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
import { upsertCategoryRule } from "../category/rules-repository.js";
import { buildOverview } from "../api/routes.js";
import { countTransactions, getBalanceSnapshot, queryReviewTransactions, queryTransactions } from "../api/queries.js";
import { setStrategyConfig, type StrategyConfig } from "../db/strategy-config.js";
import { onboardStatus, type OnboardStatus } from "../onboard/status.js";
import { buildSuggestions } from "../onboard/suggest.js";
import { buildProductionSyncRunner } from "../sync/index.js";
import type { SyncRunner } from "../api/sync-route.js";
import {
  addDays,
  balanceActual,
  colchonStatus,
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
        "Objetivo del colchon (fondo de emergencia), cuanto hay reservado, si ya esta financiado y cuanto falta.",
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
        from: z.string().regex(DAY).optional().describe("Desde, YYYY-MM-DD (inclusive)"),
        to: z.string().regex(DAY).optional().describe("Hasta, YYYY-MM-DD (inclusive)"),
        type: z.string().optional().describe("Tipo de movimiento, p.ej. debito, transferencia, servicio, retiro"),
        direction: z.enum(["in", "out"]).optional().describe("in = entra plata, out = sale plata"),
        counterparty: z.string().optional().describe("Contraparte exacta como la escribe el banco"),
        limit: z.number().int().min(1).max(500).optional().describe("Default 100"),
        offset: z.number().int().min(0).optional(),
        include_reversed: z.boolean().optional().describe("Default false"),
        include_internal: z.boolean().optional().describe("Default false"),
      },
    },
    async (args) => {
      // `to` llega como dia inclusivo; el filtro compara contra el `ts`
      // completo, asi que sin el final-del-dia se perderia todo lo de esa fecha.
      const rows = queryTransactions(deps.getDb(), {
        from: args.from ? `${args.from}T00:00:00.000Z` : undefined,
        to: args.to ? `${args.to}T23:59:59.999Z` : undefined,
        type: args.type,
        direction: args.direction,
        counterparty: args.counterparty,
        limit: args.limit,
        offset: args.offset,
        includeReversed: args.include_reversed,
        includeInternal: args.include_internal,
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
      inputSchema: {},
    },
    async () => {
      const rows = queryReviewTransactions(deps.getDb());
      return json({ transactions: rows, count: rows.length });
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
        from: z.string().regex(DAY).optional().describe("Desde, YYYY-MM-DD (inclusive)"),
        to: z.string().regex(DAY).optional().describe("Hasta, YYYY-MM-DD (inclusive)"),
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
        "Lee los correos de notificacion bancaria nuevos y los incorpora al ledger. Requiere credenciales de " +
        "Gmail y de Claude en .env; sin ellas responde gmail_not_configured sin tocar nada. Es la unica tool " +
        "que sale a la red y puede tardar.",
      inputSchema: {},
    },
    async () => {
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
        return json({ ok: true, summary: await runner() });
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
        "sync y perfil financiero. Devuelve el siguiente paso pendiente y que hay que hacer para cerrarlo.",
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
            // Un "15" pelado NO parsea y deja el calendario de pagos en null.
            diasPago: z
              .array(z.string().regex(/^(<=\d{1,2}|\d{1,2}-\d{1,2})$/))
              .describe('Ventanas de pago: ["15-15", "30-30"], ["18-20"] o ["<=5"]'),
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
        "substring y el mas largo gana. Aplica a movimientos futuros; para el historial ya sincronizado corre " +
        "`npm run onboard -- --backfill`.",
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
