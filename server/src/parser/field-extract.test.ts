import { describe, expect, it } from "vitest";
import {
  extractAccountHolder,
  extractLabeledAmount,
  extractLabeledField,
  extractMaskedAccount,
  normalizeBody,
} from "./field-extract.js";

// ---------------------------------------------------------------------------
// Estos tests son de la CAPA COMPARTIDA: ningún fixture menciona Produbanco.
// Los cuerpos son de un banco ficticio ("Banco Ejemplo"), con la misma forma
// que manda cualquier banco que notifique por correo: un bloque "Detalle" con
// campos "Etiqueta: valor", en texto plano en unos correos y en HTML en otros.
//
// El bug que estos helpers existen para no repetir: el marcado se mete ENTRE
// la etiqueta y su valor (`<STRONG>Monto:</STRONG> $45.00`), así que un ancla
// que matchea sobre el cuerpo crudo no encuentra nada y devuelve null — que
// el pipeline convierte en una fila fuera de todos los totales.
// ---------------------------------------------------------------------------

/** Cómo llega un correo cuando el cliente encontró la parte `text/plain`. */
const CUERPO_PLANO =
  "Transacción: Transferencia recibida\n" +
  "Detalle\n" +
  "Banco Destino: Banco Ejemplo\n" +
  "Cuenta Destino: XXXXXX4321\n" +
  "Monto:\n" +
  "$45.00\n" +
  "Descripción:\n" +
  "Pago\n" +
  "Referencia: XXXXXXXX0001";

/** El MISMO correo cuando sólo viene la parte `text/html`. */
const CUERPO_HTML =
  "<P><FONT face=\"Sans\">Transacción: Transferencia recibida</FONT></P>\r\n" +
  "<P><STRONG>Detalle</STRONG></P>\r\n" +
  "<P><STRONG>Banco Destino:</STRONG> \r\n    Banco Ejemplo<BR>" +
  "<STRONG>Cuenta Destino:</STRONG> \r\n    XXXXXX4321<BR>" +
  "<STRONG>Monto:</STRONG> \r\n    $45.00<BR>" +
  "<STRONG>Descripción:</STRONG> \r\n    Pago<BR>" +
  "<STRONG>Referencia:</STRONG> \r\n    XXXXXXXX0001</P>";

const ETIQUETAS_EJEMPLO = ["Banco Destino", "Cuenta Destino", "Monto", "Descripción", "Referencia"];

describe("normalizeBody", () => {
  it("deja intacto un cuerpo que ya es texto plano", () => {
    expect(normalizeBody(CUERPO_PLANO)).toBe(CUERPO_PLANO);
  });

  it("es idempotente: normalizar dos veces da lo mismo que una", () => {
    const una = normalizeBody(CUERPO_HTML);
    expect(normalizeBody(una)).toBe(una);
  });

  it("saca el marcado que se interpone entre una etiqueta y su valor", () => {
    expect(normalizeBody(CUERPO_HTML)).toContain("Monto:\n$45.00");
  });
});

describe("extractLabeledAmount", () => {
  it("lee el monto anclado a su etiqueta en un cuerpo de texto plano", () => {
    expect(extractLabeledAmount(CUERPO_PLANO, "Monto")).toEqual({ amount: 45.0, ambiguous: false });
  });

  // El caso que perdía los ingresos: mismo correo, cuerpo con marcado.
  it("lee el mismo monto cuando el cuerpo viene en HTML", () => {
    expect(extractLabeledAmount(CUERPO_HTML, "Monto")).toEqual({ amount: 45.0, ambiguous: false });
  });

  it("no adivina de otra cifra del cuerpo cuando la etiqueta no está", () => {
    const cuerpo = "Saldo disponible: $154.30\nComisión: $0.50";
    expect(extractLabeledAmount(cuerpo, "Monto")).toEqual({ amount: null, ambiguous: false });
  });

  it("ignora las cifras que preceden a la etiqueta", () => {
    const cuerpo = "Saldo disponible: $999.99\nMonto: $45.00";
    expect(extractLabeledAmount(cuerpo, "Monto")).toEqual({ amount: 45.0, ambiguous: false });
  });

  it("acepta el monto etiquetado en USD además de en $", () => {
    expect(extractLabeledAmount("Monto: USD 9.42\nFecha: 01/07/2026", "Monto")).toEqual({
      amount: 9.42,
      ambiguous: false,
    });
  });

  it("exige dos decimales: no lee un número suelto como monto", () => {
    expect(extractLabeledAmount("Monto: $9.4\nReferencia: 1234", "Monto")).toEqual({
      amount: null,
      ambiguous: false,
    });
  });

  it("no confunde una fecha con un monto", () => {
    expect(extractLabeledAmount("Fecha: 01.07.2026", "Fecha")).toEqual({ amount: null, ambiguous: false });
  });

  // El guarda del análisis de riesgos, en su formulación correcta: se dispara
  // cuando la ETIQUETA ANCLADA aparece más de una vez con lecturas distintas —
  // NO cuando hay más de una cifra en el cuerpo (los cuerpos traen saldo y
  // comisión siempre, y eso marcaría el 100 % de los correos).
  it("marca ambiguo cuando la etiqueta aparece dos veces con montos distintos", () => {
    const cuerpo = "Monto: $45.00\nDetalle\nMonto: $12.00";
    expect(extractLabeledAmount(cuerpo, "Monto")).toEqual({ amount: null, ambiguous: true });
  });

  it("NO marca ambiguo cuando la etiqueta se repite con el mismo monto", () => {
    const cuerpo = "Monto: $45.00\nConfirmamos el Monto: $45.00";
    expect(extractLabeledAmount(cuerpo, "Monto")).toEqual({ amount: 45.0, ambiguous: false });
  });

  it("NO marca ambiguo cuando la etiqueta se repite pero sólo una trae cifra", () => {
    const cuerpo = "El Monto: acreditado se detalla abajo.\nMonto: $45.00";
    expect(extractLabeledAmount(cuerpo, "Monto")).toEqual({ amount: 45.0, ambiguous: false });
  });

  it("no se dispara por otras cifras del cuerpo cuando la etiqueta es única", () => {
    const cuerpo = "Saldo disponible: $154.30\nComisión: $0.50\nMonto: $20.00\nCajero: Sucursal Centro";
    expect(extractLabeledAmount(cuerpo, "Monto")).toEqual({ amount: 20.0, ambiguous: false });
  });
});

describe("extractLabeledField", () => {
  it("lee el valor de un campo en texto plano", () => {
    expect(extractLabeledField(CUERPO_PLANO, "Banco Destino", ETIQUETAS_EJEMPLO)).toBe("Banco Ejemplo");
  });

  it("lee el mismo valor cuando el cuerpo viene en HTML", () => {
    expect(extractLabeledField(CUERPO_HTML, "Banco Destino", ETIQUETAS_EJEMPLO)).toBe("Banco Ejemplo");
  });

  it("corta el valor antes de la etiqueta siguiente en la misma línea", () => {
    const cuerpo = "Contacto: Ana Perez Banco Destino: Banco Ejemplo";
    expect(extractLabeledField(cuerpo, "Contacto", ["Banco Destino", "Contacto"])).toBe("Ana Perez");
  });

  it("devuelve null cuando el campo no está", () => {
    expect(extractLabeledField(CUERPO_PLANO, "Establecimiento", ETIQUETAS_EJEMPLO)).toBeNull();
  });

  it("devuelve null cuando el campo está pero llega vacío", () => {
    expect(extractLabeledField("Contacto:\nMonto: $1.00", "Contacto", ["Monto", "Contacto"])).toBeNull();
  });
});

describe("extractMaskedAccount", () => {
  const CUERPO_RETIRO_HTML =
    "<P><STRONG>Monto:</STRONG> \r\n    $20.00<BR>" +
    "<STRONG>Cuenta débito:</STRONG> \r\n    ANA PEREZ XXXXXX4321<BR>" +
    "<STRONG>Cajero:</STRONG> \r\n    Sucursal Centro</P>";

  it("devuelve el token enmascarado de un cuerpo de texto plano", () => {
    expect(extractMaskedAccount("Cuenta débito: ANA PEREZ XXXXXX4321\nFecha: 01/07/2026", "Cuenta\\s*d[eé]bito", ["Fecha"])).toBe(
      "XXXXXX4321"
    );
  });

  // Esta es la que dejaba `account` en NULL en todo el ledger: el `</STRONG>`
  // se comía el valor entero y quedaba la cadena vacía.
  it("devuelve el mismo token cuando el cuerpo viene en HTML", () => {
    expect(extractMaskedAccount(CUERPO_RETIRO_HTML, "Cuenta\\s*d[eé]bito", ["Monto", "Cajero"])).toBe("XXXXXX4321");
  });

  it("devuelve null cuando el campo no está", () => {
    expect(extractMaskedAccount("Monto: $20.00", "Cuenta\\s*d[eé]bito", ["Monto"])).toBeNull();
  });

  // El HTML del banco corta las líneas a lo ancho, no por campo: el nombre del
  // titular queda en una línea y la cuenta en la siguiente, DENTRO del mismo
  // campo. Leer "hasta el salto de línea" devolvería el nombre y perdería la
  // cuenta — que es justo el token con el que se aparea un reverso.
  it("encuentra la cuenta aunque el valor del campo esté partido en dos líneas", () => {
    const cuerpo = "Establecimiento:\nTIENDA EJEMPLO\nCuenta débito: ANA\nXXXXXX4321";
    expect(extractMaskedAccount(cuerpo, "Cuenta\\s*d[eé]bito", ["Establecimiento"])).toBe("XXXXXX4321");
  });

  it("no se lleva un token enmascarado que pertenece a otro campo", () => {
    const cuerpo = "Cuenta débito:\nEstablecimiento: TIENDA XXXXXX9999";
    expect(extractMaskedAccount(cuerpo, "Cuenta\\s*d[eé]bito", ["Establecimiento"])).toBeNull();
  });

  it("reconoce otros formatos de máscara además de las X", () => {
    expect(extractMaskedAccount("Cuenta débito: ANA ****1234", "Cuenta\\s*d[eé]bito")).toBe("****1234");
  });
});

describe("extractAccountHolder", () => {
  it("devuelve el nombre que precede a la cuenta enmascarada", () => {
    expect(extractAccountHolder("Cuenta débito: PEREZ GOMEZ ANA XXXXXX4321", "Cuenta\\s*d[eé]bito")).toBe(
      "PEREZ GOMEZ ANA"
    );
  });

  it("devuelve el nombre aunque el valor esté partido en dos líneas", () => {
    expect(extractAccountHolder("Cuenta débito: PEREZ GOMEZ ANA\nXXXXXX4321", "Cuenta\\s*d[eé]bito")).toBe(
      "PEREZ GOMEZ ANA"
    );
  });

  it("devuelve null cuando el campo sólo trae la cuenta", () => {
    expect(extractAccountHolder("Cuenta débito: XXXXXX4321", "Cuenta\\s*d[eé]bito")).toBeNull();
  });

  it("devuelve null cuando el campo no está", () => {
    expect(extractAccountHolder("Monto: $20.00", "Cuenta\\s*d[eé]bito", ["Monto"])).toBeNull();
  });
});
