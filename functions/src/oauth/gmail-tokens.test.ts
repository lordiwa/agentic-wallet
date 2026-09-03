/**
 * El documento `config/gmail`, contra el emulador.
 *
 * Lo que se prueba acá no es "el cifrado funciona" (eso es `crypto.test.ts`),
 * sino la promesa que el producto le hace al usuario: **el token nunca está en
 * claro en la base, y lo que el panel puede pedir no lo incluye.**
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../test-support/emulator.js";
import { configDoc } from "../ledger/paths.js";
import { DecryptError, generarClaveMaestra, type MasterKey } from "./crypto.js";
import {
  DESCONECTADO,
  guardarRefreshToken,
  leerEstado,
  leerRefreshToken,
  marcarInvalido,
  olvidarConexion,
} from "./gmail-tokens.js";

const master: MasterKey = { version: 1, key: Buffer.from(generarClaveMaestra(), "base64") };
const TOKEN_FALSO = "1//0gTOKEN-DE-PRUEBA-no-sirve-para-nada";

describe.skipIf(!hayEmulador)("config/gmail", () => {
  let db: Firestore;
  let cerrar: () => Promise<void>;
  const tenants: string[] = [];

  beforeAll(() => {
    ({ db, cerrar } = conectarEmulador());
  });

  afterAll(async () => {
    for (const uid of tenants) await limpiarTenant(db, uid);
    await cerrar();
  });

  function tenant(etiqueta = "gmail"): string {
    const uid = uidDePrueba(etiqueta);
    tenants.push(uid);
    return uid;
  }

  async function conectar(uid: string, email = "alguien@ejemplo.test") {
    await guardarRefreshToken({
      db,
      uid,
      refreshToken: TOKEN_FALSO,
      email,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      master,
    });
  }

  it("guarda y devuelve el refresh token", async () => {
    const uid = tenant();
    await conectar(uid);
    expect(await leerRefreshToken(db, uid, [master])).toBe(TOKEN_FALSO);
  });

  it("el documento en Firestore NO contiene el token en claro", async () => {
    const uid = tenant();
    await conectar(uid);
    const doc = (await configDoc(db, uid, "gmail").get()).data()!;
    expect(JSON.stringify(doc)).not.toContain(TOKEN_FALSO);
    expect(JSON.stringify(doc)).not.toContain("TOKEN-DE-PRUEBA");
    expect(doc.refreshToken.alg).toBe("AES-256-GCM");
    expect(doc.refreshToken.keyVersion).toBe(1);
  });

  it("el token de un tenant no se puede leer desde otro uid", async () => {
    const ana = tenant("ana");
    const beto = tenant("beto");
    await conectar(ana);
    // El ataque: copiar el documento entero de Ana al de Beto.
    const doc = (await configDoc(db, ana, "gmail").get()).data()!;
    await configDoc(db, beto, "gmail").set(doc);
    expect(await leerRefreshToken(db, ana, [master])).toBe(TOKEN_FALSO);
    await expect(leerRefreshToken(db, beto, [master])).rejects.toThrow(DecryptError);
  });

  describe("el estado que ve el panel", () => {
    it("nunca incluye el token ni el blob", async () => {
      const uid = tenant();
      await conectar(uid);
      const estado = await leerEstado(db, uid);
      const serializado = JSON.stringify(estado);
      expect(serializado).not.toContain(TOKEN_FALSO);
      expect(serializado).not.toContain("ciphertext");
      expect(serializado).not.toContain("AES");
      expect(Object.keys(estado).sort()).toEqual([
        "conectado",
        "email",
        "grantedAt",
        "necesitaReconectar",
        "scopes",
      ]);
    });

    it("dice conectado con el correo y los scopes", async () => {
      const uid = tenant();
      await conectar(uid, "cuenta@ejemplo.test");
      const estado = await leerEstado(db, uid);
      expect(estado.conectado).toBe(true);
      expect(estado.email).toBe("cuenta@ejemplo.test");
      expect(estado.scopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
      expect(estado.grantedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(estado.necesitaReconectar).toBe(false);
    });

    it("un tenant sin documento está desconectado, no roto", async () => {
      expect(await leerEstado(db, tenant("vacio"))).toEqual(DESCONECTADO);
    });
  });

  it("marcarInvalido apaga la conexión sin borrar el rastro", async () => {
    const uid = tenant();
    await conectar(uid);
    await marcarInvalido(db, uid, "invalid_grant");
    const estado = await leerEstado(db, uid);
    expect(estado.conectado).toBe(false);
    // Ya no sirve para la ingesta...
    expect(await leerRefreshToken(db, uid, [master])).toBeNull();
    // ...pero queda desde cuándo y por qué.
    const doc = (await configDoc(db, uid, "gmail").get()).data()!;
    expect(doc.motivoInvalido).toBe("invalid_grant");
    expect(doc.invalidSince).not.toBeNull();
  });

  it("reconectar borra la marca de inválido de la conexión anterior", async () => {
    const uid = tenant();
    await conectar(uid);
    await marcarInvalido(db, uid, "invalid_grant");
    await conectar(uid, "otra@ejemplo.test");
    const estado = await leerEstado(db, uid);
    expect(estado.conectado).toBe(true);
    expect(estado.necesitaReconectar).toBe(false);
    expect(estado.email).toBe("otra@ejemplo.test");
  });

  it("olvidarConexion saca el blob de la base", async () => {
    const uid = tenant();
    await conectar(uid);
    await olvidarConexion(db, uid);
    expect(await leerRefreshToken(db, uid, [master])).toBeNull();
    const doc = (await configDoc(db, uid, "gmail").get()).data()!;
    expect(doc.refreshToken).toBeUndefined();
    expect((await leerEstado(db, uid)).conectado).toBe(false);
  });

  it("un token cifrado con la clave vieja se lee durante una rotación", async () => {
    const uid = tenant();
    await conectar(uid);
    const v2: MasterKey = { version: 2, key: Buffer.from(generarClaveMaestra(), "base64") };
    expect(await leerRefreshToken(db, uid, [v2, master])).toBe(TOKEN_FALSO);
    await expect(leerRefreshToken(db, uid, [v2])).rejects.toThrow(DecryptError);
  });
});
