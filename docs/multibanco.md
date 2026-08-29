# Agregar tu banco

Agentic Wallet trae **un parser de ejemplo: Produbanco** (Ecuador). Si tu banco
es otro, escribir su parser es el único trabajo real de adaptación — todo lo
demás (categorías, estrategia, chat, dashboard) es agnóstico del banco.

## La arquitectura en una pantalla

```
Gmail search ──► parseEmail(email) ──► registry ──► el primer parser
                                                     cuyo canParse() da true
                                                            │
                        ┌───────────────────────────────────┤
                        ▼                                   ▼
                 { kind: "transaction", ... }        { kind: "ignored" | "statement" | "reverso" }
```

El registry (`server/src/parser/registry.ts`) tiene una lista ordenada de
parsers. Para cada correo, corre el primero cuyo `canParse()` devuelve `true`.
Si ninguno matchea, el correo se ignora con razón `no_matching_bank_parser`.

**Los parsers son funciones puras.** No tocan la base, no hacen red, no
persisten nada. Reciben texto y devuelven una estructura. Eso es lo que los
hace triviales de testear.

## El contrato

`server/src/parser/types.ts`:

```ts
export interface BankEmailParser {
  bankId: string;                      // "mibanco" — identificador estable
  gmailSenders: readonly string[];     // de dónde llegan sus correos
  canParse(email: InboundEmail): boolean;
  parse(email: InboundEmail): ParseResult;
}
```

`gmailSenders` no es decorativo: **la búsqueda de Gmail se construye
OR-eando los remitentes de todos los parsers registrados**
(`buildSearchQuery` en `server/src/ingest/pipeline.ts`). Un parser sin
remitentes declarados parsearía perfecto y no recibiría jamás un correo,
porque la búsqueda nunca lo traería.

Con dos bancos registrados, la query queda:

```
(from:produbanco OR from:notificaciones@mibanco.com) after:2026/06/30
```

### Qué puede devolver `parse()`

| `kind` | Cuándo |
|---|---|
| `transaction` | Un movimiento: consumo, transferencia, retiro, servicio, recarga, sueldo |
| `statement` | Un estado de cuenta (lo procesa `statement/`) |
| `reverso` | Una reversión (la matchea `rules/reconcile.ts` contra su original) |
| `ignored` | Publicidad, avisos de seguridad, cualquier cosa que no sea plata |

Para `transaction`, los campos que importan:

```ts
{
  kind: "transaction",
  type: "debito" | "credito" | "transferencia" | "servicio"
      | "retiro" | "recarga" | "sueldo" | "recibido",
  direction: "in" | "out",
  amount: number | null,       // null SOLO si needs_review es true
  currency: "USD",
  counterparty: string | null, // el comercio o la persona
  account: string | null,      // cuenta enmascarada, ej. "XXXXXX1234"
  raw_subject: string,
  needs_review: boolean,
  review_reason?: string,
}
```

## La capa compartida: leer campos del cuerpo

`server/src/parser/field-extract.ts` no sabe de ningún banco. Es lo que todos
los parsers usan para leer el cuerpo, y **existe para que no repitas un bug que
ya nos costó caro**.

```ts
import {
  normalizeBody,        // el cuerpo como texto plano, venga como venga
  extractLabeledAmount, // el monto anclado a "Monto:" / "Valor:" / la etiqueta que use tu banco
  extractLabeledField,  // el valor de un campo "Etiqueta: valor"
  extractMaskedAccount, // el token "XXXXXX1234" de un campo de cuenta
  extractAccountHolder, // el nombre que lo precede
} from "./field-extract.js";
```

### El bug que evita

Un correo bancario no siempre llega en texto plano. El mismo mensaje puede
llegar de las dos formas:

```
Monto:\n$45.00                              (text/plain)
<STRONG>Monto:</STRONG> \r\n  $45.00<BR>    (text/html)
```

Un regex anclado a la etiqueta matchea la primera y **no** la segunda: el
`</STRONG>` se mete entre la etiqueta y su valor. Y no falla ruidosamente —
devuelve `null`, que se persiste como una fila en revisión, fuera de todos los
totales. En el ledger de referencia eso se comió **el 100 % de las
transferencias recibidas, el 100 % de los retiros y la cuenta de las 1069
filas**, en silencio, durante ocho meses.

Los helpers normalizan el cuerpo antes de mirarlo, así que ese modo de fallo no
existe para vos. Lo mismo con el salto de línea: el HTML del banco corta las
líneas a lo ancho, no por campo, y el titular puede quedar en una línea y la
cuenta en la siguiente **dentro del mismo campo** — por eso
`extractMaskedAccount` busca el token por su forma (`XXXXXX1234`, `****1234`) y
no "el último token antes del salto".

### Lo único que pone tu banco

El vocabulario de etiquetas. Mirá `FIELD_STOP_LABELS` en `produbanco.ts`:

```ts
const FIELD_STOP_LABELS = ["Banco Destino", "Cuenta\\s*d[eé]bito", "Fecha", "Monto", "Cuenta"];

extractLabeledField(body, "Establecimiento", FIELD_STOP_LABELS);
```

Sin esa lista, un campo se lleva por delante al que le sigue cuando comparten
línea (`"Contacto: X Banco Destino: Y"` → `"X Banco Destino: Y"`). Poné las
etiquetas más largas antes que las más cortas.

### El guarda de ambigüedad

`extractLabeledAmount` devuelve `{ amount, ambiguous }`. `ambiguous: true`
significa que **la etiqueta aparece más de una vez en el cuerpo con montos
distintos**: el correo se contradice y elegir uno sería adivinar. Mandalo a
revisión.

Ojo con la formulación: el guarda es sobre **la etiqueta repetida**, no sobre
"hay más de una cifra en el cuerpo". Los cuerpos traen saldo y comisión antes
del monto que importa, siempre — la segunda versión marcaría el 100 % de los
correos, y una fila marcada no se desmarca nunca.

## La regla que no se negocia

**El monto sale de tu parser, nunca de Claude.**

El pipeline le pasa el correo a Claude en paralelo y compara: si el monto que
leyó Claude no coincide con el tuyo, la fila se marca `needs_review` y queda
**excluida de todos los totales** hasta que un humano la revise.

Por eso `amount` puede ser `null`, pero **sólo** junto con
`needs_review: true`. Nunca devuelvas `0` para decir "no pude leerlo": cero es
un monto válido y se sumaría como tal. Si no podés parsearlo con certeza,
decilo:

```ts
return {
  kind: "transaction",
  amount: null,
  needs_review: true,
  review_reason: "monto_no_parseable",
  // ...
};
```

## Paso a paso

### 1. Juntá correos reales

Buscá en Gmail los correos de tu banco y guardá el **texto plano** de uno de
cada tipo: un consumo con tarjeta, una transferencia enviada, una recibida, un
retiro, el sueldo, un estado de cuenta, un reverso.

> Estos correos tienen tu número de cuenta y tu nombre. Usalos para escribir los
> tests **con los datos cambiados** — nombres y números ficticios. Nunca
> commitees un correo real.

### 2. Escribí los tests primero

Es el orden natural acá: cada test es "este texto de correo produce esta
estructura". Mirá `server/src/parser/produbanco.test.ts` como modelo.

```ts
// server/src/parser/mibanco.test.ts
import { describe, expect, it } from "vitest";
import { miBancoParser } from "./mibanco.js";

describe("miBancoParser", () => {
  it("clasifica un consumo con tarjeta de débito", () => {
    const result = miBancoParser.parse({
      subject: "Compra con tu tarjeta por $25.40",
      body: "Comercio: SUPERMERCADO EJEMPLO\nCuenta: ****1234",
      gmail_msg_id: "m1",
      ts: "2026-07-01T12:00:00Z",
    });

    expect(result).toMatchObject({
      kind: "transaction",
      type: "debito",
      direction: "out",
      amount: 25.4,
      counterparty: "SUPERMERCADO EJEMPLO",
      needs_review: false,
    });
  });
});
```

### 3. Escribí el parser

`server/src/parser/mibanco.ts`:

```ts
import { extractLabeledField, extractMaskedAccount } from "./field-extract.js";
import type { BankEmailParser, InboundEmail, ParseResult } from "./types.js";

const AMOUNT_RE = /\$\s*([0-9]+\.[0-9]{2})\b/;

// Las etiquetas que usa tu banco. Las más largas primero.
const STOP_LABELS = ["Cuenta\\s*d[eé]bito", "Comercio", "Fecha", "Cuenta"];

function classify(email: InboundEmail): ParseResult {
  const subject = email.subject.toLowerCase();
  const body = email.body;

  if (subject.includes("compra con tu tarjeta")) {
    const amount = AMOUNT_RE.exec(email.subject)?.[1];
    return {
      kind: "transaction",
      type: "debito",
      direction: "out",
      amount: amount ? Number(amount) : null,
      currency: "USD",
      // Nunca `body.match(...)` a mano: los helpers normalizan el marcado.
      counterparty: extractLabeledField(body, "Comercio", STOP_LABELS),
      account: extractMaskedAccount(body, "Cuenta\\s*d[eé]bito", STOP_LABELS),
      raw_subject: email.subject,
      needs_review: amount === undefined,
      review_reason: amount === undefined ? "monto_no_parseable" : undefined,
    };
  }

  if (subject.includes("estado de cuenta")) {
    return { kind: "statement", raw_subject: email.subject };
  }

  return { kind: "ignored", reason: "unrecognized_subject" };
}

export const miBancoParser: BankEmailParser = {
  bankId: "mibanco",
  gmailSenders: ["notificaciones@mibanco.com"],
  canParse(email) {
    return /mi banco/i.test(email.subject) || /mibanco\.com/i.test(email.body);
  },
  parse: classify,
};
```

Sobre las regex de monto: exigí los dos decimales (`[0-9]+\.[0-9]{2}`). Un
patrón laxo como `[0-9.]+` matchea pedazos de fechas y números de cuenta, y
termina inventando montos.

### 4. Registralo

En `server/src/parser/registry.ts`:

```ts
import { miBancoParser } from "./mibanco.js";

const parsers: BankEmailParser[] = [produbancoParser, miBancoParser];
```

O sin tocar ese archivo, desde donde arranques:

```ts
import { registerParser } from "./parser/index.js";
registerParser(miBancoParser);
```

### 5. Probá

```bash
npm test
npm run dev    # y sincronizá
```

Las filas que hayan quedado en `needs_review` aparecen en la bandeja de revisión
de la web. Al principio va a haber varias — cada una te dice qué tipo de correo
todavía no estás cubriendo bien.

## Si sos el único que usa tu banco

Podés borrar el parser de Produbanco: sacalo del array en `registry.ts` y
borrá `produbanco.ts` + su test. Nada más depende de él.

Si te sirve a vos, probablemente le sirva a otro del mismo país: un PR con el
parser y sus tests es bienvenido.

## Checklist

- [ ] `gmailSenders` declarado (si no, no llegan correos)
- [ ] `canParse` reconoce los correos de tu banco y **sólo** esos
- [ ] Cada tipo de movimiento tiene un test con un correo real anonimizado
- [ ] Los montos salen de una regex estricta, con dos decimales
- [ ] Los campos del cuerpo se leen con `field-extract.ts`, no con regex propias
- [ ] Hay un test con el cuerpo en **HTML**, no sólo en texto plano
- [ ] Lo que no podés parsear devuelve `needs_review: true`, nunca `amount: 0`
- [ ] Publicidad y avisos devuelven `kind: "ignored"`
- [ ] Estados de cuenta devuelven `kind: "statement"`
- [ ] `npm test` en verde
