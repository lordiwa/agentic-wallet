# Investigación: qué del wallet depende de un agente y qué se puede reducir a scripts

> **Estado: investigación, no implementación.** Nada de este documento cambia
> código. Todas las afirmaciones sobre el motor están ancladas a `archivo:línea`
> del commit en el que se escribió. Las que no pude verificar están marcadas
> como tales.

## Respuesta corta

**El wallet ya es casi todo scripts.** De los 15 procesos que tiene, **11 son
100 % deterministas hoy** (cero IA, ni siquiera una llamada). Sólo **dos** tocan
un LLM: el cross-check de monto en el sync (una llamada por correo de
transacción) y el chat. Y sólo **uno** necesita hoy un agente de verdad para
existir: el chat.

La visión de Mato — *"la persona habla con un chat, el chat sabe qué scripts
correr, los agentes no entran a ver el email"* — **es realista, y está a mitad de
camino de estar construida sin que nadie lo haya notado.** El chat existe
(`/api/chat`). Las herramientas-que-son-scripts existen (`server/src/mcp/`, 13
tools). El problema es que **las dos mitades no se tocan**: el chat de la app
tiene su propio juego de 5 tools de sólo-lectura
(`server/src/chat/engine-tools.ts`) y no puede sincronizar, ni configurar el
perfil, ni agregar una regla. Las tools que sí pueden hacer eso viven en el
servidor MCP, que hoy sólo consume un agente externo por stdio.

Los tres límites que **no** se van a mover nunca:

1. **El OAuth de Gmail necesita un humano en la consola de Google.** No hay
   script posible.
2. **Resolver una fila `needs_review` necesita criterio humano** — y hoy ni
   siquiera hay un mecanismo para resolverlas (ver el hallazgo del §1.15: la
   bandera se prende y no se apaga nunca, en ningún camino del código).
3. **El chat es el LLM.** Es la interfaz, no un accesorio de ella.

---

## Método

Lectura directa del código, no de la documentación. Los archivos que sostienen
las conclusiones de abajo:

`ingest/pipeline.ts`, `ingest/reconstruct.ts`, `ingest/claude-email-extractor.ts`,
`ingest/amount-validate.ts`, `ingest/mask.ts`, `ingest/heal-counterparty.ts`,
`parser/produbanco.ts`, `category/categorize.ts`, `chat/chat-service.ts`,
`chat/engine-tools.ts`, `mcp/server.ts`, `onboard/cli.ts`, `onboard/suggest.ts`,
`sync/run-sync.ts`, `sync/build-sync-runner.ts`, `api/routes.ts`,
`api/mutations.ts`, `db/repository.ts`, `brief/scheduler.ts`,
`scripts/gmail-auth.ts`, `scripts/reconstruct.ts`.

Los precios de tokens salen de la
[página oficial de pricing de Anthropic](https://platform.claude.com/docs/en/about-claude/pricing),
consultada el 2026-08-29, no de memoria.

---

## 1. Inventario de procesos

Clasificación:

| | Significa |
|---|---|
| **(a) script** | Determinista puro. Cero IA. Misma entrada → misma salida. |
| **(b) LLM puntual** | Una llamada acotada, con salida estructurada. No razona ni decide pasos. |
| **(c) agente** | Necesita decidir/razonar/encadenar pasos. |
| **(d) humano** | Ningún software lo puede hacer solo. |

| # | Proceso | Dónde vive | Hoy depende de | Clase |
|---|---|---|---|---|
| 1 | `--init-env` (crear `.env`) | `onboard/cli.ts:90` | `copyFileSync`. Nada más. | **(a)** |
| 2 | Credencial de Claude | `claude setup-token` → `.env` | Login interactivo del humano | **(d)** |
| 3 | OAuth de Gmail | `scripts/gmail-auth.ts` | Consola de Google (humano) + servidor loopback (script) | **(d)** + (a) |
| 4 | Huso horario | `.env` `WALLET_UTC_OFFSET_HOURS` | Decisión del humano; escritura es script | **(d)** + (a) |
| 5 | Búsqueda + lectura de Gmail | `pipeline.ts:251`, `googleapis-gmail-client.ts` | `googleapis`, query armada con regex | **(a)** |
| 6 | Parseo del correo → monto | `parser/produbanco.ts` | Regex ancladas. **Única fuente de verdad del monto.** | **(a)** |
| 7 | **Cross-check del monto** | `pipeline.ts:335-347` + `claude-email-extractor.ts` | **1 llamada al Agent SDK por correo de transacción** | **(b)** |
| 8 | Reversos / duplicados / internas | `rules/reconcile.ts` | Comparación de montos y fechas | **(a)** |
| 9 | Categorización | `category/categorize.ts:155` | `switch` sobre `type` + substring sobre reglas del usuario | **(a)** |
| 10 | Estado de cuenta | `statement/parse-statement.ts` | Regex ancladas a etiquetas | **(a)** |
| 11 | Persistencia idempotente | `db/repository.ts:95` | `INSERT ... ON CONFLICT DO NOTHING` | **(a)** |
| 12 | Propuesta de perfil (`--suggest`) | `onboard/suggest.ts` | SQL: mediana, moda, conteos | **(a)** |
| 13 | Escrituras de config (`--set`, `--rule`, `--backfill`, `--reclassify`, `--learn-rules`) | `onboard/cli.ts:210-295` | SQL directo, idempotente | **(a)** |
| 14 | `--heal-counterparties` | `ingest/heal-counterparty.ts` | Relee Gmail + reparseo. **Sin Claude.** | **(a)** |
| 15 | **Resolver `needs_review`** | *no existe* | — ver abajo — | **(d)**, hoy imposible |
| 16 | Brief diario | `brief/build-brief.ts` + `scheduler.ts` | `setTimeout` a las 08:00 local + SQL | **(a)** |
| 17 | Dashboard + API HTTP | `api/routes.ts`, `web/src/` | Express + React. Cero IA. | **(a)** |
| 18 | Reconstrucción del ledger | `ingest/reconstruct.ts` | **Pipeline completo SIN Claude ni OAuth propio** | **(a)** |
| 19 | Chat de preguntas | `chat/chat-service.ts` | Agent SDK multi-turno + 5 tools | **(c)** |
| 20 | Servidor MCP | `mcp/server.ts` | Las 13 tools son (a); **quién las llama es (c)** | (a) + **(c)** |

**Conteo: 13 puramente script, 1 con LLM puntual, 2 que hoy requieren agente, 4
que requieren humano.**

### 1.15 — El hallazgo que hay que mirar antes que ninguna otra cosa

**`needs_review` se prende y no se apaga nunca.** No hay ningún camino en el
código que la baje a 0:

- `updateTransactionReviewFlags` (`db/repository.ts:151`) *podría* hacerlo, pero
  sus dos únicos llamadores (`pipeline.ts:384`, `reconstruct.ts:226`) sólo la
  suben, y explícitamente "never downgrading a flag that's already true".
- `GET /api/review` (`api/routes.ts:140`) es lectura.
- `get_review_queue` del MCP (`mcp/server.ts:213`) es lectura.
- `ReviewTray.tsx` en el dashboard es lectura.
- `reclassifyTransactions` toca `category` e `is_internal`, nunca `needs_review`
  (`category/reclassify.ts:40` lo documenta como decisión).

Y una fila con `needs_review = 1` queda excluida de **todos** los totales para
siempre (`strategy/totals.ts:13`: `EXCLUDE_FROM_TOTALS_SQL`).

Consecuencia para esta investigación: **cada falso positivo del cross-check de
Claude borra una transacción real del ledger, de forma permanente.** Eso cambia
por completo el cálculo costo/beneficio del §4.

---

## 2. Costo

### 2.1 Primero, la pregunta que decide todo

`build-sync-runner.ts:69` acepta **cualquiera** de dos credenciales:

```ts
if (!config.ANTHROPIC_API_KEY && !config.CLAUDE_CODE_OAUTH_TOKEN) return null;
```

- Con **`ANTHROPIC_API_KEY`**: cada llamada se factura por token. Los números de
  abajo aplican.
- Con **`CLAUDE_CODE_OAUTH_TOKEN`** (suscripción Pro/Max): **no hay factura en
  USD.** El costo es cuota de la suscripción. "Minimizar el costo de agentes"
  significa algo completamente distinto: no ahorrás dinero, ahorrás cupo.

Vale la pena que Mato decida cuál de las dos cosas está optimizando antes de
tocar nada.

### 2.2 Nadie midió el costo real, y el código tira la medición a la basura

`claude-email-extractor.ts:69-75` lee el mensaje `result` del SDK y sólo usa
`structured_output`. El mismo mensaje trae `total_cost_usd`, `usage` y
`modelUsage` (`sdk.d.ts:4238-4240`) — **se descartan**. La telemetría del repo
(`ingest/telemetry.ts`) no registra tokens ni costo.

Así que todo lo que sigue es una estimación, no una medición.

### 2.3 Dos cosas que multiplican el costo por 10-30x, y son gratis de arreglar

Comparen las dos llamadas al Agent SDK del repo:

```ts
// chat-service.ts:232-248 — el chat, cuidadosamente acotado
options: { systemPrompt: CHAT_SYSTEM_PROMPT, tools: [], strictMcpConfig: true, ... }

// claude-email-extractor.ts:55-61 — la extracción, sin acotar
options: { maxTurns: 1, outputFormat: { type: "json_schema", schema: OUTPUT_JSON_SCHEMA } }
```

El extractor **no pasa `systemPrompt`, no pasa `tools`, y no pasa `model`.** El
propio repo documenta en `chat-service.ts:79-86` por qué eso importa: *"Without
`tools: []`, the chat model would retain the full built-in toolbelt"*. Si esa
lectura es correcta —y es la del equipo que escribió el código— cada extracción
de un correo de 3 líneas está pagando el system prompt de Claude Code más las
definiciones de todo el toolbelt.

Y sin `model`, corre en el modelo por defecto del CLI, que es de la familia Opus
($5/$25 por MTok) — no en Haiku 4.5 ($1/$5), que es lo que una tarea de
"copiá este substring" pide a gritos.

> **Esto no está verificado con una medición.** Es lectura del código y de los
> tipos del SDK. Medirlo es la Fase 0 del §7 y cuesta una tarde.

### 2.4 Los números

Supuestos declarados: un correo de notificación bancaria rinde ~1.500 caracteres
de texto ≈ 400 tokens; prompt fijo + JSON Schema ≈ 270 tokens; salida ≈ 50
tokens. Total del **contenido**: ~700 tokens in / 50 out.

**Costo por correo de transacción:**

| Escenario | in | out | Haiku 4.5 | Sonnet 5 | Opus 5 |
|---|---|---|---|---|---|
| Sólo el contenido (si se acota) | 700 | 50 | **$0,001** | $0,002 | $0,005 |
| Con preset + toolbelt (~12k in) | 12.000 | 50 | $0,012 | $0,024 | **$0,060** |

La celda de arriba a la izquierda y la de abajo a la derecha se llevan **60x**.
Es el mismo trabajo.

**Primer sync.** El propio MCP usa "1717" como ejemplo de backlog
(`mcp/server.ts:310`). Claude **sólo** se llama en la rama `transaction`
(`pipeline.ts:333-338`) — no en `ignored`, ni `reverso`, ni `statement`. Si ~60 %
son transacciones, son ~1.000 llamadas:

| | Haiku acotado | Opus sin acotar |
|---|---|---|
| Primer sync (~1.000 correos) | **~$1** | **~$60** |
| Mes corriente (~150 correos) | ~$0,15 | ~$9 |

**Chat.** Por consulta: prompt del sistema + esquemas de 5 tools + transcript +
resultados de tools (`query_transactions` puede devolver 100 filas de JSON) +
respuesta, sobre 2-3 turnos internos. Estimación 10-20k in / ~1k out:

- Sonnet 5: **~$0,03-0,05 por consulta**
- Opus 5: **~$0,08-0,12 por consulta**

Con un detalle: `chat-service.ts:175-181` **reconstruye el transcript completo
como texto plano en cada turno**. Una conversación de N turnos paga O(N²) tokens
de entrada. En una charla larga sobre finanzas eso se nota.

---

## 3. La visión de Mato: "un chat que sabe qué scripts correr"

### 3.1 El diagnóstico: está a mitad de construir, y las dos mitades no se tocan

Hay **dos superficies de herramientas distintas** sobre el mismo motor, y ya
divergieron:

| | `chat/engine-tools.ts` (el chat de la app) | `mcp/server.ts` (agente externo) |
|---|---|---|
| Tools | 5 | 13 |
| Escribe | **no, ninguna** | sí |
| Puede sincronizar | **no** | sí (`sync`) |
| Puede configurar perfil | **no** | sí (`set_profile`, `set_rule`, `apply_rules`) |
| Sólo ahí | `check_affordability`, `get_daily_brief` | `sync`, `get_review_queue`, `onboarding_status`, `suggest_profile`, `heal_counterparties`, `get_colchon_status` |

O sea: **el chat con el que habla la persona no puede ejecutar ninguno de los
scripts.** Puede consultar el ledger y nada más. Las tools que sí ejecutan cosas
existen, están testeadas, y hoy sólo las alcanza un agente externo por stdio.

**Cerrar esa brecha es el cambio de mayor palanca del proyecto entero, y es
chico.** No hace falta escribir lógica nueva: hace falta que el chat vea las
tools que ya existen.

### 3.2 Proceso por proceso: ¿puede el chat reemplazar al agente acá?

| Proceso | ¿El chat puede? | Cómo / por qué no |
|---|---|---|
| `--init-env` | **Sí** | Tool nueva de 3 líneas sobre `initEnv()` |
| Credencial de Claude | **No** | Círculo vicioso: el chat necesita esa credencial para existir |
| OAuth de Gmail | **No** | Ver §6 |
| Huso horario | **A medias** | El chat puede preguntar y escribir; la elección es del humano |
| Primer sync | **Sí, ya está resuelto** | `sync` es reentrante por lotes con `progress` (`run-sync.ts:135`). El chat llama, ve `complete:false`, vuelve a llamar. Es exactamente el patrón que Mato describe. |
| Sync diario | **Sí** | Idem, o `setTimeout` sin chat (ver §7 Fase 2) |
| Propuesta de perfil | **Sí** | `suggest_profile` lee el ledger determinísticamente; el chat lo muestra en castellano y pregunta |
| Guardar el perfil | **Sí, con confirmación** | `set_profile`. Regla de `CLAUDE.md`: nunca escribir un valor no confirmado |
| Reglas de categoría | **Sí** | `set_rule` + `apply_rules`. Es *el* caso donde el chat brilla: "los gastos en la veterinaria son de la mascota" → `set_rule('veterinaria','mascota')` + `apply_rules` |
| Recuperar comercios | **Sí** | `heal_counterparties`, no usa LLM por dentro |
| Resolver `needs_review` | **No** (dos veces) | No existe el mecanismo, y aun existiendo hace falta criterio humano |
| Preguntas sobre el historial | **Es el chat** | Irreducible |
| Brief diario | **No hace falta** | Ya es un `setTimeout` |

### 3.3 Una advertencia honesta antes de darle escritura al chat

Hoy las 5 tools del chat son de sólo-lectura y eso es deliberado
(`engine-tools.ts:21`: *"READ-ONLY: no handler in this file writes"*). En cuanto
el chat pueda escribir, aparece un camino nuevo:

**texto de un correo bancario → `counterparty` en la base → resultado de una
tool → contexto del chat → tool de escritura.**

Un `counterparty` viene de un correo que un tercero puede influenciar. Hoy el
peor caso es una respuesta equivocada. Con `set_profile` disponible, el peor caso
es un `colchonObjetivo` corrompido.

No es un bloqueante — es una razón para que las tools de escritura pidan
confirmación explícita en el turno, que es además lo que ya exige `CLAUDE.md`
("nunca escribir un valor que el usuario no confirmó"). Pero conviene decidirlo a
propósito y no de rebote.

---

## 4. El caso `claude_extract`: ¿se puede eliminar?

### 4.1 Qué hace exactamente

1. `parseEmail` deriva el monto con regex ancladas (`parser/produbanco.ts`).
2. Se enmascara el correo (`mask.ts`) y se manda a Claude, que devuelve
   `amount_text_raw`: el **substring textual** del monto, nunca un número
   calculado.
3. `validateAmount` re-deriva un número de ese substring **con la misma regex
   que usó el parser** (`amount-validate.ts:15-16` es copia literal de
   `produbanco.ts:20-21`).
4. Si no coinciden → `needs_review = true`, `review_reason:
   'claude_amount_mismatch'`.

**Claude nunca aporta un monto.** El desacuerdo se resuelve siempre como "que
mire un humano", nunca como "gana Claude". Eso importa: **sacarlo no puede hacer
que ningún monto quede mal.** Sólo puede sacar una bandera.

### 4.2 Cinco razones por las que el check vale menos de lo que parece

**(1) Claude lee lo mismo que el parser.** No hay una segunda fuente. Es la misma
evidencia procesada dos veces.

**(2) En 5 de las 8 ramas el monto sale del *asunto*.** "Consumo tarjeta de
débito por USD 9.42" tiene exactamente un monto. Que Claude coincida es casi
automático: cero información.

**(3) Donde sí podría diferir, el parser está mejor posicionado.** Las 3 ramas
que leen del cuerpo (retiro, sueldo, transferencia recibida) usan extracción
**anclada a la etiqueta** — y el comentario de `produbanco.ts:50-56` explica por
qué: los cuerpos traen saldo y comisión antes del monto que importa. Claude lee
el cuerpo entero sin ancla. Si difieren, lo más probable es que **Claude haya
agarrado la cifra equivocada, no el parser.**

**(4) Un falso positivo es permanente.** Ver §1.15. No es "que un humano lo
mire": es que la transacción desaparece de todos los totales y no hay forma de
traerla de vuelta salvo editando SQLite a mano.

**(5) El enmascarado puede fabricar desacuerdos.** `mask.ts:12` reemplaza toda
corrida de 6+ dígitos. `"USD 123456.78"` → `"USD XX3456.78"`. El parser vio
123456.78, Claude ve otra cosa → mismatch garantizado. Poco probable en una
billetera personal, pero es un bug que **sólo existe porque existe el camino de
Claude**.

### 4.3 Lo que sí se pierde

Uno solo, y es real: **la plantilla del banco cambia y la regex del parser
empieza a matchear la cifra equivocada de forma silenciosa y plausible.** Hoy eso
saldría como mismatch. Sin el cross-check, entra callado al ledger.

No es hipotético: los bancos cambian sus correos. Es la única cosa que el check
compra.

### 4.4 Ya existe la prueba de que se puede vivir sin él

**`ingest/reconstruct.ts` es el pipeline completo sin Claude**, y su doc lo
argumenta mejor de lo que yo podría (líneas 11-20): *"the deterministic parser is
the SOLE source of truth for every amount — this is what keeps the 'never invent
amounts' guarantee intact even without the extractor"*. Mismo `parseEmail`, mismo
`reconcile`, misma `categorize`, mismo persist idempotente, mismo `IngestSummary`.
La diferencia son 15 líneas.

Y `heal-counterparty.ts:33-39` ya usa la alternativa determinista al mismo
problema: reparsea el correo y **exige que rinda el mismo monto** antes de
escribir. Auto-consistencia, costo cero.

### 4.5 Recomendación

**Sí, sacalo del sync por defecto — pero reemplazalo, no lo borres.** En este
orden:

1. **Medí primero.** Contá `SELECT COUNT(*) FROM transactions WHERE review_reason
   = 'claude_amount_mismatch'` en el ledger real. Ese número decide todo:
   - **0 después de miles de correos** → el check nunca se ganó el sueldo. Sacalo
     sin culpa.
   - **alto** → casi seguro son falsos positivos de las ramas ancladas (§4.2.3),
     y encima significa que hay transacciones reales borradas de los totales
     ahora mismo.

   Ese número no lo tiene nadie y es una consulta SQL.

2. **Poné el default en el camino determinista.** El código ya existe
   (`reconstruct.ts`); es unificarlo con `pipeline.ts` detrás de un flag.

3. **Reemplazá la garantía con un guarda determinista.** Lo que el check compra es
   "la plantilla cambió". Eso se detecta sin LLM: si en la región de la que el
   parser leyó hay **más de un substring con forma de monto**, el match es
   ambiguo → `needs_review`. Detecta la deriva de plantilla exactamente igual, y
   además detecta el caso que Claude *no* detecta (parser y Claude agarrando los
   dos la misma cifra equivocada).

4. **Dejá el LLM como canario, no como guardia.** Correrlo sobre el 1 % de los
   correos, o sólo sobre asuntos cuya forma no está en el catálogo conocido. El
   costo cae ~100x y la deriva de plantilla igual aparece.

5. **Y arreglá el callejón sin salida de `needs_review`** — con o sin Claude, hoy
   la bandera es una tumba.

**Si Mato quiere una sola cosa hoy y no tocar arquitectura:** ponerle `model:
'claude-haiku-4-5-20251001'`, `systemPrompt` mínimo y `tools: []` al extractor.
Es un cambio de 4 líneas, no toca ninguna garantía, y por lo estimado en §2.4 se
lleva la mayor parte del costo por delante.

---

## 5. El rol del MCP

**Sí, el MCP es la capa correcta. Conceptualmente ya es exactamente lo que Mato
describe.** `mcp/server.ts:5-10` lo dice: cero lógica financiera, cada tool valida
con zod, llama a una función que ya existe y ya está testeada, y serializa. Es un
catálogo de scripts con nombre y esquema.

Pero hoy no sirve como capa única, por dos razones concretas:

**(1) Es stdio JSON-RPC, arrancado por cliente vía `.mcp.json`.** El dashboard
web no le puede hablar. Por eso existe `chat/engine-tools.ts`: un *segundo*
servidor MCP, in-process, con `createSdkMcpServer`.

**(2) Las dos superficies ya divergieron** (tabla del §3.1). Nada las mantiene en
sincronía — ni un test, ni un tipo compartido.

**Recomendación: un solo registro, dos transportes.** Que las definiciones de
tools vivan en un lugar; `mcp/server.ts` las expone por stdio para agentes
externos y `chat/engine-tools.ts` expone un **subconjunto por nombre** en
proceso para el chat. Un test que afirme que el subconjunto está contenido en el
registro y que ninguna tool existe sólo de un lado.

**El chat NO necesita un endpoint propio que llame a las funciones directo.** Eso
sería una tercera superficie y una tercera oportunidad de divergir. `/api/chat`
ya existe; lo que le falta no es plomería HTTP, son **tools**.

---

## 6. Los límites infranqueables

### 6.1 OAuth de Gmail — humano + navegador + consola de Google

`scripts/gmail-auth.ts` automatiza lo que se puede automatizar: arma la consent
URL con PKCE (`buildConsentUrl`, línea 45), levanta un loopback, captura el
código, canjea el refresh token. Pero **antes** de que ese script sirva, alguien
tiene que, a mano, en un navegador:

1. Crear un proyecto en Google Cloud Console.
2. Habilitar la Gmail API.
3. Crear un cliente OAuth2 tipo "Desktop app".
4. Copiar client id/secret al `.env`.
5. Y después, aceptar la pantalla de consentimiento.

Ninguno de esos cinco pasos tiene API pública sin credenciales previas. Es un
huevo-y-gallina estructural, no una falta de esfuerzo. **El chat puede guiar paso
a paso. No puede hacer clic.**

### 6.2 Credencial de Claude — círculo vicioso

`claude setup-token` requiere login interactivo con suscripción. Y el chat que
haría el trabajo necesita esa credencial para existir. No hay salida.

### 6.3 Criterio humano sobre `needs_review`

Una fila llega ahí porque el monto **no se pudo determinar**. Resolverla es leer
el correo original y decidir. Un LLM podría *proponer*, pero la regla de oro del
proyecto (`CLAUDE.md` §1) es justamente que el monto no sale de Claude. Aceptar
que Claude resuelva la cola de revisión sería revertir la invariante que sostiene
todo el diseño.

*(Y de nuevo: hoy no hay ni siquiera un endpoint para resolverlas. Antes de
discutir quién decide, hay que construir el dónde.)*

### 6.4 Confirmación del perfil

`--suggest` lee el ledger determinísticamente. Pero "¿este es tu sueldo?" es una
pregunta al humano. `onboard/suggest.ts:9-10` lo fija como contrato: *"the user
always confirms it before `setStrategyConfig` writes anything."*

### 6.5 El chat mismo

Convertir "¿me alcanza para el mecánico este mes?" en `check_affordability(amount)`
+ una explicación en castellano **es** el trabajo del LLM. Si se elimina, no queda
un wallet más barato: queda un CLI.

---

## 7. Camino por fases

### Fase 0 — Medir (una tarde, riesgo cero)

Sin esto, todo lo demás es opinión.

- Capturar `total_cost_usd` / `usage` / `modelUsage` del mensaje `result` en
  `claude-email-extractor.ts` y emitirlo por `emitMetric` (sólo números, nunca
  contenido — regla de telemetría de `CLAUDE.md`).
- Loguear qué modelo resolvió el SDK.
- `SELECT COUNT(*), review_reason FROM transactions WHERE needs_review = 1 GROUP BY review_reason`
  sobre el ledger real. **Es el número que decide el §4.**

### Fase 1 — Ahorro inmediato (chico, no toca arquitectura)

- Fijar `model` (Haiku 4.5), `systemPrompt` mínimo y `tools: []` en el extractor.
  Por lo estimado en §2.4, la mayor parte del costo del sync.
- Poner el cross-check detrás de un flag de config, con el default explícito.
- Idem para el chat: fijar modelo a propósito en vez de heredar el default.

### Fase 2 — La visión de Mato (el chat que ejecuta)

- Unificar el registro de tools (§5).
- Sumarle al chat las tools de acción: `sync`, `onboarding_status`,
  `suggest_profile`, `set_profile`, `set_rule`, `apply_rules`,
  `heal_counterparties`, `get_review_queue`.
- Confirmación explícita en el turno antes de cada escritura (§3.3).
- Endurecer el prompt del sistema contra el contenido derivado de correos.

Al terminar esta fase, **todo el onboarding posterior a las credenciales se hace
hablando**: sincronizar, confirmar el perfil, poner reglas, recategorizar el
historial.

### Fase 3 — Sync 100 % determinista

- Camino `reconstruct` como default; extractor sólo en modo canario/muestreo.
- Guarda determinista de ambigüedad de monto en el parser (§4.5.3).
- **Construir la resolución de `needs_review`**: endpoint + tool + UI. Falta hoy
  independientemente de todo lo demás.
- Sync diario por `setTimeout`, igual que el brief (`brief/scheduler.ts` ya es el
  patrón) — el sync periódico no necesita ni chat ni agente.

Al terminar esta fase, **el único gasto de LLM del wallet es el chat, por
consulta.**

### Fase 4 — Lo que se queda

- El chat.
- El humano para el OAuth y para el criterio de revisión.

---

## 8. Qué queda con costo de LLM inevitable

Después de las cuatro fases:

| | Costo |
|---|---|
| Sync (cualquier volumen) | **$0** |
| Categorización, reglas, backfill | **$0** |
| Brief diario | **$0** |
| Dashboard, API, todas las consultas | **$0** |
| Onboarding post-credenciales | costo del chat que lo conduce |
| **Chat** | **~$0,03-0,12 por consulta** (Sonnet/Opus), o cuota si es Pro/Max |

Y una nota que conviene no perder: **con `CLAUDE_CODE_OAUTH_TOKEN` nada de esto
llega como factura.** Si Mato ya paga Pro/Max, la optimización relevante no es el
dólar — es la latencia del primer sync (miles de llamadas secuenciales de segundos
cada una) y el cupo. La Fase 3 arregla las dos cosas de todos modos.

---

## 9. Lo que NO verifiqué

Honestidad, en la línea de `docs/reliability.md`:

- **No corrí un sync real.** No hay credenciales en este entorno
  (`build-sync-runner.ts:8-9` lo dice del propio repo). Todos los costos son
  estimados a partir del código y del pricing publicado, no medidos.
- **No confirmé qué manda el Agent SDK cuando se omiten `systemPrompt`, `tools` y
  `model`.** `sdk.d.ts` documenta los valores posibles pero no el default. Mi
  lectura se apoya en el comentario del propio repo en `chat-service.ts:79-86`.
  Es la Fase 0.
- **No consulté el ledger real de Mato.** El conteo de
  `review_reason='claude_amount_mismatch'` — el dato que decide el §4 — no lo
  tengo.
- **El "~60 % son transacciones"** para estimar el primer sync es un supuesto mío,
  no una medición. El número real sale de `IngestSummary` (`seen` vs `skipped`).
