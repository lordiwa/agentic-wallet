/**
 * Re-ancla el saldo de un tenant en Firestore desde un SQLite real.
 *
 * ## Por qué hace falta un script aparte de la migración
 *
 * `GET /api/overview` devuelve como `balance` el `balanceSnapshot` crudo del
 * perfil —no una cifra derivada del ledger— tanto en el motor original
 * (`server/src/api/queries.ts`, `getBalanceSnapshot`) como en el port
 * (`functions/src/api/overview.ts`). Un `balanceSnapshot` que nunca se fijó
 * vale `{amount: 0, at: "1970-01-01"}`, que es el default del seed
 * (`server/src/seed/default-config.ts`), y el panel lo dibuja como "Saldo 0".
 *
 * La migración porta el `strategy_config` tal como está: si la base de origen
 * traía el default, el tenant queda con el default. No hay ninguna ruta HTTP
 * que escriba el ancla —`POST /onboarding/profile` sólo toca `diasPago` y
 * `colchonObjetivo`—, así que corregirlo es exactamente esto: un script, con
 * la misma disciplina que `migrate-tenant.ts`.
 *
 * ## De dónde sale el ancla, y en qué orden
 *
 * 1. La fila más reciente de la tabla `saldos`, si la hay. Es la fuente
 *    preferida por lo que la tabla es: "re-anclas de saldo leídas del banco
 *    por el usuario, no derivadas" (`server/src/db/schema.ts`). Se usa la
 *    columna `corriente` —la cuenta corriente, que es el "Saldo" del panel—;
 *    `flexiahorro` y `emergencia` son ahorro y no entran acá.
 * 2. Si no hay `saldos`, el `balanceSnapshot` del `strategy_config`, siempre
 *    que NO sea el default del seed.
 *
 * El orden no es arbitrario. Un ancla vieja no se puede "traer al día"
 * sumándole los movimientos del ledger: el ledger se arma con los correos de
 * notificación del banco y no ve todo lo que pasa por la cuenta, así que la
 * deriva crece con el tiempo. Entre dos anclas reales gana la más reciente,
 * y una lectura directa del banco es más reciente que un snapshot que quedó
 * escrito en un perfil.
 *
 * ## No inventa (CLAUDE.md regla 3 y 4)
 *
 * Si ninguna de las dos fuentes tiene un ancla real, el script **falla** en
 * vez de escribir un cero: un `0` en `balanceSnapshot` es una afirmación
 * ("el banco decía cero"), no un "no sé". Lo desconocido es no escribir nada
 * y dejar el default, que es lo que el motor ya interpreta como "todavía no
 * hay punto de partida".
 *
 * Uso:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node --import ./scripts/ts-resolver.mjs scripts/reanclar-saldo.ts \
 *     --sqlite /ruta/a/la/base.sqlite --uid <uid> [--dry-run]
 *
 * Igual que la migración, escribir en producción exige `--yes-produccion`.
 */
import Database from "better-sqlite3";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import * as paths from "../src/ledger/paths.js";
import { DEFAULT_STRATEGY_CONFIG } from "../src/ledger/firestore-ledger.js";

export interface Ancla {
  amount: number;
  /** Día calendario `YYYY-MM-DD`, la misma forma que `balanceSnapshot.at`. */
  at: string;
  /** Qué tabla la dio. Va al reporte para que se pueda auditar la decisión. */
  fuente: "saldos" | "strategy_config";
}

/** `YYYY-MM-DD`, que es lo único que `parseLocalDay` sabe leer. */
const DIA = /^\d{4}-\d{2}-\d{2}$/;

function tablaExiste(db: Database.Database, tabla: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabla) !==
    undefined
  );
}

/**
 * `true` cuando el ancla es la del seed —o cualquier variante de "nunca se
 * fijó"— y por lo tanto no es un dato del usuario.
 *
 * El epoch se compara contra el default en vez de cablear la fecha: si el
 * seed cambiara de punto neutro, esto lo sigue. El `at: ""` extra es la forma
 * que toma el mismo "sin fijar" en Firestore
 * (`DEFAULT_STRATEGY_CONFIG.balanceSnapshot`, que nace vacío porque un
 * documento ausente no tiene fecha).
 */
function esElDefault(amount: number, at: string): boolean {
  if (amount !== 0) return false;
  return at === "" || at === DEFAULT_STRATEGY_CONFIG.balanceSnapshot.at || at === "1970-01-01";
}

/** El ancla del `strategy_config`, o `null` si falta, no parsea, o es el default. */
function anclaDeStrategyConfig(db: Database.Database): Ancla | null {
  if (!tablaExiste(db, "strategy_config")) return null;
  const row = db.prepare("SELECT value FROM strategy_config WHERE key = 'balanceSnapshot'").get() as
    | { value: string }
    | undefined;
  if (row === undefined) return null;

  let parsed: { amount?: unknown; at?: unknown };
  try {
    parsed = JSON.parse(row.value) as { amount?: unknown; at?: unknown };
  } catch {
    return null;
  }
  if (typeof parsed.amount !== "number" || !Number.isFinite(parsed.amount)) return null;
  const at = typeof parsed.at === "string" ? parsed.at : "";
  if (!DIA.test(at)) return null;
  if (esElDefault(parsed.amount, at)) return null;

  return { amount: parsed.amount, at, fuente: "strategy_config" };
}

/**
 * La re-ancla más reciente de `saldos`.
 *
 * Se ordena por `fecha` (la PK, un `YYYY-MM-DD`, que ordena bien como texto)
 * y se descartan las filas sin `corriente`: una fila que sólo trae ahorro no
 * dice nada del saldo de la cuenta corriente. Un `corriente: 0` SÍ vale — es
 * una lectura, no una ausencia (CLAUDE.md regla 4).
 */
function anclaDeSaldos(db: Database.Database): Ancla | null {
  if (!tablaExiste(db, "saldos")) return null;
  const row = db
    .prepare(
      "SELECT fecha, corriente FROM saldos WHERE corriente IS NOT NULL ORDER BY fecha DESC LIMIT 1"
    )
    .get() as { fecha: string | null; corriente: number } | undefined;
  if (row === undefined) return null;
  if (typeof row.fecha !== "string" || !DIA.test(row.fecha)) return null;
  if (!Number.isFinite(row.corriente)) return null;

  return { amount: row.corriente, at: row.fecha, fuente: "saldos" };
}

/** El ancla real del SQLite, con la precedencia documentada arriba. */
export function leerAncla(db: Database.Database): Ancla | null {
  return anclaDeSaldos(db) ?? anclaDeStrategyConfig(db);
}

export interface ReporteReancla {
  uid: string;
  /** De qué tabla salió el ancla. `null` = no había ninguna real. */
  fuente: Ancla["fuente"] | null;
  /** La fecha del ancla. No es un dato sensible: fecha sí, monto no. */
  at: string | null;
  /** El ancla que había en Firestore antes era el default del seed. */
  eraElDefault: boolean;
  /** Firestore, releído después de escribir, coincide con lo que se mandó. */
  verificado: boolean;
  dryRun: boolean;
}

/**
 * Escribe el ancla en `config/strategy` con `merge`, no con `set` entero: el
 * resto del perfil (sueldo, moneda, días de pago) ya está bien y no tiene por
 * qué pasar por acá. Después RELEE y compara, por la misma razón que la
 * migración vuelve a contar: un reporte de lo que se creyó escribir no sirve
 * para decidir nada.
 */
export async function reanclarSaldo(options: {
  firestore: Firestore;
  sqlitePath: string;
  uid: string;
  dryRun?: boolean;
}): Promise<ReporteReancla> {
  const { firestore, sqlitePath, uid } = options;
  const dryRun = options.dryRun ?? false;
  paths.assertUid(uid);

  const sqlite = new Database(sqlitePath, { readonly: true });
  let ancla: Ancla | null;
  try {
    ancla = leerAncla(sqlite);
  } finally {
    sqlite.close();
  }

  if (ancla === null) {
    throw new Error(
      "el SQLite no tiene ningun ancla real de saldo (ni fila en `saldos` ni `balanceSnapshot` distinto del default). " +
        "No se escribe nada: un cero inventado seria peor que el default."
    );
  }

  const ref = paths.configDoc(firestore, uid, "strategy");
  const previo = (await ref.get()).data() as
    | { balanceSnapshot?: { amount?: unknown; at?: unknown } }
    | undefined;
  const previoAmount = typeof previo?.balanceSnapshot?.amount === "number" ? previo.balanceSnapshot.amount : 0;
  const previoAt = typeof previo?.balanceSnapshot?.at === "string" ? previo.balanceSnapshot.at : "";
  const eraElDefault = esElDefault(previoAmount, previoAt);

  if (dryRun) {
    return { uid, fuente: ancla.fuente, at: ancla.at, eraElDefault, verificado: false, dryRun };
  }

  await ref.set({ balanceSnapshot: { amount: ancla.amount, at: ancla.at } }, { merge: true });

  const releido = (await ref.get()).data() as
    | { balanceSnapshot?: { amount?: unknown; at?: unknown } }
    | undefined;
  const verificado =
    releido?.balanceSnapshot?.amount === ancla.amount && releido.balanceSnapshot.at === ancla.at;

  return { uid, fuente: ancla.fuente, at: ancla.at, eraElDefault, verificado, dryRun };
}

// --- CLI -------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sqlitePath = typeof args.sqlite === "string" ? args.sqlite : null;
  const uid = typeof args.uid === "string" ? args.uid : null;
  if (sqlitePath === null || uid === null) {
    console.error("uso: reanclar-saldo.ts --sqlite <ruta> --uid <uid> [--dry-run] [--yes-produccion]");
    process.exit(2);
  }

  const contraEmulador = process.env.FIRESTORE_EMULATOR_HOST !== undefined;
  if (!contraEmulador && args["yes-produccion"] !== true) {
    console.error(
      "negado: FIRESTORE_EMULATOR_HOST no esta puesto, o sea que esto escribiria en PRODUCCION.\n" +
        "Si es lo que queres, pasa --yes-produccion explicitamente."
    );
    process.exit(3);
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "agentic-wallet-71314";
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const app = initializeApp(
    contraEmulador || credentialPath === undefined
      ? { projectId }
      : { projectId, credential: cert(credentialPath) }
  );

  const reporte = await reanclarSaldo({
    firestore: getFirestore(app),
    sqlitePath,
    uid,
    dryRun: args["dry-run"] === true,
  });

  // Fuente, fecha y booleanos. El monto NO se imprime: CLAUDE.md regla 2.
  console.log(JSON.stringify(reporte, null, 2));
  process.exit(reporte.dryRun || reporte.verificado ? 0 : 1);
}

const invocadoDirecto = process.argv[1] !== undefined && process.argv[1].endsWith("reanclar-saldo.ts");
if (invocadoDirecto) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
