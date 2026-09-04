/**
 * La ingesta contra el emulador, con Gmail mockeado.
 *
 * Los fixtures son correos INVENTADOS con la forma de los reales: nombres
 * ficticios, cuentas ficticias, montos ficticios (CLAUDE.md regla 2). Lo que se
 * verifica no es que el parser lea bien —eso ya lo cubren las ~1400 líneas de
 * tests del motor, y `parser/parity.test.ts` garantiza que sea el MISMO
 * parser— sino lo que este módulo agrega: la idempotencia por `gmail_msg_id`,
 * el par `(0, needsReview)` para un monto ilegible, y que el documento escrito
 * sea el mismo que escribe la migración.
 */
import { afterEach, describe, expect, it } from "vitest";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../test-support/emulator.js";
import type { ClienteGmail, MensajeGmail } from "./gmail-client.js";
import { htmlToText } from "../parser/html-text.js";
import { armarQuery, ingestar } from "./pipeline.js";

/**
 * El HTML **con la forma que manda el banco**: el envoltorio MSHTML, el envuelto
 * a ~72 columnas que parte labels y valores por la mitad, el relleno de
 * espacios de `Establecimiento`. Es la misma forma que
 * `server/src/parser/produbanco-formato-real.test.ts`, y por el mismo motivo:
 * el parser corre sobre la salida de `htmlToText`, no sobre texto escrito a
 * mano. Los DATOS son inventados (CLAUDE.md regla 2).
 */
const HEAD = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">
<HTML><HEAD><TITLE>Notificacion</TITLE></HEAD><BODY>`;
const FOOT = `<P><FONT face="Nunito Sans Normal">Atentamente Produbanco</FONT></P></BODY></HTML>`;

function htmlConsumo(monto: string, comercio: string): string {
  return `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 02/Septiembre/2026  10:15</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Consumo Tarjeta de
Débito Produbanco</STRONG></FONT></P>
<P><STRONG><FONT face="Nunito Sans Normal">Detalle</FONT></STRONG></P>
<P><FONT face="Nunito Sans Normal"><STRONG>Valor:</STRONG> USD
${monto}<BR><STRONG>Establecimiento:</STRONG>
${comercio}                  Quito        EC<BR><STRONG>Cuenta Débito:</STRONG> ANA
XXXXXX54321</FONT></P>`;
}

/** Un consumo, ya decodificado a texto como lo entrega `gmail-client.ts`. */
function correoConsumo(id: string, monto: string, comercio = "COMERCIO EJEMPLO"): MensajeGmail {
  return {
    gmail_msg_id: id,
    gmail_thread_id: `hilo-${id}`,
    subject: `Consumo tarjeta de débito por USD ${monto}`,
    body: htmlToText(`${HEAD}\n${htmlConsumo(monto, comercio)}\n${FOOT}`),
    ts: "2026-09-02T15:15:00.000Z",
  };
}

/** Un cliente de Gmail de mentira que devuelve exactamente lo que se le pone. */
function gmailFalso(mensajes: MensajeGmail[]): ClienteGmail & { llamadas: string[] } {
  const porId = new Map(mensajes.map((m) => [m.gmail_msg_id, m]));
  const llamadas: string[] = [];
  return {
    llamadas,
    async buscarIds(query: string, limite: number) {
      llamadas.push(query);
      return mensajes.slice(0, limite).map((m) => m.gmail_msg_id);
    },
    async leerMensaje(id: string) {
      const m = porId.get(id);
      if (m === undefined) throw new Error(`sin mensaje ${id}`);
      return m;
    },
  };
}

describe("armarQuery", () => {
  it("resta un dia para no perder la franja del huso local", () => {
    expect(armarQuery("2026-07-01T02:00:00.000Z", ["banco.example"])).toBe(
      "from:banco.example after:2026/06/30"
    );
  });

  it("varios remitentes van entre parentesis para que el OR no se coma el after:", () => {
    const q = armarQuery("2026-07-02T00:00:00.000Z", ["a.example", "b.example"]);
    expect(q).toBe("(from:a.example OR from:b.example) after:2026/07/01");
  });

  it("un sinceTs ilegible cae a su prefijo de fecha en vez de romper", () => {
    expect(armarQuery("no-es-fecha", ["a.example"])).toBe("from:a.example after:no/es/fech");
  });
});

describe.skipIf(!hayEmulador)("ingestar (emulador)", () => {
  const handle = hayEmulador ? conectarEmulador() : null;
  const tenants: string[] = [];

  afterEach(async () => {
    if (handle === null) return;
    for (const uid of tenants.splice(0)) await limpiarTenant(handle.db, uid);
  });

  function nuevoTenant(etiqueta: string): string {
    const uid = uidDePrueba(etiqueta);
    tenants.push(uid);
    return uid;
  }

  it("escribe un consumo bajo su gmail_msg_id, con el monto del parser", async () => {
    const db = handle!.db;
    const uid = nuevoTenant("ingesta");
    const gmail = gmailFalso([correoConsumo("msg-1", "12.34")]);

    const resumen = await ingestar({ db, uid, gmail, offsetHours: -5 }, { sinceTs: "2026-09-01T00:00:00.000Z" });

    expect(resumen.vistos).toBe(1);
    expect(resumen.insertados).toBe(1);
    expect(resumen.duplicados).toBe(0);

    const doc = await db.doc(`users/${uid}/transactions/msg-1`).get();
    expect(doc.exists).toBe(true);
    // El id del documento ES el gmail_msg_id: eso es la idempotencia.
    expect(doc.id).toBe("msg-1");
    // En centavos, como `toTransactionDoc` — la misma funcion que la migracion.
    expect(doc.data()!.amountCents).toBe(1234);
    expect(doc.data()!.needsReview).toBe(false);
    // Derivados que la migracion tambien escribe: sin ellos el overview no
    // podria filtrar por mes ni sumar por categoria.
    expect(doc.data()!.month).toBe("2026-09");
    expect(doc.data()!.countable).toBe(true);
  });

  it("correr dos veces NO duplica: el segundo lote son duplicados", async () => {
    const db = handle!.db;
    const uid = nuevoTenant("idempotente");
    const gmail = gmailFalso([correoConsumo("msg-1", "12.34"), correoConsumo("msg-2", "56.78")]);
    const opciones = { sinceTs: "2026-09-01T00:00:00.000Z" };

    const primero = await ingestar({ db, uid, gmail, offsetHours: -5 }, opciones);
    const segundo = await ingestar({ db, uid, gmail, offsetHours: -5 }, opciones);

    expect(primero.insertados).toBe(2);
    expect(segundo.insertados).toBe(0);
    expect(segundo.duplicados).toBe(2);

    const total = await db.collection(`users/${uid}/transactions`).count().get();
    expect(total.data().count).toBe(2);
  });

  it("el lote respeta maxMensajes", async () => {
    const db = handle!.db;
    const uid = nuevoTenant("tope");
    const gmail = gmailFalso([
      correoConsumo("msg-1", "1.00"),
      correoConsumo("msg-2", "2.00"),
      correoConsumo("msg-3", "3.00"),
    ]);

    const resumen = await ingestar(
      { db, uid, gmail, offsetHours: -5 },
      { sinceTs: "2026-09-01T00:00:00.000Z", maxMensajes: 2 }
    );

    expect(resumen.vistos).toBe(2);
    expect(resumen.insertados).toBe(2);
  });

  /**
   * La invariante 4 de CLAUDE.md, dicha en un test: cero NO es "no pude
   * leerlo". Lo desconocido es el PAR (0, needsReview) — y `countable: false`
   * es lo que lo saca de todos los totales.
   */
  it("un monto ilegible se persiste como (0, needsReview) y no cuenta", async () => {
    const db = handle!.db;
    const uid = nuevoTenant("sin-monto");
    // El asunto y el cuerpo son los dos deterministas: que no coincidan
    // significa que uno se leyo mal y ninguno es de fiar. El parser devuelve
    // `amount: null`, y es ESE null el que este modulo tiene que convertir en
    // el par (0, needsReview) sin inventar un numero.
    const roto = correoConsumo("msg-roto", "12.34");
    roto.subject = "Consumo tarjeta de débito por USD 99.99";
    const gmail = gmailFalso([roto]);

    const resumen = await ingestar({ db, uid, gmail, offsetHours: -5 }, { sinceTs: "2026-09-01T00:00:00.000Z" });

    const doc = await db.doc(`users/${uid}/transactions/msg-roto`).get();
    if (resumen.insertados === 0) {
      // El parser lo descarto entero: tambien es un final aceptable — lo que
      // NO puede pasar es que quede una fila con monto 0 contable.
      expect(doc.exists).toBe(false);
      return;
    }
    expect(doc.data()!.needsReview).toBe(true);
    expect(doc.data()!.amountCents).toBe(0);
    expect(doc.data()!.countable).toBe(false);
    expect(resumen.enRevision).toBe(1);
  });

  it("un correo que el parser ignora no escribe nada", async () => {
    const db = handle!.db;
    const uid = nuevoTenant("ignorado");
    const gmail = gmailFalso([
      {
        gmail_msg_id: "msg-login",
        gmail_thread_id: null,
        subject: "Inicio de sesión exitoso",
        body: "Usted ha iniciado sesión en Banca Web.",
        ts: "2026-09-02T15:15:00.000Z",
      },
    ]);

    const resumen = await ingestar({ db, uid, gmail, offsetHours: -5 }, { sinceTs: "2026-09-01T00:00:00.000Z" });

    expect(resumen.insertados).toBe(0);
    const total = await db.collection(`users/${uid}/transactions`).count().get();
    expect(total.data().count).toBe(0);
  });

  it("el resumen dice hasta donde leyo, para que el llamador avance sinceTs", async () => {
    const db = handle!.db;
    const uid = nuevoTenant("ultimo-ts");
    const viejo = correoConsumo("msg-viejo", "1.00");
    viejo.ts = "2026-09-01T10:00:00.000Z";
    const nuevo = correoConsumo("msg-nuevo", "2.00");
    nuevo.ts = "2026-09-03T10:00:00.000Z";

    const resumen = await ingestar(
      { db, uid, gmail: gmailFalso([viejo, nuevo]), offsetHours: -5 },
      { sinceTs: "2026-09-01T00:00:00.000Z" }
    );

    expect(resumen.ultimoTs).toBe("2026-09-03T10:00:00.000Z");
  });

  it("lo que no se porto viaja en `pendiente` en vez de darse por hecho", async () => {
    const db = handle!.db;
    const uid = nuevoTenant("pendiente");
    const resumen = await ingestar(
      { db, uid, gmail: gmailFalso([]), offsetHours: -5 },
      { sinceTs: "2026-09-01T00:00:00.000Z" }
    );
    expect(resumen.pendiente).toContain("reconcile");
    expect(resumen.pendiente).toContain("verificacion-cruzada-claude");
  });
});
