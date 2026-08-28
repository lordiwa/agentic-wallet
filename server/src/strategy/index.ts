/**
 * Barrel for the deterministic strategy engine (spec §9, F2-C, TASK-025).
 * Every export here is a pure function over the ledger + strategy_config --
 * never the LLM.
 */
export * from "./dates.js";
export * from "./money.js";
export * from "./calendar.js";
export * from "./balance.js";
export * from "./card.js";
export * from "./transfers.js";
export * from "./debt.js";
export * from "./spending.js";
