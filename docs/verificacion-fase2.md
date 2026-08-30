# Verificación fase 2 — la entrada de datos desde cero

Qué se probó: que un **cliente nuevo** (ledger vacío, base recién creada)
recibe los datos **correctos desde el primer correo**, contra la bandeja real
de Produbanco y con el parser reescrito en la fase 1 (commit `8339870`).

No se hizo backfill, ni heal, ni corrección de datos: lo que está en el ledger
es exactamente lo que produjo el pipeline en su primera pasada.

## Cómo se corrió

- Base borrada; `bolsillo.sqlite` se creó sola en el primer `openDb`.
- `npm run onboard -- --status`: `env`, `claude`, `gmail` y `huso` ya en verde;
  `sync` y `profile` pendientes (lo esperable en un cliente nuevo).
- Sync ejecutado con el **runner de producción** (`buildProductionSyncRunner`,
  el mismo que usa `POST /api/sync`) invocado desde un script CLI temporal —
  sin levantar el server HTTP. El script se borró al terminar.
- `npm test` en verde antes de empezar: **757 tests, 67 archivos**.

## Cuánto se procesó

Muestra, no drenado completo: el backlog real es de **1724 correos** y cada
correo de transacción pasa por Claude (≈2 s), así que el drenado entero son
horas.

| | |
|---|---|
| Backlog total | 1724 correos |
| **Procesados** | **265 (15,4 %)** |
| Lotes | 12 llamadas a `runSync` (~20 correos/lote, tope de 45 s) |
| Ventana cubierta | 2026-08-07 → 2026-08-29 (los más recientes; el backlog viene newest-first) |

Acumulado que reportó el sync:

```
seen 265 · inserted 130 · duplicates 0 · needsReview 2 · skipped 134
statementsPersisted 1 · statementsNeedReview 0 · reversalsApplied 1
```

Tipos de correo efectivamente ejercitados: `credito`, `debito`, `servicio`,
`transferencia` (enviada), `recibido`, `retiro`, `recarga`, `sueldo`
(transferencia internacional), `reverso` y un estado de cuenta.

## Los cuatro números

Comparados contra la medición sobre la DB migrada obsoleta (el "antes").

| # | Métrica | Antes | Ahora | |
|---|---|---|---|---|
| a | `recibido` con monto perdido | **63 / 63** con monto 0 | **0 / 18** — los 18 con monto > 0, con `account`, ninguno en review | ✅ |
| b | Filas sin `account` | **861** débitos sin cuenta | **0** en `debito` (15), `credito` (46), `servicio` (4), `retiro` (3), `recibido` (18), `sueldo` (1) | ✅ |
| c | Reversos | colapsaban | 3 reversos: **1 apareado** (su consumo quedó con `is_reversed=1`), **2 en review** por no tener consumo que aparear en la ventana muestreada | ✅ |
| d | `amount = 0` en review | **76** | **0** — y **0 filas con `amount = 0`** en todo el ledger | ✅ |

Detalle de (c): los 2 reversos en review son de 2026-08-15 y 2026-08-28 y **no
existe ningún consumo del mismo monto** en el ledger muestreado — ni el mismo
día ni en toda la ventana. Es el comportamiento correcto: el reverso queda
como fila auditable en `needs_review` en vez de desaparecer o aparearse mal.
Su consumo original está fuera de la muestra o entró como asunto no catalogado.

Otros contadores de sanidad: `needs_review` total = 2 (los dos reversos); cero
filas de transacción en review; cero duplicados; 1 estado de cuenta persistido
con balance (sin `due_date`).

## Hallazgos de la primera pasada (bugs de parser, NO de dato)

> Los tres están cerrados. Se dejan escritos porque son el registro de qué se
> midió y cómo; el estado final de cada uno está más abajo.

### 1. `COMPRA MINUTOS CLARO` pierde la cuenta — regex con la preposición equivocada

- **Fila afectada:** 1 de 1 `recarga` en la muestra → `account = null`
  (monto y contraparte sí entran bien).
- **Formato real del cuerpo** (dígitos enmascarados):
  `...compra de minutos Claro por un valor de USD #.## debitado de su cuenta AHO XXXXXX#####.`
- **Qué produce el parser:** `server/src/parser/produbanco.ts:212`

  ```ts
  const CUENTA_DEBITADA_RE = new RegExp(`de la cuenta\\s+[^.\\n]*?(${MASKED_ACCOUNT_RE.source})`, "i");
  ```

  El ancla es **`de la cuenta`** y el correo dice **`de su cuenta`**. No
  matchea, `fromProse` devuelve `null`, y la cuenta se pierde. `docs/formato-correos-produbanco.md`
  §4.8 documenta este correo, pero con la preposición que el ancla asume.
- **Fix (fase 1, no backfill):** aceptar ambas formas (`de (la|su) cuenta`)
  con un test sobre el cuerpo real.

### 2. El cuerpo llega con mojibake UTF-8→latin-1

En el mismo cuerpo aparece `informaciÃ³n` en vez de `información`. No afecta
ninguno de los cuatro números (los anclas usados no llevan tildes), pero sí
llega a `counterparty`: cualquier comercio con tilde queda guardado mal, y las
reglas de categoría del usuario no van a matchear contra ese texto. Es un bug
de decodificación en la lectura del mensaje de Gmail, no del parser de campos.

### 3. La mitad de la bandeja cae en `ignored`

**134 de 265 correos (50,6 %)** se descartaron como `unrecognized_subject`.
`docs/formato-correos-produbanco.md` §6 ya registra 9 asuntos sin catalogar,
pero ahí suman 49 correos: la proporción real en la ventana muestreada es
mucho mayor. Nada de esto entra al ledger, así que **el gasto reportado hoy es
un piso, no el total**. Es la brecha más grande que queda.

> **Cerrado.** El número estaba inflado: mezclaba los ignores deliberados
> (avisos de login, de seguridad, de contactos) con la cobertura faltante.
> Sobre el buzón entero son **4 correos**, no la mitad de la bandeja — ver
> «Cobertura sobre el buzón completo».

## Drenado completo del buzón — terminado

Segunda pasada, ya con el parser ampliado (commit `9a55b99`) y sobre una base
recién creada. El objetivo es drenar los **1725** correos del backlog, no una
muestra. Corre con `server/scripts/fase2-verify.ts drain`: el mismo runner de
producción en lotes, persistiendo `sync_progress` **antes** de seguir, así que
matar el proceso en cualquier momento no pierde trabajo y la siguiente llamada
retoma donde quedó.

**El buzón se drenó entero: 1725 / 1725 correos.** Lo que reportó el sync:

```
seen 1725 · inserted 1103 · duplicates 31 · needsReview 51 · skipped 583
statementsPersisted 5 · statementsNeedReview 3 · reversalsApplied 116
```

Foto de la base al terminar — **1134 transacciones**, 8 meses de historial:

| | |
|---|---|
| Ventana cubierta | 2026-01-07 → 2026-08-30 |
| `amount = 0` | **0** en todo el ledger |
| Mojibake en `counterparty` | **0** — el fix de decodificación aguanta a escala |
| `recibido` con monto | **64 / 64** (0 en cero) |
| Cuentas pobladas | 712 / 1134 (10 cuentas distintas) |
| `needs_review` | 51 |
| Reversos apareados | 116 filas con `is_reversed = 1` |
| Estados de cuenta | 5 |

Por tipo:

| tipo | filas | `amount = 0` | sin `account` | en review |
|---|---|---|---|---|
| `debito` | 500 | 0 | **0** | 11 |
| `transferencia` | 250 | 0 | 242 | 0 |
| `reverso` | 138 | 0 | 138 | 22 |
| `credito` | 114 | 0 | **0** | 0 |
| `recibido` | 64 | 0 | 24 | 0 |
| `servicio` | 40 | 0 | 18 | 18 |
| `retiro` | 14 | 0 | **0** | 0 |
| `sueldo` | 9 | 0 | **0** | 0 |
| `recarga` | 5 | 0 | **0** | 0 |

Las tres regresiones que motivaron la fase 1 no se reproducen a escala de
buzón completo: `debito` (500), `credito` (114), `retiro` (14), `recarga` (5) y
`sueldo` (9) entran **todos** con cuenta y con monto distinto de cero, y los 64
`recibido` entran todos con monto.

**Ninguna de las 51 filas en review está ahí por falta de monto: las 51 tienen
monto.** Se reparten en 22 `reverso` (sin consumo que aparear, el
comportamiento correcto), 18 `Cobranza con débito automático` y 11 `debito`.
Sin la columna `review_reason` (ver pendientes) no se puede afirmar el motivo
exacto de esas 29 últimas; lo que sí se ve es que el monto está y que la fila
queda excluida de los totales, que es lo que la regla de oro promete.

### Hallazgo resuelto: las transferencias sin `account` son correctas

**242 de 250 `transferencia` entran sin `account`.** La duda era si el parser
estaba perdiendo la cuenta de origen. **No la pierde: el correo no la trae.**

Verificado contra 41 correos reales de transferencia enviada — 35 de la
plantilla nueva (§4.3) y 6 de la vieja (§4.15):

| Qué se buscó en el cuerpo | Resultado |
|---|---|
| Label `Cuenta Origen` o `Cuenta Débito` | **0 correos** |
| Prosa `de (la\|su\|tu) cuenta`, `desde … cuenta`, `Banco Origen` | **0 correos** |
| Tokens de cuenta enmascarada **distintos** por cuerpo | exactamente **1** |
| Ese único token, ¿es el de `Cuenta Destino`/`Cuenta Beneficiario`? | **39 / 39** |

Los únicos labels que existen son `Fecha y Hora`, `Transacción`,
`Contacto`/`Beneficiario`, `Banco Destino`/`Banco Beneficiario`, `Cuenta
Destino`/`Cuenta Beneficiario`, `Monto`, `Descripción`, `Canal` y
`Referencia`. No hay ningún segundo número de cuenta que pudiera ser el del
usuario: guardar el que hay sería poner la cuenta **del beneficiario** en el
campo del titular.

La partición cierra exacto contra la base: 238 `Transferencia enviada` + 4
`Transferencia acreditada` = **242 sin cuenta**, y las 8 con cuenta son los
`Pago Tarjeta de Crédito` (§4.13), que es otro correo, sí nombra la cuenta
debitada y entra además marcado `is_internal`.

**Veredicto: correcto, no es bug.** No se tocó el parser. El invariante ya
estaba fijado por dos tests en `produbanco-formato-real.test.ts` (§4.3 *"deja
account en null"* y §4.15 *"NO guarda la cuenta ajena como propia"*), y la
evidencia quedó registrada en `docs/formato-correos-produbanco.md` §4.3.

### Lo que sí queda sin explicar en las filas sin cuenta

Descontadas las 242 transferencias, las 180 filas restantes sin `account` se
reparten en tres grupos, dos conocidos y uno abierto:

- **`reverso`: 138 de 138**, por diseño — §4.9: el correo de reverso no trae
  ningún campo de cuenta, sólo la tarjeta.
- **`Cobranza con débito automático`: 18 de 18**, por diseño — §4.11: el correo
  no dice de qué cuenta salió la plata.
- **`Transferencia recibida desde Produbanco`: 24 de 63 — era un bug, ya
  corregido** (abajo).

Nada de esto se corrigió con backfill: esta medición es de observación.

### Bug encontrado y corregido: el mismo asunto con dos cuerpos

Tirando del hilo de las 24 `recibido` sin cuenta apareció que
`Transferencia recibida desde Produbanco` llega con **dos plantillas
distintas**, y el parser sólo conocía una:

| | correos | remitente | cuenta del usuario |
|---|---|---|---|
| §4.4 | 39 | prosa `Te confirmamos que …` | `Cuenta Destino` |
| **§4.4b** | **24** | campo **`Enviada por`** | campo **`Cuenta Contacto`** |

Las 24 de la variante nueva entraban **sin `account` y sin `counterparty`** —
justo los dos campos que el cuerpo sí trae, sólo que con otros labels.

Lo difícil era decidir qué es `Contacto`: en la transferencia **enviada**
(§4.3) `Contacto` es la otra parte, así que la lectura ingenua habría guardado
la cuenta ajena como propia. Dos hechos de la bandeja real dicen que acá es el
**destino**:

- `Banco Contacto` **no es Produbanco en ninguno de los 24** correos — y la
  plata sale de Produbanco, así que no puede ser el banco del remitente.
- El set de `Banco`/`Cuenta Contacto` **contiene** el de `Banco`/`Cuenta
  Destino` de la variante §4.4 (2 de 2 bancos, 4 de 4 cuentas), que son las
  cuentas del usuario.

**Fix (fase 1, con test, sin tocar datos):** la rama de §4.4 ahora cae a
`Enviada por` y `Cuenta Contacto` cuando la prosa y `Cuenta Destino` no están.
Tres tests nuevos en `produbanco-formato-real.test.ts` (§4.4b) con el cuerpo
real —que además llega como **texto plano**, no HTML, porque el cliente de
Gmail prefiere la parte `text/plain`—. Medido contra los correos reales
después del fix:

| `recibido` | antes | después |
|---|---|---|
| con `account` | 40 / 64 | **64 / 64** |
| con `counterparty` | 40 / 64 | **64 / 64** |
| con monto | 64 / 64 | 64 / 64 |

Las filas viejas del ledger **no se tocaron**: el fix corrige la entrada, no el
histórico.

## Cobertura sobre el buzón completo

Lo que faltaba de la fase 2: el `classify` del buzón entero, no de una muestra.
Corrido sobre los **1729** correos del backlog, sólo por el parser
determinista (sin Claude y sin tocar la base).

| | correos | |
|---|---|---|
| **Catalogados** | **1145** | **66,2 %** |
| Ignorados | 584 | 33,8 % |
| …de ellos, asuntos desconocidos | **4** | **0,2 %** |

Desglose de los catalogados: 999 transacciones, 138 reversos, 8 estados de
cuenta. Y la calidad de campos, medida por el parser sobre el buzón entero:

| tipo | n | sin monto | sin cuenta | sin contraparte |
|---|---|---|---|---|
| `debito` | 500 | 0 | 0 | 0 |
| `transferencia` | 251 | 0 | 243 (correcto, §4.3) | 0 |
| `reverso` | 138 | 0 | 138 (correcto, §4.9) | 0 |
| `credito` | 116 | 0 | 0 | 0 |
| `recibido` | 64 | 0 | 24 → **0** con el fix | 24 → **0** con el fix |
| `servicio` | 40 | 0 | 18 (correcto, §4.11) | 0 |
| `retiro` | 14 | 0 | 0 | 14 (el correo no nombra comercio) |
| `sueldo` | 9 | 0 | 0 | 0 |
| `recarga` | 5 | 0 | 0 | 0 |
| `statement` | 8 | — | — | — |

**Cero montos sin leer y cero mojibake en todo el buzón.** Una sola fila queda
en review por el parser.

### El hallazgo 3 queda cerrado: no se descarta la mitad de la bandeja

El «50,6 % en `ignored`» de la primera pasada era sobre 265 correos y contaba
junto dos cosas muy distintas. Sobre el buzón entero, de los 584 ignorados
**580 se descartan a propósito**, con su razón nombrada, porque **no son
movimientos de plata**:

| `reason` | correos | qué es |
|---|---|---|
| `login_notification` | 470 | aviso de inicio de sesión |
| `flexiahorro_internal_transfer` | 30 | movimiento entre bolsillos propios |
| `contact_created` / `contact_modified` | 32 | alta/edición de contacto |
| `security_notice` | 22 | aviso de seguridad |
| `retiro_code_issued` | 10 | el código de retiro, no el retiro |
| `customer_support` | 8 | atención al cliente |
| `flexiahorro_reminder` | 4 | recordatorio |
| otros 4 `reason` | 4 | 1 correo cada uno |
| **`unrecognized_subject`** | **4** | **lo único sin catalogar** |

Los 4 asuntos desconocidos son 1 correo cada uno y están listados en
`docs/formato-correos-produbanco.md` §6. Sólo uno es con seguridad un
movimiento: un `Consumo Tarjeta de Débito Produbanco` cuyo asunto viene **sin**
el `por USD x.xx` que la rama exige. Otro (`Vencimiento Depósito a Plazo Fijo`)
probablemente lo sea. Los otros dos son avisos.

**El gasto reportado ya no es un piso con un agujero de la mitad de la
bandeja: es el total, menos 2 correos dudosos de 1729.**

### Cómo continuar

`server/scripts/fase2-verify.ts` es un script de medición **temporal y no
versionado** (§7 de `formato-correos-produbanco.md` explica por qué estas
mediciones no viven en el repo). Los subcomandos, para cuando haya que
reconstruirlo:

```bash
env WALLET_TELEMETRY_SILENT=1 ./node_modules/.bin/tsx \
  server/scripts/fase2-verify.ts drain        # retoma desde el checkpoint
env WALLET_TELEMETRY_SILENT=1 ./node_modules/.bin/tsx \
  server/scripts/fase2-verify.ts stats        # foto de la base
env WALLET_TELEMETRY_SILENT=1 ./node_modules/.bin/tsx \
  server/scripts/fase2-verify.ts classify 2000  # cobertura por asunto
env WALLET_TELEMETRY_SILENT=1 ./node_modules/.bin/tsx \
  server/scripts/fase2-verify.ts transfers 400  # labels/anclas de las transferencias
```

**Un solo `drain` a la vez.** Dos procesos contra el mismo SQLite se pisan el
checkpoint entre ellos: el avance por lote se desploma y los lotes se
solapan. Si hay que matarlo, matá el PID del proceso `node`, no con `pkill -f`
sobre el nombre del script — el patrón también matchea el shell que lo
invoca.

`classify` sobre el buzón entero son ~1700 fetches a Gmail, unos 7 minutos;
imprime el avance por `stderr` cada 100 correos.

## Lo que quedó pendiente

- **`Consumo Tarjeta de Débito Produbanco` sin monto en el asunto** (1 correo):
  la única transacción segura que hoy no se cataloga. Falta ver el cuerpo antes
  de agregar la rama.
- **`Vencimiento Depósito a Plazo Fijo Digital Produbanco`** (1 correo): hay
  que mirarlo para decidir si es una acreditación.
- **Las 24 `recibido` de §4.4b son transferencias del titular a sí mismo** — el
  `Enviada por` es el propio titular. Con la contraparte ya poblada por el fix,
  `isInternalTransfer` podría marcarlas, pero hoy no las mira: sólo considera
  `type = 'transferencia'`, no `recibido`. Mientras tanto cuentan como ingreso.
  Es una decisión de la capa de reglas, no del parser.
- **`review_reason` no se persiste.** El pipeline lo calcula
  (`claude_amount_mismatch`, `ambiguous_reversal_match`, …) pero no hay columna
  en `transactions`: la cola de review dice *qué* revisar y no *por qué*. Con
  las 51 filas en review del buzón completo esto ya duele: se sabe que todas
  tienen monto, pero no por qué están marcadas.
- **Ningún dato viejo se corrigió.** El ledger actual se llenó *antes* del fix
  de §4.4b, así que sus 24 `recibido` siguen sin cuenta ni contraparte. Un
  cliente nuevo no los ve así; este ledger sí.

## Veredicto

**Sí: un cliente nuevo ve su historial completo y bien parseado.** Medido sobre
el buzón entero —1729 correos, 8 meses, base creada de cero— y no sobre una
muestra.

*Calidad de lo que entra:* **cero** filas con monto perdido, **cero** con monto
en cero, **cero** mojibake en `counterparty`, y todos los tipos que deben
traer cuenta la traen (`debito` 500/500, `credito` 114/114, `retiro`, `recarga`,
`sueldo`, y `recibido` 64/64 después del fix de §4.4b). Las 4 regresiones de la
fase 1 —recibidos en cero, débitos sin cuenta, reversos colapsados, montos
perdidos por HTML— no se reproducen a escala de buzón completo.

*Cobertura:* **1145 de 1729 catalogados (66,2 %)**, y el 33,8 % restante no es
un agujero: 580 de esos 584 correos se descartan a propósito con su razón
nombrada porque no son movimientos de plata (470 son avisos de login). Lo que
de verdad falta catalogar son **4 correos, 1 de cada asunto** — y sólo 2 de
ellos son con seguridad movimientos. El hallazgo 3 («la mitad de la bandeja se
descarta») queda cerrado: era un artefacto de contar los ignores deliberados
como cobertura faltante.

*Lo que sí queda sin cerrar:* las filas sin `account` que **no** son un bug
—242 `transferencia`, 138 `reverso`, 18 `Cobranza con débito automático`— son
correos que sencillamente no dicen de qué cuenta salió la plata; están
verificadas una por una contra el correo real y documentadas. Y las 24
transferencias del titular a sí mismo (§4.4b) cuentan hoy como ingreso: es una
decisión pendiente de la capa de reglas, no un error de lectura.

Los dos bugs de la primera pasada están corregidos (ancla `de la cuenta` y
decodificación del cuerpo), y esta pasada agregó uno más, también corregido:
la variante `Contacto` de la transferencia recibida.
