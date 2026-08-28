import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DEBTS } from "./default-config.js";
import { runSeedCli } from "./cli.js";

// Same temp-DB pattern as seed.test.ts's "real openDb-managed database file"
// integration smoke test -- runSeedCli is a thin wrapper around openDb +
// seedDatabase, both already fully covered, so this just proves the wiring
// (an actual DB file gets seeded and a summary is returned) works end to end.

let tmpDir: string;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("runSeedCli", () => {
  it("seeds a real database file and returns the summary", () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "agentic-wallet-seed-cli-test-"));
    const dbPath = path.join(tmpDir, "wallet.sqlite");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const result = runSeedCli(dbPath);

      expect(existsSync(dbPath)).toBe(true);
      expect(result.debtsInserted).toBe(DEFAULT_DEBTS.length);
      expect(result.savingsWritten).toBe(1);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Seed OK"));

      const db = new Database(dbPath, { readonly: true });
      const count = db.prepare("SELECT COUNT(*) as c FROM debts").get() as { c: number };
      expect(count.c).toBe(DEFAULT_DEBTS.length);
      db.close();
    } finally {
      logSpy.mockRestore();
    }
  });
});
