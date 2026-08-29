import { afterEach, describe, expect, it } from "vitest";
import { produbancoParser } from "./produbanco.js";
import { listParsers, parseEmail, registerParser } from "./registry.js";
import type { BankEmailParser, InboundEmail, ParsedTransaction } from "./types.js";

function email(overrides: Partial<InboundEmail> = {}): InboundEmail {
  return {
    subject: "",
    body: "",
    gmail_msg_id: "msg-1",
    gmail_thread_id: "thread-1",
    ts: "2026-07-01T12:00:00Z",
    ...overrides,
  };
}

/** Narrows a ParseResult to ParsedTransaction, failing loudly with the actual kind otherwise. */
function asTransaction(result: ReturnType<typeof produbancoParser.parse>): ParsedTransaction {
  if (result.kind !== "transaction") {
    throw new Error(`expected kind "transaction", got "${result.kind}"`);
  }
  return result;
}

describe("produbancoParser.canParse", () => {
  it("matches when the subject mentions Produbanco", () => {
    expect(produbancoParser.canParse(email({ subject: "Consumo tarjeta de débito Produbanco" }))).toBe(true);
  });

  it("matches when only the body mentions Produbanco", () => {
    expect(
      produbancoParser.canParse(email({ subject: "Algo", body: "Notificación enviada por Produbanco." }))
    ).toBe(true);
  });

  it("does not match emails with no mention of Produbanco", () => {
    expect(produbancoParser.canParse(email({ subject: "Newsletter semanal", body: "Hola." }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Spec 5.5 fixtures — exact regression values from the ticket.
// ---------------------------------------------------------------------------

describe("spec 5.5 fixtures", () => {
  it("9.42 debito", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Consumo tarjeta de débito por USD 9.42",
          body: "Transacción: Consumo Tarjeta de Débito Produbanco\nEstablecimiento: COMISARIATO EXPRESS\nFecha: 01/07/2026",
        })
      )
    );
    expect(result.type).toBe("debito");
    expect(result.direction).toBe("out");
    expect(result.amount).toBe(9.42);
    expect(result.currency).toBe("USD");
    expect(result.needs_review).toBe(false);
  });

  it("30.00 transferencia (Carlos Andres Molina Vera)", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Transferencia enviada por $30.00 desde Produbanco",
          body: "Contacto: Carlos Andres Molina Vera Banco Destino: Banco Pichincha",
        })
      )
    );
    expect(result.type).toBe("transferencia");
    expect(result.direction).toBe("out");
    expect(result.amount).toBe(30.0);
    expect(result.counterparty).toBe("Carlos Andres Molina Vera");
  });

  it("20.00 retiro", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Retiro sin tarjeta de débito Produbanco en cajero automático",
          body: "Detalle Monto: $20.00 Cuenta débito: ANA XXXXXX20924",
        })
      )
    );
    expect(result.type).toBe("retiro");
    expect(result.direction).toBe("out");
    expect(result.amount).toBe(20.0);
    expect(result.account).toBe("XXXXXX20924");
  });

  // "Cuenta débito: <NOMBRE DEL TITULAR> <cuenta enmascarada>": el nombre es la
  // unica evidencia del titular que traen los correos, y hasta ahora se tiraba.
  it("guarda el nombre del titular aparte de la cuenta enmascarada", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Retiro sin tarjeta de débito Produbanco en cajero automático",
          body: "Detalle Monto: $20.00 Cuenta débito: PEREZ GOMEZ ANA MARIA XXXXXX20924",
        })
      )
    );
    expect(result.account).toBe("XXXXXX20924");
    expect(result.account_holder).toBe("PEREZ GOMEZ ANA MARIA");
  });

  it("deja account_holder en null cuando el campo solo trae la cuenta", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Retiro sin tarjeta de débito Produbanco en cajero automático",
          body: "Detalle Monto: $20.00 Cuenta débito: XXXXXX20924",
        })
      )
    );
    expect(result.account).toBe("XXXXXX20924");
    expect(result.account_holder).toBeNull();
  });

  it("5.00 recarga Claro", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "COMPRA MINUTOS CLARO",
          body: "Se ha realizado la compra de minutos Claro por un valor de USD 5.00 en tu línea.",
        })
      )
    );
    expect(result.type).toBe("recarga");
    expect(result.direction).toBe("out");
    expect(result.amount).toBe(5.0);
    expect(result.counterparty).toBe("Claro");
  });

  it("2337.71 sueldo Acme Corp S.A.", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Notificación Transferencia Internacional Recibida",
          body: "Hemos acreditado a tu cuenta una transferencia de Acme Corp S.A. por el valor de USD 2337.71.",
        })
      )
    );
    expect(result.type).toBe("sueldo");
    expect(result.direction).toBe("in");
    expect(result.amount).toBe(2337.71);
    expect(result.counterparty).toBe("Acme Corp S.A.");
  });
});

// ---------------------------------------------------------------------------
// Catalog 5.1 — one test per type not already covered above, plus field
// variants (Beneficiario, Tuenti) called out in AC2.
// ---------------------------------------------------------------------------

describe("catalog: consumo credito", () => {
  it("classifies as credito/out and reads the establishment", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Consumo Tarjeta de Crédito por USD 15.00",
          body: "Transacción: Consumo Tarjeta de Crédito Produbanco\nEstablecimiento: NETFLIX.COM\nFecha: 02/07/2026",
        })
      )
    );
    expect(result.type).toBe("credito");
    expect(result.direction).toBe("out");
    expect(result.amount).toBe(15.0);
    expect(result.counterparty).toBe("NETFLIX.COM");
  });
});

describe("catalog: transferencia enviada", () => {
  it("falls back to Beneficiario when Contacto is absent", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Transferencia enviada por $75.50 desde Produbanco",
          body: "Beneficiario: Maria Fernanda Lopez Cuenta Destino: 2200112233",
        })
      )
    );
    expect(result.type).toBe("transferencia");
    expect(result.amount).toBe(75.5);
    expect(result.counterparty).toBe("Maria Fernanda Lopez");
  });
});

describe("catalog: pago de servicio", () => {
  it("classifies Combos Tuenti as servicio/out", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Pago de servicio por USD 12.50",
          body: "Pago de Servicio Combos Tuenti realizado con éxito.",
        })
      )
    );
    expect(result.type).toBe("servicio");
    expect(result.direction).toBe("out");
    expect(result.amount).toBe(12.5);
    expect(result.counterparty).toBe("Tuenti");
  });

  it("classifies Combos Claro as servicio/out", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Pago de servicio por USD 8.00",
          body: "Pago de Servicio Combos Claro realizado con éxito.",
        })
      )
    );
    expect(result.counterparty).toBe("Claro");
  });
});

describe("catalog: transferencia recibida", () => {
  it("classifies as recibido/in and reads the sender", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Transferencia recibida desde Produbanco",
          body: "De: Juan Perez Monto: $45.00 Cuenta: XXXXXX1111",
        })
      )
    );
    expect(result.type).toBe("recibido");
    expect(result.direction).toBe("in");
    expect(result.amount).toBe(45.0);
    expect(result.counterparty).toBe("Juan Perez");
  });
});

// ---------------------------------------------------------------------------
// Spec 5.2 — ignore list and F1-04/F1-05 markers.
// ---------------------------------------------------------------------------

describe("ignore list (spec 5.2)", () => {
  it("ignores login notifications", () => {
    const result = produbancoParser.parse(email({ subject: "Notificación Ingreso App Móvil Produbanco" }));
    expect(result.kind).toBe("ignored");
    expect((result as { reason: string }).reason).toBe("login_notification");
  });

  it("classifies reversal notifications as reverso, not consumo", () => {
    const result = produbancoParser.parse(
      email({ subject: "Notificación Reverso Consumo Tarjeta de Débito Produbanco" })
    );
    expect(result.kind).toBe("reverso");
  });

  it("ignores contact-creation notifications", () => {
    const result = produbancoParser.parse(email({ subject: "Notificación Creación de Contacto Produbanco" }));
    expect(result.kind).toBe("ignored");
    expect((result as { reason: string }).reason).toBe("contact_created");
  });

  it("ignores FlexiAhorro reminders", () => {
    const result = produbancoParser.parse(email({ subject: "¡Mantén tu FlexiAhorro en marcha!" }));
    expect(result.kind).toBe("ignored");
  });

  it("ignores FlexiAhorro-to-account transfers (not a real retiro)", () => {
    const result = produbancoParser.parse(email({ subject: "Retiro de tu FlexiAhorro Produbanco" }));
    expect(result.kind).toBe("ignored");
    expect((result as { reason: string }).reason).toBe("flexiahorro_internal_transfer");
  });

  it("recognizes statement emails without emitting a transaction", () => {
    const result = produbancoParser.parse(
      email({ subject: "Estado de Cuenta Produbanco - Grupo Promerica" })
    );
    expect(result.kind).toBe("statement");
  });

  it("ignores subjects that don't match any known pattern", () => {
    const result = produbancoParser.parse(email({ subject: "Boletín informativo Produbanco" }));
    expect(result.kind).toBe("ignored");
    expect((result as { reason: string }).reason).toBe("unrecognized_subject");
  });
});

// ---------------------------------------------------------------------------
// AC6 — amounts that don't validate against raw text are never guessed.
// ---------------------------------------------------------------------------

describe("needs_review: unvalidatable amounts (AC6)", () => {
  it("flags a missing amount instead of guessing", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Consumo tarjeta de débito por USD",
          body: "Establecimiento: TIENDA X",
        })
      )
    );
    expect(result.amount).toBeNull();
    expect(result.needs_review).toBe(true);
    expect(result.review_reason).toBeTruthy();
  });

  it("flags a malformed amount (wrong decimal precision) instead of coercing it", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Consumo Tarjeta de Crédito por USD 9.4",
          body: "Establecimiento: TIENDA Y",
        })
      )
    );
    expect(result.amount).toBeNull();
    expect(result.needs_review).toBe(true);
    expect(result.review_reason).toBeTruthy();
  });

  it("flags an amount with too many decimals instead of truncating it", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Consumo tarjeta de débito por USD 9.421",
          body: "Establecimiento: TIENDA Z",
        })
      )
    );
    expect(result.amount).toBeNull();
    expect(result.needs_review).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Code-review fixes (TASK-012 RC bounce 1): amounts and fields must be read
// from an anchored label, never the first amount-shaped substring in the
// text — a body can legitimately contain more than one dollar figure.
// ---------------------------------------------------------------------------

describe("review fix HIGH-1: retiro amount is anchored to the Monto: field", () => {
  it("uses the Monto: value, not an earlier unrelated $ amount in the body", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Retiro sin tarjeta de débito Produbanco en cajero automático",
          body: "Saldo disponible: $154.30 Monto: $20.00 Cuenta débito: ANA XXXXXX20924",
        })
      )
    );
    expect(result.amount).toBe(20.0);
    expect(result.needs_review).toBe(false);
  });

  it("flags needs_review when there is no well-formed Monto: field, instead of guessing from another figure", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Retiro sin tarjeta de débito Produbanco en cajero automático",
          body: "Saldo disponible: $154.30 Cuenta débito: ANA XXXXXX20924",
        })
      )
    );
    expect(result.amount).toBeNull();
    expect(result.needs_review).toBe(true);
  });
});

describe("review fix HIGH-2: recibido amount is anchored, not the first $ in the body", () => {
  it("uses the Monto: value, not an earlier unrelated $ amount (e.g. saldo)", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Transferencia recibida desde Produbanco",
          body: "Tu saldo era $999.99. De: Juan Perez Monto: $45.00 Cuenta: XXXXXX1111",
        })
      )
    );
    expect(result.amount).toBe(45.0);
    expect(result.needs_review).toBe(false);
    expect(result.counterparty).toBe("Juan Perez");
  });

  it("flags needs_review when there is no anchored Monto: field, instead of guessing from another figure", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Transferencia recibida desde Produbanco",
          body: "Tu saldo era $999.99. De: Juan Perez Cuenta: XXXXXX1111",
        })
      )
    );
    expect(result.amount).toBeNull();
    expect(result.needs_review).toBe(true);
  });
});

describe("review fix MEDIUM-1: sueldo counterparty anchors to the last 'de' before 'por el valor'", () => {
  it("does not capture an earlier, irrelevant 'de' (e.g. 'de parte de')", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Notificación Transferencia Internacional Recibida",
          body: "Hemos acreditado a tu cuenta una transferencia de parte de Acme Corp S.A. por el valor de USD 2337.71.",
        })
      )
    );
    expect(result.counterparty).toBe("Acme Corp S.A.");
  });
});

describe("review fix MEDIUM-2: retiro account stops at the next field label", () => {
  it("does not swallow a trailing Fecha: field into the account", () => {
    const result = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Retiro sin tarjeta de débito Produbanco en cajero automático",
          body: "Monto: $20.00 Cuenta débito: ANA XXXXXX20924 Fecha: 01/07/2026",
        })
      )
    );
    expect(result.account).toBe("XXXXXX20924");
  });
});

// ---------------------------------------------------------------------------
// Pluggability (AC5) — registry dispatch and registering a second bank.
// ---------------------------------------------------------------------------

describe("registry", () => {
  // registerParser() mutates the shared, module-level parser list; undo
  // that after each test so registering a fake bank here doesn't leak into
  // other test files that import the registry.
  const initialParserCount = listParsers().length;
  afterEach(() => {
    (listParsers() as BankEmailParser[]).length = initialParserCount;
  });

  it("dispatches to Produbanco for a Produbanco email", () => {
    const result = parseEmail(
      email({
        subject: "COMPRA MINUTOS CLARO",
        body: "compra de minutos Claro por un valor de USD 3.00, Produbanco.",
      })
    );
    expect(result.kind).toBe("transaction");
  });

  it("returns ignored when no registered parser can handle the email", () => {
    const result = parseEmail(email({ subject: "Hola", body: "Correo sin relación bancaria." }));
    expect(result.kind).toBe("ignored");
    expect((result as { reason: string }).reason).toBe("no_matching_bank_parser");
  });

  it("allows registering an additional bank parser", () => {
    const fakeBank: BankEmailParser = {
      bankId: "fake-bank",
      canParse: (e) => e.subject.includes("FakeBank"),
      parse: () => ({
        kind: "transaction",
        type: "debito",
        direction: "out",
        amount: 1.23,
        currency: "USD",
        raw_subject: "FakeBank test",
        needs_review: false,
      }),
    };
    registerParser(fakeBank);
    expect(listParsers()).toContain(fakeBank);

    const result = parseEmail(email({ subject: "FakeBank consumo" }));
    expect(result.kind).toBe("transaction");
  });
});

describe("consumo en moneda extranjera", () => {
  // Regresión de un caso real: el correo del 2026-05-19 por ARS 16000.00
  // (MERPAGO*JQWEB CAPITAL FEDAR) no matcheaba ninguna rama del catálogo
  // porque todas exigían "por usd", así que el consumo entraba al ledger sin
  // monto. Terminó siendo la única fila con monto null de 1019.
  const arsEmail = email({
    subject: "Consumo tarjeta de débito por ARS 16000.00",
    body: "Transacción: Consumo Tarjeta de Débito Produbanco Valor: ARS 16000.00 Establecimiento: MERPAGO*JQWEB CAPITAL FEDAR Cuenta Débito: ANA XXXXXX20924",
  });

  it("lee el monto y la moneda real en vez de dejar el monto en null", () => {
    const tx = asTransaction(produbancoParser.parse(arsEmail));
    expect(tx.amount).toBe(16000);
    expect(tx.currency).toBe("ARS");
    expect(tx.type).toBe("debito");
    expect(tx.direction).toBe("out");
  });

  it("lo marca needs_review: no hay tipo de cambio en el correo y convertirlo sería inventar", () => {
    const tx = asTransaction(produbancoParser.parse(arsEmail));
    expect(tx.needs_review).toBe(true);
    expect(tx.review_reason).toBe("foreign_currency_ars");
  });

  it("no toca la rama USD: un consumo en dólares sigue sin needs_review", () => {
    const tx = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Consumo tarjeta de débito por USD 12.50",
          body: "Establecimiento: TITAN Quito EC",
        })
      )
    );
    expect(tx.currency).toBe("USD");
    expect(tx.amount).toBe(12.5);
    expect(tx.needs_review).toBe(false);
  });

  it("también cubre el consumo de tarjeta de crédito en moneda extranjera", () => {
    const tx = asTransaction(
      produbancoParser.parse(email({ subject: "Consumo tarjeta de crédito por COP 250000.00", body: "" }))
    );
    expect(tx.type).toBe("credito");
    expect(tx.currency).toBe("COP");
    expect(tx.amount).toBe(250000);
    expect(tx.needs_review).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// El agujero de los montos perdidos: cuerpos con marcado.
//
// Produbanco alterna entre un `multipart/alternative` plano y uno anidado, así
// que el MISMO correo llega a veces como texto plano y a veces como HTML. Los
// cuerpos de acá tienen la forma exacta del HTML real (con datos ficticios):
// el `</STRONG>` se mete entre la etiqueta y su valor, y el salto de línea del
// correo cae en cualquier lado, incluso en la mitad de un campo.
//
// Sobre el ledger real, esto se comió el 100 % de las transferencias recibidas
// (63), el 100 % de los retiros (10) y 3 de 4 recargas: monto null → placeholder
// → fila fuera de todos los totales. Y dejó `account` en NULL en las 1069 filas.
//
// El arreglo NO es de Produbanco: vive en `parser/field-extract.ts`, que es la
// capa que usa cualquier banco. Ver también `field-extract.test.ts`, que lo
// testea sobre un banco ficticio.
// ---------------------------------------------------------------------------

describe("cuerpos con marcado (HTML)", () => {
  const RECIBIDO_HTML =
    '<P><FONT face="Nunito Sans Normal">Transacción:</FONT></P>\r\n' +
    "<P><STRONG>Detalle</STRONG></P>\r\n" +
    "<P><BR><STRONG>Banco Destino:</STRONG> Banco Ejemplo<BR><STRONG>Cuenta \r\n" +
    "Destino:</STRONG> XXXXXX4321<BR><STRONG>Monto:</STRONG> \r\n" +
    "$45.00<BR><STRONG>Descripción:</STRONG> \r\n" +
    "Pago<BR><STRONG>Referencia:</STRONG> XXXXXXXX0001</P>";

  const RETIRO_HTML =
    '<P><FONT face="Nunito Sans Normal">Detalle</FONT></P>\r\n' +
    '<P><FONT face="Nunito Sans Normal"><STRONG>Monto:</STRONG> \r\n' +
    "            $20.00<BR><STRONG>Cuenta débito:</STRONG> \r\n" +
    "            PEREZ GOMEZ ANA XXXXXX4321<BR><STRONG>Cajero:</STRONG> \r\n" +
    "            Produbanco - Sucursal Centro</FONT></P>";

  const CONSUMO_HTML =
    '<P><FONT face="Nunito Sans Normal"><STRONG>Establecimiento:</STRONG> \r\n' +
    "TIENDA EJEMPLO           QUITO        EC<BR><STRONG>Cuenta Débito:</STRONG> PEREZ GOMEZ ANA \r\n" +
    "XXXXXX4321</FONT></P>";

  it("lee el monto de una transferencia recibida (63 ingresos perdidos en el ledger real)", () => {
    const tx = asTransaction(
      produbancoParser.parse(email({ subject: "Transferencia recibida desde Produbanco", body: RECIBIDO_HTML }))
    );
    expect(tx.type).toBe("recibido");
    expect(tx.direction).toBe("in");
    expect(tx.amount).toBe(45.0);
    expect(tx.needs_review).toBe(false);
  });

  it("lee monto, cuenta y titular de un retiro", () => {
    const tx = asTransaction(
      produbancoParser.parse(
        email({ subject: "Retiro sin tarjeta de débito Produbanco en cajero automático", body: RETIRO_HTML })
      )
    );
    expect(tx.amount).toBe(20.0);
    expect(tx.account).toBe("XXXXXX4321");
    expect(tx.account_holder).toBe("PEREZ GOMEZ ANA");
    expect(tx.needs_review).toBe(false);
  });

  it("lee el establecimiento de un consumo aunque el valor esté envuelto en marcado", () => {
    const tx = asTransaction(
      produbancoParser.parse(email({ subject: "Consumo tarjeta de débito por USD 9.42", body: CONSUMO_HTML }))
    );
    expect(tx.amount).toBe(9.42);
    expect(tx.counterparty).toBe("TIENDA EJEMPLO QUITO EC");
  });

  // Los 497 débitos del ledger real tienen `account = NULL` aunque el correo
  // trae "Cuenta Débito:". Sin cuenta, `accountsEqual(null, null)` da true y el
  // apareo de reversos degenera a "mismo monto, mismo día".
  it("puebla la cuenta de un consumo, no sólo la de un retiro", () => {
    const tx = asTransaction(
      produbancoParser.parse(email({ subject: "Consumo tarjeta de débito por USD 9.42", body: CONSUMO_HTML }))
    );
    expect(tx.account).toBe("XXXXXX4321");
    expect(tx.account_holder).toBe("PEREZ GOMEZ ANA");
  });

  it("lee la prosa de una recarga aunque el marcado la parta", () => {
    const tx = asTransaction(
      produbancoParser.parse(
        email({
          subject: "COMPRA MINUTOS CLARO",
          body: "<P>Tu compra de minutos Claro <STRONG>por un valor de \r\nUSD 3.00</STRONG> fue exitosa. Produbanco</P>",
        })
      )
    );
    expect(tx.amount).toBe(3.0);
    expect(tx.needs_review).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Guardas deterministas (investigacion-riesgos.md §1.4 y §6).
// ---------------------------------------------------------------------------

describe("guarda: la etiqueta anclada aparece más de una vez", () => {
  it("marca needs_review cuando el cuerpo declara dos montos distintos bajo la misma etiqueta", () => {
    const tx = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Transferencia recibida desde Produbanco",
          body: "Detalle Monto: $45.00\nCorrección Monto: $12.00",
        })
      )
    );
    expect(tx.amount).toBeNull();
    expect(tx.needs_review).toBe(true);
    expect(tx.review_reason).toBe("ambiguous_labeled_amount");
  });

  // El falso positivo que había que evitar: un cuerpo normal SIEMPRE trae otras
  // cifras (saldo, comisión) antes del monto que importa. El guarda mira la
  // ETIQUETA repetida, no "hay más de una cifra".
  it("NO se dispara en un retiro normal con saldo y comisión en el cuerpo", () => {
    const tx = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Retiro sin tarjeta de débito Produbanco en cajero automático",
          body: "Saldo disponible: $154.30 Comisión: $0.50 Monto: $20.00 Cuenta débito: ANA XXXXXX20924",
        })
      )
    );
    expect(tx.amount).toBe(20.0);
    expect(tx.needs_review).toBe(false);
  });
});

describe("guarda: asunto y cuerpo son dos afirmaciones del mismo monto", () => {
  it("usa el monto cuando asunto y cuerpo coinciden", () => {
    const tx = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Transferencia recibida desde Produbanco por $45.00",
          body: "De: Juan Perez Monto: $45.00",
        })
      )
    );
    expect(tx.amount).toBe(45.0);
    expect(tx.needs_review).toBe(false);
  });

  it("marca needs_review cuando discrepan, en vez de elegir uno", () => {
    const tx = asTransaction(
      produbancoParser.parse(
        email({
          subject: "Transferencia recibida desde Produbanco por $45.00",
          body: "De: Juan Perez Monto: $12.00",
        })
      )
    );
    expect(tx.amount).toBeNull();
    expect(tx.needs_review).toBe(true);
    expect(tx.review_reason).toBe("subject_body_amount_mismatch");
  });
});
