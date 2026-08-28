import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const DB_PATH_KEYS = ["WALLET_DB_PATH", "BOLSILLO_DB_PATH"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(DB_PATH_KEYS.map((key) => [key, process.env[key]]));
  for (const key of DB_PATH_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of DB_PATH_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("loadConfig: ruta de la base", () => {
  it("usa WALLET_DB_PATH cuando esta seteada", () => {
    process.env.WALLET_DB_PATH = "./nuevo.sqlite";
    expect(loadConfig().WALLET_DB_PATH).toBe("./nuevo.sqlite");
  });

  // El .env que trae un usuario que viene de iwa-wallet nombra la variable
  // BOLSILLO_DB_PATH. Ignorarla no fallaba: abria una base vacia en la ruta
  // por defecto, que se ve exactamente igual que "no sincronizaste nunca".
  it("acepta BOLSILLO_DB_PATH (nombre viejo) para no romper la migracion", () => {
    process.env.BOLSILLO_DB_PATH = "./bolsillo.sqlite";
    expect(loadConfig().WALLET_DB_PATH).toBe("./bolsillo.sqlite");
  });

  it("con las dos seteadas gana el nombre nuevo", () => {
    process.env.WALLET_DB_PATH = "./nuevo.sqlite";
    process.env.BOLSILLO_DB_PATH = "./viejo.sqlite";
    expect(loadConfig().WALLET_DB_PATH).toBe("./nuevo.sqlite");
  });

  it("trata una variable vacia como no seteada", () => {
    process.env.WALLET_DB_PATH = "   ";
    process.env.BOLSILLO_DB_PATH = "./bolsillo.sqlite";
    expect(loadConfig().WALLET_DB_PATH).toBe("./bolsillo.sqlite");
  });

  it("sin ninguna de las dos cae al default", () => {
    expect(loadConfig().WALLET_DB_PATH).toBe("./wallet.sqlite");
  });
});
