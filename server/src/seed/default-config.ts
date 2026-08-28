/**
 * Neutral seed data for a fresh install: the `strategy_config` parameters,
 * the (empty) personal-debt set, and the savings ("colchon") goal.
 *
 * These are deliberately EMPTY/ZERO placeholders, not example figures. A
 * fresh clone of this boilerplate must never show numbers that look real but
 * belong to nobody -- the whole point of the strategy engine is that every
 * figure it prints is traceable to the user's own ledger or their own
 * configuration. `npm run onboard` (see server/src/onboard/) is what turns
 * these placeholders into the user's real values; until then the dashboard
 * shows zeros, which is honest.
 *
 * Kept as plain data separate from the loader (seed.ts) so the values can be
 * reviewed/edited independently of the idempotency logic.
 */
import type { StrategyConfig } from "../db/strategy-config.js";

export interface DefaultDebt {
  person: string;
  amount: number;
  kind: string;
  status: string;
}

export interface DefaultSavingsGoal {
  label: string;
  target: number;
  reserved: number;
}

/**
 * strategy_config rows, keyed by `key`. Values are stored as JSON strings.
 * `satisfies StrategyConfig` is a compile-time guarantee that every field of
 * the `db/strategy-config.ts` contract has a default here -- dropping a key
 * (or mistyping one) is a type error instead of a silent `undefined`
 * reaching `getStrategyConfig`'s per-field fallback.
 */
export const DEFAULT_STRATEGY_CONFIG = {
  moneda: "USD",
  /** Informational label only; the arithmetic uses WALLET_UTC_OFFSET_HOURS (see strategy/dates.ts). */
  zonaHoraria: "UTC-05:00",
  colchonObjetivo: 0,
  topeTransferenciasMensual: 0,
  sueldo: {
    fuente: "",
    cadencia: "quincenal",
    montoEstimado: 0,
    /**
     * Empty on purpose: with no configured payday, `nextPayday` returns null
     * and the engine says "no lo se" instead of inventing a payday. Onboarding
     * fills this from the salary deposits the first sync actually found.
     */
    diasPago: [] as string[],
  },
  /**
   * Account-holder name exactly as the bank writes it in its emails. Used to
   * recognise the user's own transfers as internal. Empty until onboarding
   * reads it off the first synced email.
   */
  titular: "",
  /**
   * Point-in-time snapshot of the bank balance: the starting point for every
   * balance calculation. `amount: 0` at the epoch means "balance = the sum of
   * everything in the ledger", which is the correct neutral behaviour before
   * the user tells us a real re-anchor point.
   */
  balanceSnapshot: {
    amount: 0,
    at: "1970-01-01",
  },
} satisfies StrategyConfig;

/**
 * debts rows. Empty by default -- a boilerplate has no idea who owes whom.
 * `seedDatabase(db, { debts })` accepts a set to seed (that is what the
 * onboarding CLI uses); the idempotency rules are keyed on `person` either
 * way, so a user-edited amount survives a reseed.
 */
export const DEFAULT_DEBTS: DefaultDebt[] = [];

/** savings row: the "colchon" (financial cushion) goal, with no target yet. */
export const DEFAULT_SAVINGS_GOAL: DefaultSavingsGoal = {
  label: "colchon",
  target: 0,
  reserved: 0,
};
