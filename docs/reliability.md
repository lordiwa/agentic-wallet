# Ledger de confiabilidad

> **Score: 4 / 10** — 4 VERIFICADOS, 4 ASUMIDOS, 2 INCONSISTENTES sobre los 10
> ítems del onboarding.
>
> **Meta: ≥ 9/10.** No se cumple. Los ítems que bajan el score y qué haría
> falta para subirlos están al final, en
> [Qué falta para llegar a 9/10](#qué-falta-para-llegar-a-910).

Auditoría del commit `91520df`, corrida el **2026-08-29** sobre esta misma
instalación (Linux, Node 22, `.env` sin credenciales, ledger con **0
transacciones** — es decir, el estado real de una instalación de primera vez
antes del primer sync).

---

## Para qué existe este documento

La documentación de onboarding describe un proceso que nadie volvió a caminar
de punta a punta desde que se escribió. Este ledger separa lo que **está
probado** de lo que **se supone que anda**, ítem por ítem, para que nadie
confunde una cosa con la otra.

La regla: **un ASUMIDO honesto vale más que un VERIFICADO falso.** Un ítem sólo
se marca VERIFICADO si alguien ejecutó el comando y la salida observada
coincidió con lo que dice la doc. "Está cubierto por tests unitarios" **no**
alcanza para VERIFICADO: los tests prueban el motor, este ledger prueba las
*instrucciones*.

| Estado | Qué significa |
|---|---|
| ✅ **VERIFICADO** | Se ejecutó. La salida real coincide con lo que dice la doc. |
| ⚠️ **ASUMIDO** | No se pudo ejecutar (necesita credenciales, cuenta, o una consola web). Puede estar bien o mal: nadie lo comprobó. |
| ❌ **INCONSISTENTE** | Se ejecutó y **no** coincide: la doc dice X, la realidad hace Y. |

**Confiabilidad = VERIFICADOS / (VERIFICADOS + ASUMIDOS + INCONSISTENTES).**

---

## Límite de esta auditoría (leelo antes de la tabla)

Todo lo que sigue se corrió con:

- **`.env` sin ninguna credencial** — ni Claude, ni Gmail.
- **Un ledger vacío** (0 filas en `transactions`).
- Las escrituras se hicieron contra una base temporal
  (`WALLET_DB_PATH=/tmp/rel-audit.sqlite`), nunca contra la base del usuario.
- **Sin tocar el server HTTP salvo para los dos ítems que sólo se ven ahí**
  (`npm run dev` y el chat), que se probaron con un proceso efímero en el
  puerto 3999.

Consecuencia directa: **ningún ítem se ejercitó contra un buzón de Gmail real
ni contra un ledger con datos.** Eso es exactamente lo que separa los cuatro
ASUMIDOS de los cuatro VERIFICADOS, y es la razón principal por la que el score
es 4 y no 9.

---

## El ledger

### 1. `--init-env` — crear el `.env`

| | |
|---|---|
| **Qué dice la doc** | `npm run onboard -- --init-env` copia `.env.example` → `.env` y **nunca sobrescribe** uno existente. `.env` está en `.gitignore`. (onboarding.md, Paso 1) |
| **Qué hace la realidad** | Exactamente eso. Con `.env` presente devuelve `{"ok":true,"created":false,...,"next":".env ya existia; no se toco."}` y exit 0. Un clon fresco trae `.env.example` y **no** trae `.env`. |
| **Estado** | ✅ **VERIFICADO** |
| **Evidencia** | `npm run onboard -- --init-env` → `created:false`, archivo intacto. `git clone` a `/tmp/fresh-clone-audit`: `.env.example` presente, `.env` ausente. `.gitignore` lista `.env`, `.env.bak*`, `.env.local`, `*.sqlite`. |

### 2. `claude setup-token` — credencial de Claude

| | |
|---|---|
| **Qué dice la doc** | Correr `claude setup-token`, pegar el token en `CLAUDE_CODE_OAUTH_TOKEN`, y el paso `claude` de `--status` pasa a `done: true`. Si están las dos credenciales, `ANTHROPIC_API_KEY` tiene precedencia. (onboarding.md, Paso 2) |
| **Qué hace la realidad** | **La mitad está probada.** El subcomando existe y es el correcto (`claude 2.1.246`, `setup-token` → *"Set up a long-lived authentication token (requires Claude subscription)"*). Con `CLAUDE_CODE_OAUTH_TOKEN` en el entorno, el paso `claude` efectivamente pasa a `done: true`. **La otra mitad no**: no se emitió un token real (requiere una suscripción Pro/Max y un login interactivo), así que nadie comprobó que el token que imprime ese comando sirva para sincronizar o chatear. La **precedencia** de `ANTHROPIC_API_KEY` **no está implementada en este repo**: `build-sync-runner.ts:69`, `index.ts:76` y `status.ts:120` tratan a las dos credenciales como un OR simétrico. Si hay precedencia, la decide el Claude Agent SDK, y eso no se verificó. |
| **Estado** | ⚠️ **ASUMIDO** |
| **Evidencia** | `claude --version` → `2.1.246`; `claude setup-token --help` → texto citado. `CLAUDE_CODE_OAUTH_TOKEN=ficticio npm run onboard -- --status` → paso `claude` `done:true`. `grep -rn ANTHROPIC_API_KEY server/src` → ninguna rama de precedencia. |

### 3. Gmail OAuth en Google Cloud Console

| | |
|---|---|
| **Qué dice la doc** | Ocho pasos con nombres de pantalla y botones exactos: *APIs & Services → Library → Gmail API → Enable*; *Google Auth Platform → Overview → Get started*; *Audience → External*; *Data Access → Add or remove scopes*; *Clients → Create client → Desktop app*; *Audience → Publishing status → Publish app*. Después `npm run gmail-auth`, que abre el navegador y "Google redirige a `localhost`". (conectar-gmail.md) |
| **Qué hace la realidad** | **Ninguno de los 8 clics se pudo comprobar** — requiere una cuenta de Google y la consola web. Los nombres de pantalla son plausibles para la consola post-2024 (donde el consent screen pasó a llamarse *Google Auth Platform*), pero **plausible no es verificado**, y esa consola cambia de layout seguido. Lo que sí se probó es el script: sin `GMAIL_OAUTH_CLIENT_ID`/`SECRET` imprime el error correcto y **manda a `docs/conectar-gmail.md`**, con exit 1. Detalle menor que la doc dice mal: el redirect real no es `localhost` sino `http://127.0.0.1:<puerto-aleatorio>/oauth2callback` (loopback RFC 8252 con puerto efímero — no hay que pre-registrarlo, pero la doc no lo aclara). |
| **Estado** | ⚠️ **ASUMIDO** |
| **Evidencia** | `npm run gmail-auth` sin credenciales → *"Faltan GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET en .env … el paso a paso esta en docs/conectar-gmail.md"*, exit 1. `server/scripts/gmail-auth.ts:161-176` (`server.listen(0, "127.0.0.1")`, `redirectUri = http://127.0.0.1:${port}/oauth2callback`). |

### 4. `sync` — el primer sync

| | |
|---|---|
| **Qué dice la doc** | El sync se drena por lotes de **50 correos o 45 segundos**, guarda checkpoint, y cada respuesta trae `progress: {processed, total, remaining, complete}`. Hay que **volver a llamar mientras `complete` sea `false`**; nada se reprocesa. El paso `sync` de `--status` no se cierra hasta que no queda backlog. (onboarding.md, Paso 4) |
| **Qué hace la realidad** | **Los números de la doc son correctos en el código** (`DEFAULT_SYNC_BATCH_SIZE = 50`, `DEFAULT_SYNC_MAX_MS = 45_000`) y las tres puertas de entrada degradan bien sin credenciales: tool MCP `sync` → `{"ok":false,"error":"gmail_not_configured"}`, `POST /api/sync` → HTTP 503 `{"error":"gmail_not_configured"}`. **Pero el drenaje multi-lote nunca se observó**: sin credenciales de Gmail no se pudo correr un solo lote exitoso, mucho menos comprobar el checkpoint, el `progress` incremental, o que "nada se reprocesa". Todo eso descansa en `run-sync.test.ts`, no en un buzón real. |
| **Estado** | ⚠️ **ASUMIDO** |
| **Evidencia** | `server/src/sync/run-sync.ts:72,80`. Probe MCP → `sync {}` = `gmail_not_configured`. `curl -X POST localhost:3999/api/sync` → 503. |

### 5. `suggest_profile` / `--suggest`

| | |
|---|---|
| **Qué dice la doc** | Lee el ledger real y propone; **no escribe nada**; si no hay evidencia devuelve `null` en vez de inventar. Con el ledger vacío, "`--suggest` devuelve todo `null`" es el síntoma documentado de "falta el paso 4". Las claves son `titular`, `salary`, `uncategorized`, `gastoMensualPromedio`, `mesesDeHistorial`. (onboarding.md Paso 5 + tabla de problemas; mcp.md §"El ciclo de configuración") |
| **Qué hace la realidad** | Idéntico, por las dos superficies. CLI y tool MCP devuelven exactamente `{"titular":null,"salary":null,"uncategorized":[],"gastoMensualPromedio":null,"mesesDeHistorial":0}` — mismas claves que el ejemplo de la doc, ningún valor inventado, ninguna escritura. La tabla de problemas acierta el diagnóstico. **Caveat honesto:** con el ledger vacío no se pudo ver la forma *poblada* (el `salary.sampleSize`, el orden de `uncategorized` por plata gastada); esa parte se apoya en `suggest.test.ts`. |
| **Estado** | ✅ **VERIFICADO** |
| **Evidencia** | `npm run onboard -- --suggest` y tool MCP `suggest_profile {}`: salida citada, byte por byte igual entre las dos. |

### 6. `set_profile` / `--set`

| | |
|---|---|
| **Qué dice la doc** | Escribe los campos confirmados; un campo desconocido es error duro que lista los válidos; `balanceSnapshot` ancla el saldo; el paso `profile` se cierra con `titular` + al menos un día de pago. Y en mcp.md: *"Un `\"15\"` pelado no parsea y deja el calendario de pagos en null."* |
| **Qué hace la realidad** | La parte gruesa anda: los seis campos documentados se escriben (`titular`, `sueldo`, `colchonObjetivo`, `topeTransferenciasMensual`, `moneda`, `balanceSnapshot`), el campo desconocido devuelve el error con la lista de válidos, `balanceSnapshot:{amount:1234.56}` → `get_balance.balance_actual = 1234.56`, y el paso `profile` pasa a `done:true`. **Pero la advertencia del `"15"` pelado describe mal las dos superficies**: por MCP `set_profile` **rechaza** el valor antes de escribirlo (`MCP error -32602: Invalid at sueldo.diasPago[0]`) — o sea que por el camino que documenta mcp.md el calendario nunca queda en null, porque el valor no entra. El que **sí** lo acepta en silencio es el CLI: `--set` con `diasPago:["15"]` responde `{"ok":true,"written":["sueldo"]}`, y a partir de ahí `next_payday` queda en `null` **y `safe_to_spend_hoy` se cae a 0** — mientras `--status` sigue informando `profile: done:true`. La advertencia está escrita en el documento equivocado, sobre la superficie equivocada, y ninguna doc avisa que el checklist puede decir "perfil configurado" con el calendario de pagos roto. |
| **Estado** | ❌ **INCONSISTENTE** |
| **Evidencia** | Probe MCP: `set_profile {sueldo:{...diasPago:["15"]}}` → `-32602`. CLI: `--set '{"sueldo":{...,"diasPago":["15"]}}'` → `ok:true`; después `get_balance` → `"next_payday": null, "safe_to_spend_hoy": 0`; `--status` → `('profile', True)`. |

### 7. `set_rule` / `--rule`

| | |
|---|---|
| **Qué dice la doc** | `--rule <patrón>=<categoría>`; las categorías válidas son diez y están listadas; el patrón se guarda normalizado y matchea por substring; las reglas más largas ganan. (onboarding.md, 5b) |
| **Qué hace la realidad** | `--rule "veterinaria=mascota"` → `{"ok":true,"pattern":"veterinaria","category":"mascota"}`. Una categoría inventada se rechaza y **la lista del error coincide palabra por palabra con la de la doc**: `comida, transporte, salud, mascota, servicios, recarga, efectivo, transferencia_persona, suscripcion, otros`. La tool MCP `set_rule` valida el mismo enum. **Caveat honesto:** con el ledger vacío no se observó el matcheo por substring ni el desempate por longitud; eso queda en `rules-repository.test.ts`. |
| **Estado** | ✅ **VERIFICADO** |
| **Evidencia** | CLI y probe MCP, salidas citadas. |

### 8. `apply_rules` / `--backfill` / `--reclassify` / `--learn-rules`

| | |
|---|---|
| **Qué dice la doc** | `--backfill` → `{"ok":true,"updated":N}`; `--reclassify` → `{"ok":true,"markedInternal":N,"recategorized":N}`; `--learn-rules` → `{"ok":true,"learned":N,"skippedAmbiguous":N,"skippedExisting":N}`; correrlos dos veces es inofensivo. Y: *"Por MCP los dos viven en la misma tool: `apply_rules {}` es el `--backfill`, y `apply_rules {"reclassify": true}` corre los dos, en ese orden."* (onboarding.md 5b; mcp.md) |
| **Qué hace la realidad** | Las cuatro salidas tienen exactamente las claves documentadas, y el mapeo MCP es el que dice la doc: `apply_rules {}` devuelve `{ok, updated}` y `apply_rules {reclassify:true}` devuelve `{ok, updated, markedInternal, recategorized}` — los dos, en ese orden. Idempotente al repetir. **Caveat honesto:** el ledger está vacío, así que todos los contadores dieron 0; **la tabla que compara `--backfill` contra `--reclassify` (qué filas toca cada uno, cuál marca internas) no se comprobó sobre filas reales.** |
| **Estado** | ✅ **VERIFICADO** (contrato y mapeo CLI↔MCP; ver caveat) |
| **Evidencia** | CLI: `--learn-rules` → `{learned:0,skippedAmbiguous:0,skippedExisting:0}`; `--backfill` → `{updated:0}`; `--reclassify` → `{markedInternal:0,recategorized:0}`. Probe MCP: `apply_rules {reclassify:true}` → las cuatro claves. |

### 9. `npm run dev` → `http://localhost:3000`

| | |
|---|---|
| **Qué dice la doc** | onboarding-para-humanos.md: *"Cuando el proceso termina… `npm run dev` … y abrís **http://localhost:3000** en tu navegador: vas a ver tu dashboard"*. onboarding.md §Terminado: `npm run onboard` → `npm run dev` → `http://localhost:3000`. README:86: *"`npm run dev` — API + web en http://localhost:3000"*. El propio `--status` dice *"Levanta el server (`npm run dev`) y pulsa 'Sincronizar'"*. Sólo el Paso 4 de onboarding.md menciona `npm run build # la primera vez`. |
| **Qué hace la realidad** | **En una instalación de primera vez, `localhost:3000` no muestra el dashboard: tira un 404 con un stack de Node.** El server sirve la SPA desde `web/dist` (`index.ts:93-98`), `web/dist` es artefacto de build y **`dist/` está en `.gitignore`**, así que un clon fresco no lo tiene y `npm install` no lo genera. Comprobado moviendo `web/dist` fuera del árbol: `GET /` → `HTTP 404` con `Error: ENOENT: no such file or directory, stat '.../web/dist/index.html'` — mientras `/api/overview` responde 200. Con `web/dist` presente, `GET /` → 200 con el `<title>Agentic Wallet</title>` esperado. Segundo desajuste: `npm run dev` en la raíz levanta **también** Vite (con proxy `/api` → 3000), un segundo puerto que ninguna doc menciona. |
| **Estado** | ❌ **INCONSISTENTE** |
| **Evidencia** | `mv web/dist /tmp/…` + server efímero en 3999: `curl localhost:3999/` → 404 + ENOENT; `curl localhost:3999/api/overview` → 200. Con `web/dist`: `curl localhost:3999/` → 200, `<title>Agentic Wallet</title>`. `git clone` fresco: `ls web/dist` → *No such file or directory*. `web/vite.config.ts` (proxy). |

### 10. El chat

| | |
|---|---|
| **Qué dice la doc** | onboarding-para-humanos.md: *"un chat donde le podés preguntar cosas de tu historial"*, con ejemplos del tipo *"¿cuánto gasté en comida este mes?"* / *"¿me alcanza para comprar X?"*. |
| **Qué hace la realidad** | **La degradación sin credencial sí se probó y es correcta**: `POST /api/chat` → `HTTP 503 {"error":"claude_not_configured"}`, sin romper nada. **La conversación en sí no se probó**: hace falta una credencial de Claude y un ledger con datos, y esta instalación no tiene ninguna de las dos. Que el chat conteste bien esas preguntas sobre un historial real es, hoy, una suposición. |
| **Estado** | ⚠️ **ASUMIDO** |
| **Evidencia** | `curl -X POST -d '{"message":"hola"}' localhost:3999/api/chat` → 503 `claude_not_configured`. |

---

## Score

| Estado | Cantidad |
|---|---|
| ✅ VERIFICADO | **4** (ítems 1, 5, 7, 8) |
| ⚠️ ASUMIDO | **4** (ítems 2, 3, 4, 10) |
| ❌ INCONSISTENTE | **2** (ítems 6, 9) |
| **Confiabilidad** | **4 / 10** |

---

## Hallazgos secundarios

No entran en el score de 10 de arriba (son chequeos que hice de paso, no ítems
del onboarding). Se listan igual porque cada ❌ es un fix de doc concreto, y
cada ✅ es una afirmación de la doc que **sí** quedó probada.

| # | Afirmación de la doc | Realidad | Estado |
|---|---|---|---|
| S1 | mcp.md lista **12** tools en su tabla | El server expone **13**: falta `heal_counterparties`, que existe, está registrada y devuelve el error de credenciales correcto | ❌ |
| S2 | onboarding.md tabula los campos de `--set`: `colchonObjetivo`, `topeTransferenciasMensual`, `moneda`, `balanceSnapshot` (+ `titular`/`sueldo`) | `parseSetPatch` acepta además **`zonaHoraria`**, que no está documentado en ningún lado | ❌ |
| S3 | conectar-gmail.md: *"Scope único: `gmail.readonly`"* | Por defecto sí, pero `npm run gmail-auth -- --drive` agrega `drive.file`. La bandera existe y no está documentada; el "único" es falso como absoluto | ❌ |
| S4 | onboarding.md: *"Todo sale por stdout, siempre como JSON. También los errores"* | Los errores de subcomando sí (`{"ok":false,...}` en stdout, exit 1 — probado). Pero la rama de **comando desconocido** imprime texto plano de uso, no JSON; y npm antepone su banner (`> tsx src/onboard/cli.ts …`) en stdout antes del JSON | ❌ |
| S5 | onboarding.md: *"cuando el exit code es 1, npm agrega su propio bloque `npm error …` después del JSON"*, en un párrafo sobre stdout | El bloque `npm error` va a **stderr**, no a stdout. La advertencia es más alarmista que la realidad: stdout queda limpio salvo por el banner de S4 | ❌ |
| S6 | conectar-gmail.md: *"Google redirige a `localhost`"* | Redirige a `http://127.0.0.1:<puerto efímero>/oauth2callback` (loopback con `listen(0)`) | ❌ |
| S7 | onboarding.md: las 10 categorías válidas | El error de `--rule` las lista idénticas, en el mismo orden | ✅ |
| S8 | onboarding.md: `--heal-counterparties` sin Gmail responde `{"ok": false, "error": "gmail_not_configured"}` y no toca nada | Literal, incluido el `next` que manda a `gmail-auth` | ✅ |
| S9 | onboarding.md: `--learn-rules` → `{"ok":true,"learned":N,"skippedAmbiguous":N,"skippedExisting":N}` | Exactas esas claves | ✅ |
| S10 | mcp.md: `stdout` es JSON-RPC puro, los logs van a `stderr` | Probado con un cliente stdio real: cero líneas no-JSON en stdout; el `agentic-wallet MCP server escuchando en stdio` sale por stderr | ✅ |
| S11 | mcp.md: el bundle es un artefacto versionado que `npm run build` regenera | `npm run build` deja el `.cjs` **byte-idéntico** (mismo md5 antes y después) y `git status` limpio. Un clon fresco lo trae | ✅ |
| S12 | onboarding.md: el sync se drena de a **50 correos o 45 segundos** | `DEFAULT_SYNC_BATCH_SIZE = 50`, `DEFAULT_SYNC_MAX_MS = 45_000` | ✅ |
| S13 | onboarding.md: `--status` es la fuente de verdad, reanudable e idempotente | El JSON trae `steps[]`/`complete`/`next`; los seis pasos (`env`, `claude`, `gmail`, `sync`, `huso`, `profile`) flipean a `done` cuando corresponde. `WALLET_UTC_OFFSET_HOURS=-3` cierra `huso`; `titular` + `diasPago` cierran `profile` | ✅ |
| S14 | Todos los links internos entre docs resuelven | Ninguno roto en `docs/*.md` ni en `README.md` | ✅ |
| S15 | El motor está verde | `npm test` → **65 archivos, 655 tests, 655 passed**. `npm run build` → sin errores | ✅ |

**Score ampliado** (los 10 ítems + los 15 secundarios): 13 VERIFICADOS
(4 + 9), 4 ASUMIDOS, 8 INCONSISTENTES (2 + 6) → **13/25 = 5.2/10**.

---

## Qué falta para llegar a 9/10

Los seis ítems que hoy no son VERIFICADO, ordenados por lo que cuesta arreglarlos.

### Se arreglan editando docs (ítems 6 y 9 — los dos ❌)

**Ítem 9 — `npm run dev` → 404.** Es el peor de los dos: es lo último que hace
el usuario en el onboarding, y falla con un stack de Node. Para subirlo a ✅:

1. Agregar `npm run build` **antes** de `npm run dev` en los tres lugares que
   hoy lo omiten: onboarding.md §Terminado, onboarding-para-humanos.md
   §"Después de configurarlo", y README:86.
2. Cambiar el `action` del paso `sync` en `server/src/onboard/status.ts:105`,
   que también manda a `npm run dev` a secas.
3. Alternativa más robusta que documentar el orden: que el server, si no
   encuentra `web/dist/index.html`, responda "corré `npm run build`" en vez de
   un ENOENT. (Esto sí toca código del motor — queda como propuesta, no se hizo
   en esta tarea.)
4. Mencionar que `npm run dev` levanta también Vite en otro puerto.

**Ítem 6 — la advertencia del `"15"` pelado.** Para subirlo a ✅: mover la
advertencia de mcp.md a onboarding.md (que es donde vive `--set`, la superficie
que realmente acepta el valor malo), corregir que por MCP el valor se **rechaza**
con `-32602`, y avisar que `--status` puede decir `profile: done` con el
calendario de pagos en null. Verificación: repetir la prueba por las dos
superficies y confirmar que el texto describe lo que pasa en cada una.

Con esos dos: **6/10**.

### Necesitan credenciales reales (ítems 2, 4, 10)

Los tres son el mismo bloqueo — nadie corrió el onboarding con una cuenta de
verdad desde que se escribió la doc:

- **Ítem 2 (`claude setup-token`)**: correrlo con una suscripción Pro/Max,
  pegar el token, y confirmar que un `sync` o un chat **funcionan** con él —
  no sólo que `--status` se pone en verde. Y resolver la afirmación de
  precedencia: o se comprueba contra el SDK, o se saca de la doc.
- **Ítem 4 (`sync`)**: un buzón con historial real, drenar hasta
  `complete: true`, y confirmar en el camino que el `progress` avanza, que el
  checkpoint sobrevive a cortar el proceso, y que volver a llamar no reprocesa.
- **Ítem 10 (el chat)**: con credencial y ledger poblado, hacerle las dos
  preguntas que la doc promete y ver si contesta con números del ledger.

Con estos tres: **9/10**. Es la meta, y sale de una sola sesión de instalación
real de punta a punta.

### Sólo se verifica con una cuenta de Google (ítem 3)

**Ítem 3 (los 8 pasos de la consola).** Es el único que no se puede
automatizar: hay que abrir Google Cloud Console y confirmar que cada nombre de
pantalla y cada botón siguen llamándose así. Lo razonable es capturar la fecha
de la última vez que alguien lo caminó, y tratar esas 8 filas como
**ASUMIDO con fecha de vencimiento** — la consola de Google cambia de layout
sin avisar. Con este: **10/10**.

---

## Cómo reproducir esta auditoría

Nada de acá escribe sobre la base ni el `.env` del usuario: las escrituras van
a una base temporal.

```bash
# Estado de partida
npm run onboard -- --status
npm run onboard -- --init-env       # idempotente
npm run onboard -- --suggest        # solo lectura

# Subcomandos que escriben -> base temporal
export DB=/tmp/rel-audit.sqlite
WALLET_DB_PATH=$DB npm run onboard -- --set '{"titular":"NOMBRE FICTICIO"}'
WALLET_DB_PATH=$DB npm run onboard -- --set '{"campoQueNoExiste":1}'   # debe fallar listando los validos
WALLET_DB_PATH=$DB npm run onboard -- --rule "veterinaria=mascota"
WALLET_DB_PATH=$DB npm run onboard -- --rule "x=categoria_inventada"   # debe fallar listando las 10
WALLET_DB_PATH=$DB npm run onboard -- --learn-rules
WALLET_DB_PATH=$DB npm run onboard -- --backfill
WALLET_DB_PATH=$DB npm run onboard -- --reclassify
WALLET_DB_PATH=$DB npm run onboard -- --heal-counterparties            # gmail_not_configured

# Los pasos que dependen del entorno
CLAUDE_CODE_OAUTH_TOKEN=x npm run onboard -- --status   # paso `claude` -> done
WALLET_UTC_OFFSET_HOURS=-3 npm run onboard -- --status  # paso `huso`   -> done

# Capa MCP: cliente stdio contra el bundle versionado
CLAUDE_PROJECT_DIR=$PWD WALLET_DB_PATH=$DB node server/dist-mcp/mcp-server.cjs
#   -> initialize, tools/list (deben salir 13), tools/call

# Estado de una instalacion de primera vez
git clone . /tmp/fresh-clone-audit && ls /tmp/fresh-clone-audit/web/dist   # debe NO existir

# El motor
npm run build && npm test
```

---

## Mantenimiento

Este ledger **caduca**. Cada vez que cambie el onboarding, un comando del CLI,
una tool MCP o un doc de instalación, el ítem correspondiente vuelve a
⚠️ ASUMIDO hasta que alguien lo vuelva a correr. Un VERIFICADO viejo es un
ASUMIDO disfrazado, que es justo lo que este documento existe para evitar.
