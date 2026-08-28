import type Database from "better-sqlite3";
import { z } from "zod";
import { DEFAULT_STRATEGY_CONFIG } from "../seed/default-config.js";
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
      const result = fieldSchemas[key].safeParse(value);
      if (!result.success) {
        throw new Error(`strategy_config.${key}: valor invalido (${result.error.issues[0]?.message ?? "shape"})`);
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
