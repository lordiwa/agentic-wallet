import { describe, expect, it } from "vitest";
import {
  decrypt,
  DecryptError,
  encrypt,
  generarClaveMaestra,
  igualSeguro,
  IV_BYTES,
  KEY_BYTES,
  masterKeyFromEnv,
  TAG_BYTES,
  type MasterKey,
} from "./crypto.js";

function clave(version = 1): MasterKey {
  return { version, key: Buffer.from(generarClaveMaestra(), "base64") };
}

const TOKEN_FALSO = "1//0gFAKE-refresh-token-de-prueba_no-es-real";

describe("cifrado de tokens", () => {
  it("descifra lo que cifró", () => {
    const k = clave();
    expect(decrypt(encrypt(TOKEN_FALSO, "uid-1", k), "uid-1", [k])).toBe(TOKEN_FALSO);
  });

  it("el blob no contiene el texto en claro", () => {
    const blob = encrypt(TOKEN_FALSO, "uid-1", clave());
    const serializado = JSON.stringify(blob);
    expect(serializado).not.toContain(TOKEN_FALSO);
    expect(serializado).not.toContain("refresh-token-de-prueba");
    // Ni un pedazo: si el modo estuviera mal usado (ECB, o un "cifrado" que es
    // un XOR), fragmentos del texto aparecerían tal cual en base64.
    expect(Buffer.from(blob.ciphertext, "base64").toString("utf8")).not.toContain("refresh");
  });

  it("usa los tamaños de GCM: IV de 12 bytes y tag de 16", () => {
    const blob = encrypt(TOKEN_FALSO, "uid-1", clave());
    expect(Buffer.from(blob.iv, "base64")).toHaveLength(IV_BYTES);
    expect(Buffer.from(blob.tag, "base64")).toHaveLength(TAG_BYTES);
    expect(blob.alg).toBe("AES-256-GCM");
  });

  it("el IV es distinto en cada escritura del mismo texto", () => {
    const k = clave();
    const ivs = new Set<string>();
    const cts = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const blob = encrypt(TOKEN_FALSO, "uid-1", k);
      ivs.add(blob.iv);
      cts.add(blob.ciphertext);
    }
    // Repetir un IV con la misma clave rompe GCM entero, no un poco.
    expect(ivs.size).toBe(50);
    // Y con IV distinto, el mismo texto da ciphertext distinto: nadie puede
    // deducir que dos tenants guardaron el mismo token comparando documentos.
    expect(cts.size).toBe(50);
  });

  it("un blob de otro tenant no descifra: el AAD es el uid", () => {
    const k = clave();
    const deAna = encrypt(TOKEN_FALSO, "uid-ana", k);
    // Exactamente el ataque 2 del diseño: copiar el documento de Ana al de Beto.
    expect(() => decrypt(deAna, "uid-beto", [k])).toThrow(DecryptError);
  });

  it("un ciphertext manipulado falla en vez de devolver basura", () => {
    const k = clave();
    const blob = encrypt(TOKEN_FALSO, "uid-1", k);
    const bytes = Buffer.from(blob.ciphertext, "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    expect(() =>
      decrypt({ ...blob, ciphertext: bytes.toString("base64") }, "uid-1", [k])
    ).toThrow(DecryptError);
  });

  it("un tag manipulado falla", () => {
    const k = clave();
    const blob = encrypt(TOKEN_FALSO, "uid-1", k);
    const tag = Buffer.from(blob.tag, "base64");
    tag[0] = tag[0]! ^ 0xff;
    expect(() => decrypt({ ...blob, tag: tag.toString("base64") }, "uid-1", [k])).toThrow(
      DecryptError
    );
  });

  it("una clave distinta no descifra", () => {
    const blob = encrypt(TOKEN_FALSO, "uid-1", clave());
    expect(() => decrypt(blob, "uid-1", [clave()])).toThrow(DecryptError);
  });

  it("todos los fallos dicen lo mismo: no hay oráculo", () => {
    const k = clave();
    const blob = encrypt(TOKEN_FALSO, "uid-1", k);
    const mensajes = new Set<string>();
    for (const intento of [
      () => decrypt(blob, "otro-uid", [k]),
      () => decrypt({ ...blob, keyVersion: 99 }, "uid-1", [k]),
      () => decrypt({ ...blob, iv: Buffer.alloc(8).toString("base64") }, "uid-1", [k]),
      () => decrypt({ ...blob, alg: "AES-128-CBC" as never }, "uid-1", [k]),
    ]) {
      try {
        intento();
        throw new Error("tenía que fallar");
      } catch (error) {
        mensajes.add((error as Error).message);
      }
    }
    expect(mensajes.size).toBe(1);
  });

  describe("rotación de clave", () => {
    it("un blob de la v1 se descifra con el juego que todavía la incluye", () => {
      const v1 = clave(1);
      const v2 = clave(2);
      const viejo = encrypt(TOKEN_FALSO, "uid-1", v1);
      expect(viejo.keyVersion).toBe(1);
      // Rotación en curso: se cifra con la v2 y se sigue leyendo la v1.
      expect(decrypt(viejo, "uid-1", [v2, v1])).toBe(TOKEN_FALSO);
      expect(encrypt(TOKEN_FALSO, "uid-1", v2).keyVersion).toBe(2);
    });

    it("cuando la v1 sale del juego, su blob deja de leerse", () => {
      const v1 = clave(1);
      const v2 = clave(2);
      expect(() => decrypt(encrypt(TOKEN_FALSO, "uid-1", v1), "uid-1", [v2])).toThrow(DecryptError);
    });
  });

  describe("masterKeyFromEnv", () => {
    it("lee una clave de 32 bytes en base64", () => {
      const b64 = generarClaveMaestra();
      const k = masterKeyFromEnv({ WALLET_TOKEN_KEK: b64 });
      expect(k.key).toHaveLength(KEY_BYTES);
      expect(k.version).toBe(1);
    });

    it("respeta la versión declarada", () => {
      const k = masterKeyFromEnv({
        WALLET_TOKEN_KEK: generarClaveMaestra(),
        WALLET_TOKEN_KEK_VERSION: "3",
      });
      expect(k.version).toBe(3);
    });

    it("falla si falta la clave, en vez de inventar un default", () => {
      expect(() => masterKeyFromEnv({})).toThrow(/falta WALLET_TOKEN_KEK/);
    });

    it("falla si la clave mide mal", () => {
      const corta = Buffer.alloc(16).toString("base64");
      expect(() => masterKeyFromEnv({ WALLET_TOKEN_KEK: corta })).toThrow(/16 bytes/);
    });

    it("el mensaje de error nunca incluye la clave", () => {
      const corta = Buffer.from("secreto-corto-que-no-mide").toString("base64");
      try {
        masterKeyFromEnv({ WALLET_TOKEN_KEK: corta });
        throw new Error("tenía que fallar");
      } catch (error) {
        expect((error as Error).message).not.toContain(corta);
        expect((error as Error).message).not.toContain("secreto-corto");
      }
    });
  });

  describe("igualSeguro", () => {
    it("compara igual que ===, para lo que importa", () => {
      expect(igualSeguro("abc", "abc")).toBe(true);
      expect(igualSeguro("abc", "abd")).toBe(false);
      expect(igualSeguro("abc", "abcd")).toBe(false);
      expect(igualSeguro("", "")).toBe(true);
    });
  });
});
