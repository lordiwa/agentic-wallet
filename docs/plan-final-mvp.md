# Plan final del panel de manejo — MVP sellado

**Qué es esto, en una línea:** el plan **sellado** del panel. No es una
propuesta ni una base para discutir: las decisiones ya están tomadas y este
documento es la especificación contra la que se implementa.

Reemplaza al plan preliminar de `docs/wargaming-simplificacion.md` §3 (que era
explícitamente *"una base para discutir con Mato, no un plan sellado"*) y al
plan probado B0..B3 de `docs/panel-prep-implementacion.md`. Todo lo demás de
esos documentos —el forense del ledger, los flujos F1..F12, el inventario de
cabos sueltos H/D/X/T/W— **sigue vigente y este plan lo referencia sin
repetirlo**.

**Este documento no implementa nada.** Es la especificación. La implementación
vive en los tickets `TASK-054..TASK-059`, uno por fase.

---

## 0. Las seis decisiones de Mato — selladas

Las seis decisiones que `wargaming-simplificacion.md` §3.5 listaba como
*"lo que hay que decidir antes de escribir la primera línea"* están **tomadas**.
No se re-abren. Cada una entra como criterio de aceptación de la fase que la
implementa.

| # | Decisión | Resuelve | Fase que la implementa |
|---|---|---|---|
| **M1** | **El criterio de terminado de la cola es "30 respuestas que cubren el 80 % de la plata", NO "cero filas".** | D11, riesgo 1 | N1 (el cálculo), N3 (lo que celebra la pantalla) |
| **M2** | **El chat va al final.** Diferido, fuera del MVP — motor y pantalla. | F9, W7 | — (fuera) |
| **M3** | **Sin login Google ni Firebase en el MVP. Solo llave (token).** | D9, F1 | N0 |
| **M4** | **El editor de reglas queda absorbido por la cola de clasificación.** Responder *"qué es esto"* escribe la regla; no hay pantalla de editor. | D13, D3, F8 | N1 (el escritor), N3 (la pregunta) |
| **M5** | **La cola pregunta por CONTRAPARTE, con silenciador (H33).** *"No preguntarme más por esta"* se construye en la v1. | D7, D10, W3 | N1 (motor), N3 (pantalla) |
| **M6** | **Modelo D (reenvío de correo a una dirección propia) al futuro.** Fuera del MVP. | D4 parcial | — (fuera) |

**Lo que M1 cambia y hay que tener presente:** la pantalla **no** celebra el
vacío. Celebra la cobertura. Con 151 contrapartes y 90 de ellas con una sola
fila, "cero filas" no es un estado alcanzable en una tarde; "cubriste el 80 % de
tu plata" sí, y son 30 respuestas.

**Lo que M5 cambia:** la unidad de la cola no es la fila. Son **151 grupos**, no
334 filas. Y el silenciador es lo único que evita que una contraparte con dos
verdades (un mes salud, otro préstamo) vuelva a la cola para siempre.

**Lo que M3 cambia:** `WALLET_ACCESS_TOKEN` es la única credencial del MVP.
`firebase-admin` no se instala, no hay uid permitido, no hay cuenta de servicio.
La puerta sigue siendo el middleware del server — que es lo que siempre
protegió — y P0 sólo aportaba comodidad.

**Decisión residual, ya tomada dentro del wargaming y que se sella acá:**
**D6 → opción A** (el teléfono se atiende con un diseño chico del **Resumen**
solamente; las demás superficies se ven bien en escritorio y son usables en
teléfono, sin diseño chico propio) y **D7-b → las dos** (la cola se ordena por
plata por defecto, y el aviso post-sync lleva a la cola filtrada por lo que
entró en ese lote).

---

## 1. El MVP, en una línea

> **Entro con una llave, veo mi saldo, sincronizo desde el mismo lugar, y el
> panel me pregunta —por comercio y empezando por el que más plata mueve— qué
> son mis movimientos; la primera vez me propone además mis gastos fijos leídos
> del historial.**

**Incluye, sin nada de más:**

- Los **dos escenarios de Mato**, completos.
- Ver el saldo y el gasto del mes.
- Sincronizar y saber en qué estado está.
- Las 4 filas de revisión de monto, sobre rutas que ya existen.

**No incluye:** login con Google, Firebase, chat, estrategia, ahorro, editor de
reglas, pantalla de configuración, registro de lotes de sync, *Detener*,
FilterBar completa, paginador con total, `review_reason`, `claude_amount`,
Modelo D.

**Once pantallas dibujadas → tres superficies:** el **Resumen** (con el sync y
el análisis del historial adentro), **Preguntas** (dos pestañas) y
**Movimientos**. Más el **chip de backend** en la barra, que no es pantalla.

---

## 2. Requisito de diseño — obligatorio

**Todo el panel replica exactamente el design system
`Agentic Wallet Panel - Design System` de Claude Design.** No es una inspiración
ni una guía de estilo suelta: los colores, la tipografía, el espaciado, los
radios y los componentes son los del sistema, con sus valores exactos.

- **Referencia canónica:** la tarjeta **`home.html`** del proyecto —
  <https://claude.ai/design/p/d509acfb-b4ad-480d-aa67-1b09b16a13c2?file=home.html>
  (proyecto `d509acfb-b4ad-480d-aa67-1b09b16a13c2`, 19 tarjetas).
- **Espejo local de las 19 tarjetas:** `/opt/data/home/wallet-panel-ds-previews/`
  (fuera del repo a propósito — es la deuda **T2**, que este plan no resuelve).
  Los tokens están en `00-fundamentos.html`; el *shell* (barra lateral, cabecera,
  chips) se repite idéntico en las once `p*.html`.

### 2.1 Los tokens, con sus valores exactos

De `00-fundamentos.html`. **Estos números son el contrato**: van una sola vez a
`panel/src/styles/tokens.css` como variables CSS, y ningún componente escribe un
hex a mano.

| Rol | Valor | Dónde se usa |
|---|---|---|
| Nav | `#101A26` | fondo de la barra lateral |
| Tinta | `#17202A` | texto principal |
| Apagado | `#5B6B7C` | texto secundario, etiquetas, notas |
| Fondo | `#F6F7F9` | fondo de la aplicación |
| Panel | `#FFFFFF` | fondo de tarjeta |
| Línea | `#DDE3EA` | bordes |
| Acción | `#2B5FD9` | botón primario, enlaces, barras del gráfico |
| Al día | `#1C7A45` | estado correcto |
| Atención | `#E0B73A` | estado a medias / pendiente |
| Falla | `#B3261E` | error |

**Tipografía:** `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
Escala fija: cifra 26px/640 con `font-variant-numeric: tabular-nums`;
H1 20px/640 (`letter-spacing:-.015em`); H2 14px/650; label 11px/650 en
mayúsculas con `letter-spacing:.05em`; body 15px; small 12.5px.
**Toda cifra de plata es tabular, sin excepción.**

**Forma:** radio 6 control · 8 botón · 10 tarjeta · 20 etiqueta.

**Etiquetas de estado** (`.tag`): `ok` `#E8F6EE`/`#B8E0C8`/`#1C7A45`,
`warn` `#FFF4D6`/`#E0B73A`/`#8A6200`, `bad` `#FDECEB`/`#F2C0BC`/`#B3261E`,
`neu` `#F0F3F7`/`#DDE3EA`/`#5B6B7C`, `acc` `#EAF0FF`/`#C3D4FB`/`#2B5FD9`.

**Botones:** primario `#2B5FD9` sólido con texto blanco 600; secundario blanco
con borde `#DDE3EA`; terciario sin borde con texto `#2B5FD9`; deshabilitado
`#F0F3F7` con texto `#9AA8B6`.

**Shell:** `grid-template-columns: 236px 1fr`; barra lateral `#101A26` con
enlaces 13.5px `#A9B8C8`, activo `#1D2D3F` con texto blanco 600, separadores
`1px solid #1D2D3F`; contenido con `padding: 20px 26px 40px`; cabecera con H1 +
subtítulo `.sub` a la izquierda y acciones a la derecha.

### 2.2 Qué tarjeta del sistema gobierna cada superficie del MVP

| Superficie del MVP | Fase | Tarjeta de referencia | Cómo se usa |
|---|---|---|---|
| Shell (barra lateral, cabecera, chips) | N2 | `home.html` + el shell repetido en `p2-resumen.html` | Idéntico. **La navegación se recorta a Resumen · Preguntas · Movimientos** — no se dibuja un enlace a una pantalla que el MVP no construye |
| Pantalla de la llave | N0 | `p0-acceso.html` | Mismo lienzo y misma tipografía, **sin el botón de Google**: un campo, un botón primario y el texto de ayuda. Es la única variación grande y se **crea** como tarjeta nueva del sistema (ver §2.4) |
| Chip de backend | N0 | el bloque de conexión de `p10-configuracion.html` | Se reduce a un chip en la barra con el mismo lenguaje visual: estado + servidor + *Probar conexión* |
| Resumen | N2 | `p2-resumen.html` | Rejilla de tarjetas, gráfico de barras por categoría, aviso `.alert` amarillo, cabecera con estado y acción. **Se quitan** las tarjetas cuyo destino no existe (Tarjeta y Colchón muestran cifra, sin navegar) y el brief |
| Tarjeta del Resumen | N2 | `c3-tarjeta-overview.html` (`OverviewCard`) | Componente literal: etiqueta 11px mayúsculas, cifra 26px tabular, nota 12.5px |
| Botón de sync | N2 | `c1-boton-sync.html` (`SyncButton`) | **De los ocho estados dibujados, el MVP usa cinco**: al día, atrasado, nunca, corriendo, falló. *A medias* se dibuja como *corriendo* con el pendiente al lado; 409 y 503 comparten el cartel de falla con distinto texto |
| Progreso del sync | N2 | `p3-sincronizacion.html` | La pantalla **no se construye**: se toma de ella la barra de progreso y el botón *Seguir*, y viven **dentro del chip del Resumen** |
| Preguntas · pestaña *Monto* | N3 | `p5-revision.html` (`c2-tarjeta-revision.html`, `ReviewCard`) | Misma tarjeta, en su **versión honesta**: se elimina el panel *"lo que leyó Claude"* (H10, cero discrepancias en 8 meses) y la línea de motivo (H9). Quedan contraparte, monto del ledger, asunto y las tres acciones |
| Preguntas · pestaña *Qué es esto* | N3 | **no existe** → se crea (§2.4) | Reusa el armazón de `ReviewCard` y el selector de categoría de `p6-reglas.html`. `p6` **no** se construye como pantalla |
| Análisis del historial | N4 | `p1-alta-perfil.html` | Se toman la lista de propuestas y los campos; **se elimina el checklist de 6 pasos** y dos de los cuatro campos. Se entra por una tarjeta del Resumen, no por pantalla propia |
| Movimientos | N5 | `p4-movimientos.html` + `c4-tabla-transacciones.html` (`TransactionsTable`) | Tabla literal. **Sin FilterBar**: dos controles sueltos arriba de la tabla, con el estilo de `c6-selector-filtros.html`. Sin paginador: *cargar más* |
| Chat | — | `p7-chat.html`, `c5-panel-chat.html` (`ChatPanel`) | **Fuera del MVP (M2).** Las tarjetas quedan en el sistema para cuando vuelva |
| P8 · P9 · P10 · P6 | — | `p8`, `p9`, `p10`, `p6` | **Fuera del MVP.** No se portan |

### 2.3 Las reglas de contenido del sistema son las del motor

`00-fundamentos.html` cierra con cuatro reglas que **no** son decoración; son las
invariantes del proyecto dibujadas, y el panel las respeta:

1. **Cero nunca es "no sé".** Un monto desconocido es `needs_review`, y se dibuja
   con la etiqueta neutra — jamás como `0`.
   *Corrección obligatoria (R6/X8/X11):* el motor **nunca** devuelve
   `amount: null` (`db/schema.ts:13` declara `amount REAL NOT NULL`). La etiqueta
   del sistema que dice *"Sin leer"* se usa para los campos del resumen que sí
   pueden ser nulos (`card`, `next_payday`); para una fila, la etiqueta correcta
   es **"Sin confirmar"** sobre `needs_review = 1`.
2. **Sin fecha inventada.** Si nunca hubo sync, dice "nunca sincronizaste".
3. **Nada precargado.** Los formularios arrancan vacíos y nada se guarda sin
   confirmación explícita.
4. **El panel no calcula.** Todo total, proyección o categoría llega del motor.

### 2.4 Qué falta en el sistema y hay que crear

Tres piezas del MVP no tienen tarjeta. **Se crean siguiendo el mismo sistema**
—los tokens de §2.1, sin colores, tipografías ni radios nuevos— y se suben al
proyecto de Claude Design con su marcador `@dsCard` antes de darse por
terminadas:

| Pieza nueva | Grupo | De dónde hereda |
|---|---|---|
| **`P0-b — Acceso por llave`** | Páginas | `p0-acceso.html` sin el botón de Google |
| **`P5-b — Preguntas · Qué es esto`** | Páginas | armazón de `p5-revision.html`, selector de `p6-reglas.html` |
| **`ClassifyCard — tarjeta de contraparte`** | Componentes | `c2-tarjeta-revision.html`; agrega el conteo de movimientos, el total en plata, la barra de progreso por plata y las acciones *Saltar* y *No preguntarme más* |

Y dos que son variantes, no tarjetas nuevas: el **`BackendChip`** (chip de la
barra, derivado de `p10`) y el **`SyncButton` de cinco estados** (recorte del
existente, se documenta en la misma tarjeta `c1`).

### 2.5 Cómo se verifica que "replica exactamente"

Criterio objetivo, no impresión. En cada fase con UI:

1. `panel/src/styles/tokens.css` contiene los valores de §2.1 **textualmente**, y
   `grep` de literales de color (`#[0-9a-fA-F]{6}`) fuera de ese archivo devuelve
   **cero** resultados en `panel/src/`.
2. Los componentes se llaman como el sistema: `SyncButton.vue`,
   `OverviewCard.vue`, `ReviewCard.vue`, `TransactionsTable.vue`,
   `ClassifyCard.vue`, `BackendChip.vue`.
3. Cada pantalla entregada se compara **lado a lado** con su preview `.html`, y
   la diferencia se justifica por escrito en el ticket (siempre es un recorte del
   MVP, nunca una diferencia de estilo).
4. Ningún elemento dibujado carece de backend. **Lo que no tiene backend no se
   dibuja** — el criterio no cambió en cuatro documentos.

---

## 3. Las fases

Seis fases, **8–8,5 días**. El orden importa: **N1 antes que N3** porque *la
pregunta se construye después de la función que la responde*.

```
N0 puerta  --->  N1 motor de la pregunta  --->  N2 andamio + hogar
                                                     |
                              +----------------------+----------------------+
                              |                      |                      |
                              v                      v                      v
                    N3 cola de preguntas    N4 análisis historial    N5 movimientos
                      (Escenario 1)            (Escenario 2)
```

---

### N0 · La puerta mínima — 0,5–1 día · `TASK-054`

**Qué entrega.** El server se expone al tailnet con llave, y la credencial no
puede viajar a un host ajeno.

- Middleware Bearer sobre `WALLET_ACCESS_TOKEN` en `/api/*`; `GET /api/health`
  queda **sin llave** y expone `auth_required`.
- `api/cors.ts` suma `Authorization` y `DELETE` a lo permitido (hoy no los
  acepta: el panel publicado no cargaría).
- **Lista blanca de orígenes en el cliente.** `web/src/api/base.ts:62-70` guarda
  el `?api=` de un enlace **sin preguntar**; con el token en la cabecera, eso es
  la credencial viajando a un host ajeno. Un origen fuera de la lista se llama
  **sin credencial**.
- `?api=` pide confirmación explícita antes de guardarse.
- Chip de backend siempre visible, con *Probar conexión* (R27: servidor caído,
  CORS y credencial rechazada producen el mismo error de red; `health` los
  distingue).
- `tailscale serve` probado con `curl`, y el checklist de credenciales **D14**
  marcado.

**Cabos que cierra.** H1, R1, R2, R27, **M3 (D9)**, D14.

**UI.** `P0-b` (creada, §2.4) + `BackendChip`. Sin Firebase, sin botón de Google.

**Riesgo.** Bajo, salvo D14: son tareas de Mato en su máquina y **ninguna está
hecha**. Es el único bloqueo externo del MVP.

---

### N1 · El motor de la pregunta, sin pantalla — 1,5 días · `TASK-055`

**Qué entrega.** Todo lo que la pantalla de N3 va a preguntar, contestable ya
desde la terminal y desde MCP.

- **Cola de clasificación agrupada por contraparte** (H32), con la categoría
  **recalculada** —la misma que lee el gráfico del Resumen
  (`strategy/spending.ts:32-58`)—, no la columna `category`. Sobre el ledger
  real: **334 filas → 151 grupos**.
- **`POST /api/classify`** (H28): escribe **una regla** con `upsertCategoryRule`
  + `toRulePattern` derivado de la contraparte real. Ese derivado es lo que hace
  imposible la trampa conocida del proyecto (un patrón más largo que la
  contraparte nunca matchea) — y es la razón por la que **M4** puede eliminar el
  editor sin perder funcionalidad.
- **Silenciador de contraparte** (H33, **M5**): una contraparte silenciada sale
  de la cola y no vuelve. Sin esto la cola nunca cierra.
- **Progreso por plata** (H35, **M1**): acumulado del mismo cálculo, capaz de
  responder *"30 respuestas cubren el 80 % de tu plata sin clasificar"*.
- El filtro por categoría **recalculada** para movimientos (H21 **bien
  planteado**: `WHERE category = ?` devolvería un conjunto distinto del que la
  barra del gráfico contó).

**Cabos que cierra.** H32, H27, H28, H33, H35, H21, W3, W5, T10, **M1**, **M4**,
**M5**.

**UI.** Ninguna. Es motor.

**Verificación.** `tdd`. Es la fase donde una regla mal escrita reclasifica plata
real.

---

### N2 · Andamio + el hogar con el sync adentro — 2 días · `TASK-056`

**Qué entrega.** Mato ve su saldo real y sincroniza, desde el teléfono.

- Workspace `panel/` (Vue 3), con `vitest.config.ts` incluyendo `panel/` y
  `jsdom` donde hace falta (**T5**: hoy `environment: "node"` es global y los
  tests del panel no correrían, y nadie se enteraría).
- Capa `api/` **copiada** de `web/` (883 líneas, sin React) y el reloj como
  composable. **Copiar es copiar**: si alguien "aprovecha y mejora" `base.ts`, la
  estimación se va (riesgo 6).
- **Resumen** completo (§2.2), con el **sync adentro del chip**: disparar, barra
  de progreso, *Seguir*, terminar. Sin pantalla P3, sin registro de lotes (H17),
  sin *Detener* (H18: `sync/run-sync.ts:163` escribe el progreso una vez por
  lote, al final — el botón no detiene nada).
- `running` expuesto en `GET /api/sync/status` (R9) y `batch_size` por HTTP
  (H19).
- Los dos avisos post-sync, **separados**: uno pregunta un **monto**, el otro una
  **categoría**. El de categoría lleva a la cola **filtrada por el lote**
  (D7-b).
- Modo demo cubriendo lo que el andamio necesita (**T4**, contado como trabajo).
- CI que corra `npm run build` y `npm test` (**T6**).

**Cabos que cierra.** R6, R7 (no decir "podés gastar 0,00" cuando el dato es
"todavía no sé"), R9, R30/**D6 opción A**, H19, T4, T5, T6, W6.

**UI.** `p2-resumen.html`, `c3-tarjeta-overview.html`, `c1-boton-sync.html`
(5 estados), la barra de `p3-sincronizacion.html` dentro del chip.

---

### N3 · La cola de preguntas — 1,5 días · `TASK-057` · **Escenario 1**

**Qué entrega.** El Escenario 1 de Mato, de punta a punta.

Una pantalla, dos pestañas, dos preguntas distintas:

- ***Qué es esto*** — 151 grupos ordenados por plata. Cada tarjeta:
  contraparte, cuántos movimientos, cuánta plata, en cuántos meses. Elijo
  categoría → **se escribe una regla** → bajan todas las filas de esa
  contraparte. Acciones: *Saltar* (vuelve al final, no se pierde) y
  *No preguntarme más por esta* (**M5**).
- ***Monto*** — 4 filas, sobre las tres rutas que ya existen. Con R12
  (*descartar no mueve el saldo*, `totals.ts:19-20` excluye también
  `is_discarded`), R13 (`changed:false` **no** es éxito) y R14 (otra moneda:
  *Confirmar* deshabilitado con su motivo).
- **Si una fila está en las dos pestañas, se pregunta el monto primero** — sin
  monto afirmado la fila no entra a ningún total y su categoría no movería
  ningún gráfico.
- **Progreso por plata visible** y **criterio de terminado M1**: la pantalla dice
  *"te queda el 47 % de tu plata sin clasificar · 30 respuestas más"*, y celebra
  al 80 %, no al vacío.
- **La honestidad de F13/R19** en las dos pestañas: *"reclasificaste 14
  movimientos, 2 de ellos de este mes"*. El gráfico del Resumen es del **mes en
  curso** (`api/routes.ts:91,111`); si la pantalla promete un efecto, tiene que
  poder decir cuándo el efecto es cero y por qué.

**Cabos que cierra.** R12, R13, R14, R19, R31, **M1 (D11)**, **M5 (D7, D10)**,
D7-b, F13.

**UI.** `p5-revision.html` para *Monto* (ReviewCard en versión honesta) +
`P5-b` y `ClassifyCard`, **creadas** (§2.4).

---

### N4 · El análisis del historial — 1,5 días · `TASK-058` · **Escenario 2**

**Qué entrega.** El Escenario 2 de Mato, y el Resumen deja de mostrar `0,00`
como si fuera un dato.

- **`suggestRecurringExpenses`** (H30) con **mediana, no promedio** — un mes con
  dos pagos del mismo servicio no puede inflar la propuesta.
- **Acotado al top 10 por plata** (H34, W8). Sobre el ledger real la regla
  devuelve **37 candidatas**; 37 tarjetas de sí/no en una pantalla de alta es
  otra cola disfrazada. Las otras 27 **caen en la cola de N3**, que es donde
  iban a caer los "particulares" de todos modos.
- **Dos campos de perfil**, no cuatro: `diasPago` (sin él no hay safe-to-spend ni
  próximo cobro) y `colchonObjetivo` (sin él el anillo miente: `0 ≥ 0` es
  verdadero y un usuario nuevo se ve "financiado", R25). Por
  `POST /api/onboarding/profile` (H2, mínimo). **El checklist de 6 pasos no
  entra**: cinco de sus seis pasos se resuelven en la terminal de la máquina del
  server, donde el panel no llega.
- **El freno de los 3 meses** (R33): con menos historial el análisis no se dibuja
  activo y la pantalla dice cuánto lleva acumulado (`mesesDeHistorial` ya existe
  en `onboard/suggest.ts:180-183`).
- **Termina en la cola**, no en una pantalla que ofrece ir a la cola: *Guardar y
  seguir* → N3.
- **Decir el tamaño de la muestra en voz alta**, como ya hace `suggestSalary`.

**Cabos que cierra.** H30, H34, H2 (mínimo), H31, R25, R32, R33, **D8**, W8.

**UI.** `p1-alta-perfil.html`, recortada: sin checklist, con dos campos y la
lista de 10. Se entra por una `OverviewCard` del Resumen.

---

### N5 · Movimientos — 1 día · `TASK-059`

**Qué entrega.** La tercera puerta del Escenario 1, y el ledger navegable.

- Lista sobre `GET /api/transactions`, que ya funciona.
- **Dos filtros**: rango de fechas y entrada/salida. Más **la categoría
  recalculada** cuando se llega desde una barra del gráfico (N1 lo provee).
  **Sin FilterBar**: de sus seis controles, cuatro no tienen respaldo (H21 mal
  planteado, H22, H23).
- **"Cargar más"**, no paginador con total (H20): `offset` ya existe y se pasa
  (`api/queries.ts:19,74`); lo que falta es el `total`, y con *cargar más* no
  hace falta.
- **Detalle con una sola acción nueva: *¿Qué es esto?***, que usa **el mismo
  escritor** que la cola (`POST /api/classify`). *Crear regla* llevaba a P6
  (eliminada, M4), *Preguntar al agente* al chat (diferido, M2) y *Resolver* a la
  pestaña de monto de N3.
- **"Mandar a revisión" no se construye** (H26). Se sostiene sin cambios.

**Cabos que cierra.** H21, H28 (segunda puerta), H20 (con *cargar más*), R17,
R18, H26 (confirmado sin construir).

**UI.** `p4-movimientos.html` + `c4-tabla-transacciones.html`; los dos controles
con el estilo de `c6-selector-filtros.html`, sin la barra.

---

### Resumen de fases

| # | Fase | Días | Ticket | Tier | Depende de |
|---|---|---:|---|---|---|
| N0 | La puerta mínima | 0,5–1 | `TASK-054` | tdd | — |
| N1 | El motor de la pregunta | 1,5 | `TASK-055` | tdd | TASK-054 |
| N2 | Andamio + hogar con sync | 2 | `TASK-056` | tests-after | TASK-054, TASK-055 |
| N3 | La cola de preguntas | 1,5 | `TASK-057` | tests-after | TASK-055, TASK-056 |
| N4 | El análisis del historial | 1,5 | `TASK-058` | tdd | TASK-056 |
| N5 | Movimientos | 1 | `TASK-059` | tests-after | TASK-055, TASK-056 |
| | **MVP** | **8–8,5** | | | |

**Comparación con el plan anterior (B0..B3):** 6,5–8 días y **ninguno** de los
dos escenarios, contra 8–8,5 días con **los dos**. Día y medio más caro. Se paga
eliminando el editor de reglas (2 días, M4), P3 como pantalla (~0,5) y Firebase
(~0,5, M3). Ninguno de los dos planes toca el pipeline ni migra el esquema.

---

## 4. Los riesgos aceptados, con su mitigación

Ya acordados. Se aceptan **con** la mitigación escrita, no a secas.

| # | Riesgo | Nivel | Mitigación acordada |
|---|---|---|---|
| 1 | **La cola es larga y nadie midió cuánto tarda una respuesta.** Son 151 preguntas; a 5 s son 12 minutos, y si Mato duda en la mitad es una tarde | **alto** | Ordenar por plata + progreso por plata (H35) + **criterio de terminado M1: 80 % de la plata, no cero filas**. La pantalla lo dice en voz alta |
| 2 | **La regla es por nombre y una contraparte puede tener dos verdades** | medio | **El silenciador (H33) entra al MVP (M5)** — es la única razón por la que sube de P2 a P0. Sin él, esas contrapartes vuelven a la cola para siempre |
| 3 | **El patrón de gastos fijos puede salir pobre**: 37 candidatas, sólo **2** en 6+ meses | medio | Decir el tamaño de la muestra en voz alta y no prometer más de lo que hay. Top 10 por plata; el resto cae en la cola |
| 4 | **En el Modelo D el Escenario 2 no se cumple el primer día** | estructural | Aceptado: **M6 saca el Modelo D del MVP**. Es una propiedad del modelo de ingesta, no de este plan |
| 5 | **La verificación de Google para scopes restringidos sigue sin confirmar por escrito** | externo | Queda en `TASK-053` (investigación). **M3 la saca del camino crítico**: sin Firebase ni OAuth de usuario, el MVP no la necesita |
| 6 | **El copiado tiene que ser copiado.** "Aprovechar y mejorar" `base.ts` o `demoFetch.ts` se lleva la estimación de N2 | bajo | Criterio explícito en `TASK-056`: la capa `api/` se copia y las mejoras van a un ticket propio |
| 7 | **Vue en un repo que hoy sólo tiene React** | bajo | T5 en N2, **antes** de la primera prueba del panel: `vitest.config.ts` incluye `panel/` y usa `jsdom` |
| 8 | **Deriva de alcance** (el más probable) | medio | **Lo que no tiene backend no se dibuja.** Y con el design system: lo que no está en el sistema, se crea **en** el sistema (§2.4), no fuera |
| 9 | **Los 19 previews viven fuera del repo, sin copia versionada** (T2) | bajo | Aceptado por ahora: el proyecto de Claude Design es la fuente. Si se pierde el acceso, se pierde la referencia — **versionarlos es un ticket aparte** |
| 10 | **Dos bases de datos** (`./bolsillo.sqlite` con 1.159 filas y `./server/bolsillo.sqlite` con 0) | medio | T8: correr un comando desde `server/` abre un ledger vacío que se ve igual. **No lo resuelve este plan**; se avisa en cada ticket que toque datos |

---

## 5. Qué se descarta y qué se difiere

**Se descarta — no se construye, con la razón escrita:**

- `claude_amount` (H10) — **cero** discrepancias en 8 meses de datos reales.
- Registro de lotes de sync (H17) y *Detener* (H18) — sin auto-encadenado no hay
  qué detener, y no hay dos lotes que comparar.
- Excepción de categoría por fila (H29) — su salida honesta (H33) **sí** se
  construye.
- "Mandar a revisión" y "Rehacer el ledger" (H26).
- "Registrar aporte" (H15) — un aporte es una suma, y la suma no se hace en el
  cliente.
- Metas e histórico de ahorro (H16) — las tablas existen y ningún código las lee.
- El simulador de tres perillas (H13) — aritmética financiera nueva.
- El editor de reglas (P6) como pantalla — **M4**: la cola escribe la misma
  regla, sin la trampa del patrón escrito a mano.

**Se difiere — hace falta, después del MVP:**

- **El chat (M2)**, partido en dos: primero el motor (`spendingSummary` y las
  tools, C1..C5), que **no depende del panel** y mejora el chat que ya se usa hoy
  por `web/` y por MCP; después P7 en Vue.
- **El Modelo D (M6)** — y sólo si Mato quiere un segundo usuario.
- Login con Google / Firebase (P0 completa) — **M3**.
- Listar, editar y borrar reglas (H5, H6, H7, H8).
- Estrategia (P8) y Ahorro (P9): `GET /api/debts` (H11) y el calendario (H12).
- Configuración (P10) y el checklist completo (H2 completo, H4).
- `review_reason` (H9) — barato y útil, no urgente con 4 filas.
- Total y paginador (H20), FilterBar completa (H22, H23).
- El retiro de `web/` (T1) y versionar los previews (T2).

---

## 6. Trazabilidad

**Decisión de Mato → fase → ticket:**

```
M1  criterio 80 % de la plata   --->  N1 + N3  --->  TASK-055, TASK-057
M2  el chat al final            --->  (fuera)
M3  solo llave, sin Firebase    --->  N0       --->  TASK-054
M4  editor absorbido por la cola--->  N1 + N3  --->  TASK-055, TASK-057
M5  contraparte + silenciador   --->  N1 + N3  --->  TASK-055, TASK-057
M6  Modelo D al futuro          --->  (fuera)
```

**Los cinco cabos más urgentes (§2.6 del wargaming) → dónde mueren:**

| Cabo | Muere en |
|---|---|
| **X1** — el MVP probado no contenía ninguno de los dos escenarios | este plan entero: N3 y N4 |
| **H32 + H28 + H33** — la cola, su escritor y su válvula de escape | N1 (motor) + N3 (pantalla) |
| **H1 + R1 + R2** — la puerta | N0 |
| **X3 + H35** — la cola real es 334 y no había cómo medir el progreso | N1 (cálculo) + N3 (pantalla) |
| **H30 + H34** — el Escenario 2 sin motor, y sin tope cuando lo tenga | N4 |

---

Ver también: `docs/wargaming-simplificacion.md` (el forense del ledger, los
flujos F1..F12 y el inventario completo de cabos sueltos — este plan sella su
Parte 3), `docs/flujo-wargaming.md` (el wargaming adversario),
`docs/panel-viabilidad.md` (los huecos con su endpoint propuesto),
`docs/panel-prep-implementacion.md` (el plan probado B0..B3 que este reemplaza),
`docs/panel-manejo-flujo.md` (el plan funcional),
`docs/flujo-app-prototipo.md` (el recorrido clickeable),
`tasks/TASK-045.json` (el ticket paraguas),
`tasks/TASK-054.json`..`TASK-059.json` (una por fase).
