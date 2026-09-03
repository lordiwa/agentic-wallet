import { describe, expect, it } from "vitest";
import { cargarConfig, conResultado, urlDeVuelta } from "./config.js";
import { generarClaveMaestra } from "./crypto.js";

const ENV_MINIMO = {
  WALLET_TOKEN_KEK: generarClaveMaestra(),
  WALLET_GMAIL_CLIENT_ID: "cliente.apps.googleusercontent.com",
  WALLET_GMAIL_CLIENT_SECRET: "secreto-de-prueba",
  WALLET_OAUTH_REDIRECT_URI: "https://us-central1-p.cloudfunctions.net/gmailAuthCallback",
  WALLET_PANEL_ORIGIN: "https://panel.example",
};

describe("cargarConfig", () => {
  it("arma la config con las claves de lectura encabezadas por la activa", () => {
    const cfg = cargarConfig({ ...ENV_MINIMO });
    expect(cfg.clientId).toBe(ENV_MINIMO.WALLET_GMAIL_CLIENT_ID);
    expect(cfg.master.version).toBe(1);
    expect(cfg.clavesDeLectura).toHaveLength(1);
  });

  it("le saca la barra final al origen del panel para no armar '//' al concatenar", () => {
    const cfg = cargarConfig({ ...ENV_MINIMO, WALLET_PANEL_ORIGIN: "https://panel.example/" });
    expect(cfg.panelOrigin).toBe("https://panel.example");
  });

  it.each([
    "WALLET_GMAIL_CLIENT_ID",
    "WALLET_GMAIL_CLIENT_SECRET",
    "WALLET_OAUTH_REDIRECT_URI",
    "WALLET_PANEL_ORIGIN",
  ])("falla si falta %s en vez de arrancar a medias", (faltante) => {
    const env: Record<string, string> = { ...ENV_MINIMO };
    delete env[faltante];
    expect(() => cargarConfig(env)).toThrow(new RegExp(faltante));
  });

  it("acepta claves previas para una rotación", () => {
    const cfg = cargarConfig({
      ...ENV_MINIMO,
      WALLET_TOKEN_KEK_VERSION: "2",
      WALLET_TOKEN_KEK_PREVIOUS: `1:${generarClaveMaestra()}`,
    });
    expect(cfg.master.version).toBe(2);
    expect(cfg.clavesDeLectura.map((k) => k.version)).toEqual([2, 1]);
  });

  it("rechaza una clave previa que repite la versión de la activa", () => {
    expect(() =>
      cargarConfig({ ...ENV_MINIMO, WALLET_TOKEN_KEK_PREVIOUS: `1:${generarClaveMaestra()}` })
    ).toThrow(/repite la version/);
  });

  it("rechaza una clave previa mal formada", () => {
    expect(() =>
      cargarConfig({ ...ENV_MINIMO, WALLET_TOKEN_KEK_PREVIOUS: generarClaveMaestra() })
    ).toThrow(/version:base64/);
  });
});

describe("urlDeVuelta", () => {
  const panel = "https://panel.example";

  it("acepta una ruta relativa del panel", () => {
    expect(urlDeVuelta(panel, "/#/onboarding/listo")).toBe("https://panel.example/#/onboarding/listo");
  });

  it("usa la ruta por defecto cuando no piden ninguna", () => {
    expect(urlDeVuelta(panel, undefined)).toBe("https://panel.example/#/conectado");
  });

  it.each([
    ["absoluta a otro dominio", "https://malo.example/robar"],
    ["protocol-relative", "//malo.example/robar"],
    ["con backslash, que algunos navegadores normalizan a barra", "/\\malo.example"],
    ["javascript:", "javascript:alert(1)"],
    ["sin barra inicial", "malo.example"],
    ["vacía", ""],
  ])("no se deja usar como redirector abierto: %s", (_caso, intento) => {
    const url = urlDeVuelta(panel, intento);
    expect(url.startsWith(panel + "/")).toBe(true);
    expect(url).not.toContain("malo.example");
    expect(url).not.toContain("javascript:");
  });

  it("no acepta un tipo que no sea string", () => {
    expect(urlDeVuelta(panel, 42 as never)).toBe("https://panel.example/#/conectado");
  });
});

describe("conResultado", () => {
  it("pone el query ANTES del hash, que es donde Vue Router lo ve", () => {
    expect(conResultado("https://panel.example/#/conectado", "gmail", "ok")).toBe(
      "https://panel.example/?gmail=ok#/conectado"
    );
  });

  it("usa & si ya había query", () => {
    expect(conResultado("https://panel.example/?a=1#/x", "gmail", "ok")).toBe(
      "https://panel.example/?a=1&gmail=ok#/x"
    );
  });

  it("funciona sin hash", () => {
    expect(conResultado("https://panel.example/listo", "gmail", "cancelado")).toBe(
      "https://panel.example/listo?gmail=cancelado"
    );
  });

  it("escapa el valor", () => {
    expect(conResultado("https://panel.example/", "gmail", "a b&c")).toContain("gmail=a%20b%26c");
  });
});
