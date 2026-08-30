/**
 * `npm run onboard` — the setup surface, designed to be driven by an AGENT
 * rather than by a human typing into a prompt.
 *
 * That is the reason this is a set of non-interactive subcommands instead of
 * a stdin wizard: an agent guiding a user can run `--status` to see what is
 * missing, `--suggest` to read the user's own ledger, ask the user the two
 * or three questions that actually need a human answer, then write the
 * answers with `--set` / `--rule`. Every subcommand is idempotent and
 * re-runnable, so a half-finished setup is resumed by just running it again.
 *
 * Commands (all print JSON except the default checklist):
 *   npm run onboard                      checklist, human-readable
 *   npm run onboard -- --status          same, as JSON
 *   npm run onboard -- --init-env        copy .env.example -> .env (never overwrites)
 *   npm run onboard -- --suggest         read the ledger, propose a profile
 *   npm run onboard -- --set '<json>'    write strategy_config fields
 *   npm run onboard -- --rule <pat>=<cat>  add a merchant category rule
 *   npm run onboard -- --learn-rules     derive rules from already-classified history
 *   npm run onboard -- --backfill        apply the rules to already-synced rows
 *   npm run onboard -- --reclassify      recompute categories/internals already set
 *   npm run onboard -- --heal-counterparties  re-read the emails of rows with no merchant name
 *
 * `--set` takes the same shape `--suggest` emits, so the agent's confirm loop
 * is "show suggestion -> user edits -> pass it straight back".
 */
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type Database from "better-sqlite3";
import { openDb } from "../db/open.js";
import { getStrategyConfig, setStrategyConfig, type StrategyConfig } from "../db/strategy-config.js";
import { learnRulesFromHistory, upsertCategoryRule } from "../category/rules-repository.js";
import { CATEGORIES, type Category } from "../category/categorize.js";
import { backfillCategories } from "../category/backfill.js";
import { reclassifyTransactions } from "../category/reclassify.js";
import { createGoogleapisGmailClient, healCounterparties } from "../ingest/index.js";
import type { GmailClient } from "../ingest/index.js";
import { buildSuggestions } from "./suggest.js";
import { onboardStatus } from "./status.js";

/** Repo root, two levels up from server/src/onboard. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const ENV_PATH = path.join(REPO_ROOT, ".env");
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, ".env.example");

export interface OnboardCliDeps {
  /** Opened lazily so `--init-env` works before any database exists. */
  openDatabase: () => Database.Database;
  env: NodeJS.ProcessEnv;
  envPath: string;
  envExamplePath: string;
  log: (line: string) => void;
  /**
   * Cliente de Gmail para `--heal-counterparties`, el unico subcomando que
   * necesita red. Devuelve `null` — y nunca tira — cuando faltan credenciales,
   * igual que `buildProductionSyncRunner`: asi el subcomando reporta un error
   * limpio en vez de reventar construyendo un cliente que no puede
   * autenticar. Es una funcion, no un cliente ya construido, para que ningun
   * OTRO subcomando pague una conexion que no usa.
   */
  buildGmailClient: () => Promise<Pick<GmailClient, "getMessage"> | null>;
}

/** Las tres credenciales de Gmail del `.env`, o `null` si falta alguna. */
async function gmailClientFromEnv(env: NodeJS.ProcessEnv): Promise<Pick<GmailClient, "getMessage"> | null> {
  const clientId = env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = env.GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = env.GMAIL_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return createGoogleapisGmailClient({ clientId, clientSecret, refreshToken });
}

function defaultDeps(dbPath?: string): OnboardCliDeps {
  return {
    openDatabase: () => openDb(dbPath),
    env: process.env,
    envPath: ENV_PATH,
    envExamplePath: ENV_EXAMPLE_PATH,
    log: (line) => console.log(line),
    buildGmailClient: () => gmailClientFromEnv(process.env),
  };
}

/**
 * Copies .env.example to .env. Never overwrites an existing .env -- that file
 * holds the user's Gmail refresh token and Claude credential, and silently
 * clobbering it would cost them the whole OAuth dance again.
 */
export function initEnv(deps: OnboardCliDeps): { created: boolean; path: string } {
  if (existsSync(deps.envPath)) return { created: false, path: deps.envPath };
  copyFileSync(deps.envExamplePath, deps.envPath);
  return { created: true, path: deps.envPath };
}

/**
 * Campos que `--suggest` emite como DIAGNOSTICO, no como configuracion:
 * describen el ledger para que el agente sepa que preguntar, y no tienen
 * ningun destino en `strategy_config`. `--set` los descarta en vez de tratarlos
 * como error, que es lo que hace que la propuesta se pueda devolver entera.
 */
const SUGGEST_ONLY_KEYS = new Set(["uncategorized", "gastoMensualPromedio", "mesesDeHistorial"]);

/**
 * Parses `--set`'s JSON into a validated `Partial<StrategyConfig>`. Only the
 * fields onboarding is allowed to write are accepted; an unknown key is a
 * hard error rather than a silent no-op, so a typo'd field name surfaces
 * immediately instead of looking like it was saved.
 *
 * Acepta ademas la salida literal de `--suggest`, que es el bucle que la doc
 * promete ("mostrar la propuesta -> el usuario la edita -> devolverla tal
 * cual"). Ese bucle estaba roto: `--suggest` emite `salary` y tres campos de
 * diagnostico, `--set` esperaba `sueldo` y nada mas, asi que devolver la
 * propuesta entera fallaba con "campo(s) desconocido(s)". El objeto `salary`
 * ES el objeto `sueldo` mas un `sampleSize` informativo, asi que la traduccion
 * es un renombre, no una conversion.
 *
 * Lo que NO se relaja es la proteccion contra typos: cualquier clave que no
 * sea ni configuracion ni uno de los tres diagnosticos conocidos sigue siendo
 * error duro.
 *
 * `setStrategyConfig` does the per-field shape validation -- this only gates
 * *which* fields may be written.
 */
export function parseSetPatch(json: string): Partial<StrategyConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("--set espera JSON valido, por ejemplo: --set '{\"colchonObjetivo\": 1500}'");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--set espera un objeto JSON.");
  }

  const allowed = new Set([
    "moneda",
    "zonaHoraria",
    "colchonObjetivo",
    "topeTransferenciasMensual",
    "sueldo",
    "titular",
    "balanceSnapshot",
  ]);
  const record = parsed as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !allowed.has(key) && !SUGGEST_ONLY_KEYS.has(key) && key !== "salary");
  if (unknown.length > 0) {
    throw new Error(`--set: campo(s) desconocido(s): ${unknown.join(", ")}. Validos: ${[...allowed].join(", ")}`);
  }

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SUGGEST_ONLY_KEYS.has(key)) continue;
    // `salary: null` es como `--suggest` dice "no encontre sueldo en el
    // ledger". Devolver eso tal cual no debe escribir un sueldo vacio.
    if (key === "salary") {
      if (value === null || value === undefined) continue;
      if ("sueldo" in record) {
        throw new Error("--set: no pases `salary` y `sueldo` a la vez; `salary` es el nombre que usa --suggest.");
      }
      patch.sueldo = stripSampleSize(value);
      continue;
    }
    if (key === "titular" && value === null) continue;
    patch[key] = value;
  }
  return patch as Partial<StrategyConfig>;
}

/** `sampleSize` dice que tan flaca es la lectura; no es parte del sueldo. */
function stripSampleSize(salary: unknown): unknown {
  if (typeof salary !== "object" || salary === null || Array.isArray(salary)) return salary;
  const { sampleSize: _ignored, ...rest } = salary as Record<string, unknown>;
  return rest;
}

/**
 * Parses `pattern=category`, e.g. `veterinaria=mascota`. Splits on the LAST
 * `=`, not the first: a merchant name can legitimately contain one, a
 * glossary category never can.
 */
export function parseRule(arg: string): { pattern: string; category: Category } {
  const index = arg.lastIndexOf("=");
  if (index <= 0) throw new Error("--rule espera <patron>=<categoria>, por ejemplo: --rule veterinaria=mascota");

  const pattern = arg.slice(0, index).trim();
  const category = arg.slice(index + 1).trim();
  if (!CATEGORIES.includes(category as Category)) {
    throw new Error(`--rule: categoria desconocida '${category}'. Validas: ${CATEGORIES.join(", ")}`);
  }
  return { pattern, category: category as Category };
}

/** Renders the checklist the way a human reads it. */
function formatChecklist(status: ReturnType<typeof onboardStatus>): string {
  const lines = status.steps.map((step) => {
    const mark = step.done ? "[x]" : "[ ]";
    return step.done ? `${mark} ${step.title}` : `${mark} ${step.title}\n      -> ${step.action}`;
  });
  const footer = status.complete
    ? "\nTodo listo. `npm run dev` y abre http://localhost:3000"
    : `\nSiguiente paso: ${status.next?.title}`;
  return `Onboarding de Agentic Wallet\n\n${lines.join("\n")}\n${footer}`;
}

/**
 * Runs one subcommand. Returns an exit code rather than calling
 * `process.exit`, so tests can assert on failures without killing the runner.
 */
export async function runOnboardCli(argv: readonly string[], deps: OnboardCliDeps): Promise<number> {
  const command = argv[0] ?? "--checklist";

  // --init-env is the only command that must work with no database at all.
  if (command === "--init-env") {
    const result = initEnv(deps);
    deps.log(
      JSON.stringify(
        result.created
          ? { ok: true, created: true, path: result.path, next: "Edita .env y pon tus credenciales." }
          : { ok: true, created: false, path: result.path, next: ".env ya existia; no se toco." },
        null,
        2
      )
    );
    return 0;
  }

  let db: Database.Database | null = null;
  try {
    // A missing/unopenable database is a legitimate state for --status (the
    // user hasn't synced yet), so it degrades to null rather than throwing.
    try {
      db = deps.openDatabase();
    } catch {
      db = null;
    }

    switch (command) {
      case "--checklist":
      case "--status": {
        const status = onboardStatus({ envPath: deps.envPath, env: deps.env, db });
        deps.log(command === "--status" ? JSON.stringify(status, null, 2) : formatChecklist(status));
        return 0;
      }

      case "--suggest": {
        if (!db) {
          deps.log(JSON.stringify({ ok: false, error: "No hay base de datos todavia. Corre un sync primero." }));
          return 1;
        }
        deps.log(JSON.stringify(buildSuggestions(db), null, 2));
        return 0;
      }

      case "--set": {
        if (!db) {
          deps.log(JSON.stringify({ ok: false, error: "No hay base de datos todavia. Corre un sync primero." }));
          return 1;
        }
        const patch = parseSetPatch(argv[1] ?? "");
        const written = setStrategyConfig(db, patch);
        deps.log(JSON.stringify({ ok: true, written }, null, 2));
        return 0;
      }

      case "--backfill": {
        if (!db) {
          deps.log(JSON.stringify({ ok: false, error: "No hay base de datos todavia. Corre un sync primero." }));
          return 1;
        }
        // The only awaited subcommand -- which is why `runOnboardCli` is
        // async: resolving this with .then() would let the `finally` below
        // close the database out from under the running backfill.
        const updated = await backfillCategories(db);
        deps.log(JSON.stringify({ ok: true, updated }, null, 2));
        return 0;
      }

      case "--reclassify": {
        if (!db) {
          deps.log(JSON.stringify({ ok: false, error: "No hay base de datos todavia. Corre un sync primero." }));
          return 1;
        }
        // A diferencia de --backfill, esta si repisa: es para cuando cambio el
        // insumo del calculo (llego el titular, se agrego una regla) y la
        // categoria guardada quedo vieja. Ver category/reclassify.ts.
        const result = await reclassifyTransactions(db, { titular: getStrategyConfig(db).titular });
        deps.log(JSON.stringify({ ok: true, ...result }, null, 2));
        return 0;
      }

      case "--rule": {
        if (!db) {
          deps.log(JSON.stringify({ ok: false, error: "No hay base de datos todavia. Corre un sync primero." }));
          return 1;
        }
        const { pattern, category } = parseRule(argv[1] ?? "");
        const saved = upsertCategoryRule(db, pattern, category);
        deps.log(JSON.stringify({ ok: saved, pattern, category }, null, 2));
        return saved ? 0 : 1;
      }

      case "--heal-counterparties": {
        if (!db) {
          deps.log(JSON.stringify({ ok: false, error: "No hay base de datos todavia. Corre un sync primero." }));
          return 1;
        }
        const gmailClient = await deps.buildGmailClient();
        if (!gmailClient) {
          deps.log(
            JSON.stringify({
              ok: false,
              error: "gmail_not_configured",
              next: "Pon GMAIL_OAUTH_CLIENT_ID/SECRET y corre `npm run gmail-auth` para el refresh token.",
            })
          );
          return 1;
        }
        // Relee el correo original de las filas que quedaron sin comercio y
        // les devuelve el nombre. Recategorizar es un paso aparte a
        // proposito: aca no se decide ninguna categoria, solo se recupera el
        // dato con el que `--reclassify` despues puede decidirla. Ver
        // ingest/heal-counterparty.ts.
        const result = await healCounterparties({ db, gmailClient });
        deps.log(JSON.stringify({ ok: true, ...result, next: "npm run onboard -- --reclassify" }, null, 2));
        return 0;
      }

      case "--learn-rules": {
        if (!db) {
          deps.log(JSON.stringify({ ok: false, error: "No hay base de datos todavia. Corre un sync primero." }));
          return 1;
        }
        // Para quien llega con historial ya etiquetado: convierte esas
        // etiquetas en reglas, que es lo unico que `categorize` sabe leer.
        // Nunca pisa una regla existente. Ver category/rules-repository.ts.
        const result = learnRulesFromHistory(db);
        deps.log(JSON.stringify({ ok: true, ...result }, null, 2));
        return 0;
      }

      default:
        deps.log(
          [
            `Comando desconocido: ${command}`,
            "",
            "Uso:",
            "  npm run onboard                        checklist legible",
            "  npm run onboard -- --status            checklist como JSON",
            "  npm run onboard -- --init-env          copia .env.example a .env",
            "  npm run onboard -- --suggest           propone perfil leyendo tu ledger",
            "  npm run onboard -- --set '<json>'      escribe campos de strategy_config",
            "  npm run onboard -- --rule <pat>=<cat>  agrega una regla de comercio",
            "  npm run onboard -- --learn-rules       deriva reglas del historial que ya clasificaste",
            "  npm run onboard -- --backfill          aplica las reglas al historial ya sincronizado",
            "  npm run onboard -- --reclassify        recalcula categorias e internas ya asignadas (si repisa)",
            "  npm run onboard -- --heal-counterparties  relee el correo de las filas sin comercio y les pone nombre",
          ].join("\n")
        );
        return 1;
    }
  } catch (err) {
    deps.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return 1;
  } finally {
    db?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // This CLI's stdout is a result an agent parses as JSON, not a log stream:
  // keep span lines off it (errors still go to stderr). Set before openDb, so
  // even the first migration's spans are covered.
  process.env.WALLET_TELEMETRY_SILENT ??= "1";
  process.exitCode = await runOnboardCli(process.argv.slice(2), defaultDeps());
}
