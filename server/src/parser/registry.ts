import type { BankEmailParser, InboundEmail, ParseResult } from "./types.js";
import { produbancoParser } from "./produbanco.js";

// Ordered list of registered bank parsers; the first whose canParse()
// matches wins. Produbanco is registered by default — call registerParser()
// to add more banks without touching this file's callers.
const parsers: BankEmailParser[] = [produbancoParser];

export function registerParser(parser: BankEmailParser): void {
  parsers.push(parser);
}

export function listParsers(): readonly BankEmailParser[] {
  return parsers;
}

/** Runs `email` through the first matching registered bank parser. */
export function parseEmail(email: InboundEmail): ParseResult {
  const parser = parsers.find((p) => p.canParse(email));
  if (!parser) {
    return { kind: "ignored", reason: "no_matching_bank_parser" };
  }
  return parser.parse(email);
}
