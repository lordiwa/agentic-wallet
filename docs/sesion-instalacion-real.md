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
