/**
 * Snapshot limpio de un ledger para la migracion a multi-tenant (Fase 0 del
 * pivot, pasos 1, 5 y 6 de `docs/pivot-saas.md` §3.8).
 *
 * El problema que resuelve: `bolsillo.sqlite` tiene un WAL de cientos de KB
 * sin checkpointear al lado. Un `cp` del `.sqlite` a secas **pierde todo lo
 * que esta en el WAL** — no es teorico, el WAL es casi la mitad del archivo
 * principal. `VACUUM INTO` lee la base con una transaccion de lectura normal,
 * asi que ve el WAL, y escribe un archivo nuevo ya consolidado y compactado.
 *
 * Tres invariantes que este script protege, y que un `cp` no da:
 *
 * 1. **El original no se toca.** La conexion de origen se abre `readonly`.
 *    Ni `migrate()` ni `openDb()` entran aca a proposito: los dos escriben.
 * 2. **El esquema viejo se completa en el destino.** El ledger de hoy no
 *    tiene `classify_silenced`. `migrate()` la crea al abrir la copia, pero
 *    eso hay que *verificarlo*, no suponerlo (§3.8, hecho 2).
 * 3. **La verificacion no imprime datos personales.** El control de que no se
 *    perdio ni cambio una fila es un SHA-256 sobre las filas ordenadas, no
 *    una lista de montos y comercios (CLAUDE.md, regla 2). Dos huellas
 *    iguales prueban lo mismo que comparar fila por fila, y no dejan un
 *    movimiento bancario en la salida de una consola ni en un log.
 *
 * Uso:
 *
 *   npm run tenant-snapshot -- --source bolsillo.sqlite \
 *     --dest /opt/data/backups/wallet-tenant1-vacuum.sqlite
 *
 * Imprime un JSON con conteos, huellas y el veredicto. Sale con codigo 1 si
 * algun numero no coincide — que es el paso 6 de §3.8: "si un solo numero no
 * coincide, se vuelve a la copia y se para".
 */
import crypto from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { repoRoot } from "../src/config.js";
import { migrate } from "../src/db/schema.js";
import { seedDatabase } from "../src/seed/seed.js";

/**
 * Una ruta relativa se ancla a la raiz del repo, no al cwd — la misma decision
 * y por el mismo motivo que `db/open.ts`. `npm run tenant-snapshot` corre con
 * el cwd en `server/` (es un script de workspace), asi que un
 * `--source bolsillo.sqlite` relativo al cwd abre `server/bolsillo.sqlite`,
 * que es una base vacia con el mismo nombre. Verificado en carne propia: el
 * primer intento reporto "0 transacciones, todo OK", que es el peor resultado
 * posible en una herramienta de migracion — exito sobre la base equivocada.
 */
function resolveLedgerPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot(), value);
}

/** Conteo de filas por tabla, mas las huellas que detectan un cambio de
 * contenido que los conteos solos no verian (una fila reemplazada por otra). */
export interface LedgerFingerprint {
  /** Nombre de tabla -> filas. Solo tablas de usuario (`sqlite_%` fuera). */
  counts: Record<string, number>;
  /** SHA-256 sobre las filas de `transactions` ordenadas por su clave natural. */
  transactionsDigest: string;
  /** Las columnas que entraron en la huella, en orden. Se pasan tal cual al
   * medir el destino: `migrate()` agrega columnas, y comparar dos huellas de
   * juegos de columnas distintos daria "cambio el contenido" por un cambio de
   * esquema. */
  transactionsColumns: string[];
  /** Los tres agregados de control del paso 0 de §3.8, en forma no personal. */
  needsReview: number;
  discarded: number;
  /** Ultimo `ts` del ledger. Es una fecha, no un monto ni una contraparte. */
  lastTs: string | null;
}

export interface SnapshotResult {
  source: string;
  dest: string;
  before: LedgerFingerprint;
  /** El destino recien salido de `VACUUM INTO`, antes de tocarle el esquema.
   * Es contra esta huella que se verifica que la copia no perdio nada. */
  afterCopy: LedgerFingerprint;
  /** El destino ya abierto con el server nuevo (`migrate()` + `seedDatabase()`). */
  after: LedgerFingerprint;
  /**
   * Filas que agrego `seedDatabase()` al abrir la copia, por tabla. **No es un
   * error**: el seed rellena `strategy_config`, `savings` y `debts` con sus
   * defaults neutros cuando estan vacios, que es exactamente lo que hace el
   * server real al arrancar. Va reportado y no escondido porque un numero que
   * cambia en una migracion tiene que tener una explicacion escrita.
   */
  seeded: Record<string, number>;
  /** Tablas que el destino tiene y el origen no: la migracion de esquema. */
  tablesAdded: string[];
  /** Columnas de `transactions` que agrego `migrate()` (`addColumnIfMissing`).
   * El ledger de Mato es anterior a `account_holder` y a `is_discarded`. */
  columnsAdded: string[];
  /** `true` si `classify_silenced` existe en el destino (§3.8, hecho 2). */
  classifySilencedPresent: boolean;
  /** `true` si al cerrar no quedo `-wal` al lado del destino. */
  walConsolidated: boolean;
  /** Todos los conteos y huellas de `transactions` coinciden. */
  ok: boolean;
  /** Que no coincidio, si algo no coincidio. Vacio cuando `ok`. */
  mismatches: string[];
}

function userTables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((row) => row.name);
}

/**
 * Columnas de `transactions` que interesan para detectar que una fila cambio:
 * su identidad, su monto, su fecha y su estado. Se filtran contra el esquema
 * real porque el ledger de Mato es anterior a `account_holder` y a
 * `is_discarded` (las dos entran por `addColumnIfMissing`), y pedirle una
 * columna que no tiene revienta la consulta.
 */
const DIGEST_COLUMNS = [
  "gmail_msg_id",
  "ts",
  "amount",
  "currency",
  "type",
  "direction",
  "counterparty",
  "account_holder",
  "needs_review",
  "is_discarded",
] as const;

function digestColumnsOf(db: Database.Database): string[] {
  const presentes = new Set(
    (db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[]).map((c) => c.name)
  );
  return DIGEST_COLUMNS.filter((column) => presentes.has(column));
}

/**
 * La huella cubre las columnas que identifican una transaccion y su monto —
 * si una fila cambia de importe, de fecha o de estado de revision, el digest
 * cambia. `gmail_msg_id` es UNIQUE NOT NULL (`db/schema.ts:8`), asi que
 * ordenar por el da un orden total y estable entre las dos bases.
 */
function digestTransactions(db: Database.Database, columns: string[]): string {
  const hash = crypto.createHash("sha256");
  const lista = columns.map((column) => `"${column}"`).join(", ");
  const rows = db
    .prepare(`SELECT ${lista} FROM transactions ORDER BY gmail_msg_id`)
    .iterate() as Iterable<Record<string, unknown>>;
  for (const row of rows) {
    // JSON y no concatenacion: separa los campos sin ambiguedad y distingue
    // `0` de `null` de `""` en las columnas que admiten nulo (`counterparty`,
    // `category`). Concatenar los deja indistinguibles.
    hash.update(JSON.stringify(row));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function scalar(db: Database.Database, sql: string): number {
  const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
  const value = row ? Object.values(row)[0] : 0;
  return typeof value === "number" ? value : 0;
}

/**
 * Lee una base SIN escribirle: ni `migrate()` ni pragmas de escritura.
 *
 * `columns` fuerza el juego de columnas de la huella. Se le pasa el del origen
 * al medir el destino, para que un `ALTER TABLE ADD COLUMN` de `migrate()` no
 * se lea como "cambio el contenido de las filas".
 */
export function fingerprintLedger(db: Database.Database, columns?: string[]): LedgerFingerprint {
  const counts: Record<string, number> = {};
  for (const table of userTables(db)) {
    counts[table] = scalar(db, `SELECT COUNT(*) FROM "${table}"`);
  }
  const hasTransactions = counts.transactions !== undefined;
  const digestColumns = hasTransactions ? (columns ?? digestColumnsOf(db)) : [];
  const lastTsRow = hasTransactions
    ? (db.prepare("SELECT MAX(ts) AS last_ts FROM transactions").get() as { last_ts: string | null })
    : { last_ts: null };
  return {
    counts,
    transactionsDigest: hasTransactions ? digestTransactions(db, digestColumns) : "",
    transactionsColumns: digestColumns,
    needsReview: hasTransactions ? scalar(db, "SELECT COUNT(*) FROM transactions WHERE needs_review = 1") : 0,
    // La columna es aditiva (`addColumnIfMissing`): una base vieja puede no
    // tenerla todavia, y ahi el conteo correcto es 0, no un error.
    discarded:
      hasTransactions && hasColumn(db, "transactions", "is_discarded")
        ? scalar(db, "SELECT COUNT(*) FROM transactions WHERE is_discarded = 1")
        : 0,
    lastTs: lastTsRow.last_ts ?? null,
  };
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  return columns.some((c) => c.name === column);
}

function compare(before: LedgerFingerprint, after: LedgerFingerprint): string[] {
  const mismatches: string[] = [];
  for (const [table, count] of Object.entries(before.counts)) {
    const got = after.counts[table];
    if (got === undefined) mismatches.push(`la tabla ${table} no esta en el destino`);
    else if (got !== count) mismatches.push(`${table}: ${count} filas en el origen, ${got} en el destino`);
  }
  if (before.transactionsDigest !== after.transactionsDigest) {
    mismatches.push("la huella de transactions cambio: el contenido de alguna fila no es el mismo");
  }
  if (before.needsReview !== after.needsReview) {
    mismatches.push(`needs_review: ${before.needsReview} en el origen, ${after.needsReview} en el destino`);
  }
  if (before.lastTs !== after.lastTs) {
    mismatches.push(`el ultimo ts cambio: ${before.lastTs} -> ${after.lastTs}`);
  }
  return mismatches;
}

export interface SnapshotOptions {
  source: string;
  dest: string;
  /** Aplicar `migrate()` + `seedDatabase()` al destino. Default `true`: es lo
   * que crea `classify_silenced` en un ledger de esquema viejo. */
  applySchema?: boolean;
}

/**
 * Produce el snapshot y lo verifica. No borra nada: si el destino existe, la
 * propia `VACUUM INTO` de SQLite falla, y esa es la proteccion correcta —
 * pisar un snapshot anterior en silencio es como perder el WAL.
 */
export function createTenantSnapshot(options: SnapshotOptions): SnapshotResult {
  const source = resolveLedgerPath(options.source);
  const dest = resolveLedgerPath(options.dest);
  const applySchema = options.applySchema ?? true;

  if (!existsSync(source)) throw new Error(`el ledger de origen no existe: ${source}`);
  if (existsSync(dest)) throw new Error(`el destino ya existe, no se pisa: ${dest}`);

  // `readonly` es la garantia de que este script no puede modificar el ledger
  // de nadie: SQLite rechaza cualquier escritura sobre esta conexion.
  const src = new Database(source, { readonly: true });
  let before: LedgerFingerprint;
  const sourceTables = new Set<string>();
  try {
    for (const table of userTables(src)) sourceTables.add(table);
    before = fingerprintLedger(src);
    // El unico "efecto" del script sobre el origen: leerlo entero una vez.
    // VACUUM INTO ve el WAL porque lee por la misma conexion, no por el
    // archivo suelto.
    src.prepare("VACUUM INTO ?").run(dest);
  } finally {
    src.close();
  }

  const copy = new Database(dest);
  let afterCopy: LedgerFingerprint;
  let after: LedgerFingerprint;
  let tablesAdded: string[];
  let columnsAdded: string[] = [];
  let classifySilencedPresent: boolean;
  try {
    // Primero se mide la copia CRUDA. Es la unica comparacion que puede ser
    // estricta contra el origen: despues de esta linea el esquema cambia a
    // proposito, y mezclar los dos efectos en un solo numero es como se pierde
    // la trazabilidad de una migracion.
    afterCopy = fingerprintLedger(copy, before.transactionsColumns);
    if (applySchema) {
      // Los dos son idempotentes (`CREATE TABLE IF NOT EXISTS` + seed que no
      // pisa filas existentes), que es justo lo que hace el server real al
      // arrancar (`index.ts:87-93`). Correrlo aca es *verificar* que la
      // migracion de esquema ocurre, en vez de descubrirlo en produccion.
      migrate(copy);
      seedDatabase(copy);
    }
    after = fingerprintLedger(copy, before.transactionsColumns);
    columnsAdded = digestColumnsOf(copy).filter((column) => !before.transactionsColumns.includes(column));
    tablesAdded = Object.keys(after.counts).filter((table) => !sourceTables.has(table));
    classifySilencedPresent = after.counts.classify_silenced !== undefined;
    // Sin esto, cerrar deja un `-wal` al lado del snapshot y el archivo
    // "limpio" nace con el mismo problema que vinimos a resolver.
    copy.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    copy.close();
  }

  const walPath = `${dest}-wal`;
  const walConsolidated = !existsSync(walPath) || statSync(walPath).size === 0;

  const seeded: Record<string, number> = {};
  for (const [table, count] of Object.entries(after.counts)) {
    const antes = afterCopy.counts[table] ?? 0;
    if (count > antes) seeded[table] = count - antes;
  }

  const mismatches = compare(before, afterCopy);
  // El esquema puede crear tablas y el seed llenar sus defaults, pero el
  // ledger no se toca: si abrir la copia mueve una transaccion, la migracion
  // esta mal y hay que parar (paso 6 de §3.8).
  if (after.transactionsDigest !== afterCopy.transactionsDigest) {
    mismatches.push("abrir la copia con el server nuevo modifico transactions");
  }
  if (!walConsolidated) mismatches.push(`quedo un -wal con datos al lado del destino: ${walPath}`);
  if (applySchema && !classifySilencedPresent) {
    mismatches.push("classify_silenced no existe en el destino: migrate() no corrio");
  }

  return {
    source,
    dest,
    before,
    afterCopy,
    after,
    seeded,
    tablesAdded,
    columnsAdded,
    classifySilencedPresent,
    walConsolidated,
    ok: mismatches.length === 0,
    mismatches,
  };
}

function parseArgs(argv: string[]): SnapshotOptions {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const source = get("--source");
  const dest = get("--dest");
  if (!source || !dest) {
    throw new Error(
      "uso: npm run tenant-snapshot -- --source <ledger.sqlite> --dest <snapshot.sqlite> [--sin-esquema]"
    );
  }
  return { source, dest, applySchema: !argv.includes("--sin-esquema") };
}

function main(): void {
  // El stdout de este CLI es un resultado JSON, no un log (CLAUDE.md).
  process.env.WALLET_TELEMETRY_SILENT = "1";
  const result = createTenantSnapshot(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  // Un ledger vacio es legitimo (un tenant nuevo), pero en una migracion es
  // casi siempre la ruta equivocada. El aviso va a stderr para no ensuciar el
  // JSON de stdout.
  if ((result.before.counts.transactions ?? 0) === 0) {
    console.error(`AVISO: ${result.source} no tiene ni una transaccion. Si esperabas un ledger con datos, revisa la ruta.`);
  }
  if (!result.ok) process.exitCode = 1;
}

// Mismo guard que gmail-auth.ts: importar el modulo desde el test no puede
// tocar ninguna base.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
