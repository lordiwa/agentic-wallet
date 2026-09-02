# Panel — preparación probada antes de la fase visual

**Qué es esto:** un *wargaming adversario* del roadmap de
`docs/panel-roadmap-implementacion.md`. No lo continúa: lo **ataca**. La
consigna fue probar que el roadmap está mal calculado y que buena parte de sus
exigencias son falsas o evitables, y salir con un plan preparatorio que sí se
sostenga contra el código y contra los datos reales.

**Método.** Nada de esto se afirma de memoria:

- Lectura del código con archivo:línea (todas las citas de abajo se pueden abrir).
- `npm test` corrido entero: **79 archivos, 909 tests, verde** (2026-09-02).
- **Forense sobre el ledger real** (`bolsillo.sqlite`, sólo conteos y tipos —
  ningún dato personal entra a este doc): 1.159 transacciones,
  2026-01-07 → 2026-09-01.
- El chat queda **fuera** de este encargo por pedido explícito: se deja para el
  final. Acá sólo se dice qué de lo que el roadmap le asignó es cierto.

**Lo que cambió desde que se escribió el roadmap y obliga a recalcularlo:**

1. Mato configuró **Firebase Auth** en el proyecto del panel (correo + Gmail) y
   ya creó su cuenta. El hueco H1 dejó de ser "no hay proveedor de identidad".
2. Requisito de producto nuevo: **si hay UI, la instalación tiene que dejar de
   ser difícil.** Hoy es clonar el repo, tres códigos de Google Cloud y `npm`.
   Mato propone que el usuario se cree una cuenta y que **el correo nunca llegue
   a su computadora**.

---

## 1. Veredicto del wargaming, en una tabla

Cada exigencia del roadmap, clasificada. **YA EXISTE** = está escrito y testeado
hoy. **EVITABLE** = el roadmap lo pide y no hace falta, o hay un camino más
barato. **DIFERIBLE** = hace falta, pero no para el MVP. **NECESARIA** = el
roadmap acertaba.

| # | Exigencia del roadmap | Veredicto | Evidencia |
|---|---|---|---|
| 1 | Fase 0 primero "sin excepción", porque cada endpoint nuevo "nace sin llave" | **EVITABLE como bloqueo** | El server escucha en `127.0.0.1` (`config.ts:44`). La ventana de exposición se abre el día que se enciende `tailscale serve`, no el día que se escribe el endpoint. Y el panel se construye entero en modo demo sin tocar el server (`web/src/api/base.ts:90`) |
| 2 | `WALLET_ACCESS_TOKEN` + middleware Bearer | **NECESARIA** | No existe nada: `envSchema` (`config.ts:29-77`) no tiene la variable y ninguna ruta la pide |
| 3 | Fase 6 (login con Gmail) = 2 días, **riesgo alto**, "la única que toca OAuth de verdad" | **FALSO HOY** | Firebase Auth ya está configurado. Verificar su ID token es `firebase-admin.verifyIdToken()`: Google gestiona JWKS, rotación, `aud` e `iss`. Es un subconjunto del middleware del punto 2, no una fase |
| 4 | TASK-052 AC3: sesión propia con cookie httpOnly + SameSite + logout | **EVITABLE, y dañina** | Con Firebase el cliente ya sostiene y refresca el token; no hace falta sesión de server. Peor: una cookie obliga a mandar `Access-Control-Allow-Credentials`, que `api/cors.ts:12-19` **decide a propósito no mandar nunca** |
| 5 | "Capa `api/` portada desde `web/src/api/`" y "modo demo portado" | **YA EXISTE — es copiar archivos** | `demoFetch.ts` (192), `base.ts` (108), `client.ts` (249), `types.ts` (183), `dates/countdown/freshness/spending` (151): **883 líneas con cero imports de React**. Sólo `refresh.tsx` (117) es React |
| 6 | El reloj de refresco como **store de Pinia** | **EVITABLE** | `refresh.tsx` son 117 líneas: un intervalo, un booleano de visibilidad y un `refreshNow()`. Un composable con singleton de módulo hace lo mismo. Pinia es una dependencia entera para un `setInterval` |
| 7 | H19 (`batch_size` en `POST /api/sync`) | **CASI EXISTE** | `SyncRunnerOptions {batchSize}` ya está declarado (`api/sync-route.ts:23-27`) y el runner ya lo acepta. La ruta hace `runner()` sin argumentos y con `_req` (`sync-route.ts:40,52`). Son dos líneas |
| 8 | TASK-047 AC7: "`amount: null` se muestra 'sin leer', `0` se muestra como cifra" | **IMPOSIBLE DE CUMPLIR** | `transactions.amount` es `REAL NOT NULL` (`db/schema.ts:13`). El motor escribe `UNKNOWN_AMOUNT_PLACEHOLDER = 0` (`db/repository.ts:37,137`). La API **nunca** devuelve `null`. Y en el ledger real hay **0 filas con `amount = 0`**. El criterio hay que reescribirlo sobre `needs_review` |
| 9 | Fase 3 = 3–4 días, **riesgo medio**, "es la única que toca el pipeline" | **SOBRECALCULADA** | Ver §1.1: la mitad de la fase ya está construida y su "corazón" no tiene datos |
| 10 | H9 (`review_reason`) y H10 (`claude_amount`) "no se recortan; si el presupuesto no alcanza se recorta la fase entera" | **H9 sí / H10 FALSO** | Ver §1.1 |
| 11 | "P2 Resumen es la **única** pantalla que se construye sin tocar el server" | **FALSO** | P5 Revisión se alimenta de tres rutas que ya existen y funcionan (`routes.ts:151,164,193`), con **50 resoluciones reales** ya registradas en la base. P4 Movimientos también, salvo el contador total |
| 12 | H20 (paginación de `GET /api/transactions`) | **MITAD HECHA** | `offset` ya existe y ya se pasa (`api/queries.ts:19,74`, `routes.ts:145`). Falta sólo el `total` del conjunto filtrado |
| 13 | H14: "el botón más visible de P9 apunta a la columna equivocada" | **MAL DIAGNOSTICADO** | `POST /api/buffer` escribe `savings.reserved`, que es exactamente el `reservado` que lee `colchonStatus` (`strategy/balance.ts:68`). Funciona. Lo que falta es escribir `strategy_config.colchonObjetivo`, que la tool MCP `set_profile` ya hace (`mcp/server.ts:404`). No es un bug: es un campo más de la ruta de perfil (H2) |
| 14 | Fase 5 (reglas, onboarding) va **última** "porque es lo que menos se extraña" | **INVERTIDA** | Ver §1.2: en el ledger real hay **206 filas sin categoría útil** contra **4 filas en revisión**. El roadmap prioriza la cola de 4 y posterga la de 206 |
| 15 | Franja **persistente no cerrable** de revisión pendiente (TASK-047 AC12) | **DESPROPORCIONADA** | La cola real tiene 4 filas de 1.159 (0,35 %), sin urgencia. Un cartel que no se puede cerrar, permanente, por eso |
| 16 | C1..C5: al chat le faltan herramientas de gasto | **NECESARIA y correcta** | Verificado: `engine-tools.ts` registra exactamente cinco tools (`:345-381`) y ninguna suma. `get_review_queue` está en el MCP (`mcp/server.ts:220`) y no en el chat. `chatBodySchema` es `{message}` y nada más (`chat-route.ts:64`) |
| 17 | La fase 2 del chat **depende** de la fase 1 (TASK-048 `depends_on` TASK-047) | **FALSO para su mitad de server** | `spendingSummary` + las tres tools + `GET /api/spending/summary` no tocan una línea de Vue. Mejoran el chat que ya se usa hoy por `web/` y por MCP. Pueden entregarse el día 1 |
| 18 | Fase 4 (deudas, calendario) = 2–3 días | **SOBRECALCULADA** | `GET /api/debts` son ~10 líneas sobre una tabla que ya existe y un `getDebtById` ya escrito (`api/mutations.ts:29`). `paydaysBetween` ya existe (`strategy/calendar.ts:124`). Es un día |
| 19 | H26: no construir "rehacer el ledger" ni "mandar a revisión a mano" | **NECESARIA — se sostiene** | Es la mejor decisión escrita del roadmap y no se toca |
| 20 | "El monto sale del parser, nunca del modelo" como invariante del panel | **NECESARIA — se sostiene** | Y es lo que hace obligatorio `spendingSummary` antes de que el chat conteste sobre gastos |

### 1.1 El hallazgo más caro: la fase 3 está construida sobre datos que no existen

El roadmap dice que la ReviewCard es *"donde la invariante del motor se vuelve
visible"*, que su corazón es la **comparación de las dos lecturas** (la del
parser contra la de Claude), y que **si el presupuesto no alcanza se recorta la
fase entera, no su corazón**.

Los datos reales dicen otra cosa.

| Medición | Valor | De dónde |
|---|---|---|
| Transacciones en el ledger | **1.159** | `bolsillo.sqlite` |
| Filas en `needs_review` | **4** | 0,35 % del ledger |
| De esas 4, cuántas tienen `amount = 0` (monto ilegible) | **0** | |
| Filas con `amount = 0` en todo el ledger | **0** | |
| Resoluciones de revisión ya registradas | **50** | `review_resolutions` |
| Filas donde Claude discrepó del parser, en 8 meses | **0** | `docs/investigacion-riesgos.md` §0, forense sobre 933 correos |

Tres consecuencias, en orden de gravedad:

**(a) H10 (`claude_amount`) es una columna sin contenido.** El forense del propio
repo ya lo había demostrado sobre 1.069 filas: *"no existe en el ledger ni una
sola fila cuyo estado `needs_review` sea atribuible al cross-check de Claude"*.
Persistir `claude_amount` para dibujar dos columnas que van a mostrar el mismo
número en el 100 % de los casos es trabajo de motor —migración, cambio en
`insertTransaction`, tests— por una tarjeta que nunca va a tener nada que
comparar. **Se recorta.** Si algún día aparece la primera discrepancia, la
columna se agrega ese día con `addColumnIfMissing`, que es aditivo.

**(b) H9 (`review_reason`) sí vale, y es barato.** Es el único de los dos que
tiene contenido: seis motivos distintos, ninguno de ellos Claude. Y es una
columna `TEXT` que se escribe y **no la lee ninguna rama de decisión** — no
puede romper la invariante. El roadmap le puso "riesgo medio porque toca el
pipeline": la etiqueta es del archivo, no del cambio.

**(c) P5 Revisión es entregable HOY, sin tocar el server.** Sus tres rutas
existen (`GET /api/review`, `POST /api/review/:id/resolve`,
`GET /api/review/resolutions`) y están probadas en uso real: 50 resoluciones. El
roadmap descarta esa versión con desdén —*"es una lista de asuntos de correo con
tres botones"*— pero esa lista con tres botones **es exactamente el flujo de
`npm run review` que ya se usa**, y para 4 filas alcanza y sobra.

### 1.2 El segundo hallazgo: el roadmap prioriza al revés

| Cola de trabajo real | Filas | Fase que la atiende |
|---|---:|---|
| Movimientos sin categoría útil (`NULL` u `otros`) | **206** (17,8 %) | Fase **5** — la última |
| Movimientos en revisión | **4** (0,35 %) | Fase **3** — con migración de esquema |

Hay 36 reglas de categoría escritas y 200 contrapartes distintas. El trabajo de
datos que a Mato le queda por hacer es **clasificar**, no revisar. P6 (reglas,
con su contador en vivo) es la pantalla que más mueve la aguja del ledger, y el
roadmap la manda al final por un argumento que suena razonable —*"eso ya se hace
por terminal"*— pero que aplica **igual de bien a la cola de revisión**, que
también se hace por terminal y que el roadmap sí adelanta.

### 1.3 Dónde el roadmap acertaba, y hay que decirlo

No todo estaba mal. Lo que sobrevive intacto al ataque:

- **El análisis C1..C5 del chat es correcto y es el mejor trabajo del roadmap.**
  Verificado uno por uno contra el código. En particular C1: el guardrail está
  bien escrito y el agente, bien obedecido, **no puede** contestar "cuánto gasté
  en X" — las dos salidas son malas. Es un hallazgo real que ningún doc anterior
  tenía.
- **H26** (no construir el borrado del ledger ni el "mandar a revisión" manual).
- **La corrección de nombres** (`WALLET_BIND_HOST`, no `BOLSILLO_BIND_HOST`).
- **La disciplina de no dibujar botones sin respaldo.**
- **El diagnóstico de que `web/` y `panel/` van a duplicar capa mientras
  convivan**, y que `web/` no se toca.
- **La advertencia de costo de tokens del chat** y `maxTurns: 8`.

---

## 2. Inventario verificado: qué ya está listo

### 2.1 Identidad — lo que cambió esta semana

| Pieza | Estado | Nota |
|---|---|---|
| Proyecto Firebase del panel | **listo** (Mato) | Ya existe `firebase.json` en la raíz apuntando a `web/dist-demo`, y el sitio publicado (`docs/frontend-desplegado.md`) |
| Firebase Auth: correo + Gmail | **listo** (Mato) | Proveedor de identidad real, configurado |
| Cuenta de Mato creada | **listo** (Mato) | Ya hay un `uid` contra el cual autorizar |
| Verificación del ID token en el server | **falta** | Una dependencia (`firebase-admin`) y un middleware |

Esto es lo que colapsa la fase 6. Antes, "login con Gmail" significaba montar un
flujo OAuth desde cero. Ahora significa: el panel obtiene el ID token del SDK de
Firebase y lo manda en `Authorization: Bearer`; el server lo verifica y compara
el `uid` contra una lista de uno.

### 2.2 Motor — todo esto se reutiliza tal cual, sin tocarlo

| Pieza | Dónde | Cobertura |
|---|---|---|
| Parser determinista + registro multibanco | `server/src/parser/` | tests propios |
| Pipeline de ingesta con la invariante del monto | `server/src/ingest/pipeline.ts` | tests propios |
| Reconciliación (reversos, duplicados, internas) | `server/src/rules/reconcile.ts` | tests propios |
| Motor de estrategia (saldo, safe-to-spend, colchón, tarjeta, calendario, proyección) | `server/src/strategy/` | tests propios |
| Categorización + reglas + backfill | `server/src/category/` | tests propios |
| Brief diario | `server/src/brief/` | tests propios |
| Onboarding no interactivo | `server/src/onboard/` | tests propios |
| Sync incremental con checkpoint reanudable | `server/src/sync/` | tests propios |
| **Total** | | **79 archivos, 909 tests, verde** |

### 2.3 Rutas HTTP que ya existen (verificadas una por una)

| Ruta | Archivo:línea | Sirve a |
|---|---|---|
| `GET /api/health` | `index.ts:84` | P0, P10 (falta `auth_required`) |
| `GET /api/overview` | `routes.ts:198` | **P2 completa** |
| `GET /api/brief` | `routes.ts:234` | P2 |
| `GET /api/sync/status` | `routes.ts:213` | P2, P3, C1 |
| `POST /api/sync` | `sync-route.ts:40` | P3, C1 (falta pasar `batch_size`) |
| `GET /api/transactions` | `routes.ts:129` | **P4** (con `offset`; falta `total` y filtro por categoría) |
| `GET /api/review` | `routes.ts:151` | **P5** |
| `POST /api/review/:id/resolve` | `routes.ts:164` | **P5** |
| `GET /api/review/resolutions` | `routes.ts:193` | P5 |
| `GET /api/transfers` | `routes.ts:230` | P2, P8 |
| `GET /api/strategy/projection` | `routes.ts:243` | P8 |
| `POST /api/debts/:id/paid` | `routes.ts:252` | P8 (falta el `GET` que dé los ids) |
| `POST /api/buffer` | `routes.ts:266` | P9 |
| `POST /api/chat/:conversationId?` (SSE) | `chat-route.ts:97` | P7 |
| `GET /api/conversations`, `/:id` | `chat-route.ts:83,87` | P7 |

**Quince rutas.** El roadmap trata P2 como "la única pantalla sin backend
nuevo"; en realidad **P2, P5 y casi todo P4 y P8** están alimentados.

### 2.4 Frontend — lo que se copia, no se reescribe

| Archivo | Líneas | ¿React? | Destino |
|---|---:|---|---|
| `web/src/demo/demoFetch.ts` | 192 | **no** | copiar tal cual |
| `web/src/api/base.ts` | 108 | **no** | copiar tal cual (resolución de backend + `?api=`) |
| `web/src/api/client.ts` | 249 | **no** | copiar + una línea de cabecera `Authorization` |
| `web/src/api/types.ts` | 183 | **no** | copiar tal cual |
| `web/src/lib/{dates,countdown,freshness,spending}.ts` | 151 | **no** | copiar tal cual |
| `web/src/lib/refresh.tsx` | 117 | **sí** | reescribir como composable (~40 líneas) |
| Componentes React de P2/P3 | ~300 | sí | rehacer en Vue (son chicos) |

**883 de 1.000 líneas de la capa cliente son TypeScript puro.** Incluye
`streamChat` (el lector SSE con `fetch` + `getReader()`, que el roadmap ya
identifica bien como el que sobrevive a la autenticación).

El modo demo cubre hoy 8 rutas (`demoFetch.ts:163-191`); para P4/P5/P8 hay que
agregarle las que falten, que es agregar objetos literales a un archivo que ya
existe.

### 2.5 MCP — 14 tools, cero lógica financiera propia

`server/src/mcp/server.ts` registra: `get_balance`, `get_colchon_status`,
`get_overview`, `query_transactions`, `get_review_queue`, `resolve_review`,
`get_spending_by_category`, `sync`, `onboarding_status`, `suggest_profile`,
`set_profile`, `set_rule`, `apply_rules`, `heal_counterparties`.

**Esto es el argumento más fuerte para diferir la fase 5:** las seis tools de
onboarding y reglas ya funcionan y ya se usan. La fase 5 no agrega capacidad —
agrega *pantalla* a una capacidad que existe. Es diferible sin perder nada
funcional.

### 2.6 Lo que NO existe (la lista honesta y corta)

1. Cualquier forma de autenticación en `/api/*`.
2. `spendingSummary` — no hay ninguna función que sume gasto por comercio ni que
   devuelva un total (`strategy/spending.ts` sólo agrupa por categoría).
3. `total` del conjunto filtrado y filtro por categoría en `GET /api/transactions`.
4. `GET /api/debts`, `GET /api/counterparties`, `GET /api/strategy/calendar`.
5. Rutas HTTP de onboarding y de reglas (existen sólo como MCP/CLI).
6. `review_reason` persistido.
7. El workspace `panel/`.
8. Multi-usuario: ni `conversations` ni ninguna otra tabla tiene dueño, y
   `openDb()` abre una única base de una ruta de entorno.

---

## 3. El modelo "todo web": investigación y recomendación

### 3.1 El requisito, replanteado con precisión

Mato pide: *"me creo cuenta y desde nuestros servers se le dan permisos para
leer su correo sin que el correo llegue a su computadora"*. Eso son en realidad
**tres decisiones separadas** que conviene no confundir, porque tienen costos
muy distintos:

| Decisión | Pregunta | Hoy |
|---|---|---|
| **Identidad** | ¿quién sos? | Firebase Auth ✅ resuelto |
| **Autorización del correo** | ¿cómo obtenemos permiso para leer tu buzón? | OAuth de escritorio, 15-25 min de consola de Google por usuario |
| **Dónde corre el motor** | ¿en tu máquina o en la nuestra? | En la del usuario |

Firebase Auth resolvió la primera. Las otras dos son el problema entero.

### 3.2 Los modelos posibles

#### Modelo A — "bring your own Gmail": OAuth del usuario, servidor lee directo

El usuario entra al panel, aprieta *Conectar mi Gmail*, ve la pantalla de
consentimiento de Google y autoriza **nuestra** aplicación con
`gmail.readonly`. Nosotros guardamos su *refresh token* y el motor lee su buzón
desde nuestro servidor.

- **Se gana:** cero instalación, cero consola de Google para el usuario, historial
  completo desde el día uno, sync automático.
- **Se pierde:** el ledger deja de ser local; hay un servidor con el historial
  bancario de todos.
- **La invariante no se toca:** el parser corre igual, sólo cambia dónde.
- **Los tres muros, en orden de dureza:**
  1. **`gmail.readonly` es un scope restringido de Google.** Publicar una app
     con scopes restringidos a usuarios externos exige la verificación de
     Google, que para restringidos incluye una **evaluación de seguridad por un
     tercero** (CASA), anual y paga. Sin verificar, la app queda en modo prueba,
     con **tope de usuarios de prueba** y —esto es lo que mata el modelo—
     **refresh tokens que caducan a los pocos días**, o sea reconsentimiento
     periódico de cada usuario. *(Este párrafo viene de conocimiento de la
     plataforma, no del código: **verificar contra la documentación vigente de
     Google antes de comprometer una fecha.** Es la única afirmación de este doc
     que no pude comprobar en el repo ni con una corrida.)*
  2. **Firebase Auth no te da el refresh token de Gmail.** Agregar el scope al
     `GoogleAuthProvider` del SDK cliente devuelve un *access token* de una
     hora, no un refresh token: Firebase no los guarda ni los entrega. Para
     tener acceso continuo hay que correr **un segundo flujo**, propio, de
     código de autorización con `access_type=offline`. O sea: **dos
     consentimientos**, uno de identidad y otro de correo. La intuición de Mato
     de que "ya que se creó la cuenta, dale permisos" no es un paso: son dos.
  3. **El refresh token es poder sobre el correo ajeno.** Guardar N refresh
     tokens de Gmail es guardar N llaves de buzones. Exige cifrado con clave
     gestionada aparte (no en la misma base), revocación real, y un plan de
     incidente que hoy no existe. `ingest/token-store.ts` guarda **uno**, en el
     llavero del sistema operativo — un diseño que no escala a multi-usuario ni
     por asomo.

#### Modelo B — SaaS multi-tenant completo

El wallet entero como servicio: un ledger por usuario, el motor corriendo en
nuestra infraestructura, ingesta por el Modelo A.

- Hereda **todos** los muros del Modelo A y le suma: aislamiento de tenants,
  backups, costo por usuario de las llamadas a Claude (cada correo del primer
  sync pasa por el modelo), y responsabilidad legal sobre datos financieros de
  terceros.
- **Veredicto: no es el próximo paso.** Es el destino posible, no el camino.

#### Modelo C — híbrido: UI web + motor en el servidor de Mato

Lo que el panel ya apunta a ser. Un solo usuario, un solo ledger, en la máquina
de Mato; la UI publicada en Firebase Hosting y apuntada al backend por
`?api=`. Es lo que `web/src/api/base.ts` **ya hace**.

- **Se gana:** acceso desde el teléfono, cero riesgo nuevo.
- **Se pierde:** no escala a un segundo usuario, y la instalación sigue siendo
  difícil para cualquiera que no sea Mato.

#### Modelo D — el que la consigna no listaba: **ingesta por reenvío**

El usuario se crea la cuenta, y el panel le da **una dirección propia**
(`u-<id>@in.<dominio>`) y un instructivo de seis clics para crear un filtro en
Gmail: *"correos de mi banco → reenviar a esta dirección"*. Los correos llegan a
nuestro servidor por webhook de entrada (Postmark, SendGrid inbound, CloudMailin
u otro), y de ahí entran al **mismo pipeline de siempre**.

- **Cero OAuth. Cero scope restringido. Cero verificación CASA. Cero refresh
  tokens guardados.**
- **Privacidad estrictamente mejor que el Modelo A:** en el Modelo A tenemos
  permiso de lectura sobre *todo* el buzón y prometemos filtrar; acá **sólo
  recibimos los correos que el usuario decidió reenviar**. La promesa deja de
  ser una política y pasa a ser una imposibilidad técnica.
- Cumple la frase de Mato al pie: el usuario se crea cuenta, el correo va del
  banco a nuestro servidor, y **nunca toca su computadora**.
- **Lo que cuesta de verdad, y hay que decirlo sin maquillaje:**
  1. **No hay historial.** El filtro de Gmail actúa sobre lo que llega, no sobre
     lo que ya llegó — un usuario nuevo arranca con el ledger vacío y lo va
     llenando. Los ocho meses que Mato tiene hoy no se reconstruyen así.
  2. El usuario tiene que crear el filtro. Son seis clics guiados, contra los
     15-25 minutos de consola de Google Cloud de hoy: sigue siendo **una mejora
     enorme**, pero no es cero fricción.
  3. Hay que verificar la dirección (que nadie reenvíe correo a la cuenta de
     otro) y aceptar que un remitente puede ser falsificado — el parser tiene
     que seguir anclando en el remitente esperado y mandar lo raro a revisión,
     que es exactamente lo que ya hace.

### 3.3 Recomendación

> **Camino recomendado: C hoy → D como modelo objetivo, con A como camino
> opcional de importación de historial, detrás de la verificación de Google.**

El razonamiento, en corto:

- **A no es un plan hasta que alguien confirme el costo y el plazo de la
  verificación de Google para un scope restringido.** Mientras eso no esté
  confirmado por escrito, comprometer "el usuario conecta su Gmail" es
  comprometer una fecha que no controlamos.
- **D entrega el 90 % de lo que Mato quiere por el 10 % del costo regulatorio**,
  y su única pérdida real —el historial— es justamente lo que A hace bien. Por
  eso conviven: D para el día a día de cualquier usuario nuevo, A como
  importador opcional el día que la verificación exista.
- **C es el presente y no hay que apurarse a abandonarlo.** El ledger de Mato
  con 1.159 filas ya vive ahí y funciona.

### 3.4 Qué se reutiliza y qué habría que construir para el modelo web

| Pieza | En el modelo web |
|---|---|
| Parser, pipeline, reconciliación, categorías, estrategia, brief, chat | **Tal cual.** El motor no sabe de dónde vino el correo |
| `GmailClient` (`ingest/googleapis-gmail-client.ts`) | Tal cual en A: ya toma `{clientId, clientSecret, refreshToken}` como parámetros (`:14-18`), no de variables globales. Es el archivo mejor preparado del repo para multi-usuario |
| Modo D | Adaptador nuevo: webhook de correo entrante → la misma forma `GmailMessage` que el pipeline ya consume (`ingest/types.ts`) |
| `openDb()` | Hoy abre una base de una ruta de entorno. Multi-tenant necesita `getDb(tenantId)` |
| Identidad | Firebase Auth ✅ |
| `token-store.ts` | Sólo sirve para un usuario (llavero del SO). En A habría que reemplazarlo por almacenamiento cifrado por usuario |
| Dueño de las filas | No existe en ninguna tabla |

### 3.5 Lo único que conviene hacer HOY para no retrabajar

**Casi nada, y eso es una buena noticia.** El repo ya está bien formado para
esto por accidente feliz:

- `createApiRouter(getDb)` recibe un **proveedor perezoso**, no un handle
  (`routes.ts:126`). Pasar de `() => db` a `() => dbDe(tenant)` no cambia
  ninguna ruta.
- `GmailClient` ya recibe sus credenciales por parámetro.
- `base.ts` ya desacopla el frontend del backend.

Las dos únicas precauciones que valen el minuto que cuestan:

1. **Ninguna ruta nueva puede abrir la base por su cuenta.** Todas pasan por
   `getDb`. Es la regla que mantiene abierta la puerta al multi-tenant.
2. **Cuando se toque el chat, agregar `owner TEXT` nullable a `conversations`**
   con `addColumnIfMissing`. El roadmap dice *"no se diseña por las dudas"* y es
   una buena regla — pero acá se trata de una columna nullable que nadie lee,
   contra una migración sobre historial de chat vivo más adelante. Quince
   minutos de seguro.

**Lo que NO hay que hacer hoy:** construir multi-tenancy, tocar `openDb`,
diseñar el esquema de tenants, ni escribir una línea de OAuth de terceros.

---

## 4. Checklist de preparación (sólo lo imprescindible)

Antes de escribir la primera línea del panel. Nada de esto es código de panel.

**Decisiones que hacen falta de Mato (bloquean, y son cortas):**

- [ ] **D1 — ¿Se recorta `claude_amount` (H10)?** Recomendado: **sí**, por §1.1.
- [ ] **D2 — ¿P5 Revisión entra al MVP en su versión simple** (sin `review_reason`),
      aprovechando que sus tres rutas ya existen? Recomendado: **sí**.
- [ ] **D3 — ¿P6 Reglas sube de prioridad** sobre la fase 3, por las 206 filas
      sin categoría contra 4 en revisión? Recomendado: **sí**, al menos el
      listado y el contador.
- [ ] **D4 — ¿Se confirma el camino C → D → (A opcional)** del §3.3?
- [ ] **D5 — La franja de revisión: ¿persistente no cerrable, o aviso normal?**
      Con 4 filas, recomendado: **aviso normal, cerrable**.

**Credenciales y configuración (Mato, en su máquina — nada de esto va al repo):**

- [ ] Del proyecto de Firebase: el **project id** y la **configuración web**
      (apiKey, authDomain, appId). Van al build del panel, no al repo — son
      públicos por diseño, pero se manejan por variable igual.
- [ ] Una **cuenta de servicio** de Firebase Admin para el server (JSON), fuera
      del repo, referenciada por variable de entorno.
- [ ] El **uid** de la cuenta de Mato, para la lista de permitidos de uno.
- [ ] Decidir el valor de `WALLET_ACCESS_TOKEN` (32 bytes al azar) — es el
      camino de terminal/curl, que sobrevive a Firebase.
- [ ] `WALLET_ALLOWED_ORIGINS` con el origen del panel publicado.
- [ ] `tailscale serve` hacia `localhost:3000` probado y funcionando **antes**
      de que exista el panel. Es media hora y se puede probar con `curl`.
- [ ] Confirmar que `firebase-admin` se puede instalar en el server (es una
      dependencia grande; si molesta, la verificación de un JWT de Google contra
      su JWKS también se hace a mano).

**Verificaciones técnicas (se hacen sin escribir panel):**

- [ ] Correr `npm run build` y `npm test` — línea de base, hoy verde.
- [ ] Probar `POST /api/chat` con Bearer detrás de tailscale, antes de que haya
      panel: es el endpoint que gasta la credencial de Claude.
- [ ] **Confirmar por escrito** el estado de la verificación de Google para
      scopes restringidos (§3.2, Modelo A). Es la única incógnita externa del
      plan y decide si D es "recomendado" o "obligatorio".

**Lo que NO va en el checklist, a propósito:** crear el workspace `panel/`,
elegir librería de gráficos, definir el esquema multi-tenant, tocar `web/`.

---

## 5. El plan probado (MVP sin chat)

### 5.1 La secuencia

Cuatro bloques. El chat no está: sale del alcance por pedido de Mato, y **eso lo
mejora**, porque el bloque de motor del chat era el único que empujaba la
estimación hacia arriba sin dar pantalla.

| # | Bloque | Qué entrega | Turnos | Días |
|---|---|---|---:|---:|
| **B0** | **Puerta** — `WALLET_ACCESS_TOKEN` + Bearer + ID token de Firebase, todo en **un** middleware; `GET /api/health` devuelve `auth_required`; `tailscale serve` documentado | El server se puede exponer al tailnet con llave, y P0 es un botón de Google que ya funciona | 3 | **1** |
| **B1** | **Andamio + P2 + P3** — workspace `panel/`, capa `api/` y demo **copiadas**, reloj como composable, P2 Resumen, P3 Sync, `batch_size` | Mato ve su saldo real desde el teléfono y sincroniza | 6–7 | **2–3** |
| **B2** | **P5 + P4 con lo que ya existe** — P5 sobre las tres rutas actuales; P4 sobre `GET /api/transactions` (que ya pagina), + `total` y filtro por categoría | Resuelve la cola de 4 y navega sus 1.159 movimientos | 4–5 | **1,5–2** |
| **B3** | **P6 Reglas** — `GET/POST/DELETE /api/rules`, `POST /api/rules/apply` con `dry_run`, `countMatchingTransactions`, contador en vivo | Ataca las **206 filas sin categoría**, que es el trabajo de datos que queda de verdad | 5–6 | **2** |
| | **MVP** | | **18–21** | **6,5–8** |

### 5.2 Comparación honesta con el roadmap

| | Roadmap | Este plan |
|---|---|---|
| MVP | 6–9 días, **con** chat, **sin** movimientos ni revisión ni reglas | 6,5–8 días, **sin** chat, **con** movimientos, revisión y reglas |
| Fase de login | 2 días aparte, riesgo alto | absorbida en B0 |
| Migración de esquema | sí (fase 3) | **ninguna** |
| Pipeline tocado | sí (fase 3) | **no** |

El total se parece; **lo que entra por ese total no se parece en nada.** Y este
plan no toca el pipeline en ningún momento, así que el "riesgo medio" del
roadmap desaparece del MVP entero.

### 5.3 Riesgos reales de este plan

Sólo los que puedo sostener con evidencia:

1. **La verificación del ID token de Firebase es la única pieza nueva de
   verdad** (riesgo bajo-medio). Todo lo demás en B0 es un middleware de
   comparación en tiempo constante. Mitigación: `WALLET_ACCESS_TOKEN` funciona
   solo, sin Firebase; si Firebase se complica, el MVP no se bloquea.
2. **B1 depende de que el copiado sea copiado y no reescritura** (riesgo bajo).
   Si alguien decide "aprovechar y mejorar" `base.ts` o `demoFetch.ts`, la
   estimación se va. La regla es: se copian sin cambios salvo el `Authorization`.
3. **Vue 3 en un repo que hoy sólo tiene React** (riesgo bajo). Hay que agregar
   `@vitejs/plugin-vue`, `@vue/test-utils`, y meter `panel/src/**/*.test.ts` en
   el `include` de `vitest.config.ts` — sin eso los tests del panel no corren y
   nadie se entera.
4. **`environment: "node"` es global en `vitest.config.ts`** y los tests de Vue
   necesitan jsdom. Es configuración, no diseño, pero es un tropiezo garantizado
   si no se prevé.
5. **Deriva de alcance del prototipo** (riesgo medio, el más probable de todos).
   Es el mismo que el roadmap ya nombró y su criterio sigue siendo el correcto:
   lo que no tiene backend no se dibuja.

### 5.4 Qué queda explícitamente para después

- **El chat entero** (P7 y sus tools C1..C5). Fuera de este encargo por decisión
  de Mato. Cuando vuelva: **partirlo en dos** — el motor (`spendingSummary`, las
  tres tools, `GET /api/spending/summary`) no depende del panel y se puede
  entregar solo, mejorando el chat que ya se usa por MCP y por `web/`.
- **P8 y P9** (estrategia y ahorro). `GET /api/debts` y el calendario son
  ~1 día sobre funciones existentes; no urgen.
- **P1 y P10** (alta y configuración). Se hacen con `npm run onboard` y con las
  14 tools MCP, que funcionan.
- **`review_reason` (H9).** Barato, útil, no urgente con 4 filas en cola.
- **`claude_amount` (H10).** Recortado, con evidencia (§1.1).
- **El retiro de `web/`.** Ticket propio, con el panel ya probado en uso real.
- **El modelo D.** Después del MVP, y sólo si Mato quiere un segundo usuario.

---

## 6. Qué cambia en los tickets

| Ticket | Cambio |
|---|---|
| **TASK-045** | Sigue siendo el paraguas. Sus 25 criterios no se tocan |
| **TASK-046** | Absorbe TASK-052: un middleware que acepta Bearer **o** ID token de Firebase. 1 día |
| **TASK-047** | Se aclara que la capa `api/` y el demo se **copian** (883 líneas sin React); Pinia deja de ser obligatorio; **AC7 se reescribe** (es imposible como está); la franja de revisión pasa a cerrable |
| **TASK-048** | **Fuera del MVP** (el chat se deja para el final). Se parte en dos: motor (independiente) y P7 |
| **TASK-049** | Se parte: **P4+P5 sobre lo que ya existe** entran al MVP; `review_reason` se difiere; **`claude_amount` se recorta con evidencia** |
| **TASK-050** | Sin cambios de alcance; baja de 2–3 días a ~1 |
| **TASK-051** | **P6 Reglas sube al MVP** (206 filas sin categoría). P1 y P10 se quedan diferidos |
| **TASK-052** | **Se cierra como absorbido** por TASK-046 |
| **nuevo** | Ticket de investigación del modelo web (§3): confirmar la verificación de Google y evaluar el modelo D. Sin código |

---

Ver también: `docs/panel-roadmap-implementacion.md` (lo que este doc ataca),
`docs/panel-viabilidad.md` (H1..H31), `docs/panel-manejo-flujo.md` (el plan
funcional), `docs/flujo-app-prototipo.md` (el recorrido clickeable),
`docs/investigacion-riesgos.md` (el forense del cross-check de Claude),
`docs/frontend-desplegado.md` (por qué el sitio actual está en modo demo),
`docs/conectar-gmail.md` y `docs/oauth-para-humanos.md` (el OAuth de hoy).
