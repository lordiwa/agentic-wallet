import { describe, expect, it } from "vitest";
import { classifyClaudeCredential } from "./claude-credential.js";

// Valores con la FORMA de cada credencial, no credenciales: el clasificador
// solo mira el prefijo, asi que el relleno es intencionalmente basura.
const OAUTH = `sk-ant-oat01-${"x".repeat(90)}`;
const API_KEY = `sk-ant-api03-${"x".repeat(90)}`;
const REFRESH = `sk-ant-ort01-${"x".repeat(90)}`;

describe("classifyClaudeCredential", () => {
  it("sin ninguna variable devuelve missing, no malformed", () => {
    const result = classifyClaudeCredential({});
    expect(result.kind).toBe("missing");
    expect(result.usable).toBe(false);
    expect(result.source).toBeNull();
    // `missing` ya lo explica el paso del checklist; duplicar el mensaje aca
    // haria que el CLI imprima el problema dos veces.
    expect(result.problem).toBe("");
  });

  it("una cadena de espacios cuenta como ausente", () => {
    expect(classifyClaudeCredential({ CLAUDE_CODE_OAUTH_TOKEN: "   " }).kind).toBe("missing");
  });

  it("acepta el token de `claude setup-token`", () => {
    const result = classifyClaudeCredential({ CLAUDE_CODE_OAUTH_TOKEN: OAUTH });
    expect(result).toMatchObject({ kind: "oauth-token", source: "CLAUDE_CODE_OAUTH_TOKEN", usable: true });
  });

  it("acepta una API key de la consola", () => {
    const result = classifyClaudeCredential({ ANTHROPIC_API_KEY: API_KEY });
    expect(result).toMatchObject({ kind: "api-key", source: "ANTHROPIC_API_KEY", usable: true });
  });

  // La afirmacion de precedencia estaba en la doc pero no en el codigo: las dos
  // variables se trataban como un OR simetrico. Ahora el orden es explicito.
  it("ANTHROPIC_API_KEY tiene precedencia sobre CLAUDE_CODE_OAUTH_TOKEN", () => {
    const result = classifyClaudeCredential({ ANTHROPIC_API_KEY: API_KEY, CLAUDE_CODE_OAUTH_TOKEN: OAUTH });
    expect(result.source).toBe("ANTHROPIC_API_KEY");
  });

  // El bug real encontrado corriendo el onboarding con credenciales de verdad:
  // el refresh token de ~/.claude/.credentials.json pegado donde va el de
  // `claude setup-token`. Mismo largo, mismo aspecto, 401 en cada correo.
  it("detecta el refresh token pegado en CLAUDE_CODE_OAUTH_TOKEN", () => {
    const result = classifyClaudeCredential({ CLAUDE_CODE_OAUTH_TOKEN: REFRESH });
    expect(result.kind).toBe("malformed");
    expect(result.usable).toBe(false);
    expect(result.problem).toContain("refresh token");
    expect(result.problem).toContain("claude setup-token");
  });

  it("detecta las dos variables intercambiadas", () => {
    expect(classifyClaudeCredential({ ANTHROPIC_API_KEY: OAUTH }).problem).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(classifyClaudeCredential({ CLAUDE_CODE_OAUTH_TOKEN: API_KEY }).problem).toContain("ANTHROPIC_API_KEY");
  });

  it("un valor sin prefijo conocido tambien es malformed", () => {
    const result = classifyClaudeCredential({ CLAUDE_CODE_OAUTH_TOKEN: "pegue-cualquier-cosa" });
    expect(result.kind).toBe("malformed");
    expect(result.problem).toContain("sk-ant-oat");
  });

  it("nunca incluye el valor de la credencial en el mensaje", () => {
    const secret = `sk-ant-ort01-${"z".repeat(90)}`;
    const { problem } = classifyClaudeCredential({ CLAUDE_CODE_OAUTH_TOKEN: secret });
    expect(problem).not.toContain(secret);
    expect(problem).not.toContain("z".repeat(20));
  });
});
