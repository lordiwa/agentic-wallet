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
   sección 7 (alta del usuario) y la 9 (despliegue).
4. **No hay canal de eventos del ledger.** El único stream del server es la
   respuesta del chat. Define la sección 8 (tiempo real).

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

Once pantallas. Para cada una: propósito, componentes, habilidad del agente
que consume, dato que muestra, y qué puede **hacer** Mato.

### P0 — Acceso

- **Propósito:** poner un límite antes de que la API deje de estar en
  `127.0.0.1`. Un solo usuario, sin registro público.
- **Componentes:** `AccessGate.vue`, `PassphraseField.vue`,
  `BackendPicker.vue` (URL del backend / modo demo).
- **Habilidad:** ninguna del agente. `GET /api/health` como sonda.
- **Muestra:** a qué backend está apuntando, si responde, y si el modo demo
  está activo.
- **Acciones:** *Entrar*, *Usar modo demostración*, *Cambiar backend*.
- **Honestidad:** en modo demo esta pantalla es decorativa y lo dice. Sólo
  tiene sentido real cuando el server exija el token (sección 7).

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
- **Acciones:** *Sugerir desde mi historial*, *Guardar*, *Saltar por ahora*.
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
  pendientes* (lleva a P5), *Preguntarle al agente* (lleva a P7 con el
  contexto de la tarjeta que se tocó).
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
- Flujo completo en la sección 6.

### P4 — Movimientos

- **Propósito:** el ledger navegable.
- **Componentes:** `TransactionsTable.vue`, `FilterBar.vue`,
  `TransactionDrawer.vue` (detalle de una fila), `Paginator.vue`.
- **Habilidad:** `query_transactions` vía `GET /api/transactions`.
- **Muestra:** fecha, contraparte, monto, tipo, dirección, categoría, y las
  marcas de `needs_review` / reverso / transferencia interna.
- **Acciones:** filtrar por rango, tipo, dirección y contraparte; mostrar u
  ocultar reversados/internos/descartados; *Mandar a revisión*; *Crear regla
  para este comercio* (abre P6 precargado); *Preguntar sobre este movimiento*
  (abre P7 con la fila como contexto).

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
- **Acciones:** *Crear regla*, *Editar*, *Borrar*, *Aplicar reglas al
  historial*, *Recuperar comercios faltantes*.
- **Trampa conocida, documentada en memoria del proyecto:** un patrón de
  regla **más largo que la contraparte real nunca matchea**. El editor tiene
  que mostrar en vivo cuántas filas matchea el patrón que se está escribiendo
  — antes de guardarlo, no después. Y hay que decir que reclasificar no mueve
  el gasto por categoría cuando `categorize()` corta en
  `type = 'transferencia'`.

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
  la proyección; **sin escribir nada** hasta confirmar), *Preguntarle al
  agente sobre este plan* (a P7).

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
- **Lo que NO hace:** no muestra ni edita credenciales. Los tokens viven en
  `.env` en la máquina de Mato y ahí se quedan.

### P11 — Estado del sistema (opcional, fase 2)

Salud del pipeline: última corrida, errores recientes, métricas de
`db/telemetry.ts`. Sólo claves, conteos e ids — **nunca valores personales**.
Se lista para que quede planificado, no para la primera versión.

---

## 4. Navegación

```
                    ┌──────────────────┐
                    │  P0 Acceso       │  (sólo si el backend pide token)
                    └────────┬─────────┘
                             │  token ok / modo demo
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

Hoy: **nadie está autenticado y todos pueden todo**. La propuesta mínima
honesta, en el server (no en el panel):

- Una variable nueva `WALLET_ACCESS_TOKEN` en `.env`. Mato la escribe a mano
  una vez — ése es el "alta manual".
- Un middleware en `server/src/api/` que exige `Authorization: Bearer <token>`
  en todo `/api/*` salvo `/api/health`.
- **Si la variable está vacía, el server sólo acepta conexiones de
  `127.0.0.1`** — o sea, el comportamiento de hoy sigue siendo el default y
  nada se rompe. El token es lo que *habilita* exponerse, no un agregado
  cosmético.
- P0 pide la frase, la guarda en `localStorage` (misma mecánica que la URL
  del backend, ver `web/src/api/base.ts`) y la manda en cada request.

Sin usuario, sin contraseña, sin hash, sin sesiones: **un secreto compartido
para un solo humano**. Un login con formulario de usuario y contraseña contra
una tabla de un solo registro sería más código, más superficie y exactamente
la misma seguridad.

Lo que hay que decir en voz alta: **una pantalla de login en la SPA no
protege nada por sí sola.** La API se llama directo con `curl`. El límite lo
pone el middleware del server; P0 es sólo el lugar donde se tipea el secreto.

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
   ahorro) + `WALLET_ACCESS_TOKEN`. Sin esto, tres pantallas no existen.
2. **Esqueleto del panel:** workspace `panel/`, router, capa `api/`
   portada, modo demo, `vitest.config.ts` actualizado.
3. **P2 + P3 + P5** — el núcleo operativo: ver, sincronizar, revisar. Con
   eso solo, el panel ya reemplaza funcionalmente a la web actual.
4. **P4 + P7** — movimientos y chat.
5. **P8 + P9** — estrategia y ahorro.
6. **P1 + P6 + P10** — alta, reglas y configuración (dependen del punto 1).
7. **P0** — cuando exista el token.
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

Ver también: `docs/frontend-desplegado.md` (por qué el sitio actual está en
modo demo), `docs/onboarding.md` (el diseño no interactivo del onboarding),
`docs/mcp.md` (las tools del agente), `docs/reliability.md`.
