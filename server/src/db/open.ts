import Database from "better-sqlite3";
import { loadConfig } from "../config.js";
import { migrate } from "./schema.js";

/**
 * Opens the SQLite database at `dbPath` (defaults to the configurable
 * WALLET_DB_PATH env var), enables WAL so reads and writes don't block each
 * other, and runs the schema migration. Writes are synchronous via
 * better-sqlite3, so callers don't need to await anything.
 */
export function openDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? loadConfig().WALLET_DB_PATH;
  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}
