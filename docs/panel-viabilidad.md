# Panel de manejo — auditoría de viabilidad

Mapeo pantalla por pantalla del diseño (`Agentic Wallet Panel — Design System`,
18 tarjetas: 5 de fundamentos, 11 páginas y 6 componentes) contra lo que el
backend **realmente** expone hoy. El plan funcional está en
`docs/panel-manejo-flujo.md`; el ticket, en `tasks/TASK-045.json`.

Esto no diseña ni implementa nada. Contesta una sola pregunta, pantalla por
pantalla: **¿con qué se alimenta, y existe?**

## Método

Se leyó el código, no la documentación: `server/src/api/` (`routes.ts`,
`queries.ts`, `mutations.ts`, `schemas.ts`, `sync-route.ts`, `chat-route.ts`),
`server/src/index.ts` (qué routers se montan), `server/src/mcp/server.ts` (las
14 tools), `server/src/onboard/`, `server/src/category/`,
`server/src/strategy/`, `server/src/review/resolve.ts`,
`server/src/ingest/pipeline.ts` y `server/src/db/schema.ts`. Los detalles de
cada pantalla salen de los 18 previews del diseño.

Tres veredictos:

- **VIABLE** — el backend ya lo soporta tal como está la pantalla dibujada.
- **PARCIAL** — el núcleo se puede construir, pero hay elementos del diseño sin
  respaldo. Se indica cuáles.
- **NO VIABLE** — lo que la pantalla promete no tiene respaldo alguno. Se indica
  qué habría que crear.

## Resumen

| | Pantallas | Componentes | Total |
|---|---|---|---|
| VIABLE | P2, P7 | OverviewCard, ChatPanel | **4** |
| PARCIAL | P3, P4, P5, P8, P9, P10 | SyncButton, TransactionsTable, FilterBar | **9** |
| NO VIABLE | P0, P1, P6 | ReviewCard | **4** |

Diecisiete piezas evaluadas (11 páginas + 6 componentes). **Cuatro se pueden
construir hoy tal cual.** Las otras trece necesitan, entre todas, **26 huecos**
resueltos (§3): 22 pasan por una ruta HTTP nueva — 8 de ellas se resuelven
llamando a una función que ya existe y ya está testeada, las otras 14 necesitan
además una función o una columna nueva en el motor —, 1 es el middleware de
acceso, y 3 se arreglan **sólo cambiando el diseño**, sin escribir backend.

El hallazgo que más cambia el alcance respecto de `panel-manejo-flujo.md`: la
**ReviewCard** — la pieza que el propio diseño declara "donde la invariante del
motor se vuelve visible" — compara "lo que leyó el parser" contra "lo que leyó
Claude" y muestra el motivo de la discrepancia. **Ninguno de esos tres datos se
persiste.** `review_reason` se calcula en `ingest/pipeline.ts` y se pierde: no
hay columna en `transactions` ni la escribe `insertTransaction`. El monto de la
verificación cruzada tampoco se guarda, y del correo sólo queda `raw_subject`.

---

## 1. Lo que el backend expone hoy, verificado

**HTTP** — todo se monta en `/api` desde `server/src/index.ts`:

| Endpoint | Función de motor detrás |
|---|---|
| `GET /api/health` | ninguna (literal `{status:"ok"}`) |
| `GET /api/transactions` | `queryTransactions` |
| `GET /api/review` | `queryReviewTransactions` |
| `POST /api/review/:id/resolve` | `resolveReview` |
| `GET /api/review/resolutions` | `listReviewResolutions` (**sin pasarle filtros**) |
| `GET /api/overview` | `buildOverview` (motor de `strategy/` entero) |
| `GET /api/sync/status` | `getSyncState` + `getSyncProgress` |
| `POST /api/sync` | el `SyncRunner` (**sin body, sin `batch_size`**) |
| `GET /api/transfers` | `transferenciasMes` |
| `GET /api/brief` | `buildDailyBrief` |
| `GET /api/strategy/projection` | `proyeccionSinDeuda` (**sólo `?abono=`**) |
| `POST /api/debts/:id/paid` | `markDebtPaid` |
| `POST /api/buffer` | `updateBufferReserved` (**escribe `reserved`, no el objetivo**) |
| `POST /api/chat/:conversationId?` | `runChatTurn`, SSE |
| `GET /api/conversations`, `/:id` | `listConversations` / `listMessages` |

**MCP (stdio, `server/src/mcp/server.ts`)** — 14 tools. Seis de ellas **no
tienen equivalente HTTP**: `onboarding_status`, `suggest_profile`,
`set_profile`, `set_rule`, `apply_rules`, `heal_counterparties`. Un navegador no
habla MCP por stdio: para el panel, esas seis habilidades **no existen**.

**Y no hay autenticación.** Ninguna. `createApp` monta CORS y nada más.

---

## 2. Mapeo pantalla por pantalla

### P0 — Acceso · **NO VIABLE**

- **Dónde vive:** ruta `/acceso`. Es la entrada; sale a P1 (si el onboarding
  está incompleto) o a P2. Sólo se muestra si el backend pide token.
- **Con qué se alimenta:** `GET /api/health` como sonda de vida. El resto
  (URL del backend, modo demo, frase de acceso) es `localStorage` del navegador,
  portado de `web/src/api/base.ts`.
- **Por qué NO VIABLE:** el diseño dice que la frase "viaja como
  `Authorization: Bearer` en cada request" y que "mientras `WALLET_ACCESS_TOKEN`
  esté vacío el server sólo acepta 127.0.0.1". **Ninguna de las dos cosas
  existe**: no hay `WALLET_ACCESS_TOKEN` en `config.ts`, no hay middleware, y
  `WALLET_BIND_HOST` es una variable de binding que no autentica nada. La
  pantalla se puede *dibujar* hoy y el propio preview admite que es decorativa —
  pero como control de acceso no tiene respaldo. Además el panel no tiene cómo
  saber si el server exige token o no: `GET /api/health` devuelve `{status}` y
  nada más.
- **Huecos:** H1.

### P1 — Alta y perfil · **NO VIABLE**

- **Dónde vive:** ruta `/alta`. Se llega desde P0 (o al arrancar) cuando el
  onboarding está incompleto; sale a P2. "Saltar por ahora" también va a P2.
- **Con qué se alimentaría:** `onboardStatus()` (checklist), `buildSuggestions()`
  (la propuesta leída del ledger) y `setStrategyConfig()` (guardar).
- **Por qué NO VIABLE:** las tres funciones existen, están testeadas y son
  exactamente lo que hace falta — pero **sólo se alcanzan por MCP o por el CLI**.
  No hay una sola ruta HTTP de onboarding. Toda la pantalla, sin excepción,
  depende de rutas que no existen.
- **Dos desalineaciones más, encontradas en el preview:**
  - El checklist dibujado (Gmail · base de datos · sueldo y día de pago ·
    colchón objetivo · cuentas · reglas) **no es** el que devuelve el motor
    (`env` · `claude` · `gmail` · `sync` · `huso` · `profile`). El panel tiene
    que renderizar los pasos que vengan, no una lista escrita a mano.
  - El paso **"Cuentas — qué cuentas mira el motor"** no corresponde a nada:
    `strategy_config` no tiene una clave `cuentas`, y el motor no mira cuentas
    sino el **titular** (`titular`, que `rules/reconcile.ts` compara contra el
    contacto de cada transferencia para marcarla interna).
- **Huecos:** H2, H3, H4.

### P2 — Resumen · **VIABLE**

- **Dónde vive:** ruta `/` — el hogar. Toda sesión abre acá. Sale a P5 (badge de
  pendientes), P3 (sincronizar), P4, P8 y al cajón de chat con contexto.
- **Con qué se alimenta:** `GET /api/overview` (saldo, safe-to-spend,
  `card_status`, `buffer_status`, `next_payday`, `spending_by_category`,
  `counts.needs_review`), `GET /api/brief` (la narrativa del día) y
  `GET /api/sync/status` (el chip de frescura).
- **Verificado uno por uno contra el preview:** Saldo → `balance`; Safe to spend
  → `safe_to_spend_hoy`; Tarjeta (mínimo · fecha máxima) → `card` +
  `card_status`; Próximo pago → `next_payday` (`null` ⇒ "Sin leer", que es
  justo lo que el diseño pide); Gasto por categoría → `spending_by_category`;
  Colchón → `buffer_status`; Calendario (cobro · corte · vencimiento) →
  `next_payday` + `card.issue_date` + `card.due_date`; badge de revisión →
  `counts.needs_review`.
- Nada de esta pantalla se calcula en el cliente. Se construye hoy.

### P3 — Sincronización · **PARCIAL**

- **Dónde vive:** ruta `/sync`. Se llega desde el botón de P2 o el menú; al
  terminar un lote con filas en la cola, empuja a P5.
- **Con qué se alimenta:** `POST /api/sync` (dispara un lote, devuelve
  `{summary, progress}`) y `GET /api/sync/status` (`last_sync_ts` + `backlog`,
  para rehidratar al montar).
- **Lo que sí:** los ocho estados del botón se derivan de datos reales —
  `last_sync_ts: null` ⇒ "nunca sincronizaste", `backlog !== null` ⇒ "a
  medias", 409 `sync_already_running`, 503 `gmail_not_configured`, 500 con el
  mensaje del server. El ciclo "una llamada = un lote, `complete:false` ⇒
  Seguir" está exactamente así en `sync-route.ts`.
- **Lo que falta:**
  - **"Detener"** (en P3 y en el estado *Corriendo* de C1): no hay cancelación.
    Un lote en vuelo se termina. Lo único que el cliente puede detener es el
    auto-encadenado.
  - **"Registro de lotes"** (la tabla que compara dos syncs seguidos): no se
    persiste ningún resumen por lote. `sync_progress` es una fila única con el
    backlog en curso, no un historial. Recargar la página lo borra.
  - **Barra `processed/total` durante el lote:** `advanceSyncProgress` escribe
    una vez por lote, al final. Mientras el lote corre no hay progreso que
    consultar; la barra sólo puede moverse entre lotes.
  - **`batch_size`:** existe en la tool MCP, no en la ruta HTTP (`runner()` se
    llama sin opciones).
- **Huecos:** H17, H18, H19.

### P4 — Movimientos · **PARCIAL**

- **Dónde vive:** ruta `/movimientos`. Se llega desde P2 o el menú; sale a P6
  ("Crear regla para este comercio", precargado), a P5 ("Resolver") y al cajón
  de chat con la fila como contexto.
- **Con qué se alimenta:** `GET /api/transactions` con `from`, `to`, `type`,
  `direction`, `counterparty`, `limit`, `offset`, `include_reversed`,
  `include_internal`, `include_discarded`.
- **Lo que sí:** la tabla entera. Las marcas (reverso, interna, en revisión,
  descartado) vienen como columnas de la fila y no se recalculan. `amount: null`
  ⇒ "Sin leer" y `0` ⇒ cifra: la distinción está en el dato, no en la UI.
- **Lo que falta:**
  - **Filtro por categoría** (está en la FilterBar dibujada): `queryTransactions`
    no tiene cláusula `category` y `transactionsQuerySchema` no lo acepta.
  - **"Mostrando 8 de N"** y el paginador: la respuesta trae
    `count: rows.length` — el tamaño de la página, no el total de coincidencias.
    Con eso no se puede saber si hay página siguiente.
  - **"Mandar a revisión"** (acción listada en `panel-manejo-flujo.md` §P4): no
    existe ningún camino que escriba `needs_review = 1` sobre una fila ya
    persistida. `updateTransactionFlags` sólo lo hace desde el pipeline.
  - **"Ver por qué"** de una fila descartada: el rastro existe
    (`review_resolutions`) y el motor sabe filtrar por transacción, pero la ruta
    HTTP no expone el filtro.
- **Huecos:** H20, H21, H24, y el "mandar a revisión" queda como H26 (se
  recomienda **no** construirlo — ver §4).

### P5 — Revisión · **PARCIAL**

- **Dónde vive:** ruta `/revision`. Se llega por el badge de P2, por el aviso
  persistente de P3, o desde una fila de P4.
- **Con qué se alimenta:** `GET /api/review`, `POST /api/review/:id/resolve`,
  `GET /api/review/resolutions`.
- **Lo que sí:** la cola, el conteo, las tres acciones (`confirm` / `correct` /
  `discard`), la traducción del error (`not_found` ⇒ 404, el resto 400), el
  rastro auditable con quién y cuándo, y el estado vacío. Todo eso está
  completo y testeado.
- **Lo que falta — y es el corazón de la pantalla:**
  - **El motivo por el que cayó cada fila.** `review_reason` existe en el
    resultado del parser (`amount_not_found`, `claude_amount_mismatch`,
    `ambiguous_reversal_match`, `ambiguous_retiro_group`, `invalid_ts`) y **se
    pierde en la escritura**: no hay columna en `transactions`, `insertTransaction`
    no la escribe, `GET /api/review` no la puede devolver. El diseño la muestra
    como chip en cada tarjeta y como estadística ("Motivo más común").
  - **"Lo que leyó Claude".** El monto de la verificación cruzada no se persiste
    en ningún lado. La comparación de dos columnas que define la ReviewCard no
    tiene de dónde salir.
  - **El correo original.** Sólo se guarda `raw_subject`. El cuerpo no, y con
    buen criterio: es dato personal.
- **Huecos:** H9, H10, H24.

### P6 — Categorías y reglas · **NO VIABLE**

- **Dónde vive:** ruta `/reglas`. Se llega desde P4 ("Crear regla", precargado
  con la contraparte) o desde el menú.
- **Con qué se alimentaría:** `listCategoryRules`, `upsertCategoryRule`,
  `topUncategorizedCounterparties`, `backfillCategories`,
  `reclassifyTransactions`, `healCounterparties`.
- **Por qué NO VIABLE:** igual que P1 — todas esas funciones existen y están
  testeadas, y **ninguna tiene ruta HTTP**. La pantalla completa depende de
  rutas nuevas.
- **Y aun con las rutas, faltan tres cosas en el motor:**
  - **"Matchea N filas"** (la columna de la tabla y el contador en vivo del
    editor, que es la defensa contra la trampa del patrón demasiado largo): no
    existe ninguna función que cuente cuántas filas del ledger matchea un
    patrón. Tiene que usar exactamente la normalización de `toRulePattern`; si
    no, el número miente y la pantalla queda peor que sin él.
  - **Borrar una regla:** `rules-repository.ts` sabe listar y hacer upsert. No
    hay `delete`, ni en el motor ni en MCP.
  - **"Se previsualizan antes de aplicar":** `backfillCategories` escribe. No
    hay modo dry-run.
  - **"Recuperar" una fila puntual:** `healCounterparties` toma `limit` (las N
    más caras), no una fila elegida.
- **Huecos:** H5, H6, H7, H8, H25.

### P7 — Chat · **VIABLE**

- **Dónde vive:** cajón lateral sobre cualquier pantalla, más ruta `/chat` para
  entrar directo. Recibe el contexto de origen (una fila, una tarjeta) y al
  cerrarse devuelve a donde estaba.
- **Con qué se alimenta:** `POST /api/chat/:conversationId?` por SSE —
  eventos `meta`, `text`, `tool`, `done`, `error`, documentados en
  `chat-route.ts` — más `GET /api/conversations` y `GET /api/conversations/:id`.
- **Verificado:** el 503 `claude_not_configured` sale antes de abrir el stream,
  así que el panel puede mostrarlo como "falta configurar" con link a P10 sin
  parsear medio SSE. El "Detener" del streaming funciona cortando la request: el
  route tiene `AbortController` cableado al `close`. El chip "Leído de
  `get_review_queue`" sale de los eventos `tool`. Todo existe.

### P8 — Estrategia · **PARCIAL**

- **Dónde vive:** ruta `/estrategia`. Se llega desde P2; sale a P9 y al chat con
  el plan como contexto.
- **Con qué se alimenta:** `GET /api/overview` (`card_status` da `saldoCorte`,
  `minimo`, `fechaMaxima`, `requeridoPorQuincena`, `aTiempo`,
  `saldoActualEstimado` — las cuatro tarjetas de arriba, exactas),
  `GET /api/strategy/projection?abono=` y `POST /api/debts/:id/paid`.
- **Lo que falta:**
  - **La lista de deudas.** Se puede marcar una deuda pagada por id, pero **no
    hay forma de listarlas**: no existe `GET /api/debts` ni una función de motor
    que devuelva las filas (`proyeccionSinDeuda` sólo suma). El panel no tiene de
    dónde sacar los ids que necesita para el botón que sí existe.
  - **"Vence"** en la tabla de deudas: la tabla `debts` tiene `person`,
    `amount`, `kind`, `status`, `note`. **No tiene fecha de vencimiento.**
  - **"Deshacer"** una deuda pagada: `markDebtPaid` sólo escribe `'paid'`.
  - **"Calendario de pagos":** `paydaysAfter` / `paydaysBetween` existen en
    `strategy/calendar.ts` y no están expuestos. Del calendario dibujado, sólo el
    corte y el vencimiento de tarjeta salen de `/api/overview`.
  - **"Simular" con tres perillas** (pago a la tarjeta, gasto mensual, aporte al
    colchón): la proyección acepta **un** parámetro, `abono`. Las otras dos
    variables no existen en el motor — y calcularlas en el cliente rompería la
    regla del panel.
- **Huecos:** H11, H12, H13.

### P9 — Ahorro y colchón · **PARCIAL**

- **Dónde vive:** ruta `/ahorro`. Se llega desde P2 o P8; sale al chat.
- **Con qué se alimenta:** `GET /api/overview` → `buffer_status` (objetivo,
  reservado, financiado, faltante) y `POST /api/buffer`.
- **Lo que sí:** el anillo del colchón entero, con su porcentaje y su estado. Y
  las "sugerencias de ahorro" como respuesta del chat, rotuladas como tal — el
  preview ya lo dice con todas las letras y es correcto: no existe
  `strategy/savings.ts`.
- **Lo que falta:**
  - **"Fijar objetivo".** Y esta es la trampa fina: `POST /api/buffer` escribe
    `savings.reserved`. El **objetivo** que muestra `colchonStatus` no sale de
    `savings.target` — sale de `strategy_config.colchonObjetivo`
    (`strategy/balance.ts`). O sea que el botón más visible de la pantalla
    escribe una columna que el motor **no lee**, y la clave que el motor sí lee
    sólo se puede escribir por MCP o CLI.
  - **"Registrar aporte".** El endpoint fija un valor absoluto; un aporte es una
    suma. Sumar en el cliente es aritmética de plata en la UI.
  - **"Metas"** y **"Histórico de aportes"**: las tablas `metas`,
    `metas_avance`, `flexiahorro` y `saldos` existen en el esquema y **ningún
    código las lee**. El preview ya lo declara.
- **Huecos:** H14, H15, H16.

### P10 — Configuración · **PARCIAL**

- **Dónde vive:** ruta `/configuracion`. Es el destino de todo error de
  configuración: cada 503 (`gmail_not_configured`, `claude_not_configured`)
  linkea acá.
- **Lo que sí (hoy, sin tocar el server):** el selector de backend, el modo
  demostración, "Probar conexión" contra `GET /api/health`, el bloque de
  publicación (fase 0/1/2) y el "lo que esta pantalla no hace". Todo eso es
  navegador y texto.
- **Lo que falta:**
  - **El checklist de conexiones** (Gmail conectado / Claude / base de datos /
    `WALLET_ACCESS_TOKEN`) y "Volver a correr el checklist": es
    `onboarding_status`, que no tiene ruta HTTP. Es el contenido principal de la
    pantalla.
  - **"Probar" Gmail** como acción propia: no hay endpoint que pruebe la
    credencial sin disparar un sync. El estado de Gmail sale del checklist.
  - **El estado de `WALLET_ACCESS_TOKEN`:** la variable no existe todavía (H1).
  - **La zona de riesgo — "Rehacer el ledger desde cero":** no hay endpoint, y
    **se recomienda que siga sin haberlo** (§4).
- **Huecos:** H2 (mismo que P1), H1, H26.

### P11 — Estado del sistema (opcional, fase 2)

No entra en la primera versión y el plan ya lo dice. Para el registro:
**NO VIABLE** hoy — `db/telemetry.ts` emite spans y métricas a stdout/stderr, y
no hay ningún endpoint que los devuelva. Necesitaría un colector, que es un
ticket propio.

---

## 2.b Componentes

### SyncButton (8 estados) · **PARCIAL**

Siete de los ocho estados se derivan de datos reales: *al día*, *atrasado* y
*nunca* de `last_sync_ts`; *a medias* de `backlog`; *otro lo está corriendo* del
409; *sin configurar* del 503; *falló* del 500. El octavo, **corriendo**, se
dibuja con barra `1 240 de 3 800` y **"Detener"**: el conteo sólo avanza entre
lotes (H18 explica por qué) y no hay cancelación. El "reintento 2 de 5" es
contador del cliente y está bien que lo sea. La rehidratación desde
`GET /api/sync/status` al montar: existe y funciona.

### ReviewCard · **NO VIABLE (tal como está diseñada)**

Es la pieza con el hueco más grande, y conviene decirlo sin rodeos: sus tres
elementos distintivos — **el motivo**, **la columna "lo que leyó Claude"** y
**el correo original** — no tienen respaldo persistido (H9, H10). Lo que sí se
puede construir hoy: contraparte, monto en el ledger (con "Sin leer" para
`null`), `raw_subject`, las tres acciones y el error del motor tal cual.

Las variantes del preview *"Motivo: monto no legible"* y *"Motivo: duplicado
sospechado"* dependen enteras de `review_reason`. Y las acciones alternativas
que propone la segunda (*"Son distintos"* / *"Es el mismo, descartar uno"*) no
son acciones nuevas del motor: se mapean a `confirm` y `discard`. Eso está bien
— pero requiere saber que la fila cayó por `ambiguous_reversal_match`, o sea,
otra vez `review_reason`.

### OverviewCard · **VIABLE**

Cifra + contexto + estado, sin cálculo propio. Los estados *cargando*, *sin
dato* ("Sin leer", con "Completar perfil" a P1) y *sin conexión* son de
cliente. El "0,00 se muestra como cifra" sale del dato. Nada que agregar.

### TransactionsTable · **PARCIAL**

Las columnas y las marcas están completas. Faltan tres cosas del pie y las
acciones: **"Mostrando 8 de N"** (no hay total, H20), **"Ver por qué"** de una
fila descartada (el filtro por transacción existe en el motor pero no en la
ruta, H24) y **"Recuperar"** una fila sin contraparte (el heal es por lote, no
por fila, H25).

### ChatPanel · **VIABLE**

Streaming, historial, contexto de origen, 503 con link a configuración,
"Detener" por corte de request. Todo cableado.

### FilterBar · **PARCIAL**

El componente declara que traduce "a los parámetros que ya acepta
`GET /api/transactions` — y nada más". El preview, sin embargo, dibuja cuatro
cosas que la API no acepta:

- **Categoría** (H21) — no existe el filtro.
- **Tipo multi-selección** (dos checkboxes marcados a la vez): el schema acepta
  **un** `type`, no una lista (H22).
- **"Interna" como opción de Dirección**: `direction` es `in` / `out`. Interna
  no es una dirección, es `include_internal` — pertenece a los toggles de abajo
  (H22).
- **Sugerencias de contraparte** ("Comercio A / Comercio B / sin contraparte"):
  no hay endpoint que liste contrapartes distintas (H23).
- **"Coinciden N movimientos · 1 en revisión"**: mismo total que falta en H20.

---

## 3. Los huecos, con su endpoint propuesto

Regla que ordena la tabla: **una ruta nueva valida, llama a una función que ya
existe y serializa** (misma disciplina que `api/routes.ts` y que la capa MCP).
Donde hace falta una función de motor nueva, se dice — y va en su módulo con su
propio test, nunca en la ruta.

| # | Hueco | Propuesta | Reutiliza | Tipo |
|---|---|---|---|---|
| H1 | No hay autenticación (P0, P10) | `WALLET_ACCESS_TOKEN` en `config.ts` + middleware `Authorization: Bearer` sobre `/api/*` salvo `/api/health`; con la variable vacía, sólo 127.0.0.1. Y `GET /api/health` pasa a devolver `{status, auth_required}` para que P0 sepa si la frase sirve o es decorativa | — | middleware + motor |
| H2 | Onboarding sin HTTP (P1, P10) | `GET /api/onboarding/status`, `GET /api/onboarding/suggestions`, `GET /api/onboarding/profile`, `POST /api/onboarding/profile` | `onboardStatus`, `buildSuggestions`, `getStrategyConfig`, `setStrategyConfig` | ruta |
| H3 | El paso "Cuentas" no corresponde a nada (P1) | Renombrar el paso a **Titular** en el diseño. Si se quiere la lista: `GET /api/accounts` (DISTINCT `account_holder`/`account`, ya enmascarado por el parser) | `suggestTitular` | diseño + ruta |
| H4 | El checklist dibujado ≠ los pasos del motor (P1, P10) | Ninguna ruta: el panel renderiza los `steps` que devuelva H2, sin lista escrita a mano | `onboardStatus` | diseño |
| H5 | Reglas sin HTTP (P6) | `GET /api/rules`, `POST /api/rules`, `DELETE /api/rules/:pattern`, `POST /api/rules/apply` (`{reclassify?}`), `GET /api/counterparties/uncategorized`, `POST /api/counterparties/heal` | `listCategoryRules`, `upsertCategoryRule`, `backfillCategories`, `reclassifyTransactions`, `topUncategorizedCounterparties`, `healCounterparties` | ruta |
| H6 | "Matchea N filas" no existe (P6, FilterBar) | `countMatchingTransactions(db, pattern)` en `category/`, con la normalización de `toRulePattern`; se sirve como `matches` en `GET /api/rules` y como `GET /api/rules/match-count?pattern=` para el contador en vivo | `toRulePattern` | motor + ruta |
| H7 | No se puede borrar una regla (P6) | `deleteCategoryRule(db, pattern)` en `rules-repository.ts` + `DELETE /api/rules/:pattern` | — | motor + ruta |
| H8 | "Se previsualizan antes de aplicar" (P6) | `backfillCategories(db, {dryRun})` que cuente sin escribir + `POST /api/rules/apply {dry_run:true}` | `backfillCategories` | motor + ruta |
| H9 | `review_reason` no se persiste (P5, ReviewCard) | Columna `review_reason TEXT` por `addColumnIfMissing`, escrita en `insertTransaction`, devuelta por `GET /api/review` | `insertTransaction` | motor + ruta |
| H10 | La lectura de Claude no se persiste (P5, ReviewCard) | Columna `claude_amount REAL` (sólo el número de la verificación cruzada, nada de texto del correo) escrita por el pipeline; `GET /api/review` devuelve `amount`, `claude_amount`, `review_reason`, `raw_subject`, `gmail_msg_id`. **El cuerpo del correo no se guarda**: el diseño cambia ese bloque por asunto + link a Gmail por `gmail_msg_id` | `ingest/pipeline.ts` | motor + ruta + diseño |
| H11 | No se pueden listar las deudas (P8) | `GET /api/debts` + `POST /api/debts/:id/unpaid` (o `PATCH /api/debts/:id {status}`) para el "Deshacer". La columna **"Vence"** necesita `due_date` en `debts` (migración aditiva) o sale del diseño | `getDebtById`, `markDebtPaid` | motor + ruta |
| H12 | Calendario de pagos no expuesto (P8, P2) | `GET /api/strategy/calendar?from=&to=` con cobros + corte/vencimiento de tarjeta (+ vencimientos de deuda si existe H11) | `paydaysBetween`, `tarjetaStatus` | ruta |
| H13 | "Simular" con tres perillas (P8) | v1: la simulación se limita a `abono`, que es lo que el motor sabe proyectar. Las otras dos variables son aritmética nueva ⇒ ticket aparte en `strategy/` con sus tests, nunca en la UI | `proyeccionSinDeuda` | diseño (+ motor, después) |
| H14 | "Fijar objetivo" escribe donde el motor no lee (P9) | El objetivo se escribe con `POST /api/onboarding/profile {colchonObjetivo}` (H2), que es el único escritor de `strategy_config`. `POST /api/buffer` se queda con `reserved` y su doc dice que el objetivo no va por ahí | `setStrategyConfig` | ruta + diseño |
| H15 | "Registrar aporte" es un incremento, la API es absoluta (P9) | `POST /api/buffer/contributions {amount}` que suma en el server y deja rastro; o, para la v1, se quita el botón y queda "fijar reservado". **La suma no se hace en el cliente** | `updateBufferReserved` | motor + ruta |
| H16 | `metas` / `flexiahorro` / `saldos` sin lector (P9) | `GET /api/savings/history` (flexiahorro + saldos) y `GET /api/goals` (metas + metas_avance), sólo lectura. Sin esto, los dos bloques quedan fuera de la v1 y la pantalla lo dice | — (queries nuevas) | motor + ruta |
| H17 | No hay historial de lotes de sync (P3) | Tabla `sync_runs` (`started_at`, `seen`, `new`, `needs_review`, `remaining`, `result`) escrita por `run-sync` + `GET /api/sync/runs?limit=`. Alternativa v1: el log vive en Pinia y el rótulo dice que se pierde al recargar | `run-sync.ts` | motor + ruta |
| H18 | No se puede detener un sync (P3, SyncButton) | `POST /api/sync/stop` que levante una bandera que el runner consulte entre correos (no aborta el correo en curso). Alternativa v1: "Detener" corta sólo el auto-encadenado y el rótulo lo dice — *"se detiene al terminar este lote"* | `run-sync.ts` | motor + ruta |
| H19 | `batch_size` no expuesto por HTTP (P3) | `POST /api/sync` acepta `{batch_size?}` validado con zod y lo pasa al runner — la tool MCP ya lo hace | `SyncRunner` | ruta |
| H20 | No hay total de coincidencias (P4, tabla, FilterBar) | `GET /api/transactions` devuelve `total` (COUNT con los mismos filtros) y `needs_review_in_range`, además del `count` de la página | `queryTransactions` | motor + ruta |
| H21 | No hay filtro por categoría (P4, FilterBar) | `category` en `TransactionsListFilter` y en `transactionsQuerySchema` (enum de `CATEGORIES` + `sin_categoria`) | `queryTransactions` | motor + ruta |
| H22 | Tipo multi-selección e "Interna" como dirección (FilterBar) | `type` repetible (array) en el schema, o el diseño baja a selección simple. "Interna" **sale** del selector de dirección y pasa al toggle `include_internal` | `queryTransactions` | ruta + diseño |
| H23 | No hay lista de contrapartes (FilterBar) | `GET /api/counterparties?q=&limit=` (DISTINCT con conteo) para el autocompletar | — (query nueva) | motor + ruta |
| H24 | `GET /api/review/resolutions` ignora los filtros (P5, tabla) | La ruta acepta `?transaction_id=` y `?limit=` — el motor ya los soporta, sólo hay que pasarlos | `listReviewResolutions` | ruta |
| H25 | "Recuperar" es por lote, no por fila (P6, tabla) | `healCounterparties` acepta `ids?: number[]` además de `limit`; `POST /api/counterparties/heal` lo pasa | `healCounterparties` | motor + ruta |
| H26 | Acciones que se recomienda **no** construir | "Mandar a revisión" desde P4 y "Rehacer el ledger desde cero" en la zona de riesgo de P10 — ver §4 | — | diseño |

---

## 4. Lo que se recomienda no construir

Dos elementos del diseño no deberían convertirse en endpoint, y es mejor
sacarlos de la pantalla que dejarlos dibujados sin respaldo:

1. **"Rehacer el ledger desde cero"** (zona de riesgo de P10). Un endpoint que
   borra el ledger, en una API que hoy no tiene autenticación (H1), es
   exactamente el botón que no hay que exponer: cualquiera que llegue al puerto
   lo puede pulsar con `curl`. Rehacer la base es una operación de terminal, en
   la máquina, con la base a la vista. La pantalla puede explicar **cómo** se
   hace; no debe poder hacerlo.

2. **"Mandar a revisión"** una fila ya persistida (P4). `needs_review` es una
   afirmación del pipeline sobre una discrepancia entre dos lecturas del correo,
   no una etiqueta que un humano pone a gusto. Ponerla a mano crea una fila en
   la cola sin las dos lecturas que la cola existe para comparar — y sin motivo
   (H9). Lo que el usuario quiere hacer ahí ("este monto está mal") ya tiene
   camino: la fila que **está** en la cola se corrige con `correct`, que deja
   rastro. Si aparece la necesidad real, es un ticket con su propia discusión.

Y una que no es "no construir" sino "no ahora": **el simulador multi-variable de
P8** (H13). Proyectar con gasto mensual y aporte al colchón como perillas es
aritmética financiera nueva. Va en `strategy/` con sus tests, en su ticket. Lo
que **no** puede pasar es que la línea punteada se dibuje con una cuenta hecha
en un `computed`.

---

## 5. Consecuencia para el orden de construcción

`panel-manejo-flujo.md` §9 pone "server primero: las rutas HTTP faltantes
(onboarding, reglas, ahorro) + `WALLET_ACCESS_TOKEN`". La auditoría confirma ese
orden y **agrega tres bloques de server que no estaban en la cuenta**:

- **La cola de revisión necesita trabajo de motor, no sólo de ruta** (H9, H10).
  Es la pantalla donde la invariante del proyecto se vuelve visible, y hoy la
  fila llega a la UI sin el dato que explica por qué está ahí.
- **Estrategia necesita `GET /api/debts`** (H11). Hay un botón que escribe por
  id y ninguna forma de conocer los ids.
- **La tabla de movimientos necesita `total` y filtro por categoría** (H20,
  H21), o el paginador y la FilterBar del diseño no se pueden armar.

Con eso, el bloque 3 del orden sugerido (**P2 + P3 + P5**, "el núcleo operativo
que ya reemplaza a la web actual") deja de ser gratis: P2 sí lo es, P3 llega con
"Detener" y el registro de lotes recortados, y P5 depende de H9/H10. **P2 y P7
son las dos únicas pantallas que se construyen hoy sin tocar el server.**

---

Ver también: `docs/panel-manejo-flujo.md` (el plan de producto),
`tasks/TASK-045.json` (el ticket), `docs/mcp.md` (las 14 tools),
`docs/onboarding.md` (por qué el onboarding es no interactivo),
`docs/frontend-desplegado.md` (por qué el sitio actual está en modo demo).
