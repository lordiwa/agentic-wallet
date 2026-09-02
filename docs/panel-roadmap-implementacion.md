# Panel de manejo — roadmap de implementación

Qué compromete llevar el prototipo aprobado (design system
`Agentic Wallet Panel`, 19 tarjetas, navegación clickeable) a **funcionar de
verdad**: con el ledger real, con acceso real, y con el chat contestando sobre
gastos reales.

Este doc no diseña ni implementa nada. Es la **estimación de compromiso**: en
qué orden, cuánto cuesta, qué se puede recortar y qué tickets salen de ahí.

Se apoya en tres docs que ya existen y no se repiten acá:
`docs/panel-manejo-flujo.md` (el plan funcional),
`docs/panel-viabilidad.md` (la auditoría, 26 huecos H1..H26),
`docs/flujo-app-prototipo.md` (el recorrido clickeable de las 19 tarjetas).

---

## 0. Resumen ejecutivo — qué compromete

**Seis fases. Entre 16 y 21 días de trabajo efectivo si se hace todo.**

Pero el número que importa es otro: **el mínimo para que "funcione" son las
tres primeras fases — entre 6 y 9 días.** Con eso Mato entra al panel desde su
teléfono, ve su saldo real, dispara un sync, y le pregunta al agente en qué se
fue la plata. Todo lo demás son pantallas que hoy ya se operan por terminal.

| Fase | Qué habilita | Días |
|---|---|---|
| **0 — Acceso real** | que el panel llegue al servidor sin abrirlo a internet | 1 |
| **1 — Resumen y sync** | ver el saldo real y sincronizar desde el navegador | 3–4 |
| **2 — CHAT con gastos reales** | preguntarle al agente sobre el ledger | 2–3 |
| — *fin del MVP: acá ya "funciona"* — | | **6–9** |
| **3 — Movimientos y revisión** | la tabla, y la cola de revisión con su motivo | 3–4 |
| **4 — Estrategia y ahorro** | deudas, calendario, colchón | 2–3 |
| **5 — Alta, reglas y configuración** | el onboarding y las categorías por pantalla | 3–4 |
| **6 — Login con Gmail (P0)** | la puerta real, no la frase de acceso | 2 |
| | | **16–21** |

**Sobre el chat, que es lo que se preguntó en particular.** El transporte ya
está: el streaming, el historial, el *Detener*, el 503 cuando falta la
credencial — todo eso existe y está testeado, y el panel web actual ya lo
consume. **Lo que falta no es el chat: es lo que el chat puede contestar sobre
gastos.**

Hoy el agente tiene cinco herramientas, y ninguna sabe sumar. Si le preguntás
*"¿cuánto gasté en Comercio A este mes?"*, la única herramienta que le sirve le
devuelve **la lista de movimientos** — y para darte una cifra tendría que
sumarlos él. Eso es exactamente lo que la regla 1 de este proyecto prohíbe: el
monto sale del motor, nunca del modelo. Y peor: esa lista viene cortada en 100
filas por defecto, así que la suma podría estar mal **sin que nada avise**.

Lo mismo con *"¿en qué se me fue la plata?"* — sabe agrupar por categoría
(comida, transporte…) pero **no por comercio**, que es como la gente piensa el
gasto. Y con *"¿qué movimientos no pudiste leer?"*, que es uno de los tres
atajos dibujados en el prototipo: **el agente no tiene acceso a la cola de
revisión.** Esa herramienta existe en el MCP y no está enchufada al chat.

Arreglarlo son **dos días**: una función de motor que sume gasto por comercio y
por período (con sus tests, como todo el resto del motor), tres herramientas
nuevas para el agente encima de funciones que ya existen, y la pantalla del
chat portada a Vue reusando el lector de streaming que ya está escrito en
React. Es la fase de mejor relación valor/costo de todo el roadmap.

**Un dato del contexto que hay que corregir:** la variable que fija el binding
local se llama `WALLET_BIND_HOST` (no `BOLSILLO_BIND_HOST`). `BOLSILLO_DB_PATH`
sí existe, pero es otra cosa: la ruta de la base, aceptada por compatibilidad
con la migración desde iwa-wallet. La restricción de Mato se respeta tal cual:
**el server sigue en 127.0.0.1 y no se abre ningún puerto.**

---

## 1. Qué significa "funcionar de verdad"

Vale la pena fijarlo antes de estimar, porque el prototipo aprobado tiene tres
capas distintas de "funcionar" y sólo una es cara:

1. **Se ve.** Ya está. El prototipo se recorre entero, clickeable.
2. **Se opera con datos inventados.** Es el modo demo que `web/` ya tiene
   (`web/src/demo/demoFetch.ts`) y que se porta al panel. Cero riesgo, cero
   backend.
3. **Se opera con el ledger real.** Acá está todo el costo, y se parte en dos
   preguntas separadas: **¿cómo llega el navegador al server?** (fase 0) y
   **¿existe el endpoint que la pantalla necesita?** (fases 1–5).

Lo que sigue estima la capa 3. La capa 2 va incluida en la fase 1 porque es el
andamio que permite construir pantallas antes de que su endpoint exista.

---

## 2. El plan por fases

### Fase 0 — Acceso real · **1 día**

**Qué habilita:** que el panel publicado le hable al server de Mato sin que el
server salga a internet.

**Qué se construye:**

- `WALLET_ACCESS_TOKEN` en `config.ts` y `.env.example`.
- Middleware `Authorization: Bearer` sobre todo `/api/*` salvo `/api/health`.
  **Con la variable vacía, el comportamiento es el de hoy** — sólo 127.0.0.1.
  El token es lo que *habilita* exponerse; no es cosmético.
- `GET /api/health` pasa a devolver `{status, auth_required}` para que el panel
  sepa si la puerta sirve o es decorativa.
- `tailscale serve` hacia localhost, documentado. **No `funnel`**: `serve`
  publica sólo dentro de la tailnet de Mato, `funnel` publicaría en internet.
  `WALLET_BIND_HOST` no se toca.

**Por qué va primero, sin excepción.** Toda fase posterior agrega endpoints que
leen o escriben el ledger. Construirlos antes del middleware crea una ventana
en la que cada endpoint nuevo nace sin llave. Y el endpoint más caro de dejar
abierto no es el que lee: es `POST /api/chat`, que además de leer el ledger
entero **gasta la credencial de Claude de Mato en cada llamada**. Cualquiera
que alcance el puerto puede facturarle tokens.

**Riesgo: bajo.** Es un middleware de treinta líneas con dos tests (401 sin
token, 200 con token). El único detalle fino: el chat es SSE, y `EventSource`
—la API estándar del navegador para SSE— **no permite mandar cabeceras**, así
que no se puede autenticar. No es un problema: el cliente actual
(`web/src/api/client.ts`, `streamChat`) ya usa `fetch` + `getReader()` en vez
de `EventSource`, justamente por eso. El panel porta ese mismo camino.

---

### Fase 1 — Resumen y sincronización · **3–4 días**

**Qué habilita:** el panel existe, se publica, y muestra el saldo real. El
botón de sync trae correos nuevos.

**Qué se construye:**

- Workspace `panel/` (Vue 3 + `<script setup>` + Vite), en `workspaces` de
  `package.json`, con `panel/src/**/*.test.ts` agregado a `vitest.config.ts`.
  **`web/` no se toca**: convive hasta que el panel esté probado en uso real.
- Capa `api/` portada desde `web/src/api/`, con el token en las cabeceras, y el
  modo demo (`VITE_API_BASE_URL=demo`) portado desde `web/src/demo/`.
- El reloj de refresco como composable + store de Pinia, con las tres
  propiedades de `web/src/lib/refresh.tsx`: uno solo para todo el panel, se
  para con la pestaña oculta y tickea al volver, y expone `refreshNow()`.
- **P2 Resumen** — la única pantalla que se construye sin tocar el server.
  `GET /api/overview` + `GET /api/brief` + `GET /api/sync/status`.
- **P3 Sincronización** + el SyncButton con sus ocho estados. Se agrega
  **H19** (`batch_size` en el body de `POST /api/sync`, que la tool MCP ya
  acepta) — es una línea de zod.
- El aviso persistente de revisión pendiente (franja, no toast) ya se dibuja,
  y linkea a P5 aunque P5 llegue en la fase 3: hasta entonces la franja dice
  cuántas filas hay y que se resuelven por terminal.

**Lo que se recorta a propósito, y se rotula:** *Detener* corta el
auto-encadenado y dice *"se detiene al terminar este lote"* (H18 no se
construye); el registro de lotes vive en Pinia y dice que se pierde al recargar
(H17 no se construye). Ambos son endpoints nuevos con estado nuevo en la base
por un beneficio chico.

**Por qué va segunda.** P2 es la única pantalla con cero dependencias de
backend nuevo, así que valida el andamio entero (workspace, api, reloj, demo,
despliegue) sin quedar bloqueada por nada. Y el sync es lo que mantiene el
ledger vivo: sin él, todo lo demás muestra datos viejos.

**Riesgo: bajo-medio.** El andamio es trabajo conocido. El riesgo real es de
alcance: es tentador construir P4 acá porque "la tabla es fácil". No lo es —
ver fase 3.

---

### Fase 2 — El chat y los gastos del chat · **2–3 días**

Tiene su propia sección abajo (§3), porque es lo que se preguntó en particular.

**Por qué va tercera, antes que revisión y movimientos.** Tres razones:

1. **Es lo que Mato pidió.** Entre las pantallas que faltan, es la de mayor
   valor por día invertido.
2. **No depende de nada de las fases 3–5.** Sus herramientas nuevas se apoyan
   en funciones de motor que ya existen o que son un `GROUP BY` con test
   propio. No necesita la cola de revisión construida, ni las reglas, ni las
   deudas.
3. **Compensa lo que todavía no hay.** Mientras P4 y P8 no existan, el chat es
   el único lugar del panel donde Mato puede preguntar cualquier cosa sobre su
   historial. Es la pantalla que hace que un panel a medias siga siendo útil.

**Lo único que sí depende de una fase posterior:** la *tarjeta de propuesta*
del prototipo (*"Podés crear una regla: Comercio A → comida"* con
*Revisar y crear*) navega a **P6**, que llega en la fase 5. Por eso **el patrón
de propuesta no se construye acá**: en la fase 2 el chat contesta y no propone.
Dibujar un botón que no lleva a ningún lado contradice el criterio de
aceptación de TASK-045 —*un botón que no hace nada es peor que un botón
ausente*— y la regla de que el agente propone donde la acción se confirma.

---

### Fase 3 — Movimientos y revisión · **3–4 días**

**Qué habilita:** la tabla del ledger con filtros y paginación reales, y la
cola de revisión mostrando **por qué** cayó cada fila.

**Qué se construye:**

- **Motor:** columnas `review_reason TEXT` y `claude_amount REAL` en
  `transactions` (migración aditiva por `addColumnIfMissing`), escritas por
  `insertTransaction` desde el pipeline (**H9, H10**). Hoy `review_reason` se
  calcula en `ingest/pipeline.ts` y se pierde en la escritura.
- **Motor:** `total` real y filtro por `category` en `queryTransactions`
  (**H20, H21**); `GET /api/counterparties` para el autocompletar (**H23**).
- **Rutas:** `GET /api/review` devuelve `amount`, `claude_amount`,
  `review_reason`, `raw_subject`, `gmail_msg_id`;
  `GET /api/review/resolutions` acepta `?transaction_id=` y `?limit=`, que el
  motor ya soporta y la ruta descarta (**H24**).
- **P4 Movimientos** + FilterBar (con "Interna" movida al toggle
  `include_internal`, y `type` en selección simple o repetible — **H22**).
- **P5 Revisión** + ReviewCard con el motivo y la comparación de las dos
  lecturas.

**Lo que no se construye, por decisión escrita:** *"Mandar a revisión"* desde
P4 y *"Rehacer el ledger desde cero"* en P10 (**H26**, `panel-viabilidad.md`
§4). No se dibujan deshabilitados: no están.

**El cuerpo del correo no se persiste.** Es dato personal. El enlace al correo
original se hace con `gmail_msg_id` hacia Gmail.

**Por qué acá y no antes.** Es la primera fase que **toca el pipeline de
ingesta**, o sea la zona que la regla 1 del proyecto protege. Va después de que
el andamio esté validado y el chat entregado, para que un error acá no bloquee
todo lo demás. Y es la fase con más trabajo de motor de las seis: dos columnas
nuevas, dos funciones de query nuevas, todas con test.

**Riesgo: medio.** Tocar `insertTransaction` es tocar la invariante. Los tests
del parser y del pipeline son el cinturón, y tienen que seguir verdes sin
cambiar una sola aserción.

---

### Fase 4 — Estrategia y ahorro · **2–3 días**

**Qué se construye:** `GET /api/debts` y el deshacer del pagado (**H11** — hoy
existe el botón que escribe por id y ninguna forma de conocer los ids);
`GET /api/strategy/calendar` sobre `paydaysBetween` + `tarjetaStatus`
(**H12**); el objetivo del colchón escrito por la ruta de perfil y no por
`POST /api/buffer` (**H14** — hoy ese endpoint escribe `savings.reserved`, una
columna que el motor no lee); **P8** y **P9**.

**Lo que se recorta:** la columna *"Vence"* de la tabla de deudas no se dibuja
(la tabla `debts` no tiene fecha de vencimiento); *Simular* se limita a
`abono`, el único parámetro que el motor sabe proyectar (**H13** — las otras
dos perillas son aritmética financiera nueva, van en `strategy/` con sus tests,
en otro ticket); *Registrar aporte* queda como *fijar reservado* salvo que se
construya `POST /api/buffer/contributions`, porque **la suma la hace el server,
nunca el cliente** (**H15**); metas e histórico (**H16**) quedan fuera y la
pantalla lo dice.

**Riesgo: bajo.** Son rutas sobre funciones existentes. La única trampa es
H14, y ya está identificada.

---

### Fase 5 — Alta, reglas y configuración · **3–4 días**

**Qué se construye:** las rutas de onboarding (**H2**: status / suggestions /
profile GET y POST sobre `onboardStatus`, `buildSuggestions`,
`getStrategyConfig`, `setStrategyConfig`); las rutas de reglas (**H5**:
listar / crear / borrar / aplicar / heal / sin-categorizar);
`countMatchingTransactions` con la normalización de `toRulePattern` (**H6** —
el contador en vivo, que es la defensa contra el patrón más largo que la
contraparte real); `deleteCategoryRule` (**H7**); `backfillCategories` con
`dryRun` (**H8**); `healCounterparties` por ids además de por lote (**H25**);
**P1**, **P6**, **P10**, y ahora sí el patrón de propuesta del chat, que ya
tiene a dónde navegar.

**Por qué al final.** Es el bloque más grande de rutas nuevas y el que menos se
extraña: es exactamente lo que hoy se hace por terminal con `npm run onboard` y
las tools MCP, y eso funciona. Además el checklist de P1 y P10 tiene que
renderizar **los pasos que devuelve el motor** (`env`, `claude`, `gmail`,
`sync`, `huso`, `profile`), no la lista dibujada a mano (**H4**), y el paso
*"Cuentas"* del prototipo se renombra a **Titular** porque no corresponde a
nada del motor (**H3**).

**Riesgo: bajo-medio.** Muchas rutas, poca lógica. El cuidado va en mantener la
invariante del onboarding: **nunca escribir un valor que el usuario no
confirmó.**

---

### Fase 6 — Login con Gmail (P0) · **2 días**

**Qué se construye:** verificación del `id_token` de Google en el server, una
sesión, y una lista de cuentas permitidas (una). El middleware pasa de Bearer a
sesión, con Bearer sobreviviendo para las llamadas de terminal.

**Por qué al final, y por qué no es urgente.** El token de la fase 0 **ya
resuelve el problema de seguridad**. P0 resuelve el problema de comodidad:
que Mato no tenga que pegar una frase larga. El OAuth que el repo ya tiene
(`docs/oauth-para-humanos.md`) es un flujo de escritorio para **leer correos**,
con refresh token en disco — no es un mecanismo de sesión para una SPA, y
convertirlo pide piezas que no están construidas.

**Riesgo: alto en proporción a su valor.** Es la única fase que toca OAuth de
verdad. Si algo se recorta del roadmap entero, es ésta.

---

### El grafo de dependencias, en una línea

```
Fase 0 (acceso) ──┬──▶ Fase 1 (P2+P3) ──▶ Fase 3 (P4+P5) ──┐
                  │                                         ├──▶ Fase 6 (P0)
                  ├──▶ Fase 2 (P7 chat) ────────────────────┤
                  │         └── propuesta ──▶ (espera F5)   │
                  ├──▶ Fase 4 (P8+P9) ──────────────────────┤
                  └──▶ Fase 5 (P1+P6+P10) ──────────────────┘
```

Sólo la fase 0 bloquea a todas. Las fases 2, 4 y 5 son **paralelizables** entre
sí una vez que el andamio de la fase 1 existe: no comparten archivos de motor.
La fase 3 es la única que toca el pipeline.

---

## 3. El chat y los gastos del chat, en detalle

### 3.1 Lo que ya existe, verificado en el código

La auditoría marcó **P7 como VIABLE, sin huecos**, y para lo que ella preguntaba
—*¿la pantalla tiene endpoint?*— es correcto. Todo esto está cableado y
testeado:

| Pieza | Dónde | Estado |
|---|---|---|
| Streaming SSE | `api/chat-route.ts`, eventos `meta`/`text`/`tool`/`done`/`error` | existe |
| Historial | `GET /api/conversations`, `/:id`, tabla `conversations` + `messages` | existe |
| *Detener* | `AbortController` cableado al `close` de la request | existe |
| 503 antes del stream | `claude_not_configured`, antes de abrir el SSE | existe |
| Chips de tool | evento `tool` con etiqueta en español por herramienta | existe |
| Guardrail | `CHAT_SYSTEM_PROMPT`, con test propio (`chat-service.guardrail.test.ts`) | existe |
| Aislamiento del modelo | `tools: []` + `allowedTools` + `strictMcpConfig` — el agente **no** tiene Bash, Read ni WebFetch | existe |
| Cliente SSE | `web/src/api/client.ts` → `streamChat`, con `fetch` + `getReader()` | existe, **se porta** |

Ese último renglón vale doble: el lector de streaming ya está escrito, probado
(`web/src/test/mockChatFetch.ts`) y **usa `fetch` en vez de `EventSource`**, así
que sobrevive intacto a la autenticación por Bearer de la fase 0.

### 3.2 Lo que falta — y no está en H1..H26

La auditoría preguntó *"¿la pantalla tiene endpoint?"*. La pregunta de Mato es
otra: *"¿el chat puede contestar sobre mis gastos?"*. Esa pregunta no la
contesta el endpoint sino **las herramientas que el agente tiene adentro**, y
ahí hay huecos que ningún doc anterior contó. Son cinco, y llevan numeración
propia (C1..C5) para no chocar con H1..H26.

El agente tiene hoy **cinco herramientas** (`chat/engine-tools.ts`):
`get_strategy_overview`, `query_transactions`, `get_daily_brief`,
`get_card_statement`, `check_affordability`.

---

**C1 — Ninguna herramienta suma gasto. El modelo tendría que sumar, y no
puede.**

`query_transactions` devuelve `{transactions, count, spending_by_category}`.
`count` es la cantidad de filas, no un monto. `spending_by_category` sólo
aparece **si se pasan `from` y `to` y ambos parsean**, y agrupa por categoría.

Entonces, ante *"¿cuánto gasté en Comercio A este mes?"*, el agente recibe la
lista de movimientos de Comercio A y **ninguna cifra sumada**. Para contestar
tendría que sumarlos él. Eso choca de frente con dos cosas:

- La regla 1 de `CLAUDE.md`: el monto sale del motor, nunca del modelo.
- Su propio system prompt: *"TODA cifra monetaria DEBE provenir del resultado
  de una herramienta — NUNCA inventes, estimes ni infieras un monto."*

O sea: **el guardrail está bien escrito y el agente, bien obedecido, no puede
contestar la pregunta más común sobre gastos.** Si desobedece, contesta con un
número que no salió del motor. Las dos salidas son malas.

Y hay un agravante silencioso: `limit` tiene default 100. Si el rango pedido
tiene más de 100 movimientos, la lista llega truncada **sin ninguna marca**, y
una suma hecha sobre ella sería incorrecta sin que nada lo indique.

*Qué se construye:* `spendingSummary(db, {from, to, counterparty?, category?})`
en `strategy/spending.ts`, devolviendo `{total, count, by_category,
by_counterparty}` con `EXCLUDE_FROM_TOTALS_SQL` — la misma cláusula de
exclusión que usa todo agregado de plata del motor (nunca interna, nunca
reversada, nunca en revisión, nunca descartada, nunca fila de reverso). Con su
test. Se expone como tool `get_spending_summary` y como
`GET /api/spending/summary`.

---

**C2 — "¿En qué se me fue la plata?" sólo sabe contestar por categoría, no por
comercio.**

`spendingByCategory` agrupa por las diez categorías del glosario. Pero la
pregunta que el prototipo dibuja como atajo del estado vacío —*"¿en qué se me
fue la plata este mes?"*— la gente la piensa por **comercio**: *"se te fue
$180 en Comercio A y $120 en Comercio B"*. No existe ninguna función que
agrupe por contraparte. Lo más cercano son los *top consumos* de
`buildDailyBrief`, y son **de un solo día**.

*Qué se construye:* el `by_counterparty` de C1, ordenado descendente y
truncado a un top-N. Misma función, mismo test, cero código nuevo adicional.

---

**C3 — El agente no ve la cola de revisión.**

El tercer atajo dibujado es *"¿qué movimientos no pudiste leer?"*. Las cinco
herramientas del chat no incluyen ninguna que lea `needs_review`.
`get_review_queue` **existe como tool MCP** (`mcp/server.ts`) y **no está
registrada en el chat**. Es puro cableado: `queryReviewTransactions` ya existe
y ya está testeada.

Detalle que lo hace más notorio: `panel-viabilidad.md` §P7 da como ejemplo el
chip *"Leído de `get_review_queue`"* — un chip que hoy el chat no puede emitir,
porque esa herramienta no está de su lado.

*Qué se construye:* registrar `get_review_queue` en `createEngineToolsServer`,
en modo lectura, con su etiqueta en español. Media hora.

---

**C4 — No hay comparación entre períodos.**

*"¿Gasté más que el mes pasado?"* no tiene herramienta. `get_daily_brief`
compara un día contra el promedio histórico, y eso es todo. La comparación
mes contra mes sale gratis una vez que existe C1: son dos llamadas a
`spendingSummary` con rangos distintos. **Se resuelve en el prompt, no en el
motor** — pero hay que decirlo explícitamente en la descripción de la tool para
que el agente sepa que puede llamarla dos veces en vez de inventar la
diferencia.

---

**C5 — El contexto de origen (`ContextChip`) no tiene campo en el body.**

El prototipo abre el chat desde una fila de P4 arrastrando *"Sobre: Comercio A ·
12 sep · −45,00"*. `chatBodySchema` acepta **sólo** `{message}`. O el panel
concatena el contexto en el texto del mensaje, o el body crece con un campo
`context`.

*Recomendación:* concatenarlo en el texto, rotulado, en la fase 2. Es honesto
(el agente ve exactamente lo que el usuario ve), no cambia el contrato del
endpoint, y evita persistir un campo estructurado que todavía no sabemos qué
forma final tiene. Si más adelante estorba, se convierte en campo con su
migración.

---

**Y una expectativa a fijar, que no es hueco:** el streaming es **por bloque,
no por token**. `runChatTurn` llama a `query()` sin `includePartialMessages`, a
propósito y documentado: los deltas por token obligan a parsear eventos crudos
de la API a mano y son mucho más difíciles de testear contra un modelo
stubbeado. El prototipo ya dibuja *"streaming por bloques"*, así que están
alineados — pero si alguien espera el efecto máquina de escribir letra por
letra, ahí está el porqué.

### 3.3 Qué compromete, en concreto

| Trabajo | Dónde | Turnos |
|---|---|---|
| `spendingSummary` + test (C1, C2, C4) | `strategy/spending.ts` | 1–2 |
| `get_spending_summary` como tool del chat | `chat/engine-tools.ts` + test | 1 |
| `get_review_queue` como tool del chat (C3) | `chat/engine-tools.ts` + test | 0.5 |
| `total` en `query_transactions` del chat | `chat/engine-tools.ts` | 0.5 |
| `GET /api/spending/summary` (P2 y P4 lo van a querer) | `api/routes.ts` + test | 0.5 |
| Etiquetas de tool en español para las nuevas | `chat/chat-service.ts` | — |
| Ajuste del system prompt (nombrar las tools de gasto) | `chat/chat-service.ts` + guardrail test | 0.5 |
| **P7 en Vue**: ChatPanel, MessageList, Composer, ConversationList, ContextChip | `panel/src/` | 2–3 |
| Portar `streamChat` (fetch + getReader + parser SSE) con Bearer | `panel/src/api/` | 0.5 |
| Los tres atajos del estado vacío, ahora contestables | `panel/src/` | 0.5 |

**Total: 7–9 turnos ≈ 2–3 días.**

### 3.4 Riesgos del chat

- **El único riesgo real es de disciplina, no técnico.** Si `spendingSummary`
  no se construye y se deja que el modelo sume las filas que le llegan, el chat
  parece funcionar y devuelve cifras que no salieron del motor. Sería la
  primera grieta en la regla 1 del proyecto, y la más difícil de ver, porque el
  número *casi siempre* va a estar bien. **El test que lo previene es del
  motor, no del chat:** `spendingSummary` con su propio fixture.
- **Costo de tokens.** Cada turno del chat es una llamada a la API de Claude
  con la conversación entera como prefijo (el historial se pliega en el prompt,
  no se replica por la sesión del SDK). Conversaciones largas cuestan más.
  `maxTurns: 8` acota el bucle de herramientas. Vale rotularlo en P10 el día
  que Mato quiera ver el gasto.
- **Sin la fase 0, `POST /api/chat` es el endpoint más caro de dejar abierto.**
  Ya dicho, se repite porque es lo que ordena el roadmap.
- **Las conversaciones no tienen dueño.** La tabla `conversations` no tiene
  columna de usuario. Con un solo usuario y un solo token da igual; el día que
  haya dos, es una migración. No se diseña "por las dudas".

---

## 4. Estimación de compromiso y qué se puede recortar

### 4.1 Por fase

| Fase | Turnos | Días | Riesgo | Bloquea a |
|---|---|---|---|---|
| 0 — Acceso real | 2–3 | 1 | bajo | todas |
| 1 — Resumen y sync | 8–10 | 3–4 | bajo-medio | 2, 3, 4, 5 |
| 2 — Chat con gastos | 7–9 | 2–3 | bajo | — |
| 3 — Movimientos y revisión | 9–11 | 3–4 | **medio** (toca el pipeline) | — |
| 4 — Estrategia y ahorro | 6–8 | 2–3 | bajo | — |
| 5 — Alta, reglas y config | 9–11 | 3–4 | bajo-medio | la propuesta del chat |
| 6 — Login con Gmail | 5–6 | 2 | **alto** | — |
| **Total** | **46–58** | **16–21** | | |

*Un "turno" es una tanda de trabajo con su build y sus tests en verde. Los días
son de trabajo efectivo, no de calendario.*

### 4.2 El MVP: dónde cortar si se quiere que "funcione" ya

**Fases 0 + 1 + 2 = 17–22 turnos ≈ 6–9 días.**

Con eso Mato tiene, desde el navegador de su teléfono, dentro de su tailnet:

- el saldo real, el safe-to-spend, el estado de la tarjeta, el colchón, el
  gasto por categoría y el brief del día;
- el botón de sync con sus ocho estados y el aviso persistente cuando algo cae
  en revisión;
- **el chat contestando sobre gastos reales**: cuánto gastó en un comercio, en
  qué se le fue la plata, si llega al pago de la tarjeta, qué movimientos no se
  pudieron leer.

Lo que **no** tiene en el MVP, y que hoy tampoco tiene: la tabla de movimientos
con filtros, resolver la cola de revisión, el detalle de estrategia, y el
onboarding por pantalla. **Todo eso ya se opera por terminal y por MCP, y va a
seguir funcionando igual.** El panel no rompe ninguno de esos caminos.

### 4.3 Recortes disponibles dentro de cada fase

Ordenados por cuánto ahorran contra cuánto duelen:

| Recorte | Ahorra | Cuesta |
|---|---|---|
| Fase 6 entera (P0 login) | 2 días | pegar una frase de acceso una vez |
| H17 + H18 (historial de lotes y cancelación de sync) | ~1 día | *Detener* dice la verdad más chica; el registro se pierde al recargar |
| H16 (metas e histórico de ahorro) | ~0.5 día | dos bloques de P9 que hoy no tienen ni lector |
| H13 (simulador de tres perillas) | ~1 día | la simulación queda en una sola perilla, `abono` |
| H23 (autocompletar de contrapartes) | ~0.5 día | se escribe la contraparte a mano |
| Columna *Vence* en deudas | ~0.5 día | una columna menos en P8 |

**Lo que no se recorta, aunque tiente:**

- **La fase 0.** Recortarla es dejar el ledger y la credencial de Claude sin
  llave, y ninguna fase posterior lo arregla retroactivamente.
- **`spendingSummary` (C1).** Recortarla es dejar que el modelo sume. Es la
  regla 1 del proyecto.
- **H9/H10 dentro de la fase 3.** Sin ellos la ReviewCard no es la ReviewCard:
  es una lista de asuntos de correo con tres botones. Si el presupuesto no
  alcanza, **se recorta la fase 3 entera**, no su corazón.

### 4.4 Riesgos transversales

- **Deriva de alcance del prototipo.** El diseño dibuja cosas que la auditoría
  ya marcó sin respaldo. El criterio de TASK-045 aplica en cada fase: lo que no
  tiene backend **no se dibuja**, o se dibuja deshabilitado diciendo por qué.
- **`web/` y `panel/` conviviendo.** Duplican la capa de API y el reloj mientras
  ambos existan. Es a propósito: el retiro de `web/` es otro ticket, con el
  panel ya probado en uso real. Mientras tanto, **`web/` no se modifica en
  ningún commit del panel.**
- **La fase 3 toca el pipeline.** Es la única que puede romper la invariante
  del motor. Sus tests existentes son el cinturón y tienen que seguir verdes
  **sin cambiar una sola aserción**.
- **Nada de datos personales.** En ninguna fase: ni en fixtures, ni en
  telemetría, ni en el bundle publicado. El artefacto en modo demo no lleva
  ninguna URL privada — el backend se elige con `?api=` desde el navegador.

---

## 5. Los tickets

Siete tickets nuevos, uno por fase. **TASK-045 se queda como el ticket
paraguas**: sus 25 criterios siguen siendo la definición de terminado del panel
completo, y los hijos son la ejecución.

| Ticket | Fase | Título | Depende de |
|---|---|---|---|
| **TASK-046** | 0 | Acceso real: `WALLET_ACCESS_TOKEN`, middleware Bearer y `tailscale serve` | — |
| **TASK-047** | 1 | Esqueleto `panel/` + P2 Resumen + P3 Sincronización | TASK-046 |
| **TASK-048** | 2 | **Chat con gastos reales: motor de resumen de gasto, tools del agente y P7** | TASK-046, TASK-047 |
| **TASK-049** | 3 | P4 Movimientos y P5 Revisión, con `review_reason` y `claude_amount` persistidos | TASK-047 |
| **TASK-050** | 4 | P8 Estrategia y P9 Ahorro: listar deudas, calendario y objetivo de colchón | TASK-047 |
| **TASK-051** | 5 | P1, P6 y P10: rutas HTTP de onboarding y reglas, y el contador en vivo | TASK-047 |
| **TASK-052** | 6 | P0: login con Gmail (`id_token`, sesión y cuenta permitida) | TASK-046 |

Cada uno lleva sus criterios de aceptación en `tasks/TASK-0XX.json`.

---

## 6. Corrección al contexto de partida

Para que quede escrito, porque el nombre circuló mal:

- La variable que fija el binding local es **`WALLET_BIND_HOST`**
  (`server/src/config.ts:44`, default `127.0.0.1`). No existe
  `BOLSILLO_BIND_HOST`.
- **`BOLSILLO_DB_PATH` sí existe**, pero es la ruta de la base: se acepta como
  alternativa a `WALLET_DB_PATH` por compatibilidad con la migración desde
  iwa-wallet (`config.ts:95`).

La restricción de Mato no cambia en nada: **el server sigue escuchando sólo en
127.0.0.1, no se abre ningún puerto, y el camino a datos reales es
`tailscale serve` + `WALLET_ACCESS_TOKEN`.** `tailscale funnel` queda
descartado por escrito, igual que en `docs/panel-manejo-flujo.md` §8.

---

Ver también: `docs/panel-manejo-flujo.md` (el plan funcional),
`docs/panel-viabilidad.md` (la auditoría, H1..H26),
`docs/flujo-app-prototipo.md` (el recorrido clickeable),
`docs/mcp.md` (las 14 tools), `docs/frontend-desplegado.md` (por qué el sitio
actual está en modo demo), `tasks/TASK-045.json` (el ticket paraguas).
