/**
 * Real `EmailExtractor` (spec §6.1, F1-07): one Claude Agent SDK `query()`
 * call per email, structured output validated with Zod. Deliberately does
 * NOT register a Gmail MCP tool — `pipeline.ts` already fetched (and
 * masked) the email content via `GmailClient` before calling this, so the
 * call is pure triage/classification. Its output is never the source of
 * truth for money (see amount-validate.ts, which cross-checks
 * `amount_text_raw` against the deterministic parser's own derived amount).
 *
 * Zod-version note: the project pins zod@^3 everywhere else
 * (server/package.json), but @anthropic-ai/claude-agent-sdk peer-requires
 * zod@^4. Per the claude-agent-sdk-gmail skill's explicit v3 guidance, this
 * file never hands a Zod schema object to the SDK itself — `outputFormat`
 * only ever receives a plain JSON Schema object, produced via the
 * zod@v3-compatible `zod-to-json-schema` package (`z.toJSONSchema` is
 * zod-v4-only and unavailable here). `target: "jsonSchema7"` is that
 * package's JSON-Schema-draft-7-equivalent target.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { EmailExtractor, ExtractedEmail } from "./types.js";

export const ExtractedEmailSchema = z.object({
  amount_text_raw: z
    .string()
    .nullable()
    .describe(
      'EXACT amount substring as it appears in the email, e.g. "USD 9.42" or "$9.42" — never a number you computed yourself. Use null if no amount is present.'
    ),
  counterparty: z.string().nullable().optional(),
});

const OUTPUT_JSON_SCHEMA = zodToJsonSchema(ExtractedEmailSchema, { target: "jsonSchema7" }) as Record<
  string,
  unknown
>;

function buildPrompt(email: { subject: string; body: string }): string {
  return [
    "Extract the payment amount and counterparty from this Produbanco bank notification email.",
    'amount_text_raw must be the EXACT substring from the email text that states the amount (e.g. "USD 9.42"); never a number you compute yourself. Use null if no amount is present.',
    "",
    `Subject: ${email.subject}`,
    `Body: ${email.body}`,
  ].join("\n");
}

const FAILED_EXTRACTION: ExtractedEmail = { amount_text_raw: null, counterparty: null };

/** Builds a real, single-turn `EmailExtractor` backed by the Claude Agent SDK. */
export function createClaudeEmailExtractor(): EmailExtractor {
  return {
    async extract(email) {
      for await (const message of query({
        prompt: buildPrompt(email),
        options: {
          maxTurns: 1,
          outputFormat: { type: "json_schema", schema: OUTPUT_JSON_SCHEMA },
        },
      })) {
        if (message.type !== "result") continue;

        // Both "success with no structured_output" and any
        // subtype !== "success" are failure paths (skill's Common
        // Pitfalls) — treated the same as "Claude gave no usable answer",
        // which the deterministic re-validation layer already handles as
        // "cannot confirm" rather than a crash.
        if (message.subtype === "success" && message.structured_output) {
          const parsed = ExtractedEmailSchema.safeParse(message.structured_output);
          if (parsed.success) {
            return { amount_text_raw: parsed.data.amount_text_raw, counterparty: parsed.data.counterparty ?? null };
          }
        }
        return FAILED_EXTRACTION;
      }
      return FAILED_EXTRACTION;
    },
  };
}
