# Panel de manejo (Vue 3) — flujo de pantallas

Plan de producto y arquitectura para un **panel de manejo** del wallet en
Vue 3. No es un dashboard de mirar: es una consola para **operar** las
habilidades del agente (sincronizar, revisar, categorizar, conversar,
planificar, ahorrar) desde botones, sin abrir una terminal.

Este documento **no implementa nada**. La web actual (`web/`, React) se
mantiene funcionando tal cual hasta que el panel la reemplace. Ver
`tasks/TASK-045.json` para el ticket de implementación.

---

## 1. Punto de partida honesto: qué existe y qué falta

Antes de dibujar pantallas conviene saber contra qué se dibujan. Lo que el
motor ya expone hoy:

**HTTP (`server/src/api/`, montado en `/api`)**

| Endpoint | Qué da |
|---|---|
| `GET /api/health` | vivo/no vivo |
| `GET /api/overview` | saldo, tarjeta, colchón, safe-to-spend, gasto por categoría, próximo pago, conteo de `needs_review` |
| `GET /api/transactions` | ledger con filtros (`from`, `to`, `type`, `direction`, `counterparty`, `limit`, `offset`, `include_*`) |
| `GET /api/review` | cola de revisión |
| `POST /api/review/:id/resolve` | resolver una fila de la cola |
| `GET /api/review/resolutions` | rastro auditable de quién resolvió qué |
| `GET /api/sync/status` | último sync + backlog a medias (no dispara nada) |
| `POST /api/sync` | dispara **un lote** del sync |
| `GET /api/brief` | resumen narrativo del día |
| `GET /api/strategy/projection` | proyección |
| `POST /api/debts/:id/paid` | marcar deuda pagada |
| `POST /api/buffer` | fijar el colchón |
| `GET /api/transfers` | resumen de transferencias |
| `POST /api/chat/:conversationId?` | chat en **streaming SSE** |
| `GET /api/conversations`, `GET /api/conversations/:id` | historial de chat |

**MCP (`server/src/mcp/server.ts`)** — 14 tools: `get_balance`,
`get_colchon_status`, `get_overview`, `query_transactions`,
`get_review_queue`, `resolve_review`, `get_spending_by_category`, `sync`,
`onboarding_status`, `suggest_profile`, `set_profile`, `set_rule`,
`apply_rules`, `heal_counterparties`.

### Lo que NO existe, y el panel necesita

Esto es la parte incómoda del plan, y va acá arriba a propósito:

1. **No hay API HTTP de configuración.** `onboarding_status`,
   `suggest_profile`, `set_profile`, `set_rule`, `apply_rules` y
   `heal_counterparties` viven **sólo** en MCP y en los CLIs. Un navegador no
   habla MCP por stdio. Las pantallas de *Alta/Perfil*, *Categorías y reglas*
   y *Configuración* **no se pueden construir sin agregar rutas HTTP nuevas**
   en `server/src/api/` que llamen a las mismas funciones de
   `server/src/onboard/` y `server/src/category/`. Es trabajo de server, no
   de panel, y es prerrequisito.
2. **No hay motor de "ahorro".** No existe `server/src/strategy/savings.ts`
   ni una tool de sugerencias de ahorro. Lo que sí existe: el **colchón**
   (`buffer_status` en `/api/overview`, `POST /api/buffer`), las tablas
   `flexiahorro`, `saldos` y `metas` en `server/src/db/schema.ts`, y el
   **chat**, que sí puede razonar sobre el ledger. La pantalla de Ahorro se
   arma con eso y se documenta como tal — no se inventa una habilidad que el
   agente no tiene.
3. **No hay usuarios ni autenticación.** Ninguna. Cero. Quien llegue al
   puerto lee el ledger completo, dispara lecturas de Gmail y gasta crédito
   de Claude. Ver `docs/frontend-desplegado.md` y el comentario de
   `WALLET_BIND_HOST` en `server/src/config.ts`. Esto define por completo la
   sección 6 (alta del usuario) y la 8 (despliegue).
4. **No hay canal de eventos del ledger.** El único stream del server es la
   respuesta del chat. Define la sección 7 (tiempo real).

**Regla del panel, heredada de la del MCP:** cero lógica financiera en la
capa de UI. Un componente pide, muestra y dispara. Si te encontrás calculando
un total en un `computed`, ese cálculo va en `server/src/strategy/` con su
propio test.

---

## 2. Stack y ubicación

- **Vue 3 + `<script setup>` + TypeScript + Vite**, workspace nuevo `panel/`
  al lado de `web/`. No se toca `web/`: convive hasta que el panel esté
  probado, y recién ahí se decide el retiro de la React.
- **Vue Router** para las pantallas, **Pinia** para tres stores chicos
  (`session`, `refresh`, `sync`). El resto de los datos se pide por pantalla:
  el dashboard React ya aprendió que compartir *cuándo* refrescar alcanza y
  compartir *el estado* no hace falta (ver el comentario de
  `web/src/lib/refresh.tsx`).
- **Tests con Vitest + `@vue/test-utils`**, junto al código
  (`Foo.vue` → `Foo.test.ts`), y hay que **agregar `panel/src/**/*.test.ts`
  al `include` de `vitest.config.ts`** — hoy no está y los tests no correrían.
- `panel/src/api/` se porta desde `web/src/api/` (`base.ts` resuelve el
  backend por `?api=`, `localStorage`, `VITE_API_BASE_URL` u origen propio;
  `demo/demoFetch.ts` sirve el modo demostración). Esa lógica ya está resuelta
  y probada: se traduce, no se rediseña.

---

## 3. Las pantallas

Once pantallas (`P0..P10`), más una duodécima planificada para fase 2. Para
cada una: propósito, componentes, habilidad del agente que consume, dato que
muestra, qué puede **hacer** Mato, **de dónde se llega y a dónde se va**, y si
se puede construir hoy.

La **ficha completa de cada pantalla y de cada componente** —con la navegación
clickeable del prototipo, los estados y los datos ficticios— está en
`docs/flujo-app-prototipo.md` §5 y §6. Acá va el plan de producto; allá, el
recorrido. El veredicto de viabilidad y sus huecos salen de
`docs/panel-viabilidad.md`.

### P0 — Acceso

- **Propósito:** poner un límite antes de que la API deje de estar en
  `127.0.0.1`. Un solo usuario, sin registro público.
- **El acceso es exclusivamente con Gmail.** Una sola acción en la pantalla:
  **Continuar con Google** (OAuth de Google). **No hay formulario manual de
  usuario y contraseña**, ni campo de frase de acceso. La identidad del panel
  es la misma cuenta de Gmail cuyos correos alimentan el ledger: una sola
  credencial, la que el usuario ya tiene y ya sabe revocar.
- **Componentes:** `AccessGate.vue`, `GoogleSignInButton.vue`.
- **Habilidad:** ninguna del agente. `GET /api/health` como sonda.
- **Muestra:** el botón de Google, qué autoriza esa cuenta, y —si aplica— que
  el modo demostración está activo.
- **Acciones:** una. *Continuar con Google*.
- **Navegación.** *Entra desde:* el arranque, cuando no hay sesión de Google;
  también desde P10 (*ver la pantalla de acceso*, rotulada decorativa) y desde
  el mapa de flujo. *Sale a:* **P2** con *Continuar con Google* — o a **P1** si
  el checklist de onboarding está incompleto.
- **Viabilidad: NO VIABLE (H1).** El server no autentica nada: no hay
  verificación de `id_token`, no hay sesión, no hay lista de cuentas
  permitidas. Se puede dibujar; como control de acceso, no tiene respaldo.
- **Honestidad:** en modo demo esta pantalla es decorativa y lo dice. Sólo
  tiene sentido real cuando el server valide la sesión (sección 6).

### P1 — Alta y perfil

- **Propósito:** el "alta manual del usuario de Mato". No es un registro: es
  cargar **el perfil financiero** que hoy se carga con `npm run onboard`.
- **Componentes:** `OnboardChecklist.vue` (pasos con estado),
  `ProfileForm.vue` (sueldo, día de pago, colchón objetivo, cuentas),
  `SuggestionCard.vue` (lo que el agente propuso, con *Aceptar* / *Editar*).
- **Habilidad:** `onboarding_status`, `suggest_profile`, `set_profile`
  — **requiere las rutas HTTP nuevas** (`GET /api/onboarding/status`,
  `POST /api/onboarding/suggest`, `POST /api/onboarding/profile`).
- **Muestra:** el checklist con lo que falta, y al lado la sugerencia leída
  del ledger real.
- **Acciones:** *Analizar mi historial*, *Guardar*, *Saltar por ahora*.
- **Lo que el análisis del historial produce — el Escenario 2 de Mato**
  (*"entro por primera vez ---> analiza 3-6 meses anteriores ---> crea patrón
  de gastos fijos ---> pregunta gastos particulares"*). Tres bloques, en este
  orden, y **nada se guarda hasta que Mato lo confirma**:
  1. **Sueldo y días de pago** — lo que `suggestSalary` ya lee hoy, con su
     mediana y su tamaño de muestra dicho en voz alta.
  2. **Patrón de gastos fijos** — lo que se repite mes a mes (servicio,
     suscripción, renta, cuota), con la mediana del monto y el día típico.
     Cada uno se confirma o se descarta: *"sí, es fijo"* / *"no, fue casual"*.
     **Esto no existe en el motor** (**H30**): hay que escribir
     `suggestRecurringExpenses` en `onboard/suggest.ts` con sus tests.
  3. **Los gastos particulares** — los que **no** se repiten y el motor no sabe
     qué son. La pantalla los cuenta y ofrece pasar a responderlos: es la cola
     de clasificación de P5 (**H27**, **H28**) con otro punto de entrada.
- **Dónde va lo que Mato confirma, y dónde no va:** los gastos fijos
  confirmados se guardan como **reglas de categoría** y alimentan el colchón
  sugerido. La **lista** de gastos fijos no se persiste en la v1 (**H31**):
  `strategy_config` valida con un esquema zod cerrado y no tiene esa clave, así
  que `setStrategyConfig` rechazaría el patch. Una tabla nueva es su propio
  ticket.
- **Cuando no hay historial que analizar** — el caso de todo usuario nuevo en
  el Modelo D, donde el filtro de Gmail actúa sobre lo que llega y el ledger
  arranca vacío: *Analizar mi historial* se dibuja **deshabilitado con su
  motivo**, la pantalla dice cuántos meses lleva acumulados
  (`mesesDeHistorial`, que el motor ya devuelve) y desde cuántos se activa el
  análisis. **El análisis no desaparece: se pospone.** Ver
  `docs/flujo-wargaming.md` R33.
- **Navegación.** *Entra desde:* P0 (checklist incompleto), P10 (*Completar
  perfil*), una `OverviewCard` en estado *sin leer* de P2, y el mapa de flujo.
  *Sale a:* **P2**, tanto con *Guardar* como con *Saltar por ahora* — **P1 no
  bloquea a nadie**.
- **Viabilidad: NO VIABLE (H2, H3, H4, H30, H31).** Las tres funciones que necesita
  existen y están testeadas, pero sólo se alcanzan por MCP o CLI: no hay una
  sola ruta HTTP de onboarding. Además el checklist se renderiza con **los
  pasos que devuelva el motor** (H4) y el paso dibujado como *"Cuentas"* se
  renombra a **Titular** (H3), que es lo que el motor realmente usa.
- **Invariante que se hereda del onboarding CLI:** **nunca escribir un valor
  que el usuario no confirmó.** La sugerencia se muestra deshabilitada hasta
  que Mato la acepta explícitamente. Sin defaults plausibles, sin comercios
  precargados, sin sueldo de ejemplo.

### P2 — Resumen

- **Propósito:** la pantalla de aterrizaje. Qué pasa hoy, en diez segundos.
- **Componentes:** `OverviewCards.vue` (saldo, safe-to-spend, próximo pago),
  `SyncStatusChip.vue`, `ReviewBadge.vue`, `SpendingChart.vue`,
  `BriefCard.vue`.
- **Habilidad:** `get_overview` / `get_balance` / `get_spending_by_category`
  vía `GET /api/overview` y `GET /api/brief`.
- **Muestra:** saldo y fecha del corte, safe-to-spend de hoy, colchón,
  tarjeta, gasto por categoría del mes, conteo de pendientes de revisión.
- **Acciones:** *Sincronizar ahora* (mismo botón que P3), *Ver los N
  pendientes* (lleva a P5), ***Decime qué son los M movimientos que no sé***
  (lleva a P5, pestaña *Sin clasificar* — la entrada del Escenario 1 desde el
  hogar), *Preguntarle al agente* (lleva a P7 con el contexto de la tarjeta que
  se tocó).
- **Dos contadores, no uno.** *N pendientes* (monto sin confirmar) y *M sin
  clasificar* (no se sabe qué son) se muestran **por separado**: son dos
  preguntas distintas y mezclarlas haría que responder una parezca haber
  respondido la otra. El primero sale de `counts.needs_review`, que ya existe;
  **el segundo no existe todavía** y se sirve con **H27**.
- **Navegación.** *Entra desde:* P0, P1, el ítem *Resumen* de la barra, y toda
  vuelta de un flujo (P5 con la cola vacía, P6 tras aplicar reglas, P9 tras
  fijar el objetivo). *Sale a:* **P3** (chip de sync), **P5** (badge de
  pendientes), **P4** (tarjeta de saldo y barras del gráfico de categorías),
  **P8** (tarjeta de la tarjeta de crédito), **P9** (tarjeta de colchón),
  **P1** (*Completar perfil* desde una tarjeta sin dato) y al cajón de chat.
- **Viabilidad: VIABLE salvo el contador nuevo (H27).** Cada elemento del
  diseño original se verificó contra un campo real de `/api/overview`. El
  contador *"M sin clasificar"* que agrega el Escenario 1 es el único elemento
  de esta pantalla sin respaldo: mientras H27 no exista, **no se dibuja** —ni
  con un número inventado ni deshabilitado con cara de dato— y el Escenario 1
  se entra desde el aviso posterior al sync o desde P4.
- **Detalle que importa:** `amount: null` se muestra como "sin leer", no como
  cero. Cero es un monto válido; lo desconocido es otra cosa.

### P3 — Sincronización

- **Propósito:** operar el sync y entender en qué estado está el buzón.
- **Componentes:** `SyncPanel.vue`, `SyncProgressBar.vue`,
  `FreshnessLabel.vue`, `SyncLog.vue` (últimos resultados).
- **Habilidad:** `sync` vía `POST /api/sync`, más `GET /api/sync/status`.
- **Muestra:** último sync (`last_sync_ts`, o **"nunca sincronizaste"** si
  viene `null` — no una fecha inventada), backlog a medias
  (`processed / total / remaining`), y el resumen del último lote.
- **Acciones:** *Sincronizar*, *Seguir* (cuando quedó backlog), *Detener*.
- **Navegación.** *Entra desde:* el chip de sync de la barra (presente en toda
  pantalla), el estado vacío de P2, el estado sin ledger de P4, y el menú `[≡]`.
  *Sale a:* **P5** cuando el lote deja filas en la cola (*Revisarlos ahora*) y
  **P10** cuando el server responde 503 `gmail_not_configured`.
- **Viabilidad: PARCIAL (H17, H18, H19).** El ciclo entero y los ocho estados
  del botón salen de datos reales. Falta cancelación (**H18**: *Detener* corta
  sólo el auto-encadenado del cliente, y la barra avanza **entre lotes**, no de
  forma continua), historial de lotes persistido (**H17**: `SyncLog` vive en
  memoria y se pierde al recargar) y `batch_size` por HTTP (**H19**).
- Flujo completo en la sección 5.

### P4 — Movimientos

- **Propósito:** el ledger navegable.
- **Componentes:** `TransactionsTable.vue`, `FilterBar.vue`,
  `TransactionDrawer.vue` (detalle de una fila), `Paginator.vue`.
- **Habilidad:** `query_transactions` vía `GET /api/transactions`.
- **Muestra:** fecha, contraparte, monto, tipo, dirección, categoría, y las
  marcas de `needs_review` / reverso / transferencia interna.
- **Acciones:** filtrar por rango, tipo, dirección y contraparte; mostrar u
  ocultar reversados/internos/descartados; ***¿Qué es esto?*** en una fila sin
  clasificar (responde la categoría sin salir del detalle — la segunda puerta
  del Escenario 1, mismo escritor que la cola de P5, **H28**); *Crear regla
  para este comercio* (abre P6 precargado); *Preguntar sobre este movimiento*
  (abre P7 con la fila como contexto); *Resolver* en una fila marcada en
  revisión (lleva a P5).
- **Navegación.** *Entra desde:* la tarjeta de saldo de P2, una barra del
  gráfico de categorías (con el filtro puesto), el ítem *Movimientos* de la
  barra, y el cierre del cajón de chat (que devuelve al **mismo scroll y los
  mismos filtros**). *Sale a:* **P6** (crear regla, precargado), **P5**
  (resolver una fila), **P3** (estado sin ledger) y al cajón de chat.
- **Viabilidad: PARCIAL (H20, H21, H24, H28).** La tabla y sus marcas son
  viables hoy: vienen como columnas de la fila y no se recalculan. Faltan el
  **total** de coincidencias —sin él no hay *"Mostrando 8 de N"* ni paginador
  (**H20**)—, el **filtro por categoría** (**H21**), el *"Ver por qué"* de una
  fila descartada (**H24**) y el escritor de *"¿Qué es esto?"* (**H28**).
- **Cuidado con H21, y vale para toda la pantalla:** el filtro por categoría
  **no puede ser una cláusula sobre la columna `category`**. El gráfico del
  Resumen recalcula con `categorize()`, así que tocar una barra y caer acá con
  un filtro sobre la columna devolvería **un conjunto distinto del que la barra
  contó**. Se filtra por la categoría recalculada, igual que
  `spendingByCategory`.
- **Acción que se saca del diseño:** *Mandar a revisión* (**H26**). `needs_review`
  es una afirmación del pipeline sobre una discrepancia entre dos lecturas del
  correo, no una etiqueta que un humano pone a gusto; ponerla a mano crea una
  fila en la cola sin las dos lecturas que la cola existe para comparar. Lo que
  el usuario quiere hacer ahí ya tiene camino: `correct` sobre la fila que
  **sí** está en la cola, que deja rastro auditable.

### P5 — Revisión

- **Propósito:** vaciar la cola de lo que el agente no pudo afirmar. Es el
  lugar donde la invariante del monto se hace visible: si el parser y Claude
  no coincidieron, la fila cayó acá y **está fuera de todos los totales**.
- **Componentes:** `ReviewQueue.vue`, `ReviewCard.vue` (el correo, lo que
  leyó el parser, lo que leyó Claude, la discrepancia),
  `ResolveActions.vue`, `ResolutionsLog.vue`.
- **Habilidad:** `get_review_queue` / `resolve_review` vía `GET /api/review`,
  `POST /api/review/:id/resolve`, `GET /api/review/resolutions`.
- **Muestra:** cuántas hay, por qué cayó cada una, y el rastro de las ya
  resueltas (quién, cuándo, con qué monto).
- **Acciones:** *Confirmar monto*, *Corregir monto*, *Descartar*, con nota
  opcional. El error del motor se traduce tal cual: `not_found` es 404, el
  resto son 400 y se muestran como "el motor rechazó esto, y por qué".
- **Dos colas, dos preguntas — el Escenario 1 de Mato.** La pantalla tiene
  **dos pestañas**, y no son dos vistas de lo mismo:

  | Pestaña | Población | Qué se pregunta | Qué se responde |
  |---|---|---|---|
  | **Sin confirmar el monto** | `needs_review = 1` (hoy 4 filas) | *"no pude leer cuánto fue"* | un **monto** |
  | **Sin clasificar** | categoría **recalculada** `otros` o `transferencia_persona` (hoy ~206 filas) | *"no sé qué es esto"* | una **categoría** |

  La primera está fuera de todos los totales; la segunda ya suma en el saldo y
  lo único que falta es saber qué es. Una fila puede estar en las dos, y
  entonces **se pregunta el monto primero**: sin monto afirmado la fila no
  entra a ningún total, así que su categoría no movería ningún gráfico.
- **Cómo se guarda la respuesta de categoría, y por qué así.** Se escribe una
  **regla** sobre la contraparte normalizada (`upsertCategoryRule` vía
  `toRulePattern`), **no** la columna `category` de la fila. El motivo es
  verificable: `spendingByCategory` **ignora la columna** y recalcula con
  `categorize()` + `category_rules` (`strategy/spending.ts`). Pintar la fila
  dejaría el gráfico del Resumen exactamente igual — que es justo el error que
  ya costó una ronda entera de trabajo en este proyecto. Cuando la contraparte
  tiene más movimientos, la pantalla lo dice y ofrece aplicar la respuesta a
  todos: *"hay 6 más de <Persona 1>, ¿son todos salud?"*.
- **Los tres lugares donde Mato puede responder** ("en alguna parte", como lo
  puso él) — tres puertas, **un solo escritor**: esta cola, el detalle de un
  movimiento en P4, y el chat, que **propone y navega** sin escribir.
- **`resolveReview` no se toca.** Sus tres acciones son sobre el monto y dejan
  rastro auditable; la categoría es otra pregunta con otra población y otro
  escritor. Meterla como cuarta acción mezclaría el rastro de montos con una
  preferencia de clasificación.
- **Navegación.** *Entra desde:* el badge de pendientes de P2, el aviso
  persistente que deja un sync con filas en la cola (P3), una fila en revisión
  de P4, y el ítem *Revisión (N)* de la barra. *Sale a:* **P2** al vaciar la
  cola —y el total de P2 tiene que verse cambiado, ése es el punto de la
  pantalla— y al cajón de chat.
- **Viabilidad: PARCIAL (H9, H10, H24, H27, H28, H29), y el hueco es el corazón
  de la pantalla.** La pestaña *Sin clasificar* **no tiene endpoint** (**H27**:
  no hay ninguna función que liste las filas cuya categoría *recalculada* es
  `otros`/`transferencia_persona`; `topUncategorizedCounterparties` agrupa por
  contraparte y filtra la **columna**, así que las transferencias a
  desconocidos se le escapan) y **la respuesta no tiene escritor** (**H28**).
  La excepción por fila queda **fuera de la v1** (**H29**). La cola, el conteo, las tres acciones, la traducción del error y
  el rastro auditable están completos y testeados. Pero **el motivo por el que
  cayó cada fila no se persiste** (**H9**: `review_reason` se calcula en
  `ingest/pipeline.ts` y se pierde) y **el monto que leyó Claude tampoco**
  (**H10**), así que la comparación de dos lecturas que define la `ReviewCard`
  no tiene hoy de dónde salir. **H24**: las resoluciones no se pueden filtrar
  por transacción desde la ruta.
- **Lo que no se guarda, a propósito:** el cuerpo del correo. Sólo queda
  `raw_subject`; el resto es dato personal. El diseño lo reemplaza por asunto +
  enlace a Gmail por `gmail_msg_id`.
- **Detalle de diseño:** la cola vacía se celebra explícitamente ("nada
  pendiente"), porque es el estado normal y hay que poder confiar en él.

### P6 — Categorías y reglas

- **Propósito:** enseñarle al agente cómo clasificar.
- **Componentes:** `RulesTable.vue`, `RuleEditor.vue`,
  `UncategorizedList.vue`, `ApplyRulesButton.vue`.
- **Habilidad:** `set_rule`, `apply_rules`, `heal_counterparties`
  — **requiere rutas HTTP nuevas** (`GET/POST /api/rules`,
  `POST /api/rules/apply`, `POST /api/counterparties/heal`).
- **Muestra:** las reglas vigentes, cuántas filas matchea cada una, y las
  filas sin categoría o sin contraparte.
- **Acciones:** *Crear regla*, *Editar*, *Borrar*, *Ver las N que matchea*,
  *Aplicar reglas al historial* (con previsualización antes de escribir),
  *Recuperar comercios faltantes*.
- **Navegación.** *Entra desde:* una fila sin categoría de P4 (*Crear regla
  para este comercio*, con el patrón precargado con la contraparte real), una
  propuesta del chat (*Revisar y crear*), y el menú `[≡]`. *Sale a:* **P2**,
  donde el gasto por categoría tiene que reflejar la regla recién aplicada.
- **Viabilidad: NO VIABLE (H5, H6, H7, H8, H25).** Todas las funciones existen
  y están testeadas, y **ninguna tiene ruta HTTP** (**H5**). Y aun con las
  rutas: no existe la función que cuenta cuántas filas matchea un patrón
  (**H6**), no se puede borrar una regla (**H7**), `backfillCategories` no
  tiene modo dry-run, así que la previsualización no existe (**H8**), y
  *Recuperar* es por lote, no por fila elegida (**H25**).
- **P6 es el editor; P5 y P4 son el atajo.** Responder *"¿qué es esto?"* desde
  la cola de clasificación o desde el detalle de una fila escribe **la misma
  regla** que se escribiría acá a mano, con el patrón ya normalizado a partir
  de la contraparte real. P6 sigue siendo el único lugar donde se ve la lista
  completa, se edita un patrón y se borra una regla.
- **Trampa conocida, documentada en memoria del proyecto:** un patrón de
  regla **más largo que la contraparte real nunca matchea**. El editor tiene
  que mostrar en vivo cuántas filas matchea el patrón que se está escribiendo
  — antes de guardarlo, no después.
- **Corrección verificada contra el código, y es la que habilita el Escenario
  1:** circulaba en las notas del proyecto que `categorize()` "corta" en
  `type = 'transferencia'` y que por eso ninguna regla podía reclasificar una
  transferencia. **Ya no es cierto:** el branch de `transferencia` consulta
  `matchEstablishment` **antes** de caer en `transferencia_persona`
  (`category/categorize.ts:169-176`), con el motivo escrito ahí mismo — donde
  el comercio cobra por transferencia inmediata, la clínica y el restaurante
  llegan con `type: 'transferencia'`. Que una regla sobre el nombre de un
  desconocido **sí** matchee es lo que hace que responder *"¿qué es esto?"*
  sirva para algo. Lo que sigue siendo cierto es lo otro: `spendingByCategory`
  no lee la columna `category`, la recalcula — y por eso la respuesta se guarda
  como regla y no como etiqueta de la fila.

### P7 — Chat

- **Propósito:** preguntarle al agente cualquier cosa sobre el historial.
- **Componentes:** `ChatPanel.vue`, `MessageList.vue`, `Composer.vue`,
  `ConversationList.vue`, `ContextChip.vue` (el movimiento o la tarjeta desde
  la que se llegó).
- **Habilidad:** el chat, vía `POST /api/chat/:conversationId?` — **el único
  endpoint que ya habla SSE**. Historial con `GET /api/conversations` y
  `GET /api/conversations/:id`.
- **Muestra:** la conversación en curso con streaming por bloques, y la lista
  de conversaciones anteriores.
- **Acciones:** escribir, *Nueva conversación*, *Retomar*, y atajos
  ("¿en qué se me fue la plata este mes?", "¿llego al pago de la tarjeta?").
- **Navegación.** *Entra desde:* **cualquier pantalla** — el ícono de chat de
  la barra, la `BriefCard` de P2, una fila de P4, el plan de P8, el colchón de
  P9 — siempre arrastrando el contexto de origen. La ruta `/chat` existe para
  entrar directo al historial. *Sale a:* **P6** cuando una propuesta se acepta
  (*Revisar y crear*, con el editor precargado), **P10** ante un 503, y al
  cerrarse **devuelve a la pantalla de origen, mismo scroll y mismos filtros**.
- **La regla que lo gobierna:** el agente **propone, no ejecuta**. Toda acción
  sugerida en el chat lleva a la pantalla donde esa acción se confirma, con los
  campos precargados. Es la invariante del onboarding —nunca escribir un valor
  que el usuario no confirmó— aplicada al chat.
- **Viabilidad: VIABLE, sin huecos.** Streaming, historial, contexto de origen,
  503 antes de abrir el stream, *Detener* por corte de request
  (`AbortController` cableado al `close`) y chips de tool desde los eventos
  `tool`: todo existe y está cableado.
- **Nota:** si falta la credencial de Claude, el server responde 503 igual que
  el sync responde `gmail_not_configured`. El panel muestra eso como
  "falta configurar", con link a P10, no como un error rojo genérico.

### P8 — Estrategia

- **Propósito:** el plan: deudas, tarjeta, calendario, proyección.
- **Componentes:** `StrategyCards.vue`, `DebtList.vue`, `PayCalendar.vue`,
  `ProjectionChart.vue`.
- **Habilidad:** `GET /api/strategy/projection`, `GET /api/overview`
  (`card_status`, `next_payday`), `POST /api/debts/:id/paid`.
- **Muestra:** saldo de corte, mínimo, fecha máxima, requerido por quincena,
  si va a tiempo; deudas y su vencimiento; la proyección.
- **Acciones:** *Marcar deuda pagada*, *Simular* (cambiar un supuesto y ver
  la proyección; **sin escribir nada** hasta confirmar), *Ver el colchón*,
  *Preguntarle al agente sobre este plan* (a P7).
- **Navegación.** *Entra desde:* la tarjeta de la tarjeta de crédito en P2 y el
  ítem *Estrategia* de la barra. *Sale a:* **P9** (*Ver el colchón*) y al cajón
  de chat con el plan como contexto.
- **Simular ≠ guardar.** La perilla es un control continuo sin confirmación y
  rotulado *"simulación, no se guarda"*; *Marcar deuda pagada* es un botón con
  confirmación porque escribe. La pantalla tiene que hacer evidente cuál es
  cuál.
- **Viabilidad: PARCIAL (H11, H12, H13).** Las cuatro tarjetas de arriba salen
  exactas de `card_status`. Pero **no hay forma de listar las deudas**
  (**H11**: se puede marcar una pagada por id y no hay de dónde sacar los ids;
  la tabla `debts` tampoco tiene fecha de vencimiento, ni existe *Deshacer*),
  el **calendario de pagos** no está expuesto (**H12**: sólo el corte y el
  vencimiento de tarjeta son reales) y el **simulador** dibuja tres perillas
  cuando la proyección acepta una, `abono` (**H13**). Las otras dos serían
  aritmética financiera nueva: van en `strategy/` con sus tests, en su propio
  ticket — **nunca en un `computed` del cliente**.

### P9 — Ahorro y colchón

- **Propósito:** lo que se guarda, y cuánto falta para el objetivo.
- **Componentes:** `BufferCard.vue`, `BufferEditor.vue`, `GoalsList.vue`,
  `SavingsHistory.vue`.
- **Habilidad:** `get_colchon_status` vía `GET /api/overview`
  (`buffer_status`: objetivo, reservado, financiado, faltante) y
  `POST /api/buffer`. El histórico sale de las tablas `flexiahorro` /
  `saldos` / `metas` — **hoy sin endpoint**, así que necesita ruta nueva o
  queda fuera de la primera versión.
- **Muestra:** objetivo vs. reservado, faltante, si está financiado, y las
  metas cargadas.
- **Acciones:** *Fijar objetivo de colchón*, *Registrar aporte*, *Pedirle
  sugerencias de ahorro al agente*.
- **Navegación.** *Entra desde:* la tarjeta de colchón de P2, el *Ver el
  colchón* de P8, y el ítem *Ahorro* de la barra. *Sale a:* **P2**, que tiene
  que mostrar el colchón ya actualizado —el impacto del ajuste **tiene que
  verse**, ajustar sin ver el impacto es un formulario, no una herramienta— y
  al cajón de chat para las sugerencias.
- **Viabilidad: PARCIAL (H14, H15, H16).** El anillo entero, con su porcentaje
  y su estado, es viable hoy. La trampa fina es **H14**: `POST /api/buffer`
  escribe `savings.reserved`, pero **el objetivo que el motor lee sale de
  `strategy_config.colchonObjetivo`** — o sea que el botón más visible de la
  pantalla escribiría una columna que el motor no lee. El objetivo tiene que
  ir por la ruta de perfil, y la pantalla lo dice: *"esto cambia tu perfil"*.
  **H15**: *Registrar aporte* es un incremento y el endpoint fija un valor
  absoluto; **la suma la hace el server, no el cliente**. **H16**: `metas`,
  `metas_avance`, `flexiahorro` y `saldos` existen en el esquema y ningún
  código las lee.
- **Honestidad de producto:** las "sugerencias de ahorro" **son el chat con
  un prompt específico**, no un motor propio. Se muestran como respuesta del
  agente, no como un número calculado por el sistema. El día que exista un
  motor de ahorro con sus tests, esta pantalla lo consume y el rótulo cambia.

### P10 — Configuración

- **Propósito:** el estado de las conexiones y las llaves.
- **Componentes:** `ConnectionStatus.vue` (Gmail, Claude, base de datos),
  `BackendPicker.vue`, `OnboardingSteps.vue`, `DangerZone.vue`.
- **Habilidad:** `onboarding_status` (ruta HTTP nueva) + `GET /api/health`.
- **Muestra:** qué falta configurar y qué acción resuelve cada faltante; a
  qué backend apunta este navegador; si está en modo demo.
- **Acciones:** cambiar backend, activar/desactivar demo, volver a correr el
  checklist, ver instrucciones de `npm run gmail-auth`.
- **Navegación.** *Entra desde:* el engranaje de la barra y **todo 503 del
  server**, desde donde haya ocurrido (P3 con `gmail_not_configured`, el cajón
  de chat con `claude_not_configured`). *Sale a:* **P1** (*Completar perfil*) y
  **P0** (ver la pantalla de acceso, rotulada decorativa).
- **Viabilidad: PARCIAL (H1, H2).** Lo que vive en el navegador —selector de
  backend, modo demo, *Probar conexión* contra `GET /api/health`, el bloque de
  publicación y los textos— se construye hoy. Falta el **checklist de
  conexiones**, que es `onboarding_status` sin ruta HTTP (**H2**) y es el
  contenido principal de la pantalla, y el **estado de la sesión de acceso**,
  que todavía no existe (**H1**). No hay endpoint que pruebe la credencial de
  Gmail sin disparar un sync: ese estado sale del checklist.
- **Lo que NO hace:** no muestra ni edita credenciales. Los tokens viven en
  `.env` en la máquina de Mato y ahí se quedan.
- **Zona de riesgo sin botón (H26):** *Rehacer el ledger desde cero* **no se
  construye**. Un endpoint que borra el ledger, en una API que hoy no tiene
  autenticación, es exactamente el botón que no hay que exponer: cualquiera que
  llegue al puerto lo pulsa con `curl`. La pantalla explica **cómo** se hace
  desde la terminal; no debe poder hacerlo.

### P11 — Estado del sistema (opcional, fase 2)

Salud del pipeline: última corrida, errores recientes, métricas de
`db/telemetry.ts`. Sólo claves, conteos e ids — **nunca valores personales**.
Se lista para que quede planificado, no para la primera versión.

- **Navegación.** No tiene: no está en la barra, no es tarjeta del design
  system y **no entra en el prototipo**.
- **Viabilidad: NO VIABLE.** La telemetría se emite a stdout/stderr y no hay
  endpoint que la devuelva. Necesitaría un colector, que es un ticket propio.

---

## 3.b Los componentes compartidos

Seis componentes se repiten entre pantallas. Un componente no tiene navegación
propia: **hereda la de la pantalla donde vive**. Su ficha completa —estados,
interacción clickeable, viabilidad y datos ficticios— está en
`docs/flujo-app-prototipo.md` §6.

| Componente | Vive en | Qué es | Viabilidad |
|---|---|---|---|
| **C1 SyncButton** | P2 (chip en la barra), P3 (control principal), P10 (estado de Gmail) | los **8 estados** del sync: al día, atrasado, nunca, a medias, corriendo, otro lo corre (409), sin configurar (503), falló (500) | **PARCIAL** — H17, H18, H19 |
| **C2 ReviewCard** | P5 (la cola), P4 (drawer de una fila en revisión) | una fila que el motor no pudo afirmar, con sus tres acciones | **NO VIABLE** tal como está diseñada — H9, H10 |
| **C3 OverviewCard** | P2 (rejilla de 6), P8 (4 tarjetas), P9 (anillo del colchón) | cifra + contexto + estado, **sin cálculo propio** | **VIABLE** |
| **C4 TransactionsTable** | P4 (completa), P6 (miniatura de lo que matchea una regla) | el ledger con sus marcas por fila | **PARCIAL** — H20, H24, H25 |
| **C5 ChatPanel** | P7 (ruta propia) y cajón sobre P2, P4, P5, P8, P9 | el agente: streaming, contexto de origen, propuestas | **VIABLE** |
| **C6 FilterBar** | P4 (encabezado), P6 (filtrar sin-categoría) | traduce a los parámetros de `GET /api/transactions` **y nada más** | **PARCIAL** — H20, H21, H22, H23 |

Los seis, más las once páginas, más Fundamentos y el mapa de flujo, son las
**19 tarjetas** del design system *Agentic Wallet Panel — Design System*
(`d509acfb-b4ad-480d-aa67-1b09b16a13c2`). El **mapa de flujo**
(`pf-mapa-de-flujo.html`) es el índice navegable del prototipo: cada nodo abre
la tarjeta de esa pantalla.

---

## 4. Navegación

```
                    ┌──────────────────┐
                    │  P0 Acceso       │  (sólo si no hay sesión de Google)
                    │  [Continuar con  │
                    │      Google]     │
                    └────────┬─────────┘
                             │  sesión ok / modo demo
                             ▼
                 ¿onboarding completo?
                    │                 │
                 no │                 │ sí
                    ▼                 ▼
            ┌──────────────┐   ┌──────────────┐
            │ P1 Alta y    │──▶│ P2 Resumen   │◀── inicio de toda sesión
            │    perfil    │   └──┬───┬───┬───┘
            └──────────────┘      │   │   │
                                  │   │   └────────────┐
                       ┌──────────┘   └──────┐         │
                       ▼                     ▼         ▼
                ┌─────────────┐      ┌─────────────┐  ┌─────────────┐
                │ P3 Sync     │─────▶│ P5 Revisión │  │ P8 Estrategia│
                └─────────────┘ hay  └──────┬──────┘  └──────┬──────┘
                       │       pendientes   │                │
                       ▼                    │                ▼
                ┌─────────────┐             │         ┌─────────────┐
                │ P4 Movim.   │◀────────────┘         │ P9 Ahorro   │
                └──────┬──────┘                       └──────┬──────┘
                       │ "crear regla"                       │
                       ▼                                     │
                ┌─────────────┐                              │
                │ P6 Reglas   │                              │
                └─────────────┘                              │
                       │                                     │
                       └──────────┬──────────────────────────┘
                                  ▼
                          ┌─────────────┐        ┌─────────────┐
                          │ P7 Chat     │        │ P10 Config  │
                          └─────────────┘        └─────────────┘
                       (accesible desde cualquier pantalla,
                        arrastrando el contexto de origen)
```

Reglas de navegación:

- **P2 es el hogar.** Toda sesión abre ahí (salvo que falte el onboarding).
- **P7 (chat) es un cajón lateral, no un destino.** Se abre encima de
  cualquier pantalla y recibe el contexto de donde se abrió (un movimiento,
  una tarjeta de estrategia). Cerrarlo devuelve a donde estabas.
- **P5 se alcanza de dos formas:** por el badge de pendientes en P2, o
  automáticamente al terminar un sync que dejó filas en la cola (sección 6).
- **P10 es el destino de todo error de configuración**: cada 503 del server
  (`gmail_not_configured`, credencial de Claude ausente) linkea ahí.

---

## 5. El botón de sync, en detalle

Es la operación más visible del panel y la que más puede confundir, porque
**una llamada drena un lote, no el buzón entero**
(`server/src/sync/run-sync.ts`). Un primer sync sobre años de correo son
miles de mensajes y no entra en una request.

### Estados del botón

| Estado | Se ve | Se llega ahí |
|---|---|---|
| **Al día** | verde, "sincronizado hace X" | `last_sync_ts` reciente y sin backlog |
| **Atrasado** | ámbar, "última vez hace X" | `last_sync_ts` viejo respecto del umbral de frescura |
| **Nunca** | neutro, "nunca sincronizaste" | `last_sync_ts` es `null` — **no** se muestra una fecha inventada |
| **A medias** | ámbar con barra, "quedaron N por procesar" | `backlog` no es `null` |
| **Corriendo** | spinner + barra `processed/total`, botón deshabilitado | `POST /api/sync` en vuelo |
| **Otro lo está corriendo** | aviso, sin error rojo | 409 `sync_already_running` |
| **Sin configurar** | link a P10 | 503 `gmail_not_configured` |
| **Falló** | rojo, con el mensaje del server y *Reintentar* | 500 |

### El ciclo

1. Mato pulsa **Sincronizar**. El botón se bloquea y aparece la barra.
2. `POST /api/sync` → responde `{ summary, progress }`.
3. Si `progress.complete === false`, el panel **no** finge que terminó:
   muestra "procesados N de M" y ofrece **Seguir**. Se puede encadenar
   automáticamente (auto-continuar hasta terminar, con un *Detener* siempre
   visible) — con tope de reintentos, para que un buzón enorme no se convierta
   en un bucle infinito de requests sin supervisión.
4. Al completar un lote, se dispara un refresco inmediato de todo el panel:
   los datos recién escritos tienen que verse sin esperar el próximo tick.
5. **Si el lote dejó filas en `needs_review`**, aparece un aviso persistente
   ("N movimientos necesitan tu confirmación") con acción directa a **P5**.
   No es un toast que se desvanece: es una tarea pendiente y se comporta como
   tal hasta que la cola quede vacía.
6. El resultado del lote se anota en `SyncLog.vue` (correos vistos, nuevos,
   a revisión) para que dos syncs seguidos se puedan comparar.

El estado del sync es de la **sesión, no de la pestaña**: se guarda en el
store de Pinia y se rehidrata de `GET /api/sync/status` al montar, así que
recargar la página en medio de un backlog muestra el backlog, no un estado
limpio falso.

---

## 6. Alta manual del usuario de Mato

Un solo usuario. Sin registro público. Sin tabla de usuarios. Hay **dos
cosas distintas** que la palabra "alta" mezcla, y separarlas es lo que hace
que esto sea simple:

### (a) Acceso — quién puede hablarle a la API

Hoy: **nadie está autenticado y todos pueden todo**. La decisión de diseño
(confirmada por Mato) es que **el acceso al panel es login con Gmail y sólo
eso**:

- P0 muestra **un botón: *Continuar con Google***. Sin usuario, sin
  contraseña, sin frase de acceso, sin campo de backend a la vista.
- La cuenta que abre el panel es **la misma cuenta de Gmail cuyos correos
  alimentan el ledger**. No hay una segunda identidad que administrar: el
  "alta manual" es autorizar esa cuenta una vez.
- Se revoca desde la cuenta de Google, no desde el panel. Eso es una
  propiedad, no un detalle: el usuario ya sabe hacerlo y no depende de que la
  app funcione.
- **El default sigue siendo local.** Mientras el server no valide sesión, sólo
  acepta `127.0.0.1` — el comportamiento de hoy no se rompe. Autenticar es lo
  que *habilita* exponerse.

**Lo que todavía no existe en el backend.** El OAuth de Google que el repo ya
tiene (`docs/oauth-para-humanos.md`) es para **leer correos** desde el CLI: un
flujo de aplicación de escritorio con refresh token en disco, no un mecanismo
de sesión para una SPA. Convertirlo en login del panel pide piezas nuevas
—verificación del `id_token` en el server, una sesión, y la lista de cuentas
permitidas (una)— y **ninguna está construida**. Hasta entonces P0 es una
maqueta y así se rotula (hueco H1 en `docs/panel-viabilidad.md`).

Lo que hay que decir en voz alta: **una pantalla de login en la SPA no
protege nada por sí sola.** La API se llama directo con `curl`. El límite lo
pone el middleware del server; P0 es sólo la puerta que el humano ve.

### (b) Perfil — quién es Mato para el motor

Eso es P1, y ya existe como `npm run onboard`: sueldo, día de pago, colchón
objetivo, cuentas, reglas. El panel lo convierte en formulario, respetando la
propiedad que el onboarding CLI eligió a propósito: idempotente, reanudable,
y **nunca escribe un valor que el usuario no confirmó**. `--suggest` se
convierte en "el agente propone, Mato acepta"; nada se guarda solo.

Y sigue valiendo la regla del repo: **nada precargado específico de una
persona o un país**. Los campos arrancan vacíos, no con un ejemplo plausible.

---

## 7. Tiempo real: "permanentemente actualizado"

El requisito es que el panel no muestre un número de hace una hora. Hay tres
mecanismos posibles y el plan usa dos:

| Mecanismo | Para qué | Veredicto |
|---|---|---|
| **Polling con reloj compartido** | overview, transacciones, cola de revisión, estado de sync | **Sí — la base.** |
| **SSE** | el chat | **Sí — ya existe** (`POST /api/chat`) |
| **WebSocket / canal de eventos del ledger** | push de cambios | **No por ahora** |

### Por qué polling y no un canal de eventos

El único que escribe en el ledger es el propio sync, disparado desde este
mismo panel. No hay un tercero produciendo cambios que el panel no sepa que
están ocurriendo. Montar un canal de eventos con su reconexión, su heartbeat
y su estado de servidor, para un usuario único, es construir infraestructura
para un problema que un GET cada 30 segundos ya resuelve. Es exactamente el
razonamiento que ya está escrito en `web/src/lib/refresh.tsx` y no cambió.

### El reloj, en Vue

Portar `web/src/lib/refresh.tsx` a un composable `useRefreshClock()` +
store de Pinia, conservando sus tres propiedades, que no son detalles:

1. **Un solo reloj para todo el panel.** Cada pantalla pide sus datos; lo
   único compartido es *cuándo*.
2. **Se para con la pestaña oculta y dispara un tick al volver.** Sin eso,
   una pestaña olvidada le pega a la API todo el día y al despertar muestra
   datos viejos hasta el próximo intervalo igual.
3. **`refreshNow()`** para forzar: lo usa el sync al terminar un lote y toda
   mutación (resolver una revisión, guardar una regla, fijar el colchón).

Intervalos propuestos, distintos por costo de la consulta:

- `GET /api/overview`, `GET /api/review`, `GET /api/sync/status`: **30 s**
  (barato, y `/api/sync/status` explícitamente no toca Gmail ni gasta crédito
  de Claude).
- `GET /api/transactions`: sólo al cambiar filtros, al terminar un sync y
  cada 60 s si la pestaña está visible.
- Durante un sync corriendo: **cada 3 s** hasta `complete: true`, después
  vuelve al ritmo normal.

Además, indicador de frescura permanente ("actualizado hace X") y **cartel de
desconexión** cuando el backend no responde (portar
`web/src/components/ConnectionBanner.tsx`): el peor estado posible es un panel
que muestra números viejos con cara de actuales.

**Camino de salida documentado:** si algún día el sync corre solo por cron en
el server, ahí sí aparece un productor que el panel no controla, y ahí sí se
justifica un `GET /api/events` en SSE. Se agrega cuando exista esa causa, no
antes.

---

## 8. La tensión: desplegable vs. `127.0.0.1`

Los dos requisitos de Mato chocan de frente, y conviene escribirlo sin
maquillaje:

- **"El panel tiene que ser desplegable, no accedo al servidor."**
- **"El server escucha en `127.0.0.1` por seguridad."**

El choque no es del panel: es que **la API no tiene autenticación**. Mientras
eso sea cierto, todo lugar desde el que el panel pueda leer datos reales es
un lugar desde el que cualquiera puede leerlos.

### Las opciones

| Opción | Qué da | Qué cuesta | Veredicto |
|---|---|---|---|
| Publicar el panel en modo demo (Firebase, como hoy) | UI desplegada y mirable hoy, cero riesgo | no muestra datos reales | **Sí, fase 0** |
| Panel desplegado + backend por **Tailscale** (`tailscale serve` hacia localhost) | datos reales, sin abrir puerto público | Mato instala Tailscale en su dispositivo; hay que sumar el origen a `WALLET_ALLOWED_ORIGINS` | **Sí, fase 1** |
| Túnel público (ngrok, Cloudflare Tunnel) | datos reales ya | **publica el ledger**: la URL es larga, no es un permiso | **No** |
| Hornear un snapshot del ledger en el bundle | datos reales sin backend | publica movimientos bancarios en una URL abierta | **No** |
| `WALLET_BIND_HOST=0.0.0.0` sin auth | "funciona" | ledger, Gmail y crédito de Claude abiertos a internet | **No** |
| Auth de verdad en la API + exponer | datos reales desde cualquier lado | hay que escribir el middleware y cuidarlo | **Sí, fase 2** |

### Recomendación

**Tres fases, en este orden, sin saltearse ninguna:**

1. **Fase 0 — Panel desplegado en modo demo.** Se publica el Vue en Firebase
   con `VITE_API_BASE_URL=demo`, exactamente como el sitio actual. Mato ve y
   opera la interfaz completa desde cualquier lado, con datos inventados y un
   cartel que lo dice. La configuración de a qué backend apuntar vive en el
   navegador de quien mira, no en el bundle: el artefacto publicado no lleva
   adentro ninguna URL privada ni ningún dato.
2. **Fase 1 — Datos reales por Tailscale.** El server sigue en `127.0.0.1`;
   `tailscale serve` lo proxea desde el tailnet. Mato pega la URL del tailnet
   en `?api=` una vez y queda guardada. No se abre ningún puerto público, no
   se toca `WALLET_BIND_HOST`. El límite de acceso lo pone la red, que para
   un tailnet de un solo dueño es un límite real.
3. **Fase 2 — `WALLET_ACCESS_TOKEN` antes de cualquier otra exposición.**
   El día que se quiera llegar sin Tailscale, primero el middleware de
   sección 6(a), y recién después el cambio de binding. **En ese orden.** Al
   revés hay una ventana en la que el ledger está en internet sin llave.

Y la línea que no se cruza: **el bundle publicado nunca lleva datos.** Ni un
snapshot, ni una URL privada, ni un token. El artefacto es la interfaz; los
datos los va a buscar el navegador de Mato, con su credencial, contra su
server.

---

## 9. Orden de construcción sugerido

1. **Server primero:** las rutas HTTP faltantes (onboarding, reglas,
   ahorro). Sin esto, tres pantallas no existen. **Y con los dos escenarios de
   Mato se suman tres piezas más de motor, que van antes que su pantalla**: la
   cola de clasificación (H27) y su escritor (H28) antes de P5, y la detección
   de gastos fijos (H30) antes de P1. La regla es la misma de siempre, dicha al
   revés: **una pregunta no se dibuja antes de que exista la función que la
   responde.**
2. **Esqueleto del panel:** workspace `panel/`, router, capa `api/`
   portada, modo demo, `vitest.config.ts` actualizado.
3. **P2 + P3 + P5** — el núcleo operativo: ver, sincronizar, revisar. Con
   eso solo, el panel ya reemplaza funcionalmente a la web actual.
4. **P4 + P7** — movimientos y chat.
5. **P8 + P9** — estrategia y ahorro.
6. **P1 + P6 + P10** — alta, reglas y configuración (dependen del punto 1).
7. **P0** — cuando el server valide la sesión de Google (sección 6a).
8. **Retiro de `web/`** — decisión aparte, con el panel ya probado en uso
   real. No entra en este plan.

---

## 10. Lo que este plan deliberadamente no resuelve

- **Multiusuario.** No está pedido y no se diseña "por las dudas".
- **Edición manual de movimientos.** El ledger se deriva del correo; editarlo
  a mano rompe la trazabilidad. La corrección de un monto pasa por la cola de
  revisión, que deja rastro auditable.
- **Cálculos en el cliente.** Todo total, proyección o categoría sale del
  motor. El panel no es una segunda fuente de verdad.
- **El retiro de la web React.** Convive hasta que se decida, en otro ticket.

---

Ver también: `docs/flujo-app-prototipo.md` (el recorrido clickeable y la ficha
completa de cada una de las 19 tarjetas — §5 páginas, §6 componentes),
`docs/panel-viabilidad.md` (la auditoría pantalla por pantalla
contra el backend real — los 31 huecos con su endpoint propuesto),
`docs/frontend-desplegado.md` (por qué el sitio actual está en modo demo),
`docs/onboarding.md` (el diseño no interactivo del onboarding),
`docs/mcp.md` (las tools del agente), `docs/reliability.md`.
