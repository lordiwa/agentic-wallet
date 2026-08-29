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
}

function defaultDeps(dbPath?: string): OnboardCliDeps {
  return {
    openDatabase: () => openDb(dbPath),
    env: process.env,
    envPath: ENV_PATH,
    envExamplePath: ENV_EXAMPLE_PATH,
    log: (line) => console.log(line),
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
 * Parses `--set`'s JSON into a validated `Partial<StrategyConfig>`. Only the
 * fields onboarding is allowed to write are accepted; an unknown key is a
 * hard error rather than a silent no-op, so a typo'd field name surfaces
 * immediately instead of looking like it was saved.
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
  const unknown = Object.keys(parsed).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`--set: campo(s) desconocido(s): ${unknown.join(", ")}. Validos: ${[...allowed].join(", ")}`);
  }
  return parsed as Partial<StrategyConfig>;
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
