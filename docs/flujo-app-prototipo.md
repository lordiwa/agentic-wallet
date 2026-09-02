# Flujo de la aplicación — guion para el prototipo

Este documento describe **cómo se recorre el panel**: qué pantalla lleva a
cuál, con qué gesto, en qué estado queda cada componente, y qué tiene que
poder demostrar un prototipo clickeable en Claude Design.

No es implementación ni plan de producto. El plan está en
`docs/panel-manejo-flujo.md`; la auditoría de qué se puede alimentar con el
backend real, en `docs/panel-viabilidad.md`; el ticket, en
`tasks/TASK-045.json`. Acá se contesta una sola pregunta:
**¿en qué orden se tocan las cosas, y qué pasa cuando se tocan?**

El prototipo es **de interacción, no de datos**. Todo número que aparezca en
él es ficticio y va rotulado como tal (§3.5). Nombres de contrapartes:
*Comercio A*, *Comercio B*, *Persona 1* — nunca datos reales.

---

## 1. Diagrama de navegación

### 1.1 Entrada

```
        ┌───────────────────────────────────────────────┐
        │ arranque del panel                            │
        │ (leer localStorage: backend, demo, frase)     │
        └───────────────────┬───────────────────────────┘
                            │
                   GET /api/health
                            │
              ┌─────────────┴─────────────┐
              │ auth_required = true      │ auth_required = false
              ▼                           │   (o modo demo)
      ┌───────────────┐                   │
      │ P0 Acceso     │                   │
      │ frase + back- │                   │
      │ end + demo    │                   │
      └───────┬───────┘                   │
              │ frase aceptada / "usar    │
              │ modo demostración"        │
              └─────────────┬─────────────┘
                            │
                GET /api/onboarding/status
                            │
              ┌─────────────┴─────────────┐
              │ pasos incompletos         │ checklist completo
              ▼                           ▼
      ┌───────────────┐            ┌───────────────┐
      │ P1 Alta y     │ "Guardar"  │ P2 Resumen    │
      │    perfil     ├───────────▶│  (el hogar)   │
      │               │ "Saltar    │               │
      └───────────────┘  por ahora"└───────────────┘
```

Reglas de la entrada:

- **P0 sólo aparece si el server pide token.** Si `auth_required` es `false`,
  la pantalla se saltea entera: pedir una frase que no sirve enseña una
  mentira. En modo demostración P0 se puede visitar desde P10, y se rotula
  como decorativa.
- **P1 no bloquea.** *Saltar por ahora* siempre está disponible y lleva a P2.
  El panel no retiene a nadie en un formulario.
- **P2 es el hogar.** Toda sesión posterior abre directo ahí.

### 1.2 Desde el hogar

```
                        ┌──────────────────────────────┐
                        │        P2 Resumen            │
                        │                              │
                        │ [SyncStatusChip]──▶ P3       │
                        │ [ReviewBadge N]───▶ P5       │
                        │ [OverviewCard saldo]──▶ P4   │
                        │ [OverviewCard tarjeta]─▶ P8  │
                        │ [OverviewCard colchón]─▶ P9  │
                        │ [SpendingChart barra]─▶ P4   │
                        │   (filtrado por categoría)   │
                        │ [BriefCard "preguntar"]─▶ P7 │
                        └──────────────┬───────────────┘
                                       │
      ┌──────────┬──────────┬──────────┼──────────┬──────────┬──────────┐
      ▼          ▼          ▼          ▼          ▼          ▼          ▼
 ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
 │P3 Sync │ │P4 Movi-│ │P5 Revi-│ │P6 Cate-│ │P8 Estra│ │P9 Aho- │ │P10 Con-│
 │        │ │ mientos│ │  sión  │ │  gorías│ │  tegia │ │  rro   │ │  fig   │
 └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └────────┘
     │          │          │          │          │          │
     │ quedaron │ "crear   │ cola     │ "aplicar │ "ver el  │
     │ N en     │  regla"  │ vacía    │  reglas" │  colchón"│
     │ revisión │          │          │          │          │
     └─────────▶│──────────┘          │          └─────────▶│
       (P5)     ▼                     ▼                     │
            ┌────────┐          ┌────────┐                  │
            │P6 Regl.│          │P2 vuel-│◀─────────────────┘
            └────────┘          │ ve act.│
                                └────────┘

   ┌───────────────────────────────────────────────────────────────┐
   │  P7 Chat — cajón lateral, se abre ENCIMA de cualquier pantalla │
   │  con el contexto de origen. Cerrar devuelve a donde estabas.   │
   └───────────────────────────────────────────────────────────────┘

   ┌───────────────────────────────────────────────────────────────┐
   │  P10 Configuración — destino de TODO error de configuración.   │
   │  Cada 503 (gmail_not_configured / claude_not_configured)       │
   │  dibuja un enlace directo acá, desde donde haya ocurrido.      │
   └───────────────────────────────────────────────────────────────┘
```

### 1.3 Barra de navegación permanente

Presente en P2..P10 (no en P0 ni P1, que son de entrada):

```
[≡] Resumen · Movimientos · Revisión (N) · Estrategia · Ahorro     [chip sync] [💬 chat] [⚙]
```

- **Revisión lleva el contador.** Si `counts.needs_review > 0`, el ítem se
  dibuja con el número y color *atención*. En cero, sin badge.
- **El chip de sync** es el `SyncButton` en versión compacta: mismo estado,
  mismos ocho valores, y al pulsarlo va a P3.
- **El ícono de chat** abre el cajón P7 sin abandonar la pantalla.
- **El engranaje** va a P10. P3 y P6 viven en el menú `[≡]` (segundo nivel),
  porque se llega a ellos casi siempre desde una acción, no desde el menú.

### 1.4 Dónde vive cada componente

| Componente | Aparece en | En qué forma |
|---|---|---|
| **SyncButton** (C1) | P2 (chip en la barra), P3 (control principal), P10 (estado de Gmail) | 8 estados; compacto en la barra, completo en P3 |
| **ReviewCard** (C2) | P5 (la cola), P4 (drawer de una fila en revisión) | tarjeta apilada; una por fila de la cola |
| **OverviewCard** (C3) | P2 (rejilla de 6), P8 (4 tarjetas de tarjeta de crédito), P9 (anillo de colchón) | cifra + contexto + estado |
| **TransactionsTable** (C4) | P4 (pantalla completa), P6 (previsualización de las filas que matchea una regla) | tabla con marcas por fila |
| **ChatPanel** (C5) | P7 (ruta propia) y cajón lateral sobre P2, P4, P5, P8, P9 | mismo componente, dos envases |
| **FilterBar** (C6) | P4 (encabezado), P6 (filtrar sin-categoría) | traduce a parámetros de `GET /api/transactions` |

---

## 2. Flujos clave, paso a paso

Cinco recorridos. Son los que el prototipo tiene que poder demostrar de punta
a punta: cada paso es una pantalla o un estado navegable.

### 2.1 Flujo de SYNC

**Punto de partida:** P2, chip de sync en *Atrasado* ("última vez hace 3 días").

| # | Dónde | Gesto | Qué pasa |
|---|---|---|---|
| 1 | P2 | pulsar el chip | navega a **P3** con el `SyncButton` en el mismo estado |
| 2 | P3 | *Sincronizar* | botón a **Corriendo**: spinner, barra `1 240 de 3 800`, *Detener* visible. Refresco cada **3 s** |
| 3 | P3 | — | vuelve `{summary, progress}` con `complete: false` → botón a **A medias**: "quedaron 2 560 por procesar", acción *Seguir* |
| 4a | P3 | *Seguir* | vuelve a (2). Contador de reintentos del cliente visible: "reintento 2 de 5" |
| 4b | P3 | *Detener* | corta el auto-encadenado. Rótulo exacto: **"se detiene al terminar este lote"** — no promete abortar el lote en vuelo |
| 5 | P3 | — | `complete: true` → botón a **Al día**, refresco inmediato de todo el panel (`refreshNow()`), y el registro de lotes suma una fila |
| 6 | P3 | — | **si el lote dejó filas en `needs_review`**: aparece el aviso persistente |

**La bifurcación de la revisión pendiente (paso 6):**

```
   lote completo
        │
        ├── needs_review = 0 ──▶ P3 muestra "sincronizado, nada pendiente"
        │                         y el chip queda verde. Fin.
        │
        └── needs_review = N ──▶ ┌────────────────────────────────────┐
                                 │ ⚠ N movimientos necesitan tu       │
                                 │   confirmación                     │
                                 │            [Revisarlos ahora]      │
                                 └──────────────┬─────────────────────┘
                                                │ pulsar
                                                ▼
                                              P5 Revisión
```

El aviso **no es un toast**: es una franja persistente bajo la barra de
navegación, visible en toda pantalla, y **no se puede cerrar** — desaparece
sola cuando la cola queda en cero. El prototipo lo muestra en P2, P3 y P4
para que se entienda que acompaña, no que interrumpe.

**Estados de error del ciclo, todos navegables en el prototipo:**

- **409** → aviso ámbar "ya hay un sync en curso", el botón sigue habilitado,
  se reintenta solo. **No es rojo.**
- **503 `gmail_not_configured`** → "falta conectar Gmail" + *Ir a
  Configuración* (→ P10). No es un fallo, es un faltante.
- **500** → rojo con el mensaje del server **tal cual** y *Reintentar*.

### 2.2 Flujo de REVISIÓN

**Punto de partida:** P2 con `ReviewBadge` en 3, o el aviso persistente del sync.

| # | Dónde | Gesto | Qué pasa |
|---|---|---|---|
| 1 | P2 | pulsar el badge "3 pendientes" | navega a **P5**; el foco entra en la primera `ReviewCard` |
| 2 | P5 | leer la tarjeta | contraparte, monto del ledger (o **"Sin leer"**), asunto del correo, chip de motivo *(ver §3.5 — hoy sin respaldo)* |
| 3a | P5 | *Confirmar monto* | `resolve` con `confirm`. La tarjeta se colapsa con animación corta y sale de la cola |
| 3b | P5 | *Corregir monto* | se abre el campo de monto **dentro de la tarjeta**, con el valor del ledger precargado. *Guardar* → `correct`. Sin diálogo modal: la corrección pasa donde está el dato |
| 3c | P5 | *Descartar* | pide una nota opcional y resuelve con `discard` |
| 4 | P5 | — | contador baja 3 → 2. Se dispara **`refreshNow()`**: el overview se recalcula porque la fila resuelta entra a los totales |
| 5 | P5 | resolver la última | la cola pasa al **estado vacío celebrado**: "Nada pendiente. El agente pudo afirmar todos los movimientos." + enlace *Ver el rastro de resoluciones* |
| 6 | P5 | *Ver el rastro* | despliega `ResolutionsLog`: quién, cuándo, con qué monto, para cada fila ya resuelta |
| 7 | cualquiera | — | el aviso persistente del §2.1 **desaparece solo** al llegar a cero |

**Ida y vuelta con el overview.** El prototipo tiene que mostrar el antes y el
después: en P2 el saldo dice *X* con "3 en revisión, excluidas del total"; tras
resolver las 3, el saldo dice *Y* y la nota desaparece. Ese cambio es la razón
de ser de la pantalla — que se vea que resolver mueve el número.

**Camino de error:** si el motor rechaza la resolución, la tarjeta muestra el
mensaje del server ("el motor rechazó esto, y por qué") y **no** sale de la
cola. `not_found` → 404 → "esta fila ya no está en la cola, refrescá".

### 2.3 Flujo de CHAT

**Punto de partida:** cualquier pantalla. El chat es un cajón, no un destino.

| # | Dónde | Gesto | Qué pasa |
|---|---|---|---|
| 1 | P4 | fila de *Comercio A* → *Preguntar sobre este movimiento* | se abre el cajón **encima** de P4. La tabla sigue visible detrás, atenuada |
| 2 | cajón | — | arriba, un `ContextChip`: "Sobre: Comercio A · 12 sep · −45,00". El contexto es visible y **removible** |
| 3 | cajón | escribir y enviar | la respuesta llega **por bloques** (SSE). Aparece un chip por cada tool que el agente usa: "Leído de `query_transactions`" |
| 4 | cajón | *Detener* | corta el stream. Lo ya escrito se conserva |
| 5 | cajón | el agente propone una acción | **tarjeta de propuesta** (§3.3): "Podés crear una regla: *Comercio A → comida*" con `[Crear la regla]` `[No]` |
| 6a | cajón | *Crear la regla* | cierra el cajón y **abre P6 con el editor precargado** — no ejecuta nada solo |
| 6b | cajón | *No* | la propuesta se marca descartada y la conversación sigue |
| 7 | cajón | cerrar (Esc o ✕) | vuelve a **P4, en el mismo scroll y con los mismos filtros** |

**La regla que ordena el paso 5-6:** el agente **propone, no ejecuta**. Toda
acción sugerida en el chat lleva al usuario a la pantalla donde esa acción se
confirma, con los campos precargados. Es la misma invariante del onboarding —
nunca escribir un valor que el usuario no confirmó — aplicada al chat.

**Camino de error:** 503 `claude_not_configured` → el cajón muestra "falta
configurar Claude" con enlace a P10, **antes** de abrir el stream. No es un
error rojo genérico.

**Atajos del estado vacío:** conversación nueva sin mensajes muestra tres
sugerencias pulsables — "¿en qué se me fue la plata este mes?", "¿llego al pago
de la tarjeta?", "¿qué movimientos no pudiste leer?".

### 2.4 Flujo de ESTRATEGIA / AHORRO

**Punto de partida:** P2, `OverviewCard` de la tarjeta de crédito.

| # | Dónde | Gesto | Qué pasa |
|---|---|---|---|
| 1 | P2 | pulsar la tarjeta "Tarjeta — mínimo · fecha máxima" | navega a **P8** |
| 2 | P8 | leer | cuatro `OverviewCard`: saldo de corte, mínimo, fecha máxima, requerido por quincena, con el indicador *a tiempo / atrasado* |
| 3 | P8 | mover la perilla *Abono* | la línea de proyección se redibuja. **Nada se escribe**: rótulo "simulación, no se guarda" |
| 4 | P8 | *Marcar deuda pagada* | pide confirmación (es escritura). Al confirmar → `refreshNow()` y la proyección se recalcula |
| 5 | P8 | *Ver el colchón* | navega a **P9** |
| 6 | P9 | leer | anillo del colchón: objetivo, reservado, faltante, y el estado *financiado / falta* |
| 7 | P9 | *Fijar objetivo* | se abre el campo. Al guardar escribe **el objetivo del perfil** (`colchonObjetivo`), no `reserved` — y la pantalla lo dice: "esto cambia tu perfil" |
| 8 | P9 | — | el anillo se redibuja con el objetivo nuevo, y el faltante cambia. `refreshNow()` propaga a P2 |
| 9 | P9 | *Pedirle sugerencias al agente* | abre el cajón P7 con contexto "colchón: objetivo X, reservado Y" |
| 10 | cajón | — | la respuesta llega rotulada **"respuesta del agente"**, no como cifra del sistema |

**El impacto tiene que verse.** El paso 8 es el punto del flujo: el prototipo
muestra el anillo antes (objetivo 500, faltan 180) y después (objetivo 800,
faltan 480), y el `OverviewCard` de colchón en P2 cambiando con él. Ajustar
sin ver el impacto es un formulario, no una herramienta.

**Simular ≠ guardar.** La perilla del paso 3 y el botón del paso 4 se dibujan
distinto a propósito: la simulación es un control continuo sin confirmación;
la escritura es un botón con confirmación. El prototipo tiene que hacer
evidente cuál es cuál.

### 2.5 Flujo de CONFIGURACIÓN — reglas de categorización

**Punto de partida:** P4, una fila sin categoría de *Comercio B*.

| # | Dónde | Gesto | Qué pasa |
|---|---|---|---|
| 1 | P4 | fila → *Crear regla para este comercio* | navega a **P6** con el editor abierto y el patrón **precargado con la contraparte real** |
| 2 | P6 | el editor ya muestra el contador | "matchea **7** movimientos" — calculado con la misma normalización que usa el motor |
| 3 | P6 | escribir un patrón más largo | el contador cae a **0** y aparece la advertencia: *"un patrón más largo que la contraparte real nunca matchea"* |
| 4 | P6 | borrar hasta acortar | el contador vuelve a 7. **La corrección ocurre mientras se escribe, no al guardar** |
| 5 | P6 | *Ver los 7* | despliega un `TransactionsTable` en miniatura con las filas que matchean |
| 6 | P6 | elegir categoría y *Guardar* | la regla entra en la tabla con su columna "matchea N" |
| 7 | P6 | *Aplicar al historial* | **previsualización primero**: "se reclasificarían 7 movimientos" con `[Aplicar]` `[Cancelar]` |
| 8 | P6 | *Aplicar* | escribe, `refreshNow()`, y aparece la nota: *"reclasificar no mueve el gasto por categoría de las filas de tipo transferencia"* |
| 9 | P6 | volver a P2 | el `SpendingChart` refleja la categoría nueva |

**El contador en vivo (pasos 2-4) es el corazón del flujo.** Es la defensa
contra la trampa documentada del patrón demasiado largo, y el prototipo tiene
que mostrar los tres estados del contador: **N > 0** (verde, "matchea 7"),
**0** (ámbar + advertencia), y **calculando** (mientras se teclea, con rebote
de ~300 ms para no consultar en cada tecla).

---

## 3. Decisiones de interacción para el prototipo

### 3.1 Estados que el prototipo debe incluir, componente por componente

| Componente | Estados obligatorios |
|---|---|
| **SyncButton** (C1) | los **8**: *al día*, *atrasado*, *nunca*, *a medias*, *corriendo*, *otro lo está corriendo* (409), *sin configurar* (503), *falló* (500) |
| **ReviewCard** (C2) | *pendiente*, *corrigiendo* (campo abierto), *resolviendo* (en vuelo), *resuelta* (colapsando), *rechazada por el motor* (con el mensaje), y la variante **sin motivo disponible** |
| **OverviewCard** (C3) | *con dato*, *cero* (cifra legítima), *sin leer* (`null`), *cargando* (esqueleto), *sin conexión* |
| **TransactionsTable** (C4) | *con filas*, *cargando*, *vacía por filtros*, *vacía porque no hay ledger*, y las marcas por fila: en revisión, reverso, interna, descartada |
| **ChatPanel** (C5) | *conversación nueva* (con atajos), *escribiendo* (streaming por bloques), *con chip de tool*, *detenido*, *con propuesta de acción*, *sin credencial* (503) |
| **FilterBar** (C6) | *sin filtros*, *con filtros activos* (chips removibles), *sin coincidencias*, y **los controles sin respaldo, deshabilitados con su motivo** (§3.5) |

### 3.2 Micro-interacciones

- **Reloj de refresco: 30 s.** Un solo reloj para todo el panel. Cada pantalla
  pide lo suyo; lo compartido es *cuándo*.
- **Durante un sync corriendo: 3 s**, hasta `complete: true`; después vuelve a
  30 s. En el prototipo se representa con la barra avanzando entre lotes — no
  de forma continua, porque el progreso real sólo se escribe al cerrar un lote.
- **La pestaña oculta detiene el reloj**, y al volver dispara un tick
  inmediato. Sin eso, una pestaña olvidada le pega a la API todo el día y al
  despertar muestra datos viejos igual.
- **`refreshNow()` tras cada mutación**: resolver una revisión, guardar o
  aplicar una regla, fijar el colchón, marcar una deuda pagada, terminar un
  lote de sync. El dato recién escrito se ve sin esperar el próximo tick.
- **Indicador de frescura permanente**: "actualizado hace X", siempre visible.
- **Cartel de desconexión** cuando el backend no responde, y **los números se
  atenúan**. El peor estado posible es un panel que muestra cifras viejas con
  cara de actuales.
- **Rebote de 300 ms** en el contador de coincidencias del editor de reglas y
  en el autocompletar de contraparte.
- **Transiciones cortas (≤200 ms) y sólo donde comunican algo**: la tarjeta que
  se colapsa al resolverse, el cajón de chat que entra desde el costado, el
  anillo del colchón que se redibuja. Nada decorativo.

### 3.3 Patrón de la acción propuesta por el agente

Un bloque reutilizable, usado en P7 y en la `BriefCard` de P2:

```
┌────────────────────────────────────────────────┐
│ 💡 Propuesta del agente                         │
│ Crear la regla: Comercio A → comida            │
│ Matchearía 7 movimientos.                      │
│                                                 │
│              [Revisar y crear]   [Descartar]   │
└────────────────────────────────────────────────┘
```

*Revisar y crear* **navega a la pantalla que hace esa acción, precargada**.
Nunca ejecuta desde el chat. El rótulo dice "revisar" a propósito.

### 3.4 Estados vacíos

| Pantalla | Estado vacío | Cómo se dibuja |
|---|---|---|
| P2 | ledger sin movimientos | "Todavía no leí ningún correo" + *Sincronizar por primera vez* |
| P3 | nunca hubo sync | "Nunca sincronizaste" — **no una fecha inventada** |
| P4 | sin coincidencias | "Ningún movimiento coincide" + *Limpiar filtros* |
| P4 | sin ledger | distinto del anterior: "no hay movimientos todavía" + ir a P3 |
| P5 | cola vacía | **celebrado**: "Nada pendiente. El agente pudo afirmar todos los movimientos." Es el estado normal y hay que poder confiar en él |
| P6 | sin reglas | "Todavía no le enseñaste a categorizar" + las contrapartes sin categoría más frecuentes, como punto de partida |
| P7 | conversación nueva | los tres atajos de §2.3 |
| P8 | sin deudas | "Sin deudas cargadas" — no una tabla vacía con encabezados |
| P9 | sin objetivo de colchón | anillo gris + *Fijar objetivo*, sin cifra de ejemplo |
| P1 | formulario | **arranca vacío**: sin sueldo de ejemplo, sin comercios, sin titular |

### 3.5 Dónde el prototipo se queda sin backend

Estos puntos vienen de `docs/panel-viabilidad.md`. En el prototipo se dibujan
con **datos ficticios claramente marcados** y una nota visible; en la
implementación, o esperan su endpoint, o se dibujan deshabilitados diciendo
por qué. **Un botón que no hace nada es peor que un botón ausente.**

| Pantalla / componente | Elemento sin respaldo | Hueco | Cómo lo representa el prototipo |
|---|---|---|---|
| P0 | la frase de acceso, `auth_required` | H1 | pantalla completa con banda: *"maqueta — el server todavía no exige token"* |
| P1 | todo el checklist y el guardado | H2, H4 | checklist ficticio, banda: *"requiere rutas HTTP de onboarding"*. El paso dibujado como "Cuentas" se renombra a **Titular** (H3) |
| P6 | toda la pantalla, y el contador "matchea N" | H5, H6 | flujo completo con contador simulado, banda: *"requiere rutas de reglas + `countMatchingTransactions`"* |
| P6 | borrar una regla, previsualizar la aplicación | H7, H8 | ambos botones presentes y rotulados como pendientes de motor |
| P5 / ReviewCard | chip de motivo, columna "lo que leyó Claude", correo original | H9, H10 | **variante primaria = sin motivo**: contraparte + monto + asunto + acciones. La variante con motivo se muestra aparte, rotulada *"depende de persistir `review_reason` y `claude_amount`"*. El cuerpo del correo **no se dibuja nunca**: es dato personal; en su lugar, enlace por `gmail_msg_id` |
| P3 | *Detener* | H18 | presente, con el rótulo honesto *"se detiene al terminar este lote"* |
| P3 | registro de lotes | H17 | tabla ficticia rotulada *"registro de esta sesión — se pierde al recargar"* |
| P3 | barra `processed/total` continua | H18 | avanza **entre lotes**, a saltos, no de forma fluida |
| P4 / FilterBar | filtro por categoría, tipo múltiple, autocompletar de contraparte | H21, H22, H23 | dibujados **deshabilitados** con el motivo al lado. "Interna" **sale** del selector de dirección y pasa al toggle `include_internal` |
| P4 / tabla | "Mostrando 8 de N" y el paginador | H20 | número ficticio, banda: *"la API devuelve el tamaño de la página, no el total"* |
| P4 | *Mandar a revisión* | H26 | **no se dibuja.** Se recomienda no construirlo |
| P8 | lista de deudas, columna "Vence", *Deshacer* | H11 | lista ficticia, banda: *"no existe `GET /api/debts`"*. "Vence" en gris: la tabla `debts` no tiene esa columna |
| P8 | calendario de pagos | H12 | sólo corte y vencimiento de tarjeta son reales; el resto, marcado |
| P8 | simulador de tres perillas | H13 | **una sola perilla activa** (*abono*); las otras dos, visibles y deshabilitadas |
| P9 | *Fijar objetivo* | H14 | activo, pero rotulado *"escribe tu perfil, no el colchón reservado"* |
| P9 | *Registrar aporte* | H15 | deshabilitado: *"la suma la hace el server, no el cliente"* |
| P9 | metas e histórico de aportes | H16 | bloques ficticios, banda: *"tablas sin endpoint"* |
| P10 | checklist de conexiones, *Probar Gmail* | H2 | ficticio, marcado |
| P10 | *Rehacer el ledger desde cero* | H26 | **no se dibuja.** La pantalla explica cómo se hace desde la terminal, y nada más |

**Cómo se marca lo ficticio, en concreto:** banda superior fija en la pantalla
(`Modo demostración — datos inventados`) más, en cada bloque sin respaldo, una
etiqueta ámbar con el número de hueco. Que se vea de un vistazo qué parte del
prototipo es una promesa y qué parte es una realidad ya construible.

---

## 4. Mapeo del flujo a las tarjetas del design system

Design system: **Agentic Wallet Panel — Design System**
(`d509acfb-b4ad-480d-aa67-1b09b16a13c2`), 18 tarjetas. Los previews locales
están en `/opt/data/home/wallet-panel-ds-previews/`.

### 4.1 Tarjetas y su archivo

| Tarjeta | Preview | Rol en el flujo |
|---|---|---|
| Fundamentos | `00-fundamentos.html` | color semántico, tipografía tabular, los 9 estados, las 4 reglas de contenido. **No es una pantalla**: es la referencia que gobierna todas |
| P0 Acceso | `p0-acceso.html` | entrada condicional (§1.1) |
| P1 Alta y perfil | `p1-alta-perfil.html` | entrada condicional (§1.1) |
| P2 Resumen | `p2-resumen.html` | el hogar (§1.2) |
| P3 Sincronización | `p3-sincronizacion.html` | flujo de sync (§2.1) |
| P4 Movimientos | `p4-movimientos.html` | origen del flujo de reglas (§2.5) y del chat con contexto (§2.3) |
| P5 Revisión | `p5-revision.html` | flujo de revisión (§2.2) |
| P6 Categorías y reglas | `p6-reglas.html` | flujo de configuración (§2.5) |
| P7 Chat | `p7-chat.html` | cajón lateral sobre todas |
| P8 Estrategia | `p8-estrategia.html` | flujo de estrategia (§2.4, pasos 1-5) |
| P9 Ahorro y colchón | `p9-ahorro.html` | flujo de ahorro (§2.4, pasos 6-10) |
| P10 Configuración | `p10-configuracion.html` | destino de todo error de configuración |
| C1 SyncButton | `c1-boton-sync.html` | 8 estados |
| C2 ReviewCard | `c2-tarjeta-revision.html` | la cola |
| C3 OverviewCard | `c3-tarjeta-overview.html` | cifra + contexto + estado |
| C4 TransactionsTable | `c4-tabla-transacciones.html` | el ledger |
| C5 ChatPanel | `c5-panel-chat.html` | el cajón |
| C6 FilterBar | `c6-selector-filtros.html` | el encabezado de P4 |

### 4.2 Orden de conexión de las tarjetas en el prototipo

Cada paso de los flujos de §2, con la tarjeta que le corresponde. Éste es el
orden en que se enlazan las tarjetas en Claude Design.

**Entrada**

```
P0 ──(frase / demo)──▶ P1 ──(guardar | saltar)──▶ P2
 └──(auth_required = false)───────────────────────▶ P2
```

**Flujo de sync (§2.1)**

```
P2[C1 chip] ──▶ P3[C1 completo]
                 ├─ estado corriendo   → C1 "Corriendo"
                 ├─ estado a medias    → C1 "A medias" → Seguir → C1 "Corriendo"
                 ├─ 409/503/500        → C1 "Otro lo corre" / "Sin configurar" / "Falló"
                 │                        └─ 503 ──▶ P10
                 └─ completo + N>0     → aviso persistente ──▶ P5
```

**Flujo de revisión (§2.2)**

```
P2[ReviewBadge] ──▶ P5[C2 pendiente]
                     ├─ Corregir  → C2 "corrigiendo" → C2 "resuelta"
                     ├─ Confirmar → C2 "resuelta"
                     ├─ Descartar → C2 "resuelta"
                     └─ cola en 0 → P5 vacío ──▶ P2[C3 con el total actualizado]
```

**Flujo de chat (§2.3)**

```
P4[C4 fila] ──▶ C5 sobre P4 (con ContextChip)
                 ├─ streaming    → C5 "escribiendo" + chip de tool
                 ├─ propuesta    → C5 "con propuesta" ──▶ P6 precargado
                 ├─ 503          ──▶ P10
                 └─ cerrar       ──▶ P4 (mismo scroll, mismos filtros)
```

**Flujo de estrategia / ahorro (§2.4)**

```
P2[C3 tarjeta] ──▶ P8[C3 ×4]
                    ├─ perilla abono → P8 proyección redibujada (sin escribir)
                    ├─ marcar pagada → confirmación → P8 recalculado
                    └─ ver colchón   ──▶ P9[anillo antes]
                                          ├─ fijar objetivo ──▶ P9[anillo después]
                                          │                     └──▶ P2[C3 colchón actualizado]
                                          └─ sugerencias    ──▶ C5 sobre P9
```

**Flujo de configuración / reglas (§2.5)**

```
P4[C4 fila sin categoría] ──▶ P6[editor precargado]
                               ├─ contador "matchea 7"   (verde)
                               ├─ patrón largo → "matchea 0" (ámbar + advertencia)
                               ├─ Ver los 7 → C4 en miniatura
                               ├─ Guardar → P6 tabla con la regla
                               └─ Aplicar → previsualización → P6 aplicado
                                              └──▶ P2[SpendingChart actualizado]
```

### 4.3 Duplicados necesarios en el prototipo

Un prototipo clickeable necesita una tarjeta por **estado**, no por pantalla.
Los duplicados mínimos para que los cinco flujos se recorran de punta a punta:

- **P2** ×3 — con revisión pendiente / sin pendientes / tras aplicar una regla.
- **P3** ×4 — atrasado / corriendo / a medias / completo con aviso.
- **P5** ×3 — cola con 3 / corrigiendo una / cola vacía.
- **P6** ×4 — editor con contador en 7 / contador en 0 / previsualización / aplicado.
- **P9** ×2 — anillo antes y después de cambiar el objetivo.
- **C5** ×4 — vacía con atajos / escribiendo / con propuesta / sin credencial.
- **C1** ×8 — un estado por tarjeta, tal como ya están en `c1-boton-sync.html`.

---

## 5. Lo que este flujo deliberadamente no resuelve

- **P11 Estado del sistema.** Fase 2, sin endpoint de telemetría. No entra en
  el prototipo.
- **Navegación multiusuario o cambio de cuenta.** Un solo usuario, por diseño.
- **Modo oscuro.** Los fundamentos definen una sola paleta. Si se agrega, es
  una decisión de la tarjeta de fundamentos, no de este flujo.
- **Gestos táctiles y layout móvil.** El prototipo es de escritorio. La
  adaptación a pantalla chica se documenta cuando se decida.

---

Ver también: `docs/panel-manejo-flujo.md` (el plan de producto y las once
pantallas en detalle), `docs/panel-viabilidad.md` (la auditoría pantalla por
pantalla y los 26 huecos), `tasks/TASK-045.json` (el ticket),
`docs/mcp.md` (las tools del agente).
