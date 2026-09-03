/**
 * El store del `state`, contra el emulador de Firestore de verdad.
 *
 * Emulador y no un doble en memoria por una razón concreta: lo que hay que
 * probar acá es que `canjearState` sea de UN SOLO USO bajo concurrencia, y eso
 * es una propiedad de la transacción de Firestore, no del código que la llama.
 * Un doble en memoria diría que sí siempre.
 */
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { conectarEmulador, hayEmulador, uidDePrueba } from "../test-support/emulator.js";
import { DecryptError, generarClaveMaestra, type MasterKey } from "./crypto.js";
import { crearState, crearVerifier } from "./pkce.js";
import {
  canjearState,
  guardarState,
  limpiarStatesVencidos,
  StateError,
  STATE_TTL_MS,
  STATES_COLLECTION,
} from "./state-store.js";

const master: MasterKey = { version: 1, key: Buffer.from(generarClaveMaestra(), "base64") };

describe.skipIf(!hayEmulador)("state del OAuth", () => {
  let db: Firestore;
  let cerrar: () => Promise<void>;
  const creados: string[] = [];

  beforeAll(() => {
    ({ db, cerrar } = conectarEmulador());
  });

  afterAll(async () => {
    for (const id of creados) await db.collection(STATES_COLLECTION).doc(id).delete();
    await cerrar();
  });

  async function nuevo(opts: { uid?: string; returnTo?: string; ahora?: Date } = {}) {
    const stateId = crearState();
    const verifier = crearVerifier();
    creados.push(stateId);
    await guardarState({
      db,
      stateId,
      uid: opts.uid ?? uidDePrueba("state"),
      verifier,
      returnTo: opts.returnTo ?? "https://panel.example/#/conectado",
      master,
      ahora: opts.ahora,
    });
    return { stateId, verifier };
  }

  it("devuelve el uid y el verifier que se guardaron", async () => {
    const uid = uidDePrueba("state");
    const { stateId, verifier } = await nuevo({ uid });
    const canjeado = await canjearState(db, stateId, master);
    expect(canjeado.uid).toBe(uid);
    expect(canjeado.verifier).toBe(verifier);
    expect(canjeado.returnTo).toBe("https://panel.example/#/conectado");
  });

  it("guarda el verifier CIFRADO, no en claro", async () => {
    const { stateId, verifier } = await nuevo();
    const doc = (await db.collection(STATES_COLLECTION).doc(stateId).get()).data()!;
    expect(JSON.stringify(doc)).not.toContain(verifier);
    expect(doc.verifier.alg).toBe("AES-256-GCM");
  });

  it("es de un solo uso", async () => {
    const { stateId } = await nuevo();
    await canjearState(db, stateId, master);
    await expect(canjearState(db, stateId, master)).rejects.toThrow(StateError);
  });

  it("dos canjes simultáneos: sólo uno gana", async () => {
    const { stateId } = await nuevo();
    // El usuario hace doble clic, o el navegador reintenta el 302.
    const resultados = await Promise.allSettled([
      canjearState(db, stateId, master),
      canjearState(db, stateId, master),
      canjearState(db, stateId, master),
    ]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("vence a los diez minutos", async () => {
    const hace11min = new Date(Date.now() - 11 * 60 * 1000);
    const { stateId } = await nuevo({ ahora: hace11min });
    await expect(canjearState(db, stateId, master)).rejects.toMatchObject({
      code: "state_vencido",
    });
    expect(STATE_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("justo antes de vencer todavía sirve", async () => {
    const casi = new Date(Date.now() - STATE_TTL_MS + 5000);
    const { stateId } = await nuevo({ ahora: casi });
    await expect(canjearState(db, stateId, master)).resolves.toBeTruthy();
  });

  it("un state que no existe no dice que no existe: dice lo mismo que los demás", async () => {
    const inexistente = canjearState(db, crearState(), master).catch((e: StateError) => e.message);
    const { stateId } = await nuevo();
    await canjearState(db, stateId, master);
    const usado = canjearState(db, stateId, master).catch((e: StateError) => e.message);
    expect(await inexistente).toBe(await usado);
  });

  it("un verifier manipulado en la base no descifra", async () => {
    const { stateId } = await nuevo();
    const ref = db.collection(STATES_COLLECTION).doc(stateId);
    const doc = (await ref.get()).data()!;
    const bytes = Buffer.from(doc.verifier.ciphertext, "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    await ref.update({ "verifier.ciphertext": bytes.toString("base64") });
    await expect(canjearState(db, stateId, master)).rejects.toThrow(DecryptError);
  });

  it("el verifier de un state no sirve en otro: el AAD es el id del state", async () => {
    const a = await nuevo();
    const b = await nuevo();
    const docA = (await db.collection(STATES_COLLECTION).doc(a.stateId).get()).data()!;
    // Alguien copia el blob del state A al documento del state B.
    await db.collection(STATES_COLLECTION).doc(b.stateId).update({ verifier: docA.verifier });
    await expect(canjearState(db, b.stateId, master)).rejects.toThrow(DecryptError);
  });

  it("no deja pisar un state existente", async () => {
    const { stateId } = await nuevo();
    await expect(
      guardarState({
        db,
        stateId,
        uid: uidDePrueba("otro"),
        verifier: crearVerifier(),
        returnTo: "https://panel.example/",
        master,
      })
    ).rejects.toThrow();
  });

  it("limpia los vencidos y deja los vivos", async () => {
    const viejo = await nuevo({ ahora: new Date(Date.now() - 60 * 60 * 1000) });
    const nuevoVivo = await nuevo();
    const borrados = await limpiarStatesVencidos(db);
    expect(borrados).toBeGreaterThanOrEqual(1);
    expect((await db.collection(STATES_COLLECTION).doc(viejo.stateId).get()).exists).toBe(false);
    expect((await db.collection(STATES_COLLECTION).doc(nuevoVivo.stateId).get()).exists).toBe(true);
  });

  it("guarda expiresAt como Timestamp, que es lo que el TTL nativo de Firestore necesita", async () => {
    const { stateId } = await nuevo();
    const doc = (await db.collection(STATES_COLLECTION).doc(stateId).get()).data()!;
    expect(doc.expiresAt).toBeInstanceOf(Timestamp);
    expect(doc.usedAt).toBeNull();
  });
});
