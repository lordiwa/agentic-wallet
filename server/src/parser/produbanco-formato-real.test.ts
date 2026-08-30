/**
 * Los fixtures de este archivo son el HTML **tal como lo manda Produbanco**:
 * el envoltorio MSHTML, el envuelto a ~72 columnas con el salto de linea
 * cayendo en el medio de labels y valores, los `<SPAN>&nbsp;</SPAN>` entre
 * label y valor, el relleno de espacios de `Establecimiento`, el pie legal.
 * Lo unico cambiado son los DATOS: nombres, montos, cuentas y referencias son
 * inventados.
 *
 * El formato esta documentado en docs/formato-correos-produbanco.md, medido
 * sobre una bandeja real. Es a proposito que estos fixtures entren por
 * `htmlToText` en vez de ser texto plano escrito a mano: el parser corre sobre
 * la salida de esa funcion, y el bug que este archivo bloquea vivia
 * exactamente ahi.
 */
import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-text.js";
import { produbancoParser } from "./produbanco.js";
import type { InboundEmail, ParsedTransaction } from "./types.js";

/** Encabezado MSHTML identico al real, incluido el `<HEADER>` con la imagen. */
const HEAD = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">
<HTML><HEAD><TITLE>Produbanco enlínea notificacion nuevo formato</TITLE>
<STYLE>BODY {color: #000; font-family: 'Nunito Sans Normal'; font-size: 14px;}</STYLE>

<META content="text/html; charset=unicode" http-equiv=Content-Type>
<META name=GENERATOR content="MSHTML 11.00.10570.1001"></HEAD>
<BODY><HEADER><TR><TD><IMG alt=""
src="https://content01.prd.net.ec/notificaciones/ImagenesCorreo/Header.png"
width=600 height=110></TD></TR></HEADER>`;

/** Pie legal real (acortado): cuatro parrafos de prosa sin ningun dato. */
const FOOT = `<P><FONT face="Nunito Sans Normal">Atentamente Produbanco</FONT></P>
<style type="text/css">/*<![CDATA[*/ .style1 { font-size: 9px; } /*]]>*/</style>
<div class="pie"><table><tbody><tr><td>
Su correo puede recibir mensajes con archivos o links adjuntos de esta institución.
Le recomendamos no reenviar información sensible por este medio.
</td></tr></tbody></table></div>
</BODY></HTML>`;

function email(subject: string, html: string): InboundEmail {
  return {
    subject,
    body: htmlToText(`${HEAD}\n${html}\n${FOOT}`),
    gmail_msg_id: "msg-1",
    gmail_thread_id: "thread-1",
    ts: "2026-08-01T19:32:00Z",
  };
}

function parse(subject: string, html: string): ParsedTransaction {
  const result = produbancoParser.parse(email(subject, html));
  if (result.kind !== "transaction") throw new Error(`esperaba "transaction", vino "${result.kind}"`);
  return result;
}

/** Los correos que traen parte `text/plain` NO pasan por `htmlToText`: el
 * cliente de Gmail prefiere esa parte cuando existe. Los fixtures de esas
 * plantillas entran tal cual, sin envoltorio MSHTML. */
function parsePlain(subject: string, text: string): ParsedTransaction {
  const result = produbancoParser.parse({
    subject,
    body: text,
    gmail_msg_id: "msg-1",
    gmail_thread_id: "thread-1",
    ts: "2026-06-01T20:24:00Z",
  });
  if (result.kind !== "transaction") throw new Error(`esperaba "transaction", vino "${result.kind}"`);
  return result;
}

/** El `reason` con el que se descarta un correo que NO es un movimiento de
 * plata. Se afirma el motivo y no sólo el descarte: "no lo catalogo" y "lo
 * catalogué como no-movimiento" se ven igual en el ledger y son cosas
 * distintas. */
function ignoredReason(subject: string, html: string): string {
  const result = produbancoParser.parse(email(subject, html));
  if (result.kind !== "ignored") throw new Error(`esperaba "ignored", vino "${result.kind}"`);
  return result.reason;
}

// ---------------------------------------------------------------------------
// 4.1 Consumo tarjeta de débito
// ---------------------------------------------------------------------------

// El salto de linea del codigo fuente cae DENTRO del valor de `Cuenta Débito`
// ("ANA \nXXXXXX54321") y DENTRO del monto ("USD \n12.34"). Ese envuelto es lo
// que hacia que `account` saliera null en 499 de 499 consumos reales.
const CONSUMO_DEBITO = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 01/Agosto/2026  14:32</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Consumo Tarjeta de
Débito Produbanco</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Te informamos que se acaba de registrar un
consumo con tu Tarjeta de Débito Produbanco.</FONT></P>
<P><STRONG><FONT face="Nunito Sans Normal">Detalle</FONT></STRONG></P>
<P><FONT face="Nunito Sans Normal"><STRONG>Valor:</STRONG> USD
12.34<BR><STRONG>Establecimiento:</STRONG>
COMERCIO EJEMPLO                  Quito        EC<BR><STRONG>Cuenta Débito:</STRONG> ANA
XXXXXX54321</FONT></P>
<P><FONT face="Nunito Sans Normal"></FONT></P>`;

describe("consumo tarjeta de débito (formato real)", () => {
  it("lee monto, contraparte, cuenta y titular", () => {
    const result = parse("Consumo tarjeta de débito por USD 12.34", CONSUMO_DEBITO);
    expect(result).toMatchObject({
      type: "debito",
      direction: "out",
      amount: 12.34,
      currency: "USD",
      counterparty: "COMERCIO EJEMPLO Quito EC",
      account: "XXXXXX54321",
      account_holder: "PEREZ GOMEZ ANA MARIA",
      needs_review: false,
    });
  });

  it("marca needs_review cuando el `Valor:` del cuerpo contradice el asunto", () => {
    // Los dos son deterministas y deben coincidir; que no coincidan significa
    // que uno de los dos se leyo mal, y ninguno de los dos es de fiar. El
    // motivo es el mismo `subject_body_amount_mismatch` de la transferencia
    // recibida: es un solo guarda, aplicado a todo correo que trae el monto por
    // duplicado, y un segundo nombre para lo mismo sólo partiria el filtro.
    const result = parse("Consumo tarjeta de débito por USD 99.99", CONSUMO_DEBITO);
    expect(result.needs_review).toBe(true);
    expect(result.amount).toBeNull();
    expect(result.review_reason).toBe("subject_body_amount_mismatch");
  });
});

// ---------------------------------------------------------------------------
// 4.2 Consumo tarjeta de crédito
// ---------------------------------------------------------------------------

// No hay NINGUN campo `Cuenta`: la tarjeta vive sola en la prosa, con la
// mascara corta de credito y un espacio antes del punto final.
const CONSUMO_CREDITO = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora:
01/08/2026 14:32</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Consumo Tarjeta de
Crédito Produbanco</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Te informamos que se acaba de registrar un
consumo con tu Tarjeta de Crédito Visa Produbanco XXX4321
.</FONT></P>
<P><FONT face="Nunito Sans Normal"><STRONG>Detalle</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal"><STRONG>Valor:</STRONG> USD
12.34<BR><STRONG>Establecimiento:</STRONG>
DLC* COMERCIO EJEMPLO</FONT></P>`;

describe("consumo tarjeta de crédito (formato real)", () => {
  it("saca la tarjeta de la prosa porque el correo no trae campo Cuenta", () => {
    expect(parse("Consumo Tarjeta de Crédito por USD 12.34", CONSUMO_CREDITO)).toMatchObject({
      type: "credito",
      direction: "out",
      amount: 12.34,
      counterparty: "DLC* COMERCIO EJEMPLO",
      account: "XXX4321",
      account_holder: "PEREZ GOMEZ ANA MARIA",
      needs_review: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 4.3 Transferencia enviada
// ---------------------------------------------------------------------------

// Este es el unico correo que trae los atributos `style` gigantes en cada `<P>`
// y `<SPAN>&nbsp;</SPAN>` entre cada label y su valor. Los saltos caen DENTRO
// de los labels ("Banco \nDestino:", "Cuenta \nDestino:").
const ENVIADA = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P
style="FONT-SIZE: 12px; FONT-FAMILY: Arial, Helvetica, sans-serif; WHITE-SPACE: normal; TEXT-TRANSFORM: none; COLOR: rgb(0,0,0); LETTER-SPACING: normal"><FONT
face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 01/Agosto/2026  14:32</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción:<SPAN>&nbsp;</SPAN><STRONG>Transferencia
Enviada Exitosamente desde Produbanco</STRONG></FONT></P>
<P><STRONG><FONT face="Nunito Sans Normal">Detalle</FONT></STRONG></P>
<P><FONT
face="Nunito Sans Normal"><STRONG>Contacto:</STRONG><SPAN>&nbsp;</SPAN>Nombre Del Beneficiario<BR><STRONG>Banco
Destino:</STRONG><SPAN>&nbsp;</SPAN>BANCO EJEMPLO<BR><STRONG>Cuenta
Destino:</STRONG><SPAN>&nbsp;</SPAN>XXXXX54321<BR><STRONG>Monto:</STRONG><SPAN>&nbsp;</SPAN>$12.34<BR><STRONG>Descripción:</STRONG><SPAN>&nbsp;</SPAN>Pago Servicios<BR><STRONG>Canal:</STRONG><SPAN>&nbsp;</SPAN>App Móvil<BR><STRONG>Referencia:</STRONG><SPAN>&nbsp;</SPAN>987654321012</FONT></P>`;

describe("transferencia enviada (formato real)", () => {
  it("lee el contacto sin arrastrar el label siguiente", () => {
    expect(parse("Transferencia enviada por $12.34 desde Produbanco", ENVIADA)).toMatchObject({
      type: "transferencia",
      direction: "out",
      amount: 12.34,
      counterparty: "Nombre Del Beneficiario",
      needs_review: false,
    });
  });

  it("deja account en null: `Cuenta Destino` es la del beneficiario, no la del usuario", () => {
    // El correo no dice de que cuenta salio la plata. Poner ahi la cuenta
    // destino seria guardar un dato correcto en el campo equivocado.
    expect(parse("Transferencia enviada por $12.34 desde Produbanco", ENVIADA).account).toBeNull();
  });

  it("reconoce la variante de asunto sin el sufijo 'desde Produbanco'", () => {
    expect(parse("Transferencia enviada por $12.34", ENVIADA).amount).toBe(12.34);
  });
});

// ---------------------------------------------------------------------------
// 4.4 Transferencia recibida
// ---------------------------------------------------------------------------

// El asunto NO trae monto, no existe campo `De:`/`Remitente:`, y la contraparte
// esta en la prosa. Las tres suposiciones del parser viejo estaban mal, y por
// eso los 63 correos reales de este tipo salian sin contraparte.
const RECIBIDA = `&nbsp;
<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT
face="Nunito Sans Normal"><STRONG>PEREZ GOMEZ ANA MARIA</STRONG></FONT></P>Te
confirmamos que <STRONG>ROJAS SILVA CARLOS ANDRES</STRONG> ha realizado una transferencia
a tu cuenta en <STRONG>BANCO EJEMPLO</STRONG>, enviada desde Produbanco.
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 01/Agosto/2026  14:32</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción:
<STRONG>Transferencia&nbsp;recibida desde Produbanco</STRONG></FONT></P>
<P><STRONG><FONT face="Nunito Sans Normal">Detalle</FONT></STRONG></P><STRONG></STRONG><FONT
face="Nunito Sans Normal">
<P><BR><STRONG>Banco Destino:</STRONG> BANCO EJEMPLO<BR><STRONG>Cuenta
Destino:</STRONG> XXXXX54321<BR><STRONG>Monto:</STRONG>
$12.34<BR><STRONG>Descripción:</STRONG>
Pago<BR><STRONG>Referencia:</STRONG> 987654321012</P>
<P></FONT>&nbsp;</P>`;

describe("transferencia recibida (formato real)", () => {
  it("saca el monto del campo Monto porque el asunto no lo trae", () => {
    expect(parse("Transferencia recibida desde Produbanco", RECIBIDA)).toMatchObject({
      type: "recibido",
      direction: "in",
      amount: 12.34,
      needs_review: false,
    });
  });

  it("saca la contraparte de la prosa porque no hay campo De/Remitente", () => {
    expect(parse("Transferencia recibida desde Produbanco", RECIBIDA).counterparty).toBe(
      "ROJAS SILVA CARLOS ANDRES"
    );
  });

  it("usa `Cuenta Destino` como account: acá el dinero ENTRA a esa cuenta", () => {
    expect(parse("Transferencia recibida desde Produbanco", RECIBIDA).account).toBe("XXXXX54321");
  });

  it("no deja needs_review cuando pudo leer el monto", () => {
    expect(parse("Transferencia recibida desde Produbanco", RECIBIDA).needs_review).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4.4b Transferencia recibida — variante `Contacto`
// ---------------------------------------------------------------------------

// El MISMO asunto que 4.4 llega con dos cuerpos distintos. Esta variante trae
// `Enviada por` / `Banco Contacto` / `Cuenta Contacto` en vez de la prosa
// "Te confirmamos que ..." y `Cuenta Destino`, y ademas llega como texto plano
// (el cliente de Gmail prefiere el `text/plain` cuando el correo lo trae).
//
// `Contacto` aca es el DESTINO, no la contraparte: ninguno de los correos
// reales de esta variante trae Produbanco en `Banco Contacto` — y el dinero
// sale de Produbanco—, y sus valores son los mismos que el `Banco Destino` /
// `Cuenta Destino` de la variante 4.4. Ver docs/formato-correos-produbanco.md.
const RECIBIDA_CONTACTO = `Estimado/a
PEREZ GOMEZ ANA MARIA
Fecha y Hora: 01/Junio/2026 20:24
Transacción: Transferencia recibida desde Produbanco
Detalle
Enviada por: ROJAS SILVA CARLOS ANDRES
Banco Contacto: BANCO EJEMPLO
Cuenta Contacto: XXXXX54321
Monto: $7.50
Descripción: Pago
Referencia: 121272020900
Atentamente Produbanco`;

describe("transferencia recibida — variante Contacto (4.4b)", () => {
  it("lee el monto del campo Monto", () => {
    expect(parsePlain("Transferencia recibida desde Produbanco", RECIBIDA_CONTACTO)).toMatchObject({
      type: "recibido",
      direction: "in",
      amount: 7.5,
      needs_review: false,
    });
  });

  it("saca la contraparte de `Enviada por`, que en esta variante SI es un campo", () => {
    expect(parsePlain("Transferencia recibida desde Produbanco", RECIBIDA_CONTACTO).counterparty).toBe(
      "ROJAS SILVA CARLOS ANDRES"
    );
  });

  it("usa `Cuenta Contacto` como account: es la cuenta destino, la del usuario", () => {
    expect(parsePlain("Transferencia recibida desde Produbanco", RECIBIDA_CONTACTO).account).toBe("XXXXX54321");
  });
});

// ---------------------------------------------------------------------------
// 4.5 Pago de servicio
// ---------------------------------------------------------------------------

// Aca `Cuenta Débito` viene SIN titular delante, y el nombre del servicio va
// pegado al `Transacción:`.
const SERVICIO = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 01/Agosto/2026  9:05</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Pago de Servicio
Combos Ejemplo</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Canal:
<STRONG>Banca Web</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Te informamos que el siguiente pago se ha
realizado.</FONT></P>
<P><STRONG><FONT face="Nunito Sans Normal">Detalle</FONT></STRONG></P>
<P><FONT face="Nunito Sans Normal"><STRONG>Suministro:</STRONG>
123456789<BR><STRONG>Monto:</STRONG> USD
12.34<BR><STRONG>Cuenta Débito:</STRONG>
XXXXXXXXXXXXX54321<BR><STRONG>Descripción:</STRONG>
Combos Ejemplo<BR><STRONG>Referencia:</STRONG> 987654321</FONT></P>`;

describe("pago de servicio (formato real)", () => {
  it("lee el servicio, el monto y la cuenta debitada", () => {
    expect(parse("Pago de servicio por USD 12.34", SERVICIO)).toMatchObject({
      type: "servicio",
      direction: "out",
      amount: 12.34,
      counterparty: "Combos Ejemplo",
      account: "XXXXXXXXXXXXX54321",
      needs_review: false,
    });
  });

  it("no inventa titular cuando el campo trae solo la cuenta", () => {
    // El titular sigue saliendo del encabezado, no del campo.
    expect(parse("Pago de servicio por USD 12.34", SERVICIO).account_holder).toBe("PEREZ GOMEZ ANA MARIA");
  });
});

// ---------------------------------------------------------------------------
// 4.6 Retiro sin tarjeta
// ---------------------------------------------------------------------------

const RETIRO = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora:
01/08/2026 14:32</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Retiro sin
tarjeta de débito Produbanco en cajero
Automático</STRONG></FONT></P>
<P><STRONG><FONT face="Nunito Sans Normal">Detalle</FONT></STRONG></P>
<P><FONT face="Nunito Sans Normal"><STRONG>Monto:</STRONG>
$12.34<BR><STRONG>Cuenta débito:</STRONG>
ANA XXXXXX54321<BR><STRONG>Cajero:</STRONG>
NOMBRE DEL CAJERO</FONT></P>`;

describe("retiro sin tarjeta (formato real)", () => {
  it("lee monto y cuenta, y no arrastra el campo Cajero", () => {
    expect(parse("Retiro sin tarjeta de débito Produbanco en cajero automático", RETIRO)).toMatchObject({
      type: "retiro",
      direction: "out",
      amount: 12.34,
      account: "XXXXXX54321",
      needs_review: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 4.7 Transferencia internacional recibida
// ---------------------------------------------------------------------------

// Sin bloque `Detalle`: cuenta, empresa y monto salen los tres de una misma
// frase, partida en dos por el envuelto del mailer.
const INTERNACIONAL = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 01/Agosto/2026  14:32</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Transferencia
Internacional Recibida</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Te confirmamos la acreditación en tu cuenta
XXXXXX54321 de la transferencia Internacional Recibida de EMPRESA EJEMPLO S.A.
por el valor de USD 1234.56.</FONT></P>`;

describe("transferencia internacional recibida (formato real)", () => {
  it("lee empresa, monto y cuenta acreditada de la prosa", () => {
    expect(parse("Notificación Transferencia Internacional Recibida", INTERNACIONAL)).toMatchObject({
      type: "sueldo",
      direction: "in",
      amount: 1234.56,
      counterparty: "EMPRESA EJEMPLO S.A.",
      account: "XXXXXX54321",
      needs_review: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 4.8 Compra de minutos
// ---------------------------------------------------------------------------

const CLARO = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y hora de
compra:01/Agosto/2026 14:32</FONT></P>
<P><FONT face="Nunito Sans Normal">Se ha realizado la compra de minutos Claro por un
valor de USD 12.34 debitado de la cuenta ANA
XXXXXX54321.</FONT></P>`;

describe("compra de minutos (formato real)", () => {
  it("lee monto y cuenta de la prosa, sin comerse el punto final", () => {
    expect(parse("COMPRA MINUTOS CLARO", CLARO)).toMatchObject({
      type: "recarga",
      direction: "out",
      amount: 12.34,
      counterparty: "Claro",
      account: "XXXXXX54321",
      needs_review: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 4.8-bis La preposicion del ancla: "de SU cuenta"
// ---------------------------------------------------------------------------

// El cuerpo REAL de la compra de minutos no dice "de la cuenta" sino "de su
// cuenta", y con el tipo de cuenta ("AHO") delante del token. El ancla anterior
// pedia "de la cuenta" y por eso `account` salia null en el 100% de las
// recargas de la bandeja real.
const CLARO_DE_SU_CUENTA = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y hora de
compra:01/Agosto/2026 14:32</FONT></P>
<P><FONT face="Nunito Sans Normal">Se ha realizado la compra de minutos Claro por un
valor de USD 12.34 debitado de su cuenta AHO
XXXXXX54321.</FONT></P>`;

describe("compra de minutos, cuerpo real (4.8)", () => {
  it("lee la cuenta cuando el correo dice 'de su cuenta' y no 'de la cuenta'", () => {
    expect(parse("COMPRA MINUTOS CLARO", CLARO_DE_SU_CUENTA)).toMatchObject({
      type: "recarga",
      direction: "out",
      amount: 12.34,
      counterparty: "Claro",
      account: "XXXXXX54321",
      needs_review: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 4.10 COMPRA RECARGA MOVISTAR
// ---------------------------------------------------------------------------

const MOVISTAR = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y hora de
proceso:01/Julio/2026 9:05</FONT></P>
<P><FONT face="Nunito Sans Normal">Se realizo una recarga Movistar por un valor
de USD 12.34 debitado de su cuenta ANA XXXXXX54321.</FONT></P>
<P><FONT face="Nunito Sans Normal">Este es un servicio de PRODUBANCO
enlínea.</FONT></P>`;

describe("compra recarga Movistar (4.10)", () => {
  it("lee monto, operadora y cuenta", () => {
    expect(parse("COMPRA RECARGA MOVISTAR", MOVISTAR)).toMatchObject({
      type: "recarga",
      direction: "out",
      amount: 12.34,
      counterparty: "Movistar",
      account: "XXXXXX54321",
      needs_review: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 4.11 Cobranza con debito automatico
// ---------------------------------------------------------------------------

// Sin bloque `Detalle`, sin ningun campo de cuenta, y —lo que lo hacia
// imposible de leer— con el `Monto:` SIN token de moneda.
const COBRANZA = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 01/07/2026
09:05:11</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>DEBITO EMPRESA
EJEMPLO S.A</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Canal: <STRONG>Produbanco
Empresas</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Monto: <STRONG>123.45</STRONG></FONT></P>`;

describe("cobranza con débito automático (4.11)", () => {
  it("lee el monto aunque venga sin USD ni $, y la empresa del Transacción:", () => {
    expect(parse("Cobranza con débito automático", COBRANZA)).toMatchObject({
      type: "servicio",
      direction: "out",
      amount: 123.45,
      counterparty: "EMPRESA EJEMPLO S.A",
      needs_review: false,
    });
  });

  it("deja account en null: el correo no dice de qué cuenta salió", () => {
    expect(parse("Cobranza con débito automático", COBRANZA).account).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4.12 Retiro de Efectivo en cajero
// ---------------------------------------------------------------------------

// Mismo bloque `Detalle` que 4.6, pero con `Fecha y Hora de Proceso` en vez de
// `Fecha y Hora` y otro asunto.
const RETIRO_CAJERO = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora de Proceso: 01/08/2026
14:32</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Retiro de Efectivo
Produbanco en Cajero Automático</STRONG></FONT></P>
<P><STRONG><FONT face="Nunito Sans Normal">Detalle</FONT></STRONG></P>
<P><FONT face="Nunito Sans Normal"><STRONG>Monto:</STRONG>
$12.34<BR><STRONG>Cuenta débito:</STRONG>
ANA XXXXXX54321<BR><STRONG>Cajero:</STRONG> Banred</FONT></P>`;

describe("retiro de efectivo en cajero (4.12)", () => {
  it("lee monto y cuenta sin arrastrar el campo Cajero", () => {
    expect(parse("Retiro de Efectivo Produbanco en Cajero Automático", RETIRO_CAJERO)).toMatchObject({
      type: "retiro",
      direction: "out",
      amount: 12.34,
      account: "XXXXXX54321",
      needs_review: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 4.13 Pago Tarjeta de Credito
// ---------------------------------------------------------------------------

// Todo en una frase: la tarjeta pagada, el monto, y la cuenta de la que salio.
const PAGO_TARJETA = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 01/Agosto/2026 14:32</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Pago Tarjeta de
Crédito Produbanco</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Registramos el pago de la tarjeta VISA EJEMPLO
XXXXXXXXXXXX4321 por el monto de USD 123.45 a través del canal App Móvil,
debitado de la cuenta XXXXXX54321.</FONT></P>`;

describe("pago de tarjeta de crédito (4.13)", () => {
  it("lee monto, tarjeta pagada y cuenta debitada de la prosa", () => {
    expect(parse("Pago Tarjeta de Crédito Produbanco", PAGO_TARJETA)).toMatchObject({
      type: "transferencia",
      direction: "out",
      amount: 123.45,
      counterparty: "VISA EJEMPLO XXXXXXXXXXXX4321",
      account: "XXXXXX54321",
      needs_review: false,
    });
  });

  it("lo marca interno: es plata propia pagando deuda propia, no gasto nuevo", () => {
    // El gasto ya se contó cuando se usó la tarjeta (las filas `credito`).
    // Sumarlo otra vez acá seria contar el mismo consumo dos veces.
    expect(parse("Pago Tarjeta de Crédito Produbanco", PAGO_TARJETA).is_internal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4.14 Notificacion Pago de Servicio <EMPRESA>
// ---------------------------------------------------------------------------

// Es un correo DISTINTO del 4.5 y de un pago distinto: se verifico en la
// bandeja real que los dos llegan el mismo minuto por dos servicios diferentes
// pagados en la misma sesion, no por duplicado del mismo pago.
const NOTIF_SERVICIO = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 01/Agosto/2026 9:05</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Pago de Servicio
AGUA EJEMPLO</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Confirmamos el pago del servicio de agua
potable AGUA EJEMPLO por un valor de USD 12.34 debitado de su cuenta ANA
XXXXXX54321.</FONT></P>`;

describe("notificación pago de servicio (4.14)", () => {
  it("lee servicio, monto y cuenta de la prosa", () => {
    expect(parse("Notificación Pago de Servicio AGUA EJEMPLO", NOTIF_SERVICIO)).toMatchObject({
      type: "servicio",
      direction: "out",
      amount: 12.34,
      counterparty: "AGUA EJEMPLO",
      account: "XXXXXX54321",
      needs_review: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 4.15 Transferencia acreditada (plantilla vieja de la transferencia enviada)
// ---------------------------------------------------------------------------

// Labels `Beneficiario` / `Cuenta Beneficiario` en vez de `Contacto` /
// `Cuenta Destino`. La cuenta sigue siendo la del OTRO: `account` va null.
const ACREDITADA = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 01/05/2026
15:28:03</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Transferencia
Acreditada Produbanco</STRONG></FONT></P>
<P><STRONG><FONT face="Nunito Sans Normal">Detalle</FONT></STRONG></P>
<P><FONT face="Nunito Sans Normal"><STRONG>Beneficiario:</STRONG> NOMBRE DEL
BENEFICIARIO<BR><STRONG>Banco Beneficiario:</STRONG>
Produbanco<BR><STRONG>Cuenta Beneficiario:</STRONG>
XXXXXX54321<BR><STRONG>Monto:</STRONG> $12.34<BR><STRONG>Descripción:</STRONG>
Deuda<BR><STRONG>Canal:</STRONG> App Móvil<BR><STRONG>Referencia:</STRONG>
987654321</FONT></P>`;

describe("transferencia acreditada (4.15)", () => {
  it("lee beneficiario y monto, y NO guarda la cuenta ajena como propia", () => {
    expect(parse("Transferencia acreditada Produbanco", ACREDITADA)).toMatchObject({
      type: "transferencia",
      direction: "out",
      amount: 12.34,
      counterparty: "NOMBRE DEL BENEFICIARIO",
      account: null,
      needs_review: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 4.16 Transferencia Recibida EN Produbanco
// ---------------------------------------------------------------------------

// Aca la contraparte SI tiene campo propio (`Enviada por:`) — a diferencia de
// 4.4, donde solo esta en la prosa. Y `Cuenta Beneficiario` es la del usuario.
const RECIBIDA_EN = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 01/mayo/2026 10:15</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Transferencia Recibida
Produbanco</STRONG></FONT></P>
<P><STRONG><FONT face="Nunito Sans Normal">Detalle</FONT></STRONG></P>
<P><FONT face="Nunito Sans Normal"><STRONG>Enviada por:</STRONG> EMPRESA
EJEMPLO SA<BR><STRONG>Banco Origen:</STRONG> BANCO
EJEMPLO<BR><STRONG>Beneficiario:</STRONG> PEREZ GOMEZ ANA
MARIA<BR><STRONG>Cuenta Beneficiario:</STRONG>
XXXXXX54321<BR><STRONG>Monto:</STRONG> $12.34<BR><STRONG>Descripción:</STRONG>
PAGOS VARIOS<BR><STRONG>Referencia:</STRONG> 98765432</FONT></P>`;

describe("transferencia recibida en Produbanco (4.16)", () => {
  it("lee remitente, monto y la cuenta acreditada del usuario", () => {
    expect(parse("Transferencia Recibida en Produbanco", RECIBIDA_EN)).toMatchObject({
      type: "recibido",
      direction: "in",
      amount: 12.34,
      counterparty: "EMPRESA EJEMPLO SA",
      account: "XXXXXX54321",
      needs_review: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 5.2-bis Los correos que NO son movimientos de plata
// ---------------------------------------------------------------------------

// Este es el mas peligroso de todos: es la EMISION DEL CODIGO de un retiro sin
// tarjeta, no el retiro. No trae monto, y el retiro de verdad llega despues en
// su propio correo ("Retiro sin tarjeta ... en cajero automatico", 4.6).
// Catalogarlo como movimiento contaria el retiro dos veces.
const RETIRO_CODIGO = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 01/Agosto/2026 13:27</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Retiro de Efectivo sin
Tarjeta de Débito Produbanco</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Canal: <STRONG>App Móvil</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Tu orden de retiro sin tarjeta ha sido
registrada. Usa el siguiente código en nuestra red de cajeros
automáticos:</FONT></P>
<P><FONT face="Nunito Sans Normal">Código: <STRONG>123456</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Vigencia: 24 horas o hasta realizar el
retiro.</FONT></P>`;

// Un consumo RECHAZADO. Trae "$12.34" en la prosa: un catalogo laxo lo leeria
// como un gasto que nunca ocurrio.
const NO_PROCESADO = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Fecha y Hora: 01/08/2026
18:02:44</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Consumo No
Procesado</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">Te informamos que el pago con tu tarjeta de
débito Produbanco terminada en XXX54321 por $12.34 en COMERCIO EJEMPLO no fue
procesada por insuficiencia de fondos en la cuenta.</FONT></P>`;

const APORTE_FLEXI = `<P><FONT face="Nunito Sans Normal">Estimado/a,</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Te confirmamos que realizaste un aporte de
USD 123.45 a tu FlexiAhorro Ahorrar por ahorrar.</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Aporte de dinero de
FlexiAhorro</STRONG></FONT></P>`;

const ESTADO_TARJETA = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Transacción: <STRONG>Estado de Cuenta
Tarjeta de Crédito</STRONG></FONT></P>
<P><FONT face="Nunito Sans Normal">En el adjunto podrás encontrar el Estado de
Cuenta de tu TARJETA DE CREDITO Produbanco.</FONT></P>`;

const CLAVE_TEMPORAL = `<P><FONT face="Nunito Sans Normal">Estimado/a</FONT></P>
<P><FONT face="Nunito Sans Normal">PEREZ GOMEZ ANA MARIA</FONT></P>
<P><FONT face="Nunito Sans Normal">Tu clave temporal para compras por internet
es 123456.</FONT></P>`;

describe("correos que no son movimientos de plata (5.2)", () => {
  it("la emisión del código de retiro sin tarjeta NO es el retiro", () => {
    expect(ignoredReason("Retiro de Efectivo sin tarjeta de débito Produbanco", RETIRO_CODIGO)).toBe(
      "retiro_code_issued"
    );
  });

  it("un consumo rechazado no es un gasto, aunque el cuerpo traiga un monto", () => {
    expect(ignoredReason("Consumo No Procesado", NO_PROCESADO)).toBe("consumo_no_procesado");
  });

  it("el aporte al FlexiAhorro es interno, igual que el retiro del FlexiAhorro", () => {
    expect(ignoredReason("Aportaste a tu FlexiAhorro Ahorrar por ahorrar", APORTE_FLEXI)).toBe(
      "flexiahorro_internal_transfer"
    );
  });

  it("el estado de cuenta de la tarjeta no trae datos en el cuerpo: van en el adjunto", () => {
    expect(ignoredReason("Notificación Estado de Cuenta Tarjeta de Crédito", ESTADO_TARJETA)).toBe(
      "statement_attachment_only"
    );
  });

  it("los avisos de seguridad y servicio no son movimientos", () => {
    expect(
      ignoredReason("Notificación Clave Temporal de Seguridad para Compras por Internet", CLAVE_TEMPORAL)
    ).toBe("security_notice");
  });
});
