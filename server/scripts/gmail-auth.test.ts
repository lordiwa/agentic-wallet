import { describe, expect, it } from "vitest";
import { buildConsentUrl } from "./gmail-auth.js";

// buildConsentUrl is the one piece of the OAuth flow that doesn't need a
// real Google roundtrip or a live loopback server, so it's the only part of
// gmail-auth.ts covered by an automated test -- everything else (the actual
// consent screen, the callback exchange) can only be verified by hand with
// real credentials, per the TASK-020 review's own instruction not to
// attempt that here.
describe("buildConsentUrl", () => {
  it("builds a Google consent URL scoped to gmail.readonly with offline/consent params", () => {
    const url = buildConsentUrl({
      clientId: "dummy-client-id.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:12345/oauth2callback",
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("client_id")).toBe("dummy-client-id.apps.googleusercontent.com");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:12345/oauth2callback");
  });

  it("includes the PKCE code_challenge when provided", () => {
    const url = buildConsentUrl({
      clientId: "dummy-client-id.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:12345/oauth2callback",
      codeChallenge: "dummy-challenge",
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get("code_challenge")).toBe("dummy-challenge");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });
});
