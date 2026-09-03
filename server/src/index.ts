import path from "node:path";
import { pathToFileURL } from "node:url";
import type Database from "better-sqlite3";
import express from "express";
import { classifyRequestAuth, createAuthMiddleware, normalizeAccessToken } from "./api/auth.js";
import { createCorsMiddleware, parseAllowedOrigins } from "./api/cors.js";
import { createApiRouter } from "./api/routes.js";
import { createChatRouter } from "./api/chat-route.js";
import { createSyncRouter } from "./api/sync-route.js";
import type { SyncRunner } from "./api/sync-route.js";
import { classifyClaudeCredential } from "./claude-credential.js";
import { buildDailyBrief } from "./brief/build-brief.js";
import { startDailyBriefScheduler } from "./brief/scheduler.js";
import type { QueryFn } from "./chat/chat-service.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/open.js";
import { seedDatabase } from "./seed/seed.js";
import { buildProductionSyncRunner } from "./sync/build-sync-runner.js";

export interface CreateAppOptions {
  /**
   * Overrides the production `SyncRunner` (real Gmail+Claude wired from env
   * config, see sync/build-sync-runner.ts) -- pass a fake for tests, or an
   * explicit `null` to force POST /api/sync's "not configured" path. Omit
   * to use the default env-derived wiring.
   */
  syncRunner?: SyncRunner | null;
  /**
   * Overrides POST /api/chat's Claude-credential gate (el mismo
   * `classifyClaudeCredential` que usa el wiring de produccion de
   * `syncRunner`: presencia Y forma) -- pass `false`/`true` in tests instead
   * of setting real env vars. Omit to use the real env-derived check.
   */
  chatCredential?: boolean;
  /**
   * Overrides the real Claude Agent SDK `query()` call chat-service.ts
   * makes -- pass a stub in tests so no network call happens (mirrors the
   * injected `EmailExtractor` pattern `syncRunner` uses). Omit to use the
   * real SDK.
   */
  chatQueryFn?: QueryFn;
}

/**
 * `db` is optional and injectable for tests. When omitted, the real database
 * (env-configured path) is opened lazily on the first request that actually
 * needs it, so constructing the app (e.g. in tests that never call an /api/*
 * route) never touches disk.
 *
 * TASK-021 AC2: the real (env-configured) database is seeded with the spec
 * 4.6 defaults (strategy_config/debts/savings) right after it's first
 * opened, so a fresh local DB is ready for the strategy engine as soon as
 * the server starts serving requests. `seedDatabase` is idempotent (F1-10 +
 * TASK-021's person-keyed debts fix), so this is safe to run on every
 * server start, including against an already-seeded DB. Only the real,
 * lazily-opened db is seeded -- a `db` injected by a test is never touched,
 * so route/unit tests that pass their own fixture db keep full control over
 * its contents.
 */
export function createApp(db?: Database.Database, options: CreateAppOptions = {}) {
  const app = express();
  app.use(express.json());

  // Antes de cualquier ruta para que el preflight OPTIONS tambien lo vea.
  // Sin `WALLET_ALLOWED_ORIGINS` la lista queda vacia y esto es un no-op.
  app.use(createCorsMiddleware(parseAllowedOrigins(loadConfig().WALLET_ALLOWED_ORIGINS)));

  let lazyDb = db;
  const getDb = (): Database.Database => {
    if (!lazyDb) {
      lazyDb = openDb();
      seedDatabase(lazyDb);
    }
    return lazyDb;
  };

  const getSyncRunner = (): SyncRunner | null =>
    "syncRunner" in options ? (options.syncRunner ?? null) : buildProductionSyncRunner(loadConfig(), getDb);

  const hasChatCredential = (): boolean =>
    "chatCredential" in options
      ? Boolean(options.chatCredential)
      : classifyClaudeCredential(loadConfig()).usable;

  // Se lee una sola vez, al construir la app: cambiar la llave es reiniciar
  // el server, no una condicion que se re-evalue por request.
  const accessToken = normalizeAccessToken(loadConfig().WALLET_ACCESS_TOKEN);

  /**
   * El unico endpoint sin llave, y a proposito (R27). Desde un navegador un
   * server caido, un origen que CORS no permite y una credencial rechazada
   * dan el mismo error de red; esta respuesta separa los tres:
   *
   * - no responde        -> server caido, o el origen no esta en la lista blanca
   * - `auth_required`    -> si este server pide llave
   * - `authenticated`    -> si la llave que trajo ESTA peticion sirve
   *
   * No dice nada del ledger ni de la configuracion: solo si la puerta existe
   * y si la llave presentada abre.
   */
  app.get("/api/health", (req, res) => {
    const auth = classifyRequestAuth(accessToken, req.headers.authorization);
    res.json({
      status: "ok",
      auth_required: accessToken !== null,
      // `disabled` cuenta como autenticado: sin llave configurada, cualquier
      // peticion pasa — decir `false` haria que el chip acuse una credencial
      // rota donde no hay ninguna credencial que romper.
      authenticated: auth === "ok" || auth === "disabled",
    });
  });

  // Despues de /api/health (que queda abierto) y antes de todo router: a
  // partir de aca `/api/*` exige `Authorization: Bearer`. Sin
  // WALLET_ACCESS_TOKEN es un no-op y el server se comporta como siempre.
  app.use("/api", createAuthMiddleware(accessToken));

  // Mounted before the SPA catch-all so /api/* is fully handled here.
  app.use("/api", createApiRouter(getDb));
  app.use("/api", createSyncRouter(getSyncRunner));
  app.use("/api", createChatRouter({ getDb, hasCredential: hasChatCredential, queryFn: options.chatQueryFn }));

  // Any /api/* route not matched above is a client error, not a page route:
  // return JSON 404 instead of falling through to index.html (F1-01 follow-up).
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // Serve the built SPA (web/dist) so backend + frontend run on a single local port.
  const webDist = path.resolve(import.meta.dirname, "../../web/dist");
  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });

  return app;
}

/**
 * The scheduler's daily trigger (F2-F / TASK-027, spec §13 AC5): opens its
 * own short-lived db connection (better-sqlite3 supports multiple
 * connections to the same WAL-mode file) rather than sharing `createApp`'s
 * lazy one, since this only runs once a day and closing it right after
 * keeps the process from accumulating open handles over a long uptime.
 * Delivery (email/notification) is out of this ticket's scope -- this only
 * builds the brief and logs its headline figures, the same structured-log
 * shape every other module here uses.
 *
 * The whole trigger body runs inside try/catch (not just try/finally): this
 * fires from a bare `setTimeout` callback, so an uncaught throw here (e.g.
 * `openDb`/`seedDatabase`/`buildDailyBrief` failing) would become an
 * uncaughtException and kill the whole server at 08:00 -- the scheduler's
 * own reschedule-on-`finally` can't save it, because the exception escapes
 * the callback before that runs. Catching and logging it instead lets one
 * bad day's brief fail loudly without silencing every day after it.
 */
function runScheduledBrief(): void {
  let db: Database.Database | undefined;
  try {
    db = openDb();
    seedDatabase(db);
    const brief = buildDailyBrief(db);
    console.log(
      JSON.stringify({
        level: "info",
        event: "brief.scheduler.triggered",
        date: brief.date,
        alertCount: brief.alertas.length,
        recordatorioTarjeta: brief.recordatorioTarjeta,
      })
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "brief.scheduler.error",
        message: err instanceof Error ? err.message : String(err),
      })
    );
  } finally {
    db?.close();
  }
}

// Only boot the HTTP listener when run directly, not when imported by tests.
// Compared as file:// URLs (not raw strings) so this works on Windows too,
// where argv[1] uses backslashes and lacks the extra leading slash.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const app = createApp();
  app.listen(config.PORT, config.WALLET_BIND_HOST, () => {
    console.log(`Agentic Wallet escuchando en http://${config.WALLET_BIND_HOST}:${config.PORT}`);
    if (config.WALLET_BIND_HOST === "0.0.0.0" && normalizeAccessToken(config.WALLET_ACCESS_TOKEN) === null) {
      console.warn(
        "AVISO: WALLET_BIND_HOST=0.0.0.0 expone la API en todas las interfaces " +
          "y no hay WALLET_ACCESS_TOKEN, asi que la API no pide llave. En una " +
          "maquina con IP publica usa 127.0.0.1 + `tailscale serve`."
      );
    }
  });

  // Local 08:00 local time daily brief trigger (F2-F AC5) -- only
  // started here, in the real-server-boot path, never in createApp() itself,
  // so it never starts under `npm test` (which constructs the app directly
  // without calling listen()). See brief/scheduler.ts for why this is a
  // plain setTimeout loop rather than node-cron or an OS cron job.
  startDailyBriefScheduler(runScheduledBrief);
}
