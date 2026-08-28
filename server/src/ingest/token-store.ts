/**
 * Gmail refresh-token persistence (claude-agent-sdk-gmail skill, workflow
 * 5): the real implementation encrypts at rest via the OS keychain
 * (`@napi-rs/keyring`). That package is a NATIVE (Rust-backed) addon —
 * listed as an `optionalDependency` in server/package.json and imported
 * lazily here (dynamic `import()` inside the method, not a top-level
 * import) so a machine where its prebuild fails to install still has a
 * fully working mocked test path (`InMemoryTokenStore`) and a fully
 * type-checking `pipeline.ts`, which never imports this module at all.
 */
import type { TokenStore } from "./types.js";

const SERVICE = "agentic-wallet";
const ACCOUNT = "gmail-refresh-token";

/** Real TokenStore: OS keychain via @napi-rs/keyring (macOS Keychain /
 * Windows Credential Vault / Linux Secret Service). */
export class KeyringTokenStore implements TokenStore {
  async save(refreshToken: string): Promise<void> {
    const { Entry } = await this.loadKeyring();
    new Entry(SERVICE, ACCOUNT).setPassword(refreshToken);
  }

  async load(): Promise<string | null> {
    const { Entry } = await this.loadKeyring();
    return new Entry(SERVICE, ACCOUNT).getPassword() ?? null;
  }

  private async loadKeyring(): Promise<typeof import("@napi-rs/keyring")> {
    try {
      return await import("@napi-rs/keyring");
    } catch (cause) {
      throw new Error(
        "@napi-rs/keyring failed to load (native module not built for this platform). " +
          "Gmail OAuth token storage is unavailable — see server/package.json's optionalDependencies note.",
        { cause }
      );
    }
  }
}

/** In-memory TokenStore for tests — never touches the OS keychain. */
export class InMemoryTokenStore implements TokenStore {
  private token: string | null = null;

  async save(refreshToken: string): Promise<void> {
    this.token = refreshToken;
  }

  async load(): Promise<string | null> {
    return this.token;
  }
}
