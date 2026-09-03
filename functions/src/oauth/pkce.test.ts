import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  challengeS256,
  construirAuthUrl,
  crearPkce,
  crearState,
  crearVerifier,
  GMAIL_SCOPES,
} from "./pkce.js";

describe("PKCE", () => {
  it("el verifier respeta el largo y el alfabeto del RFC 7636", () => {
    for (let i = 0; i < 20; i += 1) {
      const v = crearVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      // unreserved: A-Z a-z 0-9 - . _ ~ — base64url no produce "+" ni "/" ni "=".
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it("cada verifier es distinto", () => {
    const vistos = new Set(Array.from({ length: 100 }, () => crearVerifier()));
    expect(vistos.size).toBe(100);
  });

  it("el challenge es el SHA-256 del verifier en base64url, sin padding", () => {
    const v = crearVerifier();
    const esperado = createHash("sha256").update(v, "ascii").digest("base64url");
    expect(challengeS256(v)).toBe(esperado);
    expect(challengeS256(v)).not.toContain("=");
  });

  it("el challenge no revela el verifier", () => {
    const { verifier, challenge } = crearPkce();
    expect(challenge).not.toBe(verifier);
    expect(challenge).not.toContain(verifier);
  });

  it("el state es opaco y no se repite", () => {
    const estados = new Set(Array.from({ length: 100 }, () => crearState()));
    expect(estados.size).toBe(100);
    expect(crearState()).toMatch(/^[A-Za-z0-9\-_]{43}$/);
  });
});

describe("URL de consentimiento", () => {
  const base = {
    clientId: "cliente-de-prueba.apps.googleusercontent.com",
    redirectUri: "https://us-central1-proyecto.cloudfunctions.net/gmailAuthCallback",
    state: "estado-de-prueba",
    codeChallenge: "reto-de-prueba",
  };

  it("apunta al endpoint de Google con todos los parámetros del flujo", () => {
    const url = new URL(construirAuthUrl(base));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = url.searchParams;
    expect(q.get("client_id")).toBe(base.clientId);
    expect(q.get("redirect_uri")).toBe(base.redirectUri);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("state")).toBe(base.state);
    expect(q.get("code_challenge")).toBe(base.codeChallenge);
    expect(q.get("code_challenge_method")).toBe("S256");
  });

  it("pide offline + consent: sin eso no hay refresh token", () => {
    const q = new URL(construirAuthUrl(base)).searchParams;
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
  });

  it("pide gmail.readonly y ningún permiso de escritura", () => {
    const scopes = new URL(construirAuthUrl(base)).searchParams.get("scope")!.split(" ");
    expect(scopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
    expect(GMAIL_SCOPES).toHaveLength(1);
    for (const prohibido of ["modify", "compose", "send", "gmail.metadata", "mail.google.com"]) {
      expect(scopes.join(" ")).not.toContain(prohibido);
    }
  });

  it("nunca usa code_challenge_method=plain", () => {
    expect(construirAuthUrl(base)).not.toContain("plain");
  });

  it("el login_hint es opcional y no rompe la URL cuando no hay correo", () => {
    expect(new URL(construirAuthUrl(base)).searchParams.has("login_hint")).toBe(false);
    const conHint = new URL(construirAuthUrl({ ...base, loginHint: "alguien@ejemplo.test" }));
    expect(conHint.searchParams.get("login_hint")).toBe("alguien@ejemplo.test");
  });

  it("escapa lo que va en la query", () => {
    const url = construirAuthUrl({ ...base, state: "con espacio&otro=1" });
    expect(url).toContain("state=con+espacio%26otro%3D1");
    expect(new URL(url).searchParams.get("state")).toBe("con espacio&otro=1");
  });
});
