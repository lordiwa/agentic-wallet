import type Database from "better-sqlite3";
import { z } from "zod";
import { DEFAULT_STRATEGY_CONFIG } from "../seed/default-config.js";
import { esVentanaDePago } from "../strategy/calendar.js";
import { logInfo, withSpanSync } from "./telemetry.js";

/** Rejects NaN/Infinity too -- money arithmetic on either is silent garbage. */
const financeNumber = z.number().finite();

const strategyConfigSchema = z.object({
  moneda: z.string(),
  zonaHoraria: z.string(),
  colchonObjetivo: financeNumber,
  topeTransferenciasMensual: financeNumber,
  sueldo: z.object({
    fuente: z.string(),
    cadencia: z.string(),
    montoEstimado: financeNumber,
    diasPago: z.array(z.string()),
  }),
  titular: z.string(),
  // Point-in-time snapshot of the bank balance (spec 4.6), the starting point for balance calculations.
  balanceSnapshot: z.object({
    amount: financeNumber,
    at: z.string(),
  }),
});

/**
 * Typed shape of `strategy_config`, the contract the F2-C strategy engine
 * consumes. Every field is always present and shape-validated -- see
 * `getStrategyConfig`.
 */
export type StrategyConfig = z.infer<typeof strategyConfigSchema>;
export type StrategySalaryConfig = StrategyConfig["sueldo"];
export type StrategyBalanceSnapshot = StrategyConfig["balanceSnapshot"];

/** Per-field schemas, so a single mistyped field defaults on its own without invalidating the rest. */
const fieldSchemas = strategyConfigSchema.shape;

/**
 * **Lo que se escribe se valida más duro que lo que se lee** (wargaming ronda 4,
 * W30).
 *
 * `setStrategyConfig` es el borde que comparten las tres superficies de
 * escritura —el panel por `writeProfile`, la tool MCP `set_profile` y
 * `npm run onboard -- --set`—, y hasta esta ronda sólo validaba la FORMA. La
 * regla de qué día de pago es válido vivía en `writeProfile`, o sea en el
 * camino del panel y en ninguno de los otros dos: por MCP y por CLI entraba un
 * `"15"` que `parseDiasPago` descarta en silencio (calendario mudo, perfil
 * "configurado"), un `"99-99"` que `localCalendarDate` clampea al último día del
 * mes, y un colchón negativo que deja `colchonStatus` diciendo
 * `financiado: true`.
 *
 * Por qué acá y no en cada superficie: porque el arreglo de la ronda 2 fue
 * arreglar el caso y el de la ronda 3 fue encontrarlo vivo en otra superficie.
 * El único lugar donde la guarda las cubre a todas es el escritor.
 *
 * Por qué NO se endurece también la lectura: una base ya escrita con un
 * `diasPago: ["15"]` fallaría el schema entero de `sueldo` y se leería el
 * default, perdiendo el monto y la fuente que el usuario sí confirmó. Lo viejo
 * se sigue leyendo tal cual y se reporta honestamente (`readProfile`,
 * `profileConfigured`: fijado = el calendario puede leer una ventana).
 */
const writeSchemas: Partial<{ [K in keyof StrategyConfig]: z.ZodType<StrategyConfig[K]> }> = {
  colchonObjetivo: financeNumber.nonnegative({
    message: "colchonObjetivo no puede ser negativo: cero es 'no fijé objetivo'",
  }),
  sueldo: fieldSchemas.sueldo.extend({
    diasPago: z.array(
      // La referencia se resuelve DENTRO del closure y no al construir el
      // schema. `strategy/calendar.ts` importa `getStrategyConfig` de este
      // módulo, así que los dos forman un ciclo: al pasar `esVentanaDePago`
      // directo, un consumidor que entre por `calendar.js` primero construye
      // este `refine` con la referencia todavía sin inicializar y
      // `setStrategyConfig` explota con "check is not a function" — para todas
      // sus superficies, no sólo para ese consumidor. La llamada diferida
      // ocurre recién al validar, cuando el ciclo ya se cerró.
      z.string().refine((spec) => esVentanaDePago(spec), {
        message:
          "cada dia de pago es una ventana que el calendario sepa leer: \"15-15\" (el 15), " +
          "\"18-20\" (entre el 18 y el 20) o \"<=5\" (los primeros 5), con dias entre 1 y 31. " +
          "Un dia suelto como \"15\" no parsea y deja el calendario de pagos mudo",
      })
    ),
  }),
};

interface StrategyConfigRow {
  key: string;
  value: string;
}

type DefaultConfigKey = keyof StrategyConfig;

/**
 * Reads strategy_config into a typed, shape-validated `StrategyConfig`
 * (TASK-021 AC4; hardened per review MEDIUM-1): each key's JSON value is
 * parsed AND validated against its Zod schema, falling back to the spec 4.6
 * seed default (seed/default-config.ts, the same defaults `seedDatabase`
 * writes) when the key is missing, its stored value fails to parse as JSON,
 * OR it parses but doesn't match the expected shape/type (e.g. a
 * hand-edited `colchonObjetivo: "abc"` or `balanceSnapshot: 42`). Without
 * this, a valid-JSON-but-wrong-typed value would cast straight through to
 * F2-C's money arithmetic as silent NaN/garbage. This guarantees every field
 * of the returned object is always present and *actually* correctly typed.
 *
 * Never logs the parsed values themselves (titular, sueldo, balance amount
 * are personal financial data) -- only which keys were present-but-defaulted.
 */
export function getStrategyConfig(db: Database.Database): StrategyConfig {
  return withSpanSync("strategy_config.get", {}, () => {
    const rows = db.prepare("SELECT key, value FROM strategy_config").all() as StrategyConfigRow[];
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const defaultedKeys: string[] = [];

    function read<K extends DefaultConfigKey>(key: K): StrategyConfig[K] {
      const raw = byKey.get(key);
      if (raw !== undefined) {
        try {
          const parsed: unknown = JSON.parse(raw);
          const result = fieldSchemas[key].safeParse(parsed);
          if (result.success) return result.data as StrategyConfig[K];
        } catch {
          // Corrupt JSON falls through to the default below.
        }
      }
      defaultedKeys.push(key);
      return DEFAULT_STRATEGY_CONFIG[key];
    }

    const config: StrategyConfig = {
      moneda: read("moneda"),
      zonaHoraria: read("zonaHoraria"),
      colchonObjetivo: read("colchonObjetivo"),
      topeTransferenciasMensual: read("topeTransferenciasMensual"),
      sueldo: read("sueldo"),
      titular: read("titular"),
      balanceSnapshot: read("balanceSnapshot"),
    };

    if (defaultedKeys.length > 0) {
      logInfo("strategy_config.get.defaulted", { keys: defaultedKeys });
    }

    return config;
  });
}

/**
 * Writes a subset of `strategy_config`, validating each field against the
 * same per-field schema `getStrategyConfig` reads it back with -- so a bad
 * value is rejected here, at the boundary, instead of silently defaulting on
 * every later read. This is what `npm run onboard` uses to turn the neutral
 * seed placeholders into the user's real numbers.
 *
 * Partial on purpose: onboarding fills the profile in stages (titular from
 * the first sync, payday once salary deposits are visible, colchon whenever
 * the user decides), and each stage must be able to write its own field
 * without having to restate the others.
 *
 * Runs as one transaction so a rejected field leaves nothing behind. Never
 * logs the values themselves -- titular/sueldo/balance are personal
 * financial data -- only which keys were written.
 */
export function setStrategyConfig(db: Database.Database, patch: Partial<StrategyConfig>): string[] {
  return withSpanSync("strategy_config.set", {}, () => {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [
      DefaultConfigKey,
      unknown,
    ][];

    // Validate everything BEFORE opening the write transaction, so an invalid
    // field is a plain throw rather than a rollback.
    const validated = entries.map(([key, value]) => {
      const result = (writeSchemas[key] ?? fieldSchemas[key]).safeParse(value);
      if (!result.success) {
        const issue = result.error.issues[0];
        // El campo exacto, no sólo la clave: `sueldo` tiene cuatro adentro y
        // "valor invalido en sueldo" no le dice a un agente cuál corregir.
        const campo = [key, ...(issue?.path ?? [])].join(".");
        throw new Error(`strategy_config.${campo}: valor invalido (${issue?.message ?? "shape"})`);
      }
      return { key, value: JSON.stringify(result.data) };
    });

    const stmt = db.prepare(
      `INSERT INTO strategy_config (key, value) VALUES (@key, @value)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    db.transaction(() => {
      for (const row of validated) stmt.run(row);
    })();

    const keys = validated.map((row) => row.key);
    if (keys.length > 0) {
      logInfo("strategy_config.set", { keys });
    }
    return keys;
  });
}
