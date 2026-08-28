/**
 * TASK-037 (F3-E): offline guardrail-enforcement tests. This suite locks the
 * STRUCTURAL invariants that make amount fabrication hard at the code layer:
 * the exact `query()` options `runChatTurn` always passes (no built-in
 * toolbelt, allowedTools scoped to exactly the five wallet-engine tools,
 * `strictMcpConfig`), the guardrail clauses baked into `CHAT_SYSTEM_PROMPT`,
 * and this pipeline's own "no data -> explicit marker, never invent"
 * handling when a tool call yields nothing usable.
 *
 * What this suite CANNOT prove -- and does not pretend to -- is whether the
 * real model actually obeys the system prompt when it's free to choose its
 * own words. `queryFn` here is always a scripted stub (per chat-service.ts's
 * injectable-model-boundary doc comment), so every assertion below is about
 * OUR plumbing, never the model's judgment. That behavioral question is the
 * live UAT a human runs against the real SDK -- see
 * docs/chat-guardrail-uat.md.
 */
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { createConversation } from "./conversation-repository.js";
import { CHAT_SYSTEM_PROMPT, runChatTurn, type QueryFn } from "./chat-service.js";
import { getCardStatement } from "./engine-tools.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

async function* messages(...msgs: unknown[]) {
  for (const m of msgs) yield m;
}

/** The five F3-B tools, fully qualified the way the SDK's `allowedTools`
 * expects (`mcp__<server>__<tool>`) -- kept as an explicit literal list (not
 * imported from chat-service.ts, which doesn't export it) so this test fails
 * the moment the real list drifts from what's written here. */
const EXPECTED_ALLOWED_TOOLS = [
  "get_strategy_overview",
  "query_transactions",
  "get_daily_brief",
  "get_card_statement",
  "check_affordability",
].map((name) => `mcp__wallet-engine__${name}`);

describe("chat guardrail -- structural enforcement (query() options)", () => {
  it("disables the built-in toolbelt, scopes allowedTools to exactly the five wallet-engine tools, locks strictMcpConfig, and pins the guardrail system prompt", async () => {
    const conversation = createConversation(db);
    let captured: Parameters<QueryFn>[0] | undefined;
    const fakeQuery: QueryFn = (args) => {
      captured = args;
      return messages({ type: "result", subtype: "success", result: "ok" });
    };

    await runChatTurn({ db, conversationId: conversation.id, userText: "hola", queryFn: fakeQuery });

    // `tools: []` is the actual gate that removes Bash/Read/Write/WebFetch/
    // WebSearch -- without it a crafted chat message could reach the host
    // filesystem or network regardless of what allowedTools lists.
    expect(captured?.options?.tools).toEqual([]);
    expect(captured?.options?.strictMcpConfig).toBe(true);
    expect(captured?.options?.systemPrompt).toBe(CHAT_SYSTEM_PROMPT);

    // Set-equality, not "contains": adding, removing, or renaming a tool
    // later (a sixth F3-B tool, a typo'd name) must fail this test rather
    // than silently widening or narrowing what the model can reach.
    expect(new Set(captured?.options?.allowedTools)).toEqual(new Set(EXPECTED_ALLOWED_TOOLS));
    expect(captured?.options?.allowedTools).toHaveLength(EXPECTED_ALLOWED_TOOLS.length);
  });
});

describe("CHAT_SYSTEM_PROMPT -- guardrail clauses", () => {
  it("instructs the model to answer only via the provided tools", () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/ÚNICAMENTE usando las herramientas/i);
  });

  it("instructs that every monetary figure must come from a tool result, never invented/estimated/inferred", () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/cifra monetaria/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/NUNCA inventes/i);
  });

  it("instructs an explicit no-data response instead of guessing", () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/no devuelve datos/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/no adivines/i);
  });

  it("instructs against laundering a user-supplied amount as ledger-confirmed", () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/no repitas un monto/i);
  });

  it("is written in Spanish", () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/hablas español/i);
  });
});

describe("no-data flows through without fabrication", () => {
  it("falls back to the explicit no-answer marker (never a fabricated figure) when a tool call returns 'no data' and no assistant text ever arrives", async () => {
    const conversation = createConversation(db);

    // Cross-check with F3-B directly on this same empty DB: the real tool
    // handler already returns an explicit "no statement loaded" marker, not
    // a guessed balance (full coverage of this contract lives in
    // engine-tools.test.ts -- this just pins that the pipeline built on top
    // of it doesn't undo the guarantee).
    expect(getCardStatement(db)).toMatchObject({ available: false, message: "no statement loaded" });

    const fakeQuery: QueryFn = () =>
      messages(
        {
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "get_card_statement", input: {} }] },
        },
        // Simulates the boundary case THIS PIPELINE (not the model) must
        // handle safely: the tool was called but no assistant text/result
        // message ever arrived -- e.g. the model exhausted its turn budget
        // deciding how to phrase "no data" instead of guessing a balance.
        { type: "result", subtype: "error_max_turns" }
      );

    const result = await runChatTurn({
      db,
      conversationId: conversation.id,
      userText: "¿cuánto debo de la tarjeta?",
      queryFn: fakeQuery,
    });

    expect(result.assistantMessage.content).toMatch(/no pude generar una respuesta/i);
    // The fallback marker itself must never contain a digit -- it can never
    // be mistaken for a real figure.
    expect(result.assistantMessage.content).not.toMatch(/\d/);
  });

  // No additional "each tool never fabricates on an empty DB" cross-check is
  // added here: engine-tools.test.ts already asserts this directly for all
  // five tools (getStrategyOverview's "degrades to nulls/empties" test,
  // getCardStatement's "no statement loaded" result above, queryTransactions'
  // null spending_by_category, and checkAffordability's null cardStatus /
  // null categorySpentThisMonth). Note: `strategy_config` has no "totally
  // empty" state to probe further -- an empty table falls back to
  // seed/default-config.ts, whose shipped values are zeros/empties, so an
  // unconfigured wallet reports zero rather than inventing a figure. There is
  // no additional fabrication surface to lock beyond what's already covered.
});
