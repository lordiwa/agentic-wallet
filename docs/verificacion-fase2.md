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

## Hallazgos abiertos (bugs de parser, NO de dato)

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

## Drenado completo del buzón — en curso

Segunda pasada, ya con el parser ampliado (commit `9a55b99`) y sobre una base
recién creada. El objetivo es drenar los **1725** correos del backlog, no una
muestra. Corre con `server/scripts/fase2-verify.ts drain`: el mismo runner de
producción en lotes, persistiendo `sync_progress` **antes** de seguir, así que
matar el proceso en cualquier momento no pierde trabajo y la siguiente llamada
retoma donde quedó.

Corte de esta medición: **444 / 1725 procesados (25,7 %)**, `255`
transacciones. Ritmo observado ≈ 17 correos/min (≈ 20 por lote), sin un solo
lote fallido.

| | |
|---|---|
| Ventana cubierta | 2026-07-23 → 2026-08-30 |
| `amount = 0` | **0** en todo el ledger |
| `recibido` con monto | **23 / 23** (0 en cero) |
| Cuentas pobladas | 171 / 255 |
| `needs_review` | 7 (4 reversos sin aparear, 3 `servicio`) |
| Mojibake en `counterparty` | **0** — el fix de decodificación aguanta |
| Reversos apareados | 11 filas con `is_reversed = 1` |

Los tres bugs que motivaron la fase 1 siguen sin reproducirse a esta escala:
`debito` (73), `credito` (52), `recibido` (23), `retiro` (6), `recarga` (3) y
`sueldo` (2) entran **todos** con cuenta y con monto distinto de cero.

### Lo que aparece al ampliar la ventana

Las 84 filas sin `account` no están repartidas: se concentran en tres tipos.

- **`transferencia`: 66 de 70 sin cuenta.** Es el hueco nuevo más grande y no
  estaba en la muestra de la primera pasada. Hay que mirar el asunto real de
  la transferencia enviada antes de decidir si es bug de parser o si el correo
  simplemente no trae la cuenta.
- **`reverso`: 15 de 15 sin cuenta**, 4 en review. Consistente con el hallazgo
  de la primera pasada: el reverso queda auditable en vez de aparearse mal.
- **`servicio`: 3 de 11 sin cuenta**, las mismas 3 en review.

Nada de esto se corrigió: esta medición es de observación, sin backfill ni
heal.

### Cómo continuar

```bash
env WALLET_TELEMETRY_SILENT=1 ./node_modules/.bin/tsx \
  server/scripts/fase2-verify.ts drain     # retoma desde el checkpoint
env WALLET_TELEMETRY_SILENT=1 ./node_modules/.bin/tsx \
  server/scripts/fase2-verify.ts stats     # foto de la base
```

**Un solo `drain` a la vez.** Dos procesos contra el mismo SQLite se pisan el
checkpoint entre ellos: el avance por lote se desploma y los lotes se
solapan. Si hay que matarlo, matá el PID del proceso `node`, no con `pkill -f`
sobre el nombre del script — el patrón también matchea el shell que lo
invoca.

Falta todavía la parte de **cobertura** de esta segunda pasada: el conteo de
asuntos que siguen cayendo en `ignored` sobre el buzón entero (subcomando
`classify`). El 50,6 % de la primera pasada es sobre 265 correos, no sobre los
1725.

## Lo que quedó pendiente

- **1281 correos sin procesar** del drenado en curso. El checkpoint de
  `sync_progress` está intacto: la próxima llamada a `drain` sigue donde quedó,
  sin repetir trabajo.
- **La ventana anterior a 2026-08-07 no se probó.** Si los correos viejos usan
  otra plantilla, este resultado no dice nada sobre ellos.
- **`review_reason` no se persiste.** El pipeline lo calcula
  (`claude_amount_mismatch`, `ambiguous_reversal_match`, …) pero no hay columna
  en `transactions`: la cola de review dice *qué* revisar y no *por qué*.
- Cuantificar los asuntos ignorados sobre la muestra real y decidir cuáles
  catalogar (hallazgo 3).

## Veredicto

**La entrada de datos es correcta desde el primer correo para un cliente
nuevo, en los tipos que el parser cataloga.** Las tres regresiones que motivaron
la fase 1 —recibidos con monto 0, débitos sin cuenta, reversos colapsados— no
se reproducen: 0/18, 0/87 y 0 filas con `amount = 0`, sobre 265 correos reales
procesados desde una base vacía.

Falta corregir en la fase 1, sin tocar datos: el ancla `de la cuenta` del
correo de recarga (hallazgo 1) y la decodificación del cuerpo (hallazgo 2).
Ninguno de los dos invalida los cuatro números; los dos son de parser.

Aparte de eso, el problema dominante ya no es la *calidad* de lo que entra sino
su *cobertura*: la mitad de la bandeja todavía no se cataloga.
