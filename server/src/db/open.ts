import path from "node:path";
import Database from "better-sqlite3";
import { loadConfig, repoRoot } from "../config.js";
import { migrate } from "./schema.js";

/**
 * Una ruta relativa se ancla a la raiz del repo, no al cwd. Cada entrypoint
 * arranca desde un directorio distinto -- `npm run dev` y `npm run onboard`
 * corren con cwd en `server/` (son scripts del workspace), el server compilado
 * desde la raiz, y el MCP desde el cwd arbitrario del agente -- asi que un
 * `WALLET_DB_PATH=./bolsillo.sqlite` relativo al cwd abre una base DISTINTA
 * (y vacia) por entrypoint: el onboarding reporta "nunca sincronizaste"
 * mientras el MCP ve el ledger completo. Es el mismo fallo silencioso que
 * ignorar `BOLSILLO_DB_PATH` (ver config.ts), y se corrige en el mismo lugar
 * para todos.
 *
 * `:memory:` y las URIs `file:` no son rutas del filesystem y pasan intactas.
 */
function resolveDbPath(dbPath: string): string {
  if (dbPath === ":memory:" || dbPath.startsWith("file:")) return dbPath;
  return path.resolve(repoRoot(), dbPath);
}

/**
 * Opens the SQLite database at `dbPath` (defaults to the configurable
 * WALLET_DB_PATH env var), enables WAL so reads and writes don't block each
 * other, and runs the schema migration. Writes are synchronous via
 * better-sqlite3, so callers don't need to await anything.
 */
export function openDb(dbPath?: string): Database.Database {
  const resolvedPath = resolveDbPath(dbPath ?? loadConfig().WALLET_DB_PATH);
  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}
