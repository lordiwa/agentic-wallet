import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./open.js";

let tmpDir: string | undefined;

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("openDb", () => {
  it("opens a database at the given path and runs migrations", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "agentic-wallet-db-test-"));
    const dbPath = path.join(tmpDir, "wallet.sqlite");
    const db = openDb(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row: any) => row.name);
    expect(tables).toContain("transactions");
    db.close();
  });

  it("is safe to open twice at the same path (idempotent migration)", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "agentic-wallet-db-test-"));
    const dbPath = path.join(tmpDir, "wallet.sqlite");
    const db1 = openDb(dbPath);
    db1.close();
    expect(() => {
      const db2 = openDb(dbPath);
      db2.close();
    }).not.toThrow();
  });

  it("ancla una ruta relativa a la raiz del repo, no al cwd", () => {
    // Sin esto cada entrypoint (server, onboard, MCP) corre con un cwd
    // distinto y abre su propia base vacia con el mismo WALLET_DB_PATH.
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "agentic-wallet-db-test-"));
    const repoRootDir = path.resolve(import.meta.dirname, "../../..");
    const relative = path.relative(repoRootDir, path.join(tmpDir, "relativa.sqlite"));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const db = openDb(relative);
      db.close();
      expect(existsSync(path.resolve(repoRootDir, relative))).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("falls back to WALLET_DB_PATH from config when no path is given", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "agentic-wallet-db-test-"));
    const dbPath = path.join(tmpDir, "from-env.sqlite");
    const prev = process.env.WALLET_DB_PATH;
    process.env.WALLET_DB_PATH = dbPath;
    try {
      const db = openDb();
      expect(existsSync(dbPath)).toBe(true);
      db.close();
    } finally {
      if (prev === undefined) delete process.env.WALLET_DB_PATH;
      else process.env.WALLET_DB_PATH = prev;
    }
  });
});
