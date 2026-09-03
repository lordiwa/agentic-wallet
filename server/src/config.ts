import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Raiz del repo. Normalmente se deduce de la ubicacion de este archivo
 * (`server/src` -> dos niveles arriba), pero el MCP server corre desde un
 * bundle CJS de esbuild y ahi `import.meta` esta vacio: `import.meta.dirname`
 * es `undefined` y `path.resolve` reventaria al cargar el modulo. Por eso el
 * entrypoint bundleado pasa la raiz explicita por env, igual que hace el
 * protocolo MCP con `CLAUDE_PROJECT_DIR`.
 */
export function repoRoot(): string {
  const fromEnv = process.env.WALLET_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return path.resolve(fromEnv);
  // En el bundle CJS `import.meta.dirname` es undefined; ahi el cwd es el
  // ultimo recurso razonable (y `.mcp.json` siempre pasa la raiz explicita,
  // asi que este camino es la red de seguridad, no el normal).
  const here: string | undefined = import.meta.dirname;
  return here ? path.resolve(here, "../..") : process.cwd();
}

// Load .env from repo root (Node 22 native, no dotenv dependency needed).
const rootEnvPath = path.join(repoRoot(), ".env");
if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  /**
   * Interfaz donde escucha el server. El default es 127.0.0.1 A PROPOSITO:
   * `app.listen(port)` sin host escucha en 0.0.0.0, lo que en una VPS con IP
   * publica deja la API abierta a internet. La API no tiene ninguna
   * autenticacion (ver docs/handoff-migracion-server.md), asi que exponerla
   * equivale a publicar el historial bancario, el Gmail via POST /api/sync y
   * el credito de Claude via POST /api/chat.
   *
   * En la VPS se deja en 127.0.0.1 y el acceso remoto se da con
   * `tailscale serve`, que proxea desde el tailnet hacia localhost sin abrir
   * ningun puerto publico. Ponerlo en 0.0.0.0 es una decision explicita, no
   * un accidente de configuracion.
   */
  WALLET_BIND_HOST: z.string().default("127.0.0.1"),
  /**
   * Origenes que pueden leer la API desde un navegador (lista blanca
   * coma-separada, ver api/cors.ts). Va vacia por defecto: sin esto no se
   * emite ninguna cabecera CORS y solo funciona el dashboard servido por el
   * propio server. Se setea cuando el frontend vive en otro origen (Firebase
   * Hosting, ver docs/frontend-desplegado.md).
   */
  WALLET_ALLOWED_ORIGINS: z.string().optional(),
  /**
   * La llave del server (fase N0 del plan final). Sin valor la API queda como
   * hasta hoy: sin autenticacion, protegida solo por `WALLET_BIND_HOST`. Con
   * valor, todo `/api/*` exige `Authorization: Bearer <token>` — menos
   * `GET /api/health`, que queda abierto a proposito porque es el unico
   * diagnostico posible desde un navegador (ver api/auth.ts).
   *
   * Opcional y sin default a proposito: inventar una llave aca seria una
   * credencial precargada que el usuario no eligio, y ademas romperia el uso
   * local de siempre. El valor lo genera el usuario (32 bytes al azar) y vive
   * en `.env`, nunca en el repo.
   */
  WALLET_ACCESS_TOKEN: z.string().optional(),
  /**
   * Tope de peticiones por segundo y por IP (ver api/rate-limit.ts). `0` —el
   * default— lo apaga, igual que las dos variables de arriba: en local el
   * unico cliente sos vos y un tope nacido activo solo puede romper un uso
   * que ya andaba.
   *
   * Se enciende con la misma decision que abre el puerto. Protege a la llave,
   * no la reemplaza: sin tope, los intentos de adivinarla son gratis.
   */
  WALLET_RATE_LIMIT_RPS: z.coerce.number().default(0),
  /** Pico tolerado antes de que mande el promedio. Vacio = el doble de
   * `WALLET_RATE_LIMIT_RPS`, que es lo que deja arrancar al panel (pide
   * varios endpoints de una) sin ampliar el sostenido. */
  WALLET_RATE_LIMIT_BURST: z.coerce.number().optional(),
  /**
   * Leer la IP del cliente de `X-Forwarded-For`. Va en `false` a proposito:
   * activarlo sin un proxy propio delante deja que cualquiera elija su propia
   * IP —y con ella un cubo nuevo por peticion—, que es peor que no limitar.
   * Se pone en `true` solo cuando Caddy/nginx es el unico camino al puerto.
   */
  WALLET_TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Sin `.default()` a proposito: el default se aplica en `loadConfig` recien
   * despues de mirar `BOLSILLO_DB_PATH`. Un default aca ganaria siempre y el
   * nombre viejo no se leeria nunca. */
  WALLET_DB_PATH: z.string().optional(),
  /**
   * Nombre viejo de la misma variable, el que trae el `.env` de iwa-wallet.
   * Se sigue aceptando para que migrar sea copiar el `.env` y nada mas:
   * ignorarlo no fallaba de forma visible — abria una base vacia en la ruta
   * por defecto, indistinguible de "nunca sincronizaste".
   */
  BOLSILLO_DB_PATH: z.string().optional(),
  /**
   * Topes del sync incremental (ver sync/run-sync.ts). Sin valor, mandan los
   * defaults del motor — no se repiten aca para no tener dos fuentes de
   * verdad del mismo numero. Se tocan cuando el cliente que llama al sync
   * tiene un timeout distinto al tipico de 60s del MCP.
   */
  WALLET_SYNC_BATCH_SIZE: z.coerce.number().int().positive().optional(),
  WALLET_SYNC_MAX_MS: z.coerce.number().int().positive().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
  GMAIL_OAUTH_CLIENT_ID: z.string().optional(),
  GMAIL_OAUTH_CLIENT_SECRET: z.string().optional(),
  GMAIL_OAUTH_REFRESH_TOKEN: z.string().optional(),
});

const DEFAULT_DB_PATH = "./wallet.sqlite";

/** Primer valor con contenido real: una variable seteada en vacio (`FOO=` en
 * el `.env`) cuenta como no seteada, no como ruta vacia. */
function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim() !== "");
}

/** `WALLET_DB_PATH` ya viene resuelto: el resto del codigo no necesita saber
 * que existe un nombre viejo. */
export type Config = z.infer<typeof envSchema> & { WALLET_DB_PATH: string };

export function loadConfig(): Config {
  const env = envSchema.parse(process.env);
  return {
    ...env,
    WALLET_DB_PATH: firstNonEmpty(env.WALLET_DB_PATH, env.BOLSILLO_DB_PATH) ?? DEFAULT_DB_PATH,
  };
}
