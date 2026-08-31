# Scoping: soporte de Outlook como proveedor de correo

**Estado: investigación y diseño. No hay una línea de implementación.**
Este documento existe para que, cuando el wallet se estabilice (meta:
[≥ 9/10 de confiabilidad](reliability.md) + primer piloto humano), construir
el soporte de Outlook sea ejecutar un plan ya pensado y no volver a empezar la
investigación.

Ticket asociado: `tasks/TASK-044.json`.

## Por qué

El wallet hoy sólo lee Gmail. Un amigo que probó la instalación usa Outlook y
se quedó afuera en el primer paso del onboarding — no por el banco, no por el
parser, sino por el buzón. Si aparecen más, es demanda real y no una
hipótesis.

Vale la pena decir explícitamente qué **no** cambia: el banco es el mismo, el
correo es el mismo, el parser es el mismo. Lo único distinto es **cómo se
llega al correo**.

---

## 1. La capa de ingestión hoy: qué tan atada está a Gmail

La respuesta corta es: **mucho menos de lo que parece por los nombres.** La
abstracción correcta ya existe; lo que falta es una segunda implementación y
sacarle a la interfaz la palabra "Gmail".

### 1.1 La frontera ya está trazada

`server/src/ingest/types.ts` define el contrato entero de acceso al correo en
dos métodos:

```ts
export interface GmailClient {
  searchMessageIds(query: string): Promise<string[]>;
  getMessage(id: string): Promise<GmailMessage>;
}

export interface GmailMessage {
  gmail_msg_id: string;
  gmail_thread_id: string | null;
  subject: string;
  body: string;   // texto plano, ya decodificado
  ts: string;     // ISO-8601
}
```

Eso es todo. `pipeline.ts` no importa `googleapis`, no sabe qué es base64url y
no sabe qué es un `multipart/alternative`: recibe un `GmailClient` por
inyección (`IngestDeps.gmailClient`) y le pide ids y mensajes. La razón por la
que esto existe no fue prever Outlook — fue poder testear el pipeline sin red
(`pipeline.test.ts` usa un cliente fake en memoria, 982 líneas de tests que
nunca tocan Google). El efecto colateral es que **el 90% del trabajo de
abstracción ya está hecho y pagado**.

### 1.2 Los cuatro puntos que sí están acoplados

**(a) La implementación concreta.** `googleapis-gmail-client.ts` (127 líneas)
es el único archivo del motor que habla con Google: OAuth2 de `googleapis`,
`users.messages.list` / `.get`, paginación por `nextPageToken`, decodificación
base64url, y el descenso recursivo por el árbol MIME (`findPart`) para
encontrar el `text/plain` — o, si no hay, convertir el `text/html` con
`parser/html-text.ts`. Es el archivo que Outlook necesita como espejo.

**(b) La sintaxis de la búsqueda.** `pipeline.ts:buildSearchQuery()` produce
una query **en el lenguaje de Gmail**:

```
(from:produbanco) after:2026/07/30
```

Con dos particularidades que no son cosméticas y que hay que reproducir, no
copiar:

- `after:` en Gmail toma **fecha, no timestamp**, y se evalúa en el huso de la
  cuenta. Por eso el código resta un día deliberadamente (fix de TASK-017): sin
  eso se perdía silenciosamente la ventana 21:00–24:00 local cada vez que
  avanzaba `last_sync`. El solapamiento resultante es gratis porque la
  persistencia es idempotente.
- El `from:` no está hardcodeado: sale de OR-ear el campo `gmailSenders` de
  **todos los parsers registrados** (`registeredSenders()`). Registrar un banco
  es lo que hace que su correo sea alcanzable.

Un proveedor con `$filter=receivedDateTime ge <ISO>` (Graph) puede filtrar por
timestamp exacto y **no necesita el truco del día**. Eso es un argumento para
que la construcción de la query viva en cada proveedor y no en el pipeline.

**(c) El nombre `gmail_msg_id`, que llega hasta el esquema.** La columna
`transactions.gmail_msg_id TEXT UNIQUE NOT NULL` es **la clave de
idempotencia de todo el sistema** — lo que hace que re-sincronizar sea gratis,
lo que permite reanudar un primer sync interrumpido, lo que absorbe el
solapamiento del punto (b). Aparece además en `statements`, en `sync_progress`
(el JSON de ids pendientes), en `heal-counterparty.ts` (relee correos puntuales
por id) y en `reconstruct.ts`.

Esto **no hay que renombrarlo** para soportar Outlook (ver §5.3): el id de
Outlook entra en esa misma columna sin colisionar. El nombre queda feo; el
costo de arreglarlo no lo paga esta feature.

**(d) El cableado de credenciales.** Tres variables (`GMAIL_OAUTH_CLIENT_ID`
/ `_SECRET` / `_REFRESH_TOKEN`) leídas en `config.ts`, chequeadas en
`sync/build-sync-runner.ts` y en `mcp/server.ts` (`buildGmailClient`), y
exigidas por el paso `gmail` de `onboard/status.ts`. Más el script
`server/scripts/gmail-auth.ts`, que implementa el flujo OAuth de escritorio
con loopback + PKCE.

### 1.3 Lo que NO depende del proveedor

Verificado leyendo el código, no asumido:

| Capa | ¿Depende del proveedor? |
|---|---|
| `parser/` (Produbanco, field-extract, html-text) | **No.** `canParse` mira `subject`/`body`; nada más. |
| `rules/reconcile.ts` (reversos, duplicados, internas) | No. Opera sobre candidatos ya parseados. |
| `category/` | No. |
| `strategy/` (saldo, sueldo, deudas, colchón, calendario) | No. |
| `chat/`, `brief/`, `api/`, `web/` | No. |
| `db/` | Sólo el **nombre** de la columna, no su semántica. |
| `mcp/` | Sólo el mensaje de error y `buildGmailClient`. |
| `ingest/pipeline.ts`, `reconstruct.ts`, `heal-counterparty.ts` | Sólo vía la interfaz — ninguno importa `googleapis`. |

La única excepción real es `BankEmailParser.gmailSenders`: el contrato del
parser tiene una palabra del proveedor adentro. Es un campo de *string*, no de
comportamiento — el remitente `notificaciones@produbanco.com` es el mismo en
los dos buzones. Se renombra a `senders` con un alias de compatibilidad y
listo.

---

## 2. Las dos vías: Microsoft Graph vs IMAP

> **Nota de honestidad:** esta sesión de scoping corrió **sin acceso a la
> web**. Lo que sigue es análisis de arquitectura + conocimiento del ecosistema
> Microsoft, no verificación contra la documentación de hoy. Los puntos
> marcados **[VERIFICAR]** son afirmaciones que hay que confirmar contra
> `learn.microsoft.com` **antes** de escribir código — no después. Ninguna de
> ellas cambia la recomendación; sí pueden cambiar detalles del plan.

### 2.1 Microsoft Graph API

Es la API moderna de Microsoft para correo: `GET /me/messages` sobre
`https://graph.microsoft.com/v1.0`, OAuth 2.0 contra la identidad de
Microsoft, respuesta en JSON.

**A favor:**

- **El mensaje llega decodificado.** Graph devuelve `subject`,
  `receivedDateTime` (ISO-8601, que es exactamente lo que `GmailMessage.ts`
  quiere), `body: { contentType, content }`, `id`, `conversationId`. No hay
  base64url, no hay árbol MIME que recorrer, no hay `quoted-printable`. Las
  ~40 líneas más delicadas del cliente de Gmail (`findPart` / `decodePartData`
  / `decodeBody`) **desaparecen** en esta vía en vez de duplicarse.
- **Filtro por timestamp exacto.** `$filter=receivedDateTime ge 2026-07-30T14:00:00Z`
  hace innecesario el truco de restar un día, y además evita reprocesar mail ya
  ingerido en cada corrida.
- **Paginación explícita** vía `@odata.nextLink` — el mismo bucle `do/while`
  que ya escribimos para `nextPageToken`.
- **Flujo OAuth de la misma forma que el de Google**: app pública / cliente
  nativo, redirect de loopback, PKCE, `offline_access` para obtener refresh
  token. `scripts/gmail-auth.ts` es el molde, no hay que inventar el flujo.
- **Funciona con cuentas personales** (`outlook.com` / `hotmail` / `live`), que
  es exactamente el caso del amigo, y también con cuentas de trabajo/escuela
  (Microsoft 365) sin cambiar el código. **[VERIFICAR]** el endpoint de
  autoridad correcto (`/consumers` sólo personales vs `/common` ambas) y qué
  configuración de "supported account types" hay que elegir en el registro.
- Camino de crecimiento claro: `/messages/delta` da sincronización
  incremental real (token de delta en vez de ventana por fecha), que es
  estrictamente mejor que lo que tenemos con Gmail. No es para la v1.

**En contra:**

- **Requiere registrar una aplicación en Entra ID (Azure)**, y el portal de
  Azure es notoriamente más intimidante que Google Cloud Console. Esto es
  trabajo de **documentación**, no de código, y es el mayor costo real de la
  feature para el usuario final (ver §5.2).
- La combinación de `$search` (KQL) con `$filter`/`$orderby` tiene
  restricciones. **[VERIFICAR]** — el plan de la v1 lo evita a propósito: se
  filtra por `receivedDateTime` + remitente con `$filter` solamente, sin
  `$search`.
- Límites de throttling por buzón. **[VERIFICAR]** los números vigentes; el
  sync ya viene con lote y presupuesto de tiempo (`DEFAULT_SYNC_BATCH_SIZE`,
  `DEFAULT_SYNC_MAX_MS`), así que el mecanismo para respetarlos ya existe.
- Un SDK más (`@microsoft/microsoft-graph-client` o `fetch` a pelo — para dos
  endpoints, `fetch` alcanza y evita una dependencia).

### 2.2 IMAP (`outlook.office365.com`)

**A favor:**

- Protocolo estándar y viejo: `IMAP SEARCH` + `FETCH`, sirve para Outlook,
  Yahoo, y cualquier buzón corporativo. En teoría, un solo cliente para todo
  lo que no sea Gmail.
- No depende de que Microsoft mantenga una API.

**En contra — y acá se cae:**

- **La autenticación básica (usuario + contraseña) ya no existe.** Microsoft
  la retiró de Exchange Online y después de las cuentas personales de
  Outlook.com; IMAP contra Outlook hoy exige **OAuth 2.0 con XOAUTH2**.
  **[VERIFICAR]** las fechas y el estado exacto, pero la dirección del viaje no
  está en duda. Esto elimina de un plumazo el único argumento fuerte de IMAP:
  **igual hay que registrar la app en Azure y hacer el mismo flujo OAuth.** Se
  paga el costo caro de Graph sin ninguno de sus beneficios.
- **Vuelve a poner el MIME encima de la mesa.** IMAP entrega el mensaje crudo
  RFC 5322: hay que parsear el árbol multipart, decodificar `base64` y
  `quoted-printable`, y resolver `charset` a mano (o con `mailparser`, que es
  una dependencia bastante más pesada que `fetch`). Es *exactamente* el
  trabajo que Graph ya hizo — y es el trabajo donde vive nuestro bug histórico
  más sutil (el mojibake, §4).
- Conexión con estado, sockets, timeouts, reconexión, `UIDVALIDITY`. Un cliente
  HTTP sin estado encaja mucho mejor con un pipeline por lotes que se corta a
  los 45s y reanuda.
- **[VERIFICAR]** si IMAP/POP siguen habilitados por defecto en cuentas
  personales de Outlook.com o quedaron detrás de un toggle — hay señales de que
  Microsoft los está empujando hacia la salida. Construir sobre eso es
  construir sobre algo que se está apagando.

### 2.3 Recomendación: **Microsoft Graph**

No por modernidad. Por tres razones concretas:

1. **IMAP no es más simple.** Su supuesta ventaja (auth trivial) ya no existe:
   pide el mismo registro en Azure y el mismo OAuth. Lo que queda es sólo su
   desventaja.
2. **Graph nos devuelve el cuerpo ya decodificado**, y la decodificación es
   justamente donde el proyecto tiene la cicatriz (mojibake, `findPart`,
   HTML crudo llegando al parser). Menos código nuestro en esa zona es menos
   superficie para el mismo bug otra vez.
3. **Su modelo mental es el que el pipeline ya tiene**: pedir ids, pedir
   mensajes, paginar. `searchMessageIds` + `getMessage` se implementan casi
   línea por línea contra Graph; contra IMAP hay que traducir de un protocolo
   con sesión a una interfaz sin ella.

IMAP queda anotado como plan B **explícito** para un caso distinto: soportar
proveedores misceláneos (Yahoo, correo corporativo genérico) más adelante. La
abstracción de §3 lo deja entrar sin rediseño.

---

## 3. El diseño: `MailProvider`

La idea es **no inventar una abstracción nueva**, sino renombrar la que ya
funciona y darle una segunda implementación.

### 3.1 El contrato

```ts
// server/src/ingest/types.ts

/** Un mensaje de correo, ya decodificado a texto plano, venga de donde venga. */
export interface MailMessage {
  /** Id del mensaje en SU proveedor. Es la clave de idempotencia del ledger. */
  msg_id: string;
  thread_id: string | null;
  subject: string;
  body: string;
  ts: string; // ISO-8601
}

/** Acceso de SOLO LECTURA al buzón. Sólo existen `search` y `get` a propósito:
 * el read-only se hace cumplir en el código, no sólo en el scope OAuth. */
export interface MailProvider {
  /** Identificador estable: "gmail" | "outlook". Sólo para telemetría/errores. */
  readonly providerId: string;

  /**
   * Ids de todos los mensajes de `senders` recibidos desde `sinceTs`,
   * paginando internamente.
   *
   * La firma cambia respecto de `searchMessageIds(query: string)`: el pipeline
   * pasa INTENCIÓN (remitentes + timestamp), no sintaxis. Cada proveedor
   * traduce a la suya — y ahí es donde vive el "-1 día" de Gmail, que Graph
   * no necesita porque filtra por timestamp exacto.
   */
  searchMessageIds(params: { senders: readonly string[]; sinceTs: string }): Promise<string[]>;

  getMessage(id: string): Promise<MailMessage>;
}
```

Ese cambio de firma es **el único de fondo** en todo el diseño, y es el que
paga: mueve la sintaxis de búsqueda adentro del proveedor, que es el único que
la conoce. `buildSearchQuery` no se borra — se muda a
`gmail-provider.ts` con sus tests intactos, porque su comentario sobre el huso
horario es conocimiento ganado a golpes y no se tira.

`GmailClient` y `GmailMessage` se mantienen como alias `@deprecated` de
`MailProvider`/`MailMessage` para que el renombre no sea un big-bang.

### 3.2 Los archivos

```
server/src/ingest/
  types.ts                 # MailProvider, MailMessage (+ alias deprecados)
  providers/
    gmail-provider.ts      # el googleapis-gmail-client.ts de hoy, movido,
                           # + buildSearchQuery adentro
    outlook-provider.ts    # NUEVO: Microsoft Graph
    index.ts               # createMailProvider(config) -> elige por WALLET_MAIL_PROVIDER
```

`createMailProvider` es la única pieza nueva de decisión, y es un `switch` de
diez líneas sobre una variable de entorno. Ningún llamador
(`build-sync-runner.ts`, `mcp/server.ts`) elige proveedor: piden "el
proveedor configurado".

### 3.3 Qué cambia en cada archivo

| Archivo | Cambio |
|---|---|
| `ingest/types.ts` | Renombres + alias deprecados. |
| `ingest/pipeline.ts` | `deps.gmailClient` → `deps.mailProvider`; `searchMessageIds` pasa `{senders, sinceTs}` en vez de un string. **Cero lógica nueva.** |
| `ingest/providers/gmail-provider.ts` | Movido tal cual + absorbe `buildSearchQuery`. |
| `ingest/providers/outlook-provider.ts` | Nuevo, ~120 líneas. |
| `sync/build-sync-runner.ts` | El gate de credenciales pasa a ser por proveedor. |
| `mcp/server.ts` | `buildGmailClient` → `buildMailProvider`; el texto del error deja de decir "Gmail". |
| `onboard/status.ts` | El paso `gmail` pasa a `correo`, y su `action` depende del proveedor elegido. |
| `parser/types.ts` | `gmailSenders` → `senders` (alias de compatibilidad). |
| `scripts/outlook-auth.ts` | Nuevo, calcado de `gmail-auth.ts`. |
| `heal-counterparty.ts`, `reconstruct.ts` | Sólo el tipo del parámetro. |
| `parser/produbanco.ts` y **todo** `strategy/`, `category/`, `rules/`, `chat/`, `api/`, `web/` | **Nada.** |

### 3.4 La invariante que hay que cuidar en la ejecución

El pipeline es hoy 100% testeable con un proveedor fake en memoria. **Eso no
puede degradarse.** El `OutlookProvider` se testea igual que el de Gmail:
`googleapis-gmail-client.test.ts` mockea `googleapis`; el de Outlook mockea
`fetch`. Ni un test nuevo que necesite red o credenciales.

---

## 4. El banco y el mojibake

**Para el parser de Produbanco, Outlook no cambia nada.** `canParse()` mira
`subject` y `body`; `classify()` corre regex sobre el texto. Ninguna de las
653 líneas de `produbanco.ts` sabe de dónde vino el correo, y los tests
(`produbanco.test.ts` + `produbanco-formato-real.test.ts`, 1441 líneas) corren
sobre strings, no sobre buzones. El banco manda el mismo correo a los dos
lados.

Dicho eso, hay **dos riesgos reales en el borde**, y son la parte de esta
feature que no se puede resolver leyendo documentación:

### 4.1 El mojibake: probablemente sí, pero hay que verlo

El daño que repara `mojibake.ts` **viene hecho desde el emisor**: Produbanco
manda un correo que declara `charset=us-ascii` y contiene los bytes UTF-8 de
la "ó" re-codificados como si fueran latin-1 (`C3 83 C2 B3` en vez de
`C3 B3`). Los bytes son del mensaje, no de Gmail.

Como los bytes son los mismos, **lo esperable es que el daño sobreviva a
Graph** y que `repairMojibake` siga siendo necesario. Pero la decodificación
la hace Exchange del lado del servidor, y un decodificador distinto frente a un
`charset` mal declarado puede producir una secuencia **distinta** — que
`MOJIBAKE_RE` no reconozca, o peor, que reconozca mal.

Lo bueno: `repairMojibake` es idempotente y tiene tres guardas que devuelven el
texto intacto si no hay evidencia clara de daño. **Cablearlo en el proveedor de
Outlook es seguro pase lo que pase.** Lo que no se puede saltear es la
verificación empírica: capturar un correo real con tildes/eñes en un buzón de
Outlook y comparar carácter por carácter contra el mismo correo en Gmail. Esa
comparación es un criterio de aceptación del ticket, no un "ya veremos".

### 4.2 HTML vs texto plano: el riesgo más grande de la feature

En Gmail el cliente **prefiere `text/plain`** y sólo cae a convertir HTML si no
hay otra cosa. Graph entrega **una** representación del cuerpo — HTML en la
mayoría de los correos bancarios — y ofrece pedir texto con un header
(`Prefer: outlook.body-content-type="text"`), que hace la conversión **del lado
de Microsoft**, con un algoritmo que no es el nuestro.

Ahí hay una trampa fina: si Exchange convierte a texto con reglas distintas a
`parser/html-text.ts`, el mismo correo produce dos strings distintos según el
buzón — y `extractField` corta los campos en el salto de línea, así que una
diferencia de saltos puede cambiar un `counterparty`. Un `counterparty` con
espacios de más envenena el matching por substring de `category/categorize.ts`,
que es justo la cicatriz que dejó el bug de las contrapartes con marcado HTML.

**Decisión de diseño:** el proveedor de Outlook pide **HTML** y lo convierte
con **nuestro** `htmlToText`, para que los dos buzones pasen por el mismo
código. Y el criterio de aceptación correspondiente no es "compila": es
**tomar el mismo correo del banco en los dos buzones y verificar que
`parseEmail` produce campos idénticos.**

---

## 5. Costo y riesgo, sin maquillaje

### 5.1 Tamaño

**Mediano. Del orden de dos a cuatro días de trabajo enfocado**, con la mayor
incertidumbre en el registro de Azure, no en el código.

| Bloque | Costo | Riesgo |
|---|---|---|
| Renombre `GmailClient` → `MailProvider` + mover el cliente de Gmail | Bajo (mecánico, la suite lo cubre) | Bajo |
| Cambio de firma de `searchMessageIds` (string → `{senders, sinceTs}`) | Bajo-medio | **Medio**: acá vive el fix del "-1 día". Si se pierde en la mudanza, se pierde correo en silencio. Los tests de `buildSearchQuery` se mudan con él, sin tocarlos. |
| `OutlookProvider` contra Graph | Medio | Medio: paginación, throttling, forma de la respuesta |
| Flujo OAuth de Microsoft + `scripts/outlook-auth.ts` | Medio | **Alto** hasta que se haga una vez con una cuenta real |
| Onboarding + `docs/conectar-outlook.md` | Medio | Bajo técnicamente, **alto en fricción para el usuario** |
| Verificación empírica (mojibake + HTML) | Bajo | **Alto**: requiere un buzón de Outlook real con correos del banco |

### 5.2 El costo que no es código

Registrar una app en Entra ID (Azure) para conseguir un client id. Es el mismo
tipo de paso que ya pedimos para Google (`docs/conectar-gmail.md`), pero el
portal de Azure es más denso y la nomenclatura ("app registration",
"supported account types", "public client flows", "redirect URI") es más
hostil. **Este es el mayor riesgo de adopción de toda la feature**, y se paga
con documentación al mismo nivel de detalle que la de Gmail: capturas, texto
exacto de cada botón, y qué hacer cuando el consentimiento falla.

### 5.3 Lo que puede romper

1. **La clave de idempotencia.** Los ids de Graph son opacos y largos, y
   **cambian cuando el mensaje se mueve de carpeta** salvo que se pidan ids
   inmutables (`Prefer: IdType="ImmutableId"`). Si no se piden, mover un correo
   de Inbox a Archivo lo hace re-ingresar como transacción nueva: **gasto
   duplicado en el ledger.** Es el riesgo más serio del ticket y por eso es un
   criterio de aceptación explícito. **[VERIFICAR]** la disponibilidad de ids
   inmutables en cuentas personales.
   Alternativa más limpia a futuro: usar `internetMessageId` (el `Message-ID`
   de RFC 5322), que es del mensaje y no del proveedor — pero eso es cambiar la
   clave del ledger entero y **no entra en este ticket**.
2. **La longitud del id.** `gmail_msg_id` es `TEXT`, sin límite: SQLite no se
   inmuta. No hay problema real, se anota para que nadie lo "optimice".
3. **Mezclar dos buzones en una misma base.** No está soportado y **no debe
   intentarse en la v1**: un proveedor por instalación. Cambiar de proveedor
   sobre un ledger existente no borra nada (los ids no colisionan), pero el
   historial queda partido en dos épocas. El onboarding tiene que decirlo.
4. **Regresión silenciosa en la ventana de búsqueda** — ver 5.1.
5. **Divergencia de texto plano** — ver §4.2.

### 5.4 Lo que no corre ningún riesgo

Categorización, reglas de comercio, reconciliación de reversos, transferencias
internas, estrategia (saldo/sueldo/deudas/colchón/calendario), chat, brief,
dashboard, MCP, y el parser de Produbanco entero. Ninguna de esas capas
importa nada de `ingest/providers/`. Es la mejor noticia del scoping: el
soporte de Outlook toca **un archivo nuevo y los bordes**, no el motor.

---

## 6. Orden de ejecución sugerido

Pensado para que cada paso sea verificable solo y ninguno deje el repo roto:

1. **Renombre puro.** `GmailClient` → `MailProvider`, `GmailMessage` →
   `MailMessage`, con alias deprecados. Sin cambio de comportamiento, suite
   verde sin editar tests.
2. **Mover** el cliente de Gmail a `providers/gmail-provider.ts` y meterle
   `buildSearchQuery` adentro, con el cambio de firma de `searchMessageIds`.
   Los tests de la query se mudan sin tocar sus aserciones.
3. **`createMailProvider`** + `WALLET_MAIL_PROVIDER` (default `gmail`).
   Nadie nota nada.
4. **`OutlookProvider`** contra Graph, con `fetch` mockeado en los tests.
5. **`scripts/outlook-auth.ts`** + variables `OUTLOOK_OAUTH_*`.
6. **Onboarding** (paso `correo` en vez de `gmail`) + `docs/conectar-outlook.md`.
7. **Verificación con un buzón real**: mojibake, texto plano, ids inmutables.
   Este paso es el que cierra el ticket — sin él, la feature está escrita pero
   no verificada, que es exactamente el estado que
   [`docs/reliability.md`](reliability.md) llama "ASUMIDO".

Los pasos 1–3 son valiosos **aunque Outlook nunca se construya**: dejan la
capa de ingestión honestamente agnóstica y borran del motor la mentira de que
Gmail es la única forma de leer correo.
