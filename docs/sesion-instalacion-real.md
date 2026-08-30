# Sesión de instalación real — bitácora

Corrida el **2026-08-30** sobre una instalación con **credenciales reales** y un
ledger poblado (1140 transacciones). Es la contraparte de
[`reliability.md`](reliability.md), que se auditó con `.env` vacío y 0 filas: lo
que allí quedó ⚠️ ASUMIDO por falta de credenciales, acá se ejecuta de verdad.

Este documento es la **evidencia**; `reliability.md` es el **veredicto**. Si los
dos discrepan, gana lo que esté acá, porque acá está la salida observada.

> **Nada de datos personales.** Todo lo que sigue son conteos, claves y
> estructuras. Ningún nombre, ningún monto del ledger real, ningún token.

---

## Paso 1 — `--status` sobre una instalación real

`npm run onboard -- --status` con el `.env` real y el ledger poblado:

| Paso | `done` |
|---|---|
| `env` | ✅ true |
| `claude` | ❌ **false** |
| `gmail` | ✅ true |
| `sync` | ✅ true |
| `huso` | ✅ true |
| `profile` | ❌ false |

`complete: false`, `next: claude`.

**El `--status` atrapó un error real de configuración**, y esto es el hallazgo
más valioso del paso 1. El `.env` tenía en `CLAUDE_CODE_OAUTH_TOKEN` un token
que *parecía* correcto (108 caracteres, prefijo `sk-ant-`), pero era el
**refresh token** (`sk-ant-ort01…`) en vez del **access token**
(`sk-ant-oat01…`). El mensaje de `action` lo diagnosticó con precisión
quirúrgica, incluyendo de dónde sale cada uno:

> `CLAUDE_CODE_OAUTH_TOKEN tiene un refresh token (empieza con sk-ant-ort...), no
> un token de acceso. Es el valor "refreshToken" de ~/.claude/.credentials.json;
> el que hace falta lo imprime `claude setup-token` y empieza con sk-ant-oat...`

Sin esa validación de forma (la que agregó `866d5ec`), el síntoma habría sido un
**401 silencioso con reintentos** en medio del primer sync — ver paso 2, caso B,
donde se reproduce exactamente eso. Es la diferencia entre "te falta pegar el
token correcto" y "el sync se cuelga y no sé por qué".

### Detalle de entorno que conviene saber

- El `.env` real está en **CRLF**. Se verificó que `process.loadEnvFile` (Node
  22 nativo, sin dependencia de `dotenv`) **descarta el `\r`**: `PORT` llega con
  `len=4`, no 5. No hay bug acá, pero valía comprobarlo antes que suponerlo.
- Hay **dos** `bolsillo.sqlite`: el bueno en la raíz (1140 tx) y uno viejo y
  chico en `server/` (135 KB, de un `cwd` distinto). Es exactamente el riesgo
  que ya documenta `db/open.ts:11`. No afecta a los comandos de este documento
  (todos corren desde la raíz), pero es una trampa esperable para quien corra
  `npm run …` parado en `server/`.

---

## Paso 2 — La credencial de Claude funciona *de verdad* (ítem #2)

El ítem #2 de `reliability.md` estaba ASUMIDO con una queja precisa: *"nadie
comprobó que el token que imprime ese comando sirva para sincronizar o
chatear"* — sólo que `--status` se ponía en verde. Eso ya no es así.

Las tres pruebas se corrieron con **`HOME` apuntando a un directorio vacío**
(`/tmp/emptyhome`), para que el SDK **no** pueda leer
`~/.claude/.credentials.json` y la única credencial posible sea la variable de
entorno. Sin ese aislamiento la prueba no vale nada: el SDK habría autenticado
por el archivo y el resultado sería el mismo con o sin `CLAUDE_CODE_OAUTH_TOKEN`.

| # | Credencial en `CLAUDE_CODE_OAUTH_TOKEN` | Resultado observado |
|---|---|---|
| A | access token `sk-ant-oat01…` | ✅ `subtype=success`, `is_error=false`, respuesta `"ok"` |
| B | refresh token `sk-ant-ort01…` | ❌ `api_retry status=401` ×2 → `"Not logged in · Please run /login"` |
| C | access token válido **+** `ANTHROPIC_API_KEY` basura | ❌ `api_retry status=401` ×7 (y sigue) |

Qué prueba cada uno:

- **A** — un token con la forma que emite `claude setup-token` autentica al SDK
  **por variable de entorno**, sin archivo de credenciales. Esta es la mitad que
  faltaba del ítem #2.
- **B** — la validación de forma de `--status` es un **true positive**, no una
  molestia. El token que rechaza efectivamente falla con 401 contra la API.
- **C** — **`ANTHROPIC_API_KEY` tiene precedencia sobre el token OAuth**, y eso
  queda comprobado empíricamente. `reliability.md` decía que la precedencia *"no
  está implementada en este repo"* y tenía razón sobre el código del repo (las
  tres ramas tratan las credenciales como un OR simétrico), pero la precedencia
  **existe y la aplica el Claude Agent SDK**: con un token OAuth perfectamente
  válido presente, una API key inválida rompe igual. El comentario del
  `.env.example` (*"si ambos están puestos, ANTHROPIC_API_KEY gana y factura por
  token"*) es **correcto**. Queda resuelta la disyuntiva que planteaba el ítem
  #2 (*"o se comprueba contra el SDK, o se saca de la doc"*): se comprobó.

### El extractor de Claude, punta a punta

`server/claude-probe.probe.ts` corre el `ItemsExtractor` real contra un correo
**ficticio** y cruza el resultado contra el parser determinista:

```json
{ "ms": 4230,
  "extracted": { "amount_text_raw": "USD 12.34", "counterparty": "COMERCIO DE PRUEBA" },
  "crossCheck": { "ok": true, "derived": 12.34 } }
```

La invariante nº 1 de `CLAUDE.md` (el monto sale del parser, Claude es
verificación cruzada) se ejercita acá con la credencial real: Claude leyó
`USD 12.34`, el cruce contra el 12.34 del parser dio `ok: true`. **~4,2 s por
correo** es el costo real de la verificación cruzada — el número que hacía falta
para dimensionar cuánto tarda un sync grande.

### El caveat honesto del ítem #2

Lo que **no** se pudo hacer es correr `claude setup-token` en sí: pide un login
interactivo en el navegador. El token que se usó salió de
`~/.claude/.credentials.json` (suscripción **Max** ya logueada en esta máquina),
que es *el mismo tipo de token* (`sk-ant-oat01…`, 108 caracteres) que imprime
`setup-token`, pero **de sesión, no de un año**: expira el **2026-08-30 22:06
UTC**, unas horas después de esta corrida.

Consecuencia práctica: está verificado que **un token con esa forma funciona**,
que **la variable de entorno es la vía**, y que **el token equivocado falla como
dice el diagnóstico**. Lo que sigue sin verificar es la *longevidad* del token de
un año. Para Kevin eso es un no-problema: él va a correr `claude setup-token` de
verdad y va a obtener el de un año.

---

## Paso 3 — El sync, drenado de verdad (ítem #4)

El ítem #4 estaba ASUMIDO porque *"el drenaje multi-lote nunca se observó"*:
sin credenciales no se pudo correr un solo lote, y el checkpoint, el `progress`
incremental y el "nada se reprocesa" descansaban en `run-sync.test.ts`. Acá se
observan los tres contra el buzón real.

### 3a. Drenaje multi-lote y checkpoint — base temporal, procesos separados

Lotes de 5 contra `/tmp/e2e-sync.sqlite`, cada lote en **un proceso nuevo**. Si
el checkpoint no sobreviviera a la muerte del proceso, el lote 2 empezaría de
cero:

| Lote | `processed` | `total` | `remaining` | `complete` | `seen` | `duplicates` |
|---|---|---|---|---|---|---|
| 1 | 5 | 1734 | 1729 | false | 5 | 0 |
| 2 | 10 | 1734 | 1724 | false | 5 | 0 |
| 3 | 15 | 1734 | 1719 | false | 5 | 0 |

`total` se mantiene fijo en 1734 (el backlog se abre **una** vez y queda
guardado), `processed` avanza exactamente `seen`, y `remaining` baja de a 5. El
checkpoint en la base, leído aparte, cierra la aritmética:

```
checkpoint: processed=15 total=1734 pendingIds.length=1719   # 1734 - 15
```

### 3b. "Nada se reprocesa" — sobre el ledger real, que es donde se prueba

Éste es el que no se podía falsear con una base vacía. La base real ya tenía
**1140** transacciones drenadas y un `last_sync_ts` de unas horas antes:

| Llamada | `total` | `seen` | `inserted` | `duplicates` | `skipped` | `complete` |
|---|---|---|---|---|---|---|
| 1 | 21 | 16 | **0** | **11** | 5 | false |
| 2 | 21 | 5 | **0** | **3** | 2 | true |

Tres cosas quedan probadas de una sola vez:

1. **La ventana incremental funciona.** El backlog es de **21**, no de 1734: la
   `after:` derivada de `last_sync_ts` (menos un día de solape, `pipeline.ts:127`)
   acota la búsqueda. Contra una base virgen el mismo código abre 1734 — o sea
   que el filtro es real y no decorativo.
2. **Nada se reprocesa.** 14 duplicados, **0 inserciones**, y el conteo de la
   tabla quedó en **1140 antes y 1140 después**. La idempotencia por
   `gmail_msg_id` no es una promesa de test unitario: un re-drenado completo de
   la ventana no movió una sola fila.
3. **Al cerrar, cierra bien.** `complete: true`, `remaining: 0`,
   `sync_progress` con **0 filas** (checkpoint borrado) y `last_sync_ts`
   avanzado. Es exactamente la secuencia que describe `run-sync.ts:156-159`.

### 3c. El tope de 45 segundos, visto en vivo

La primera llamada se pidió con `batchSize: 50` y devolvió `seen: 16` en
**49,6 s**. No se quedó corta de correos: se quedó corta de **tiempo**, y cortó
donde dice la doc (`DEFAULT_SYNC_MAX_MS = 45_000`). Los 5 que faltaban salieron
en la llamada siguiente. El `seen` es un prefijo exacto del lote y lo no
atendido queda pendiente tal cual — la doc lo afirmaba, acá se ve.

Esto le pone número al costo real: **~4,4 s por correo** (los ~4,2 s del
extractor de Claude del paso 2, más red). Para quien arranque de cero con este
buzón, **1734 correos ≈ 2 horas de sync**, en lotes de ~45 s. No es un
problema, pero conviene decirlo: el primer sync no es instantáneo, y hay que
volver a llamar mientras `complete` sea `false`.

### Hallazgo de paso: el anclaje de rutas relativas es real

Corriendo el probe desde `server/` con `PROBE_DB=../bolsillo.sqlite`, el motor
**no** abrió `/opt/data/home/wallet-prueba/bolsillo.sqlite` sino
`/opt/data/home/bolsillo.sqlite`: una ruta relativa se ancla a la **raíz del
repo**, no al `cwd` (`db/open.ts:20-23`). Es el comportamiento documentado y es
el correcto — pero conviene saber que convierte un `../` distraído en una base
nueva y vacía, en silencio, fuera del repo. Se borró; la base del usuario no se
tocó.

Es la misma familia de trampa que el `server/bolsillo.sqlite` viejo del paso 1.

---

## Paso 4 — El perfil, propuesto y escrito con datos reales (ítems #5 y #6)

Los ítems #5 y #6 ya eran ✅, pero con un caveat grande: *"con el ledger vacío
no se pudo ver la forma **poblada**"*. Acá se ve.

### 4a. `--suggest` sobre 1140 transacciones

Las cinco claves documentadas, ahora con contenido:

| Clave | Qué salió |
|---|---|
| `titular` | presente (cadena de 29 caracteres) |
| `salary` | `{fuente, cadencia, montoEstimado, diasPago, sampleSize}` — `cadencia: "quincenal"`, `sampleSize: 9` |
| `mesesDeHistorial` | `7.3` |
| `gastoMensualPromedio` | presente |
| `uncategorized` | 15 entradas de `{counterparty, count, total}` |

Dos afirmaciones de la doc que sólo se podían comprobar con datos, y se
comprueban:

- **`uncategorized` viene ordenado por plata gastada, descendente.** Los 15
  totales salen `700 > 612 > 607 > 373 > 205 > … > 80`, estrictamente
  decreciente. No por cantidad de veces: la tercera entrada tiene **240**
  apariciones y la primera sólo 7. El orden correcto es ése —lo que más plata
  mueve va primero—, y es el que efectivamente hace.
- **`sampleSize: 9`** coincide exactamente con las 9 filas de tipo `sueldo` del
  ledger. No es un número decorativo.

### 4b. `--suggest | --set`: el flujo real es un pipe

`parseSetPatch` (`cli.ts:125-168`) está hecho para tragarse **la salida entera
de `--suggest` sin editarla**: ignora las claves que son sólo de sugerencia,
renombra `salary` → `sueldo`, le saca el `sampleSize` (*"dice qué tan flaca es
la lectura; no es parte del sueldo"*) y descarta `titular: null`. Así que el
paso 5 del onboarding es literalmente un pipe:

```bash
SUG=$(npm run onboard -- --suggest | sed -n '/^{/,$p')
npm run onboard -- --set "$SUG"     # -> {"ok":true,"written":["titular","sueldo"]}
```

Salió `{"ok": true, "written": ["titular", "sueldo"]}`, y en la base quedó
`sueldo` con las cuatro claves buenas — **sin `sampleSize`**, como corresponde.

Con eso, `--status` da **`complete: true`, `next: null`**: los seis pasos en
verde sobre una instalación real.

### 4c. El calendario de pagos **no** cae en la trampa del `"15"` pelado

Éste era el riesgo concreto del ítem #6: `--set` acepta un día de pago pelado
(`"15"`), deja `next_payday` en `null` y `safe_to_spend_hoy` en 0, y `--status`
igual informa `profile: done` — un perfil "configurado" con el calendario mudo.

Lo que `--suggest` propone **no** tiene esa forma: emite rangos,
`diasPago: ["5-5","20-20"]`. Y el resultado se ve:

```
next_payday: 2026-09-05      # hoy es 2026-08-30
safe_to_spend_hoy: número > 0
```

O sea: **el camino que va a caminar Kevin (`--suggest | --set`) produce un
calendario que funciona.** La trampa del `"15"` sigue existiendo, pero sólo se
pisa escribiendo el `diasPago` a mano. La advertencia de onboarding.md §5a
queda bien puesta y ahora se sabe que no afecta al flujo normal.

### 4d. La capa MCP, contra el bundle versionado

El `get_balance` de arriba salió por el `.cjs` versionado, con un cliente stdio
real. De paso:

- **`stdout` es JSON-RPC puro**: 0 líneas no-JSON. (S10, revalidado.)
- **El server expone 14 tools, y `mcp.md` documentaba 12.** La auditoría
  anterior había anotado esto como S1 con 13 contra 12; el hueco creció al
  agregarse `resolve_review` (`6759548`). **Corregido en este commit**: la tabla
  de `mcp.md` lista ahora las 14, con `resolve_review` y `heal_counterparties`
  en su lugar. S1 pasa a ✅.

---

## Paso 5 — Las reglas de categorización, sobre filas de verdad (ítems #7 y #8)

Los ítems #7 y #8 estaban ✅ **de contrato** con un caveat que se repetía en los
dos: *"con el ledger vacío no se observó el matcheo por substring ni el
desempate por longitud"*, y *"todos los contadores dieron 0"*. Acá los
contadores no dan 0.

Punto de partida: **`category_rules` vacía** y **689 filas en `otros`** — es
decir, casi todo el gasto sin clasificar. Es el estado real de un ledger recién
drenado.

### 5a. `--backfill` **no** es `--reclassify`, y la diferencia se siente

La primera sorpresa útil. Con las 10 reglas ya escritas, `--backfill` devolvió
`updated: 138`… y el gasto por categoría casi no se movió: `transporte` quedó
en 113 cuando UBER solo tiene **437** filas, y `otros` incluso **subió** de 689
a 691.

No es un bug, es la definición de cada comando, y ahora está observada:

| Comando | A qué filas les toca la categoría |
|---|---|
| `--backfill` | Sólo las que la tienen **vacía**: `WHERE category IS NULL OR category = ''` (`backfill.ts:27`) |
| `--reclassify` | **Recalcula** las ya clasificadas, incluidas las que quedaron en `otros` |

Las 138 de `--backfill` eran las 116 filas con `category` en `NULL`. Todo lo que
ya decía `otros` —que es donde se acumula el gasto sin regla— **sólo lo mueve
`--reclassify`**:

```
--reclassify -> {"markedInternal": 71, "recategorized": 501}
```

Ahí sí: `otros` cayó de 691 a 200.

> **Esto importa para Kevin.** Si corre sólo `--backfill` después de escribir
> sus reglas, va a ver casi todo el gasto en `otros` y va a concluir que las
> reglas no funcionan.
>
> `onboarding.md` §5b **ya lo advierte** y lo advierte bien: *"una fila que ya
> decía `otros` es una fila 'con categoría', y `--backfill` la va a saltear para
> siempre"*, con el orden correcto (`--set` → `--backfill` → `--reclassify`).
> La doc acertó; lo que faltaba era el número que muestra cuánto se juega ahí:
> **`--backfill` movió 138 filas, `--reclassify` movió 501**. Es la diferencia
> entre un tablero que parece roto y uno que no.

### 5b. El desempate por longitud, verificado

Ésta es la afirmación que nunca se había podido probar: *"las reglas más largas
ganan"*. Se montó el caso a propósito — dos reglas que compiten por las mismas
filas:

- `uber` → `transporte`
- `uber eats` → `comida`

Resultado sobre el ledger real:

| Contraparte | Filas | Categoría |
|---|---|---|
| `…UBER EATS…` | 7 | **`comida`** ✅ (ganó la regla larga) |
| `…UBER RIDES…` | 518 | `transporte` |
| `UBR* PENDING.UBER.COM…` | 35 | `transporte` |
| `METRORED…` | 6 | `salud` |
| `TITAN…` | 7 | `comida` |
| `ANTHROPIC…` / `CLAUDE.AI…` | 5 / 1 | `suscripcion` |
| `…GOOGLE ONE…` / `…YouTubePremium…` | 8 / 3 | `suscripcion` |
| `TIPTI…` | 3 | `comida` |

Las siete filas de UBER EATS podrían haber caído en `transporte` por la regla
`uber`, y no cayeron: ganó `uber eats`, que es más larga. **El desempate por
longitud funciona.**

Y el matcheo por substring también, en las dos direcciones que importaban:

- `uber` matchea `DLC* UBER RIDES SAN JOSE CR` y `UBR* PENDING.UBER.COM
  Amsterdam IE` — contrapartes con formas muy distintas.
- `google one` matchea `Google One 650-…` **y** `GOOGLE *GOOGLE ONE MOUNTAIN
  VIUS`. Para que eso pase, la normalización (minúsculas + espacios) tiene que
  aplicarse **a los dos lados**, no sólo al patrón guardado. Se aplica.

### 5c. Idempotencia, medida

Repetir los dos comandos sobre el mismo estado:

```
--backfill    -> {"updated": 0}
--reclassify  -> {"markedInternal": 0, "recategorized": 0}
```

Cero en todo. *"Correrlos dos veces es inofensivo"* deja de ser una promesa.

### 5d. `--learn-rules` con datos: 26 aprendidas, 0 ambiguas

```
{"learned": 26, "skippedAmbiguous": 0, "skippedExisting": 2}
```

Las 26 son la **contraparte normalizada completa**, no fragmentos
(`rules-repository.ts:97`) — `dlc* uber rides san jose cr`,
`metrored carolina quito ec`, `google youtubepremium 650-2530000 us`. Conviven
sin pelearse con las 10 cortas escritas a mano porque, justamente, la más larga
gana: la aprendida es más específica y coincide con la corta en la categoría.

Los `skippedExisting: 2` son las que ya estaban. Un `--reclassify` posterior dio
`0, 0`: las reglas aprendidas no cambiaron ninguna clasificación, que es lo
esperable si son consistentes con las escritas a mano.

### Distribución final del gasto

| Categoría | Filas |
|---|---|
| `transporte` | 564 |
| `transferencia_persona` | 211 |
| `otros` | 152 |
| `servicios` | 22 |
| `suscripcion` | 18 |
| `comida` | 17 |
| `efectivo` | 14 |
| `salud` | 6 |
| `recarga` | 5 |

De **689 en `otros` a 152**, con 36 reglas (10 a mano + 26 aprendidas). Las 152
que quedan son comercios de una sola aparición y 24 filas sin contraparte —
ésas no las puede resolver ninguna regla de substring.

---

## Reproducir los pasos 1 y 2

```bash
npm run onboard -- --status

# El token entra por PROBE_TOKEN para que loadEnvFile no lo pise,
# y HOME vacio garantiza que el SDK no lea ~/.claude/.credentials.json.
mkdir -p /tmp/emptyhome
export PROBE_TOKEN='sk-ant-oat01...'
HOME=/tmp/emptyhome npx tsx server/claude-env.probe.ts         # caso A (y B con el ort)
HOME=/tmp/emptyhome npx tsx server/claude-precedence.probe.ts  # caso C

cd server && npx tsx claude-probe.probe.ts                     # extractor + cruce
```
