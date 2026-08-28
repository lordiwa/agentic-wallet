import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the Claude Agent SDK boundary per the ticket's "never make a live
// network call" rule. Exercises the real production extractor code
// (claude-email-extractor.ts) against a fake `query()` async generator.
const queryMock = vi.fn();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

async function* messages(...msgs: unknown[]) {
  for (const m of msgs) yield m;
}

beforeEach(() => {
  queryMock.mockReset();
});

describe("createClaudeEmailExtractor", () => {
  it("returns the validated structured output on success", async () => {
    queryMock.mockReturnValueOnce(
      messages({
        type: "result",
        subtype: "success",
        structured_output: { amount_text_raw: "USD 9.42", counterparty: "COMISARIATO EXPRESS" },
      })
    );
    const { createClaudeEmailExtractor } = await import("./claude-email-extractor.js");
    const extractor = createClaudeEmailExtractor();

    const result = await extractor.extract({ subject: "Consumo Produbanco", body: "USD 9.42" });

    expect(result).toEqual({ amount_text_raw: "USD 9.42", counterparty: "COMISARIATO EXPRESS" });
  });

  it("passes outputFormat as a plain JSON Schema (draft-7-equivalent), never a raw Zod object", async () => {
    queryMock.mockReturnValueOnce(
      messages({ type: "result", subtype: "success", structured_output: { amount_text_raw: null } })
    );
    const { createClaudeEmailExtractor } = await import("./claude-email-extractor.js");
    const extractor = createClaudeEmailExtractor();

    await extractor.extract({ subject: "s", body: "b" });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [{ options }] = queryMock.mock.calls[0] as [{ options: { outputFormat: { type: string; schema: unknown } } }];
    expect(options.outputFormat.type).toBe("json_schema");
    expect(options.outputFormat.schema).toMatchObject({ type: "object" });
    expect(typeof (options.outputFormat.schema as { parse?: unknown }).parse).toBe("undefined");
  });

  it("treats success with no structured_output as a failure, not a crash", async () => {
    queryMock.mockReturnValueOnce(messages({ type: "result", subtype: "success" }));
    const { createClaudeEmailExtractor } = await import("./claude-email-extractor.js");
    const extractor = createClaudeEmailExtractor();

    const result = await extractor.extract({ subject: "s", body: "b" });

    expect(result).toEqual({ amount_text_raw: null, counterparty: null });
  });

  it("treats an error subtype as a failure, not a crash", async () => {
    queryMock.mockReturnValueOnce(messages({ type: "result", subtype: "error_max_structured_output_retries" }));
    const { createClaudeEmailExtractor } = await import("./claude-email-extractor.js");
    const extractor = createClaudeEmailExtractor();

    const result = await extractor.extract({ subject: "s", body: "b" });

    expect(result).toEqual({ amount_text_raw: null, counterparty: null });
  });

  it("treats structured output that fails Zod validation as a failure, not a crash", async () => {
    queryMock.mockReturnValueOnce(
      messages({ type: "result", subtype: "success", structured_output: { unexpected_field: 123 } })
    );
    const { createClaudeEmailExtractor } = await import("./claude-email-extractor.js");
    const extractor = createClaudeEmailExtractor();

    const result = await extractor.extract({ subject: "s", body: "b" });

    expect(result).toEqual({ amount_text_raw: null, counterparty: null });
  });
});
