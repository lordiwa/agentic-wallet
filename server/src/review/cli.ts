/**
 * `npm run review` — la cola de revisión desde la terminal.
 *
 * Mismo diseño que `npm run onboard` (ver `onboard/cli.ts`): subcomandos **no
 * interactivos**, stdout parseable como JSON, cero prompts bloqueantes. Es
 * para que lo pueda manejar tanto una persona como un agente: `--list` para
 * ver qué hay, y una acción explícita por fila.
 *
 * Comandos:
 *   npm run review                            la cola pendiente (JSON)
 *   npm run review -- --list                  idem
 *   npm run review -- --confirm <id>          el monto del parser está bien
 *   npm run review -- --correct <id>=<monto>  el humano afirma otro monto
 *   npm run review -- --discard <id>          no es un movimiento real
 *   npm run review -- --history [<id>]        qué se resolvió, por quién y cuándo
 *
 * Modificadores de cualquier acción: `--by <nombre>` (queda en la auditoría;
 * sin él se registra `cli`) y `--note <texto>`. Los dos aceptan también la
 * forma pegada `--by=<nombre>`.
 *
 * Una resolución que no cambió nada (la fila ya estaba resuelta) sale con
 * **exit 0**: es el resultado correcto de una operación idempotente, no un
 * error. Exit 1 queda para lo que de verdad falló.
 */
import { pathToFileURL } from "node:url";
import type Database from "better-sqlite3";
import { openDb } from "../db/open.js";
import { queryReviewTransactions } from "../api/queries.js";
import { listReviewResolutions, resolveReview, type ReviewAction } from "./resolve.js";

export interface ReviewCliDeps {
  openDatabase: () => Database.Database;
  log: (line: string) => void;
}

/** Las acciones, por la bandera con la que se las escribe en la terminal. */
const ACTION_FLAGS: Record<string, ReviewAction> = {
  "--confirm": "confirm",
  "--correct": "correct",
  "--discard": "discard",
};

const USAGE = [
  "Uso:",
  "  npm run review                            la cola pendiente (JSON)",
  "  npm run review -- --list                  idem",
  "  npm run review -- --confirm <id>          el monto del parser esta bien",
  "  npm run review -- --correct <id>=<monto>  el humano afirma otro monto",
  "  npm run review -- --discard <id>          no es un movimiento real",
  "  npm run review -- --history [<id>]        que se resolvio, por quien y cuando",
  "",
  "  --by <nombre>   queda en la auditoria (sin el se registra 'cli')",
  "  --note <texto>  por que se resolvio asi",
].join("\n");

/**
 * Lee `--by`/`--note` en sus dos formas (`--by mato` y `--by=mato`) y devuelve
 * el resto de los argumentos. Se separan del posicional a propósito: así el id
 * puede ir antes o después de los modificadores sin que el orden importe.
 */
function extractOptions(argv: readonly string[]): { by?: string; note?: string; rest: string[] } {
  const rest: string[] = [];
  let by: string | undefined;
  let note: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const pegado = arg.match(/^--(by|note)=(.*)$/);
    if (pegado) {
      if (pegado[1] === "by") by = pegado[2];
      else note = pegado[2];
      continue;
    }
    if (arg === "--by" || arg === "--note") {
      const value = argv[i + 1];
      i += 1;
      if (value === undefined) continue;
      if (arg === "--by") by = value;
      else note = value;
      continue;
    }
    rest.push(arg);
  }

  return { by, note, rest };
}

/** `123` para confirm/discard, `123=41.07` para correct. Devuelve `null` en vez
 * de tirar: el llamador lo convierte en exit 1 con un mensaje útil. */
function parseTarget(arg: string | undefined, action: ReviewAction): { id: number; amount?: number } | null {
  if (arg === undefined) return null;

  if (action !== "correct") {
    const id = Number(arg);
    return Number.isInteger(id) && id > 0 ? { id } : null;
  }

  // El monto no puede llevar `=`, así que el primer separador alcanza.
  const index = arg.indexOf("=");
  if (index <= 0) return null;
  const id = Number(arg.slice(0, index));
  const amount = Number(arg.slice(index + 1));
  if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(amount)) return null;
  return { id, amount };
}

/**
 * Corre un subcomando. Devuelve el exit code en vez de llamar a
 * `process.exit`, igual que `runOnboardCli`, para que el test pueda afirmar
 * sobre los fallos sin matar al runner.
 */
export async function runReviewCli(argv: readonly string[], deps: ReviewCliDeps): Promise<number> {
  const { by, note, rest } = extractOptions(argv);
  const command = rest[0] ?? "--list";

  let db: Database.Database | null = null;
  try {
    try {
      db = deps.openDatabase();
    } catch {
      deps.log(JSON.stringify({ ok: false, error: "No hay base de datos todavia. Corre un sync primero." }));
      return 1;
    }

    if (command === "--list") {
      const transactions = queryReviewTransactions(db);
      deps.log(JSON.stringify({ ok: true, transactions, count: transactions.length }, null, 2));
      return 0;
    }

    if (command === "--history") {
      const transactionId = rest[1] === undefined ? undefined : Number(rest[1]);
      if (transactionId !== undefined && !Number.isInteger(transactionId)) {
        deps.log(JSON.stringify({ ok: false, error: "--history espera un id numerico o nada." }));
        return 1;
      }
      const resolutions = listReviewResolutions(db, { transactionId });
      deps.log(JSON.stringify({ ok: true, resolutions, count: resolutions.length }, null, 2));
      return 0;
    }

    const action = ACTION_FLAGS[command];
    if (!action) {
      deps.log(JSON.stringify({ ok: false, error: `Comando desconocido: ${command}`, usage: USAGE }, null, 2));
      return 1;
    }

    const target = parseTarget(rest[1], action);
    if (!target) {
      deps.log(
        JSON.stringify(
          {
            ok: false,
            error:
              action === "correct"
                ? "--correct espera <id>=<monto>, por ejemplo: --correct 123=41.07"
                : `${command} espera un id numerico, por ejemplo: ${command} 123`,
          },
          null,
          2
        )
      );
      return 1;
    }

    const result = resolveReview(db, { id: target.id, action, amount: target.amount, note, resolvedBy: by ?? "cli" });
    deps.log(JSON.stringify(result, null, 2));
    // Una resolución idempotente (`changed: false`) no es un fallo.
    return result.ok ? 0 : 1;
  } finally {
    db?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Igual que el CLI de onboarding: stdout es un resultado JSON que alguien
  // parsea, no un log. Los spans se silencian antes de abrir la base.
  process.env.WALLET_TELEMETRY_SILENT ??= "1";
  process.exitCode = await runReviewCli(process.argv.slice(2), {
    openDatabase: () => openDb(),
    log: (line) => console.log(line),
  });
}
