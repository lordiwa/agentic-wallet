import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, repoRoot, shouldLoadRootEnv } from "./config.js";

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

// El fallo que cierra esto no era un test rojo: era 107 tests rojos que
// dependian del `.env` de la maquina (docs/pivot-saas.md, P24). Verde en CI no
// probaba que produccion arranca, y el rojo local se aprendia a ignorar.
describe("shouldLoadRootEnv: quien puede leer el .env de la raiz", () => {
  it("el server real lo lee", () => {
    expect(shouldLoadRootEnv({})).toBe(true);
    expect(shouldLoadRootEnv({ NODE_ENV: "production" })).toBe(true);
  });

  it("la suite no lo lee: VITEST alcanza", () => {
    expect(shouldLoadRootEnv({ VITEST: "true" })).toBe(false);
  });

  // Para cualquier otro corredor de tests, sin acoplar la decision a vitest.
  it("NODE_ENV=test tambien lo apaga", () => {
    expect(shouldLoadRootEnv({ NODE_ENV: "test" })).toBe(false);
  });

  // Una variable seteada en vacio no es una decision de nadie.
  it("VITEST vacio no cuenta como estar bajo el runner", () => {
    expect(shouldLoadRootEnv({ VITEST: "" })).toBe(true);
  });

  /**
   * El candado de verdad: corriendo *esta* suite, con el `.env` real de la
   * maquina presente, ninguna de sus claves llego a `process.env`. En una
   * maquina sin `.env` (CI) no hay nada que comprobar y el test pasa solo —
   * es la maquina del desarrollador la que tiene el archivo, y es ahi donde
   * la regresion aparecia.
   */
  it("ninguna clave del .env real se cuela en la suite", () => {
    const envPath = path.join(repoRoot(), ".env");
    if (!existsSync(envPath)) return;
    const declaradas = readFileSync(envPath, "utf8")
      .split("\n")
      .map((linea) => linea.trim())
      .filter((linea) => linea !== "" && !linea.startsWith("#") && linea.includes("="))
      .map((linea) => {
        const corte = linea.indexOf("=");
        return { clave: linea.slice(0, corte).trim(), valor: linea.slice(corte + 1).trim() };
      })
      // Vacia en el `.env` es indistinguible de no seteada, y las de la ruta
      // de la base las setean los tests de arriba a proposito.
      .filter(({ clave, valor }) => valor !== "" && !DB_PATH_KEYS.includes(clave as (typeof DB_PATH_KEYS)[number]));
    // Se comparan VALORES —que una variable exista en el shell no es una fuga;
    // que valga lo mismo que el `.env`, si— y se reportan solo los NOMBRES.
    const filtradas = declaradas.filter(({ clave, valor }) => process.env[clave] === valor).map(({ clave }) => clave);
    expect(filtradas).toEqual([]);
  });
});
