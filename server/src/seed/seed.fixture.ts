/**
 * TEST-ONLY fixture configuration. Not part of the build (see the
 * `src/**​/*.fixture.ts` entry in server/tsconfig.json's `exclude`).
 *
 * The shipped seed (default-config.ts) is deliberately all zeros and empty
 * strings, because a boilerplate must not put anybody's real numbers on a
 * fresh install. The strategy engine's tests, though, need a *configured*
 * wallet to have anything to assert about -- a colchon target of 0 makes
 * "faltante" trivially 0, an empty `diasPago` makes every payday prediction
 * null, and a zero `tope` makes every transfer limit meaningless.
 *
 * So the numbers below are invented example figures for a fictional user
 * ("PEREZ GOMEZ ANA MARIA", paid by "Acme Corp S.A."), owned by the test
 * suite rather than by the product. Changing a shipped default never
 * silently rewrites what these tests prove, and vice versa.
 */
import type Database from "better-sqlite3";
import type { StrategyConfig } from "../db/strategy-config.js";
import type { DefaultDebt } from "./default-config.js";
import { seedDatabase, type SeedOptions, type SeedResult } from "./seed.js";

/** A fully-configured wallet: cushion 1200, semi-monthly salary, a snapshot. */
export const FIXTURE_STRATEGY_CONFIG = {
  moneda: "USD",
  zonaHoraria: "UTC-05:00",
  colchonObjetivo: 1200,
  topeTransferenciasMensual: 1200,
  sueldo: {
    fuente: "Acme Corp S.A.",
    cadencia: "quincenal",
    montoEstimado: 2360,
    diasPago: ["<=5", "18-20"],
  },
  titular: "PEREZ GOMEZ ANA MARIA",
  balanceSnapshot: {
    amount: 2409,
    at: "2026-07-20",
  },
} satisfies StrategyConfig;

/** Five debts with unique persons, totalling 375 -- the shape the person-keyed
 * idempotency rules in seed.ts are written against. */
export const FIXTURE_DEBTS: DefaultDebt[] = [
  { person: "Persona Uno", amount: 140, kind: "personal", status: "pending" },
  { person: "Persona Dos", amount: 100, kind: "personal", status: "pending" },
  { person: "Persona Tres", amount: 50, kind: "personal", status: "pending" },
  { person: "Persona Cuatro", amount: 50, kind: "personal", status: "pending" },
  { person: "Persona Cinco", amount: 35, kind: "personal", status: "pending" },
];

export const FIXTURE_COLCHON_TARGET = 1200;

/**
 * Seeds a database into the "fully onboarded" state the strategy tests
 * assume: the real (idempotent) seeder runs first, then every
 * `strategy_config` key and the colchon target are overwritten with the
 * fixture values. Debts are NOT seeded by default -- tests that care about
 * debts pass `{ debts: FIXTURE_DEBTS }`, so a test that doesn't mention
 * debts really does start with none.
 */
export function seedFixture(db: Database.Database, options: SeedOptions = {}): SeedResult {
  const result = seedDatabase(db, options);

  const upsert = db.prepare(
    `INSERT INTO strategy_config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  for (const [key, value] of Object.entries(FIXTURE_STRATEGY_CONFIG)) {
    upsert.run(key, JSON.stringify(value));
  }
  db.prepare("UPDATE savings SET target = ? WHERE label = 'colchon'").run(FIXTURE_COLCHON_TARGET);

  return result;
}
