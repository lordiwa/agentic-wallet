import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { insertTransaction, type NewTransaction } from "../db/repository.js";
import { getStrategyConfig } from "../db/strategy-config.js";
import { listCategoryRules } from "../category/rules-repository.js";
import { parseRule, parseSetPatch, runOnboardCli, type OnboardCliDeps } from "./cli.js";

let db: Database.Database;
let workdir: string;
let output: string[];

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  workdir = mkdtempSync(path.join(tmpdir(), "onboard-cli-"));
  output = [];
});

afterEach(() => {
  db.close();
  rmSync(workdir, { recursive: true, force: true });
});

/**
 * The CLI closes the database it opens. Tests need it to survive so they can
 * assert on what was written, so it gets a proxy whose `close` is a no-op.
 * Every other member is forwarded with `this` bound to the real handle --
 * better-sqlite3 is a native binding and rejects a foreign receiver.
 */
function nonClosingHandle(real: Database.Database): Database.Database {
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "close") return () => {};
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function deps(overrides: Partial<OnboardCliDeps> = {}): OnboardCliDeps {
  return {
    openDatabase: () => nonClosingHandle(db),
    env: {},
    envPath: path.join(workdir, ".env"),
    envExamplePath: path.join(workdir, ".env.example"),
    log: (line) => output.push(line),
    // Sin credenciales por defecto: el unico subcomando que lo usa
    // (--heal-counterparties) tiene que reportar "gmail_not_configured".
    buildGmailClient: async () => null,
    ...overrides,
  };
}

/** Parses the single JSON blob the command printed. */
function printedJson(): any {
  return JSON.parse(output.join("\n"));
}

describe("--init-env", () => {
  it("copies .env.example to .env when there is none", async () => {
    const d = deps();
    writeFileSync(d.envExamplePath, "WALLET_DB_PATH=./wallet.sqlite\n");

    expect(await runOnboardCli(["--init-env"], d)).toBe(0);
    expect(printedJson().created).toBe(true);
    expect(readFileSync(d.envPath, "utf8")).toContain("WALLET_DB_PATH");
  });

  it("never overwrites an existing .env -- it holds the user's OAuth tokens", async () => {
    const d = deps();
    writeFileSync(d.envExamplePath, "WALLET_DB_PATH=./wallet.sqlite\n");
    writeFileSync(d.envPath, "GMAIL_OAUTH_REFRESH_TOKEN=secreto-real\n");

    expect(await runOnboardCli(["--init-env"], d)).toBe(0);
    expect(printedJson().created).toBe(false);
    expect(readFileSync(d.envPath, "utf8")).toContain("secreto-real");
  });
});

describe("--status", () => {
  it("reports every step as pending on a fresh install", async () => {
    expect(await runOnboardCli(["--status"], deps())).toBe(0);

    const status = printedJson();
    expect(status.complete).toBe(false);
    expect(status.next.id).toBe("env");
    expect(status.steps.map((s: any) => s.id)).toEqual(["env", "claude", "gmail", "sync", "huso", "profile"]);
  });

  it("advances to the sync step once .env and both credentials are present", async () => {
    const d = deps({
      env: {
        CLAUDE_CODE_OAUTH_TOKEN: "tok",
        GMAIL_OAUTH_CLIENT_ID: "id",
        GMAIL_OAUTH_CLIENT_SECRET: "secret",
        GMAIL_OAUTH_REFRESH_TOKEN: "refresh",
      },
    });
    writeFileSync(d.envPath, "");

    await runOnboardCli(["--status"], d);
    expect(printedJson().next.id).toBe("sync");
  });
});

describe("--suggest", () => {
  it("emits a proposal read off the user's own ledger", async () => {
    insertTransaction(db, {
      gmail_msg_id: "s1",
      ts: "2026-05-15T12:00:00Z",
      direction: "in",
      type: "sueldo",
      amount: 1000,
      counterparty: "EMPRESA EJEMPLO SA",
      account: "PEREZ GOMEZ ANA MARIA",
    } satisfies NewTransaction);
    insertTransaction(db, {
      gmail_msg_id: "s2",
      ts: "2026-06-15T12:00:00Z",
      direction: "in",
      type: "sueldo",
      amount: 1000,
      counterparty: "EMPRESA EJEMPLO SA",
      account: "PEREZ GOMEZ ANA MARIA",
    } satisfies NewTransaction);

    expect(await runOnboardCli(["--suggest"], deps())).toBe(0);

    const suggestion = printedJson();
    expect(suggestion.titular).toBe("PEREZ GOMEZ ANA MARIA");
    expect(suggestion.salary.diasPago).toEqual(["15-15"]);
  });

  it("fails cleanly when there is no database yet", async () => {
    const d = deps({
      openDatabase: () => {
        throw new Error("no db");
      },
    });
    expect(await runOnboardCli(["--suggest"], d)).toBe(1);
    expect(printedJson().ok).toBe(false);
  });
});

describe("--set", () => {
  it("writes the confirmed profile into strategy_config", async () => {
    const patch = JSON.stringify({
      titular: "PEREZ GOMEZ ANA MARIA",
      colchonObjetivo: 1500,
      sueldo: { fuente: "EMPRESA EJEMPLO SA", cadencia: "quincenal", montoEstimado: 1000, diasPago: ["15-15", "30-30"] },
    });

    expect(await runOnboardCli(["--set", patch], deps())).toBe(0);

    const config = getStrategyConfig(db);
    expect(config.titular).toBe("PEREZ GOMEZ ANA MARIA");
    expect(config.colchonObjetivo).toBe(1500);
    expect(config.sueldo.diasPago).toEqual(["15-15", "30-30"]);
  });

  it("leaves untouched fields alone -- the profile is filled in stages", async () => {
    await runOnboardCli(["--set", JSON.stringify({ titular: "ANA" })], deps());
    await runOnboardCli(["--set", JSON.stringify({ colchonObjetivo: 900 })], deps());

    const config = getStrategyConfig(db);
    expect(config.titular).toBe("ANA");
    expect(config.colchonObjetivo).toBe(900);
  });

  it("rejects an unknown field instead of silently ignoring a typo", async () => {
    expect(await runOnboardCli(["--set", JSON.stringify({ colchonObjetibo: 100 })], deps())).toBe(1);
    expect(printedJson().error).toContain("colchonObjetibo");
  });

  it("rejects a wrongly-typed value rather than letting NaN reach the math", async () => {
    expect(await runOnboardCli(["--set", JSON.stringify({ colchonObjetivo: "mucho" })], deps())).toBe(1);
    expect(getStrategyConfig(db).colchonObjetivo).toBe(0);
  });

  it("rejects malformed JSON with a usable hint", async () => {
    expect(await runOnboardCli(["--set", "{not json"], deps())).toBe(1);
    expect(printedJson().error).toContain("JSON valido");
  });
});

describe("--rule", () => {
  it("stores a merchant rule the categorizer will then apply", async () => {
    expect(await runOnboardCli(["--rule", "veterinaria=mascota"], deps())).toBe(0);
    expect(listCategoryRules(db)).toEqual([{ pattern: "veterinaria", category: "mascota" }]);
  });

  it("normalizes the pattern so casing and accents match either way", async () => {
    await runOnboardCli(["--rule", "Farmacía=salud"], deps());
    expect(listCategoryRules(db)[0].pattern).toBe("farmacia");
  });

  it("rejects a category outside the glossary", async () => {
    expect(await runOnboardCli(["--rule", "algo=inventada"], deps())).toBe(1);
    expect(printedJson().error).toContain("categoria desconocida");
  });

  it("rejects a blank pattern -- it would swallow the whole ledger", async () => {
    expect(await runOnboardCli(["--rule", "=mascota"], deps())).toBe(1);
  });
});

describe("--learn-rules", () => {
  it("convierte el historial ya clasificado en reglas y reporta el conteo", async () => {
    insertTransaction(db, {
      gmail_msg_id: "clasificada-a-mano",
      ts: "2026-06-01T12:00:00Z",
      direction: "out",
      type: "transferencia",
      amount: 30,
      counterparty: "CENTRO MEDICO SUR",
      category: "salud",
    } satisfies NewTransaction);

    expect(await runOnboardCli(["--learn-rules"], deps())).toBe(0);
    expect(printedJson()).toMatchObject({ ok: true, learned: 1 });
    expect(listCategoryRules(db)).toEqual([{ pattern: "centro medico sur", category: "salud" }]);
  });
});

describe("--backfill", () => {
  it("applies newly-added rules to rows that were synced before them", async () => {
    insertTransaction(db, {
      gmail_msg_id: "old-row",
      ts: "2026-06-01T12:00:00Z",
      direction: "out",
      type: "debito",
      amount: 30,
      counterparty: "VETERINARIA CENTRAL",
    } satisfies NewTransaction);

    // The row was ingested with no rule configured, so it is 'otros'.
    await runOnboardCli(["--rule", "veterinaria=mascota"], deps());
    expect(await runOnboardCli(["--backfill"], deps())).toBe(0);

    const row = db.prepare("SELECT category FROM transactions WHERE gmail_msg_id = ?").get("old-row") as {
      category: string;
    };
    expect(row.category).toBe("mascota");
  });

  it("does not run against a database that isn't there yet", async () => {
    const d = deps({
      openDatabase: () => {
        throw new Error("no db");
      },
    });
    expect(await runOnboardCli(["--backfill"], d)).toBe(1);
  });
});

describe("--heal-counterparties", () => {
  const email = {
    gmail_msg_id: "sin-comercio",
    gmail_thread_id: null,
    subject: "Consumo Tarjeta de Crédito por USD 11.99",
    // Un campo por linea con su valor, que es como sale de `htmlToText`: el
    // salto del codigo fuente del HTML ya no parte el label de su valor.
    body: "Detalle\nValor: USD 11.99\nEstablecimiento: NETFLIX.COM\nAtentamente Produbanco",
    ts: "2026-06-01T12:00:00Z",
  };

  function seedRowWithoutCounterparty(): void {
    insertTransaction(db, {
      gmail_msg_id: "sin-comercio",
      ts: "2026-06-01T12:00:00Z",
      direction: "out",
      type: "credito",
      amount: 11.99,
      counterparty: null,
    } satisfies NewTransaction);
  }

  it("le devuelve el nombre del comercio a una fila que lo perdio", async () => {
    seedRowWithoutCounterparty();
    const d = deps({ buildGmailClient: async () => ({ getMessage: async () => email }) });

    expect(await runOnboardCli(["--heal-counterparties"], d)).toBe(0);

    const row = db.prepare("SELECT counterparty FROM transactions WHERE gmail_msg_id = ?").get("sin-comercio") as {
      counterparty: string;
    };
    expect(row.counterparty).toBe("NETFLIX.COM");
    expect(printedJson()).toMatchObject({ ok: true, healed: 1 });
  });

  // El nombre solo, sin recategorizar, no mueve el gasto: por eso el
  // subcomando apunta explicitamente al paso siguiente.
  it("apunta a --reclassify como paso siguiente", async () => {
    seedRowWithoutCounterparty();
    const d = deps({ buildGmailClient: async () => ({ getMessage: async () => email }) });

    await runOnboardCli(["--heal-counterparties"], d);

    expect(printedJson().next).toContain("--reclassify");
  });

  it("reporta gmail_not_configured en vez de reventar sin credenciales", async () => {
    seedRowWithoutCounterparty();

    expect(await runOnboardCli(["--heal-counterparties"], deps())).toBe(1);
    expect(printedJson()).toMatchObject({ ok: false, error: "gmail_not_configured" });
  });

  it("no corre contra una base que todavia no existe", async () => {
    const d = deps({
      openDatabase: () => {
        throw new Error("no db");
      },
    });
    expect(await runOnboardCli(["--heal-counterparties"], d)).toBe(1);
  });
});

describe("argument parsing", () => {
  it("parseRule splits on the first '=' so patterns may contain one", async () => {
    expect(parseRule("a=b=salud")).toEqual({ pattern: "a=b", category: "salud" });
  });

  it("parseSetPatch accepts the exact shape --suggest emits for sueldo", async () => {
    const patch = parseSetPatch(
      JSON.stringify({ sueldo: { fuente: "X", cadencia: "mensual", montoEstimado: 1, diasPago: ["1"] } })
    );
    expect(patch.sueldo?.cadencia).toBe("mensual");
  });
});

describe("unknown command", () => {
  it("prints usage and exits non-zero", async () => {
    expect(await runOnboardCli(["--nope"], deps())).toBe(1);
    expect(output.join("\n")).toContain("npm run onboard");
  });
});
