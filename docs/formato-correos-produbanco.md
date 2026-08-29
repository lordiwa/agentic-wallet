# El formato real de los correos de Produbanco

Este documento describe la **estructura verificada** de las notificaciones que
manda `bancaenlinea@produbanco.com`, leída de una bandeja real (1722 correos).
Todos los ejemplos están despersonalizados: **los nombres, montos y cuentas son
inventados; la estructura es la del correo real, carácter por carácter.**

Existe porque el parser original se escribió sobre fixtures imaginados y por eso
fallaba en campos enteros: `account` salía `null` en 861 de 861 movimientos y la
contraparte de toda transferencia recibida salía `null`. Si vas a tocar
`parser/produbanco.ts`, leé esto antes; y si escribís el parser de otro banco,
leé también la sección [El salto de línea blando](#el-salto-de-línea-blando):
el problema no es de Produbanco, es de cómo los mailers generan HTML.

## 1. El envoltorio MIME

**Todos** los correos llegan como **una sola parte `text/html`**. No hay
`multipart`, no hay `text/plain`, nunca:

```
payload
└── text/html
```

Esto importa: cualquier lector que asuma un `text/plain` o que sólo mire el
primer nivel del `payload` se queda sin cuerpo. `decodeBody`
(`ingest/googleapis-gmail-client.ts`) busca en profundidad y, cuando sólo hay
HTML, lo convierte con `htmlToText` en vez de devolver el marcado crudo.

## 2. El salto de línea blando

**Este es el detalle que rompía todo.**

El HTML lo genera MSHTML y viene **envuelto a ~72 columnas**. El salto de línea
del código fuente cae en cualquier parte: dentro de un label, entre el label y
su valor, o en el medio del valor. Del correo real:

```html
<P><BR><STRONG>Banco Destino:</STRONG> BANCO EJEMPLO<BR><STRONG>Cuenta
Destino:</STRONG> XXXXX54321<BR><STRONG>Monto:</STRONG>
$12.34<BR><STRONG>Descripción:</STRONG>
Pago<BR><STRONG>Referencia:</STRONG> 987654321012</P>
```

Fijate dónde caen los tres saltos:

| Salto | Cae | Ejemplo |
|---|---|---|
| dentro del label | `Cuenta` / `Destino:` | `<STRONG>Cuenta\nDestino:</STRONG>` |
| entre label y valor | `Monto:` / `$12.34` | `<STRONG>Monto:</STRONG>\n$12.34` |
| dentro del valor | `ANA` / `XXXXXX54321` | `Cuenta Débito:</STRONG> ANA\nXXXXXX54321` |

En HTML esos saltos **son espacio en blanco cualquiera**: no significan nada. El
único salto con significado es el que producen `<br>`, `</p>`, `</div>`,
`</tr>`, `</li>`, `</h1..6>`.

`htmlToText` los distinguía mal: colapsaba espacios y tabs pero **preservaba los
`\n` del código fuente**, así que el texto plano quedaba partido en lugares
arbitrarios. Como `extractField` corta el valor de un campo en el `\n`, el
resultado era:

```
Cuenta Débito: ANA        ← valor truncado, la cuenta se perdió
XXXXXX54321
Monto:                    ← label huérfano
$12.34
```

**Regla para cualquier parser de banco:** un `\n` que venía del código fuente
del HTML no es un separador de campos. Colapsalo a espacio y quedate sólo con
los saltos que declaró el marcado. Eso hace `htmlToText` hoy, y por eso el
`\n` volvió a ser un terminador de campo confiable.

## 3. La plantilla común

Después de `htmlToText`, todo correo transaccional tiene esta forma:

```
Estimado/a
APELLIDO APELLIDO NOMBRE NOMBRE          ← el titular, siempre en el encabezado
Fecha y Hora: 01/Agosto/2026 14:32       ← también 01/08/2026 14:32:05
Transacción: <nombre de la transacción>
<una o dos frases en prosa>              ← a veces trae datos que NO están en ningún campo
Detalle                                  ← no siempre
<Label>: <valor>                         ← el bloque de campos, uno por línea
...
Atentamente Produbanco
<pie legal de 4 párrafos>                ← ruido, no contiene datos
```

Dos cosas que no son obvias:

1. **El bloque `Detalle` no siempre existe** (la transferencia internacional y
   la compra de minutos no lo traen: los datos están sólo en la prosa).
2. **La prosa a veces es la única fuente de un dato.** La tarjeta de un consumo
   con tarjeta de crédito y la contraparte de una transferencia recibida no
   aparecen en ningún campo etiquetado.

## 4. Cada tipo de correo

Los ejemplos son el **texto plano después de `htmlToText`**, que es lo que ve el
parser.

### 4.1 `Consumo tarjeta de débito por USD 12.34`

```
Transacción: Consumo Tarjeta de Débito Produbanco
Te informamos que se acaba de registrar un consumo con tu Tarjeta de Débito Produbanco.
Detalle
Valor: USD 12.34
Establecimiento: COMERCIO EJEMPLO      Quito        EC
Cuenta Débito: ANA XXXXXX54321
```

- **Monto:** en el asunto (`por USD N`) **y** en el campo `Valor:`. Los dos.
- **Cuenta:** `Cuenta Débito:` → `<titular> <cuenta enmascarada>`.
- **Contraparte:** `Establecimiento:`, con relleno de espacios a ancho fijo
  (el comercio, la ciudad y el país vienen padeados) — hay que colapsarlo.

> El label es `Cuenta Débito` con D mayúscula acá y `Cuenta débito` con
> minúscula en el retiro. Matchear sin distinguir mayúsculas no es opcional.

### 4.2 `Consumo Tarjeta de Crédito por USD 12.34`

```
Transacción: Consumo Tarjeta de Crédito Produbanco
Te informamos que se acaba de registrar un consumo con tu Tarjeta de Crédito Visa Produbanco XXX4321 .
Detalle
Valor: USD 12.34
Establecimiento: DLC* COMERCIO EJEMPLO
```

- **No hay ningún campo `Cuenta`.** La tarjeta está **sólo en la prosa**, con
  la máscara corta de tarjeta de crédito (`XXX` + 4 dígitos) y un espacio antes
  del punto final.
- El resto igual que el débito.

### 4.3 `Transferencia enviada por $12.34 desde Produbanco`

```
Transacción: Transferencia Enviada Exitosamente desde Produbanco
Detalle
Contacto: Nombre Del Beneficiario
Banco Destino: BANCO EJEMPLO
Cuenta Destino: XXXXX54321
Monto: $12.34
Descripción: Pago Servicios
Canal: App Móvil
Referencia: 987654321012
```

- El monto va con `$`, no con `USD`.
- `Cuenta Destino` es la cuenta **del beneficiario**, no la del usuario: **no
  es el `account` de la transacción.** El correo no dice desde qué cuenta salió
  la plata, así que `account` queda `null` — y eso es correcto, no una falla.
- Existe una variante de asunto sin el sufijo: `Transferencia enviada por $12.34`.

### 4.4 `Transferencia recibida desde Produbanco`

```
Estimado/a
APELLIDO APELLIDO NOMBRE NOMBRE
Te confirmamos que NOMBRE DEL REMITENTE ha realizado una transferencia a tu cuenta en BANCO EJEMPLO , enviada desde Produbanco.
Fecha y Hora: 01/Agosto/2026 14:32
Transacción: Transferencia recibida desde Produbanco
Detalle
Banco Destino: BANCO EJEMPLO
Cuenta Destino: XXXXX54321
Monto: $12.34
Descripción: Pago
Referencia: 987654321012
```

Tres cosas, todas distintas de lo que asumía el parser viejo:

- **El asunto NO trae el monto.** El monto sale del campo `Monto:` del cuerpo,
  y sólo de ahí.
- **No existe ningún campo `De:` ni `Remitente:`.** La contraparte está en la
  prosa: `Te confirmamos que <NOMBRE> ha realizado una transferencia`.
- Acá `Cuenta Destino` **sí** es la cuenta del usuario (el dinero entra), así
  que ésa es la que va en `account`. Es el mismo label que en la transferencia
  enviada y significa lo contrario — depende del sentido del movimiento.

### 4.5 `Pago de servicio por USD 12.34`

```
Transacción: Pago de Servicio Combos Ejemplo
Canal: Banca Web
Te informamos que el siguiente pago se ha realizado.
Detalle
Suministro: 123456789
Monto: USD 12.34
Cuenta Débito: XXXXXXXXXXXXX54321
Descripción: Combos Ejemplo
Referencia: 987654321
```

- El nombre del servicio va pegado a `Transacción: Pago de Servicio <nombre>`,
  y se repite en `Descripción:`. No hay un campo "Empresa".
- Acá `Cuenta Débito:` trae **sólo la cuenta**, sin titular delante.
- El monto va con `USD` (a diferencia de la transferencia enviada, que usa `$`).

### 4.6 `Retiro sin tarjeta de débito Produbanco en cajero automático`

```
Transacción: Retiro sin tarjeta de débito Produbanco en cajero Automático
Detalle
Monto: $12.34
Cuenta débito: ANA XXXXXX54321
Cajero: NOMBRE DEL CAJERO
```

- El asunto no trae monto; sale de `Monto:`.
- Label `Cuenta débito` en minúscula, y `Cajero:` es un label que el parser
  tiene que conocer para no arrastrarlo dentro del valor anterior.

### 4.7 `Notificación Transferencia Internacional Recibida`

```
Transacción: Transferencia Internacional Recibida
Te confirmamos la acreditación en tu cuenta XXXXXX54321 de la transferencia Internacional Recibida de EMPRESA EJEMPLO S.A. por el valor de USD 1234.56.
```

- **No hay bloque `Detalle`.** Todo — cuenta, empresa y monto — está en una sola
  frase de prosa.
- La cuenta va entre `en tu cuenta` y `de la transferencia`.

### 4.8 `COMPRA MINUTOS CLARO`

```
Fecha y hora de compra:01/Agosto/2026 14:32
Se ha realizado la compra de minutos Claro por un valor de USD 12.34 debitado de la cuenta ANA XXXXXX54321.
```

- Tampoco hay `Detalle`. Monto y cuenta salen de la prosa.
- Ojo con el punto final pegado a la cuenta.

### 4.9 `Notificación Reverso Consumo Tarjeta de Débito Produbanco`

```
Transacción: Reverso Consumo Tarjeta de Débito Produbanco
Te informamos que se acaba de registrar el reverso de un consumo con la tarjeta VISA Produbanco XXXXXXXXXXXX4321 por un valor de USD 12.34 en COMERCIO EJEMPLO      Quito        EC.
Detalle
Valor: USD 12.34
Establecimiento: COMERCIO EJEMPLO      Quito        EC
```

- El monto está en `Valor:` (no en `Monto:`) y repetido en la prosa.
- **No hay campo `Cuenta débito`.** Lo único identificable es la **tarjeta**
  (`XXXXXXXXXXXX` + 4 dígitos), que es un identificador **distinto** del
  `Cuenta Débito: ... XXXXXX54321` del consumo que reversa. Por eso
  `rules/reconcile.ts` trata una cuenta ausente como *desconocida* y no como
  *distinta*: comparar los dos identificadores nunca daría igual y ningún
  reverso volvería a matchear.

## 5. Las máscaras de cuenta

Cuatro formas, todas `X` repetida + los últimos dígitos:

| Forma | Dónde | Qué es |
|---|---|---|
| `XXXXXX54321` | `Cuenta Débito` de un consumo, retiro, minutos Claro | cuenta de ahorros/corriente |
| `XXXXX54321` | `Cuenta Destino` de una transferencia | cuenta de ahorros/corriente |
| `XXXXXXXXXXXXX54321` | `Cuenta Débito` de un pago de servicio | la misma cuenta, con otro largo de máscara |
| `XXX4321` / `XXXXXXXXXXXX4321` | prosa de consumo/reverso con tarjeta | número de tarjeta |

**El largo de la máscara no es estable ni siquiera para la misma cuenta.** Se
guarda el token tal cual llega; no se normaliza ni se recorta, porque recortarlo
mezclaría una tarjeta con una cuenta que terminan en los mismos dígitos.

El patrón compartido está en `parser/field-extract.ts` (`MASKED_ACCOUNT_RE`).

## 6. Asuntos que todavía no se catalogan

Verificado sobre la bandeja real: estos correos **son movimientos de plata** y
hoy caen en `ignored / unrecognized_subject`. Están acá para que quede
registrado que la omisión es conocida y no un descuido:

| Asunto | Correos |
|---|---|
| `Cobranza con débito automático` | 18 |
| `Retiro de Efectivo sin tarjeta de débito Produbanco` | 10 |
| `Pago Tarjeta de Crédito Produbanco` | 8 |
| `Transferencia acreditada Produbanco` | 4 |
| `Notificación Pago de Servicio <EMPRESA>` | 4 |
| `Retiro de Efectivo Produbanco en Cajero Automático` | 2 |
| `COMPRA RECARGA MOVISTAR` | 1 |
| `Transferencia Recibida en Produbanco` | 1 |
| `Reverso Pago Tarjeta de Crédito Produbanco` | 1 |

## 7. Cómo verificar contra correos reales sin commitear nada

El repo no trae ningún correo real y no debe traerlo. Para chequear un cambio
del parser contra la bandeja de verdad, escribí un script **fuera del repo** que
use `createGoogleapisGmailClient` + `parseEmail` y que imprima sólo **conteos y
formas enmascaradas**, nunca valores. La medición que motivó este documento se
hizo así:

```
n   | asunto => kind/type                          | sinMonto | sinAccount | sinContraparte
499 | Consumo tarjeta de débito por USD N => debito |        0 |        499 |              0
 63 | Transferencia recibida desde Produbanco       |        0 |         63 |             63
```

Los fixtures de `produbanco-formato-real.test.ts` son el HTML **con la
estructura exacta** de esos correos y datos inventados. Cuando cambies el
parser, cambiá ahí primero.
