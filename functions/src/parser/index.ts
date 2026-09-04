export type {
  BankEmailParser,
  Direction,
  IgnoredEmail,
  InboundEmail,
  ParsedTransaction,
  ParseResult,
  ReversoEmail,
  StatementEmail,
  TransactionType,
} from "./types.js";
export { produbancoParser } from "./produbanco.js";
export { listParsers, parseEmail, registerParser } from "./registry.js";
