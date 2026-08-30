import { describe, expect, it } from "vitest";
import {
  extractAccountHolder,
  extractField,
  extractLabeledAmount,
  extractMaskedAccount,
  maskedAccount,
  maskedAccountHolder,
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
  '<P><FONT face="Sans">Transacción: Transferencia recibida</FONT></P>\r\n' +
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

  // El salto del código fuente NO es un separador en la rama HTML: el mailer
  // envuelve el marcado a ~72 columnas y ese salto cae en cualquier parte. Se
  // colapsa a espacio y sólo sobreviven los saltos que declaró el marcado
  // (`<BR>`), que son los que separan un campo del siguiente.
  it("saca el marcado que se interpone entre una etiqueta y su valor", () => {
    expect(normalizeBody(CUERPO_HTML)).toContain("Monto: $45.00");
  });

  it("conserva como salto de línea el que declaró el marcado", () => {
    expect(normalizeBody(CUERPO_HTML)).toContain("$45.00\nDescripción:");
  });
});

describe("extractField", () => {
  it("lee un campo simple", () => {
    expect(extractField("Establecimiento: COMERCIO EJEMPLO", "Establecimiento")).toBe("COMERCIO EJEMPLO");
  });

  it("ignora acentos y mayusculas del label", () => {
    // El correo real escribe "Cuenta Débito" en el consumo y "Cuenta débito"
    // en el retiro: el mismo campo con dos grafias.
    expect(extractField("Cuenta Débito: ANA XXXXXX54321", "cuenta debito")).toBe("ANA XXXXXX54321");
    expect(extractField("Cuenta débito: ANA XXXXXX54321", "Cuenta Débito")).toBe("ANA XXXXXX54321");
  });

  it("lee el valor de un campo en texto plano", () => {
    expect(extractField(CUERPO_PLANO, "Banco Destino", ETIQUETAS_EJEMPLO)).toBe("Banco Ejemplo");
  });

  it("lee el mismo valor cuando el cuerpo viene en HTML", () => {
    expect(extractField(CUERPO_HTML, "Banco Destino", ETIQUETAS_EJEMPLO)).toBe("Banco Ejemplo");
  });

  it("corta en el salto de linea, que es donde empieza el campo siguiente", () => {
    expect(extractField("Contacto: NOMBRE EJEMPLO\nBanco Destino: BANCO EJEMPLO", "Contacto")).toBe("NOMBRE EJEMPLO");
  });

  it("corta en el proximo label declarado cuando dos campos comparten linea", () => {
    expect(extractField("Contacto: NOMBRE EJEMPLO Banco Destino: BANCO EJEMPLO", "Contacto", ["Banco Destino"])).toBe(
      "NOMBRE EJEMPLO"
    );
  });

  it("no confunde un label con otro que lo contiene como prefijo", () => {
    // "Cuenta" es prefijo de "Cuenta Destino": pedir "Cuenta Destino" no puede
    // resolverse contra el campo "Cuenta".
    expect(extractField("Cuenta Destino: XXXXX54321", "Cuenta Destino")).toBe("XXXXX54321");
  });

  it("devuelve null cuando el campo no esta", () => {
    expect(extractField("Monto: $12.34", "Establecimiento")).toBeNull();
    expect(extractField(CUERPO_PLANO, "Establecimiento", ETIQUETAS_EJEMPLO)).toBeNull();
  });

  it("devuelve null cuando el campo esta vacio", () => {
    // Un "" diria "el banco mando el campo vacio", que no es lo mismo que
    // "el campo no estaba".
    expect(extractField("Establecimiento:\nMonto: $12.34", "Establecimiento")).toBeNull();
    expect(extractField("Contacto:\nMonto: $1.00", "Contacto", ["Monto", "Contacto"])).toBeNull();
  });

  it("preserva los acentos del VALOR (solo el label se pliega para matchear)", () => {
    expect(extractField("Canal: App Móvil", "Canal")).toBe("App Móvil");
  });

  it("colapsa el relleno de espacios con que el banco padea los valores", () => {
    expect(extractField("Establecimiento: COMERCIO EJEMPLO      Quito        EC", "Establecimiento")).toBe(
      "COMERCIO EJEMPLO Quito EC"
    );
  });
});

describe("extractLabeledAmount", () => {
  it("lee un monto en USD anclado a su label", () => {
    expect(extractLabeledAmount("Valor: USD 12.34", "Valor")).toEqual({ amount: 12.34, ambiguous: false });
  });

  it("lee un monto en $ anclado a su label", () => {
    expect(extractLabeledAmount("Monto: $12.34", "Monto")).toEqual({ amount: 12.34, ambiguous: false });
  });

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

  it("no se lleva por delante otra cifra del cuerpo", () => {
    // El ancla al label es justamente para no agarrar la primera cifra que
    // aparezca (saldo, comision, referencia).
    expect(extractLabeledAmount("Saldo: $999.99\nMonto: $12.34", "Monto")).toEqual({ amount: 12.34, ambiguous: false });
  });

  it("exige exactamente dos decimales", () => {
    expect(extractLabeledAmount("Monto: $12.3", "Monto")).toEqual({ amount: null, ambiguous: false });
    expect(extractLabeledAmount("Monto: $12.345", "Monto")).toEqual({ amount: null, ambiguous: false });
  });

  it("devuelve null ante un separador de miles en vez de inventar un monto", () => {
    // "1,050.00" con una regex laxa se leeria como 50.00: un monto plausible
    // y equivocado. Preferimos null + needs_review.
    expect(extractLabeledAmount("Monto: $1,050.00", "Monto")).toEqual({ amount: null, ambiguous: false });
  });

  it("no confunde una fecha con un monto", () => {
    expect(extractLabeledAmount("Fecha: 01.07.2026", "Fecha")).toEqual({ amount: null, ambiguous: false });
  });

  it("devuelve null cuando el label existe pero no hay monto", () => {
    expect(extractLabeledAmount("Monto: pendiente", "Monto")).toEqual({ amount: null, ambiguous: false });
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

  describe("bareAllowed (monto sin token de moneda)", () => {
    // La cobranza con débito automático de Produbanco escribe "Monto: 45.00",
    // sin USD ni $. Sin esta opción el monto no se lee y el correo entero no
    // se puede catalogar.
    it("por defecto NO lee un monto sin moneda", () => {
      expect(extractLabeledAmount("Monto: 45.00", "Monto")).toEqual({ amount: null, ambiguous: false });
    });

    it("lo lee cuando quien llama lo declara", () => {
      expect(extractLabeledAmount("Monto: 45.00", "Monto", { bareAllowed: true })).toEqual({
        amount: 45.0,
        ambiguous: false,
      });
    });

    it("sigue leyendo el monto CON moneda", () => {
      expect(extractLabeledAmount("Monto: USD 45.00", "Monto", { bareAllowed: true })).toEqual({
        amount: 45.0,
        ambiguous: false,
      });
    });

    it("no confunde una fecha ni una referencia con un monto", () => {
      expect(extractLabeledAmount("Fecha: 01.07.2026", "Fecha", { bareAllowed: true })).toEqual({
        amount: null,
        ambiguous: false,
      });
      expect(extractLabeledAmount("Referencia: 987654321", "Referencia", { bareAllowed: true })).toEqual({
        amount: null,
        ambiguous: false,
      });
    });

    it("mantiene el guarda de ambigüedad", () => {
      expect(extractLabeledAmount("Monto: 45.00\nMonto: 46.00", "Monto", { bareAllowed: true })).toEqual({
        amount: null,
        ambiguous: true,
      });
    });
  });
});

describe("maskedAccount", () => {
  it("extrae el token enmascarado de un valor que tambien trae texto", () => {
    expect(maskedAccount("ANA XXXXXX54321")).toBe("XXXXXX54321");
  });

  it("extrae el token cuando el valor es solo la cuenta", () => {
    expect(maskedAccount("XXXXXXXXXXXXX54321")).toBe("XXXXXXXXXXXXX54321");
  });

  it("acepta la mascara corta de tarjeta de credito", () => {
    expect(maskedAccount("Tarjeta de Crédito Visa Produbanco XXX4321 .")).toBe("XXX4321");
  });

  it("acepta la mascara con asteriscos de otros bancos", () => {
    expect(maskedAccount("Cuenta ****4321")).toBe("****4321");
  });

  it("devuelve null cuando no hay ningun token enmascarado", () => {
    expect(maskedAccount("NOMBRE DEL CAJERO")).toBeNull();
    expect(maskedAccount(null)).toBeNull();
  });

  it("no confunde un numero suelto con una cuenta enmascarada", () => {
    expect(maskedAccount("Referencia: 987654321012")).toBeNull();
  });
});

describe("maskedAccountHolder", () => {
  it("devuelve lo que acompania al token enmascarado", () => {
    expect(maskedAccountHolder("PEREZ GOMEZ ANA MARIA XXXXXX54321")).toBe("PEREZ GOMEZ ANA MARIA");
  });

  it("devuelve null cuando el campo solo trae la cuenta", () => {
    expect(maskedAccountHolder("XXXXXXXXXXXXX54321")).toBeNull();
  });

  it("devuelve null cuando no hay token enmascarado", () => {
    expect(maskedAccountHolder("NOMBRE DEL CAJERO")).toBeNull();
  });
});

// `extractMaskedAccount`/`extractAccountHolder` son la variante que CRUZA el
// salto de línea: existe para los cuerpos de texto plano donde el banco corta
// las líneas a lo ancho y el valor de un campo queda partido en dos.
describe("extractMaskedAccount", () => {
  const CUERPO_RETIRO_HTML =
    "<P><STRONG>Monto:</STRONG> \r\n    $20.00<BR>" +
    "<STRONG>Cuenta débito:</STRONG> \r\n    ANA PEREZ XXXXXX4321<BR>" +
    "<STRONG>Cajero:</STRONG> \r\n    Sucursal Centro</P>";

  it("devuelve el token enmascarado de un cuerpo de texto plano", () => {
    expect(extractMaskedAccount("Cuenta débito: ANA PEREZ XXXXXX4321\nFecha: 01/07/2026", "Cuenta débito", ["Fecha"])).toBe(
      "XXXXXX4321"
    );
  });

  // Esta es la que dejaba `account` en NULL en todo el ledger: el `</STRONG>`
  // se comía el valor entero y quedaba la cadena vacía.
  it("devuelve el mismo token cuando el cuerpo viene en HTML", () => {
    expect(extractMaskedAccount(CUERPO_RETIRO_HTML, "Cuenta débito", ["Monto", "Cajero"])).toBe("XXXXXX4321");
  });

  it("devuelve null cuando el campo no está", () => {
    expect(extractMaskedAccount("Monto: $20.00", "Cuenta débito", ["Monto"])).toBeNull();
  });

  it("encuentra la cuenta aunque el valor del campo esté partido en dos líneas", () => {
    const cuerpo = "Establecimiento:\nTIENDA EJEMPLO\nCuenta débito: ANA\nXXXXXX4321";
    expect(extractMaskedAccount(cuerpo, "Cuenta débito", ["Establecimiento"])).toBe("XXXXXX4321");
  });

  it("no se lleva un token enmascarado que pertenece a otro campo", () => {
    const cuerpo = "Cuenta débito:\nEstablecimiento: TIENDA XXXXXX9999";
    expect(extractMaskedAccount(cuerpo, "Cuenta débito", ["Establecimiento"])).toBeNull();
  });

  it("reconoce otros formatos de máscara además de las X", () => {
    expect(extractMaskedAccount("Cuenta débito: ANA ****1234", "Cuenta débito")).toBe("****1234");
  });
});

describe("extractAccountHolder", () => {
  it("devuelve el nombre que precede a la cuenta enmascarada", () => {
    expect(extractAccountHolder("Cuenta débito: PEREZ GOMEZ ANA XXXXXX4321", "Cuenta débito")).toBe("PEREZ GOMEZ ANA");
  });

  it("devuelve el nombre aunque el valor esté partido en dos líneas", () => {
    expect(extractAccountHolder("Cuenta débito: PEREZ GOMEZ ANA\nXXXXXX4321", "Cuenta débito")).toBe("PEREZ GOMEZ ANA");
  });

  it("devuelve null cuando el campo sólo trae la cuenta", () => {
    expect(extractAccountHolder("Cuenta débito: XXXXXX4321", "Cuenta débito")).toBeNull();
  });

  it("devuelve null cuando el campo no está", () => {
    expect(extractAccountHolder("Monto: $20.00", "Cuenta débito", ["Monto"])).toBeNull();
  });
});
