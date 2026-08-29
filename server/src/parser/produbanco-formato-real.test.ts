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
