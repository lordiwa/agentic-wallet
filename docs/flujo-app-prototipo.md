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

**Cómo leer este documento.** §1 y §2 son el recorrido: el mapa de navegación y
los cinco flujos paso a paso. §3 son las decisiones de interacción. §4 mapea el
recorrido a las 19 tarjetas del design system y lista, en §4.4, **cada enlace
clickeable del prototipo, de punta a punta**. §5 y §6 son el catálogo: una
**ficha completa por cada página (P0..P10) y por cada componente (C1..C6)**, con
propósito, contenido, acciones, navegación entrante y saliente, viabilidad con
sus huecos, endpoint que la alimenta y datos ficticios. Si buscás una pantalla
puntual, entrá por ahí.

---

## 1. Diagrama de navegación

### 1.1 Entrada

```
        ┌───────────────────────────────────────────────┐
        │ arranque del panel                            │
        │ (leer sesión de Google + backend guardado)    │
        └───────────────────┬───────────────────────────┘
                            │
                   GET /api/health
                            │
              ┌─────────────┴─────────────┐
              │ sin sesión de Google      │ sesión válida
              ▼                           │   (o modo demo)
      ┌───────────────┐                   │
      │ P0 Acceso     │                   │
      │ [Continuar    │                   │
      │  con Google]  │                   │
      └───────┬───────┘                   │
              │ un solo click:            │
              │ consentimiento de Google  │
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

- **P0 es login con Gmail y nada más.** Una sola acción en toda la pantalla:
  *Continuar con Google* (OAuth de Google). **No hay formulario manual de
  usuario y contraseña**, ni campo de frase de acceso: la identidad del panel
  es la misma cuenta de Gmail cuyos correos alimentan el ledger. Pedir dos
  credenciales para un solo humano es superficie de más.
- **P0 se saltea si ya hay sesión.** Con la sesión de Google viva —o en modo
  demostración— la pantalla no se muestra; se puede visitar desde P10, y ahí
  se rotula como decorativa.
- **En el prototipo, P0 es clickeable.** *Continuar con Google* navega a
  **P2 Resumen** (§4.2): el prototipo no simula la ventana de consentimiento
  de Google, salta directo al destino. Es el único atajo que el prototipo se
  permite en la entrada, y está ahí para que el recorrido se pueda hacer a
  click, no leyendo el diagrama.
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
| P0 | la sesión de Google (login con Gmail) | H1 | pantalla completa con el botón único *Continuar con Google*, clickeable hacia P2, y banda: *"maqueta — el server todavía no valida sesión de Google"*. El OAuth de Gmail que ya existe es para **leer correos** desde el CLI, no para abrir sesión en el panel: esa parte es diseño, no backend construido |
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
(`d509acfb-b4ad-480d-aa67-1b09b16a13c2`), **19 tarjetas**: Fundamentos, 11
páginas (`P0..P10`), 6 componentes (`C1..C6`) y el mapa de flujo. Los previews
locales están en `/opt/data/home/wallet-panel-ds-previews/` — 19 archivos, uno
por tarjeta.

### 4.1 Tarjetas y su archivo

| Tarjeta | Preview | Rol en el flujo |
|---|---|---|
| Fundamentos | `00-fundamentos.html` | color semántico, tipografía tabular, los 9 estados, las 4 reglas de contenido. **No es una pantalla**: es la referencia que gobierna todas |
| P0 Acceso | `p0-acceso.html` | entrada condicional (§1.1): botón único *Continuar con Google*, clickeable hacia P2 |
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
| [Mapa de flujo](https://claude.ai/design/p/d509acfb-b4ad-480d-aa67-1b09b16a13c2?file=pf-mapa-de-flujo.html) | `pf-mapa-de-flujo.html` | mapa visual de todas las páginas y sus conexiones, con los estados de viabilidad marcados. **No es una pantalla**: es el índice navegable del prototipo |

Diecinueve tarjetas: 1 de fundamentos + 11 páginas + 6 componentes + el mapa.
Cada una tiene su **ficha completa** en §5 (páginas) y §6 (componentes).

### 4.2 Orden de conexión de las tarjetas en el prototipo

Cada paso de los flujos de §2, con la tarjeta que le corresponde. Éste es el
orden en que se enlazan las tarjetas en Claude Design.

**El prototipo se recorre a click.** Cada flecha de este mapa es un enlace
real entre tarjetas: se navega pulsando el elemento de la pantalla, no
abriendo la tarjeta destino a mano. Los enlaces **ya están construidos** en
las 19 tarjetas: la barra de navegación, los retornos al hogar, los cinco
flujos y los nodos del mapa. La lista completa, origen por origen, está en
**§4.4**; el detalle de qué entra y qué sale de cada pantalla, en su ficha
de §5.

**Entrada**

```
P0 ──(click en "Continuar con Google")──▶ P2
 │                                         ▲
 └─(primera vez: checklist incompleto)──▶ P1 ──(guardar | saltar)──┘
```

En el prototipo, el enlace de P0 va **directo a P2**: el desvío por P1 depende
del checklist de onboarding, que es estado de backend y no se puede evaluar en
una maqueta. P1 se alcanza desde el mapa de flujo y desde P10.

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

### 4.4 Mapa de enlaces de punta a punta

**Cada flecha del mapa de flujo es un enlace real entre tarjetas.** Esta tabla
es esa lista completa: origen, el elemento concreto que se pulsa, y el destino.
Lo que no está acá, no se navega — y si el prototipo dibuja un control que no
figura en esta tabla, es porque está deshabilitado con su motivo (§3.5).

| Desde | Se pulsa | Hacia | Flujo |
|---|---|---|---|
| arranque | (sin sesión) | **P0** | entrada §1.1 |
| **P0** | *Continuar con Google* | **P2** | entrada §1.1 |
| **P1** | *Guardar* | **P2** | entrada §1.1 |
| **P1** | *Saltar por ahora* | **P2** | entrada §1.1 |
| **P1** | *Sugerir desde mi historial* | **P1** (estado *con sugerencia*) | entrada §1.1 |
| barra (P2..P10) | *Resumen* | **P2** | §1.3 |
| barra | *Movimientos* | **P4** | §1.3 |
| barra | *Revisión (N)* | **P5** | §1.3 |
| barra | *Estrategia* | **P8** | §1.3 |
| barra | *Ahorro* | **P9** | §1.3 |
| barra | chip de sync (C1 compacto) | **P3** | §1.3 |
| barra | ícono de chat | **C5** sobre la pantalla actual | §1.3 |
| barra | engranaje | **P10** | §1.3 |
| barra | menú `[≡]` | **P3**, **P6** | §1.3 |
| **P2** | `OverviewCard` saldo | **P4** | §1.2 |
| **P2** | `OverviewCard` tarjeta | **P8** | §2.4 |
| **P2** | `OverviewCard` colchón | **P9** | §2.4 |
| **P2** | `OverviewCard` en *sin leer* → *Completar perfil* | **P1** | §3.4 |
| **P2** | `ReviewBadge` "3 pendientes" | **P5** | §2.2 |
| **P2** | barra del `SpendingChart` | **P4** (filtrado por categoría) | §1.2 |
| **P2** | `BriefCard` → *preguntar* | **C5** sobre P2 | §2.3 |
| **P2** | estado vacío → *Sincronizar por primera vez* | **P3** | §3.4 |
| **P3** | *Sincronizar* | **P3** (*corriendo*) | §2.1 |
| **P3** | *Seguir* | **P3** (*corriendo*) | §2.1 |
| **P3** | *Detener* | **P3** (*a medias*, encadenado cortado) | §2.1 |
| **P3** | *Revisarlos ahora* (aviso persistente) | **P5** | §2.1 |
| **P3** | *Ir a Configuración* (503) | **P10** | §2.1 |
| **P3** | *Reintentar* (500) | **P3** (*corriendo*) | §2.1 |
| **P4** | fila → *Crear regla para este comercio* | **P6** (editor precargado) | §2.5 |
| **P4** | fila → *Preguntar sobre este movimiento* | **C5** sobre P4 | §2.3 |
| **P4** | fila en revisión → *Resolver* | **P5** | §2.2 |
| **P4** | `FilterBar` → *Limpiar filtros* | **P4** (sin filtros) | §3.4 |
| **P4** | estado sin ledger → *Sincronizar* | **P3** | §3.4 |
| **P5** | *Confirmar* / *Corregir* / *Descartar* | **P5** (cola N−1) | §2.2 |
| **P5** | resolver la última | **P5** (*cola vacía*) | §2.2 |
| **P5** | *Ver el rastro de resoluciones* | **P5** (con `ResolutionsLog`) | §2.2 |
| **P5** | volver desde la cola vacía | **P2** (total actualizado) | §2.2 |
| **P6** | *Ver los 7* | **P6** (con `C4` en miniatura) | §2.5 |
| **P6** | *Guardar* | **P6** (tabla con la regla) | §2.5 |
| **P6** | *Aplicar al historial* | **P6** (*previsualización*) | §2.5 |
| **P6** | *Aplicar* | **P6** (*aplicado*) | §2.5 |
| **P6** | *Cancelar* | **P6** (tabla) | §2.5 |
| **P6** | volver tras aplicar | **P2** (`SpendingChart` actualizado) | §2.5 |
| **C5** | *Revisar y crear* (propuesta) | **P6** (precargado) | §2.3 |
| **C5** | *Descartar* (propuesta) | **C5** (conversación sigue) | §2.3 |
| **C5** | *Detener* | **C5** (*detenido*) | §2.3 |
| **C5** | 503 → *Ir a Configuración* | **P10** | §2.3 |
| **C5** | cerrar (Esc o ✕) | la pantalla de origen, mismo scroll | §2.3 |
| **P7** | `ConversationList` → *Retomar* | **P7** (conversación elegida) | §2.3 |
| **P8** | perilla *Abono* | **P8** (proyección redibujada) | §2.4 |
| **P8** | *Marcar deuda pagada* | **P8** (confirmación → recalculado) | §2.4 |
| **P8** | *Ver el colchón* | **P9** | §2.4 |
| **P8** | *Preguntarle al agente sobre este plan* | **C5** sobre P8 | §2.4 |
| **P9** | *Fijar objetivo* | **P9** (*anillo después*) | §2.4 |
| **P9** | volver tras fijar el objetivo | **P2** (`OverviewCard` colchón actualizado) | §2.4 |
| **P9** | *Pedirle sugerencias al agente* | **C5** sobre P9 | §2.4 |
| **P10** | *Probar conexión* | **P10** (con resultado) | §1.2 |
| **P10** | *Completar perfil* | **P1** | §1.2 |
| **P10** | *Ver la pantalla de acceso* | **P0** (rotulada decorativa) | §1.1 |
| **mapa de flujo** | cualquier nodo | la tarjeta de esa pantalla | índice |

**El mapa de flujo es el índice.** `pf-mapa-de-flujo.html` no es una pantalla
del panel: es la tarjeta desde la que se llega a todas las demás, con el
veredicto de viabilidad marcado en cada nodo. Es el punto de entrada
recomendado para recorrer el prototipo, y el único lugar desde el que se
alcanzan las pantallas que no tienen enlace entrante desde el hogar (P0 y P1,
que son de entrada y en una sesión normal no se vuelven a ver).

**Enlaces que el prototipo deliberadamente no dibuja:** *Mandar a revisión*
desde P4 y *Rehacer el ledger desde cero* en P10 (H26 — ver
`docs/panel-viabilidad.md` §4). No están deshabilitados: no están.

**Filas de la tabla sin control en la maqueta.** Cinco destinos de arriba no
tienen hoy un elemento que pulsar, porque la tarjeta dibuja un solo estado y
esos controles viven en otro: los estados vacíos de **P2** (*Sincronizar por
primera vez*) y **P4** (*Sincronizar* sin ledger), *Ver el rastro de
resoluciones* en **P5** — el rastro ya está desplegado —, la propuesta del
agente en **C5** (*Revisar y crear* / *Descartar*), y *Ver la pantalla de
acceso* en **P10**. Los dos primeros se alcanzan igual desde `C1`/`C3`, que
sí dibujan el estado *nunca sincronizaste*; a **P0** se llega desde el mapa
de flujo, que es su único enlace entrante por diseño (§1.1). Se resuelven
cuando existan los duplicados por estado de §4.3, no antes: agregar el botón
sólo para tener el enlace inventaría un estado que la tarjeta no muestra.

---

## 5. Ficha de cada pantalla

Once fichas, una por página del design system. Cada una contesta lo mismo, en
el mismo orden: para qué está, qué muestra, qué se puede hacer, **de dónde se
llega y a dónde se va a click**, si se puede construir hoy, con qué se
alimenta, y qué números inventados usa el prototipo.

**Todos los datos de la sección "datos ficticios" son inventados**, elegidos
para que los flujos se lean, y así están rotulados en cada tarjeta. No hay
moneda, país, comercio real ni titular: *Comercio A*, *Comercio B*,
*Persona 1*. Los formularios del prototipo **arrancan vacíos** — los valores
de ejemplo aparecen sólo en las variantes que ilustran una sugerencia del
agente, nunca como default de un campo.

### P0 — Acceso · **NO VIABLE** (H1)

- **(a) Propósito y lugar en el flujo.** La puerta. Primera y única pantalla
  antes de tener sesión; se saltea entera si la sesión de Google está viva o si
  el modo demostración está activo. Es lo primero que ve un humano y lo último
  en construirse (§9 del plan): autenticar de verdad es trabajo de server.
- **(b) Qué muestra.** El nombre del panel, una línea de qué autoriza esa
  cuenta ("la misma cuenta de Gmail cuyos correos alimentan el ledger"), el
  botón único, y —si aplica— el cartel de modo demostración. **No muestra**
  campos de usuario, contraseña, frase de acceso ni selector de backend.
- **(c) Acciones.** Una sola: **Continuar con Google**.
- **(d) Navegación clickeable.**

  ```
  arranque (sin sesión) ──▶ P0
  P10 ──(ver la pantalla de acceso)──▶ P0
  mapa de flujo ──▶ P0

  P0 ──(Continuar con Google)──▶ P2
       └─(en producto, si el checklist está incompleto)──▶ P1
  ```

  El prototipo no simula la ventana de consentimiento de Google: el botón salta
  directo a P2. El desvío por P1 depende del estado del onboarding, que es
  backend, y por eso no se enlaza desde acá (P1 se alcanza desde el mapa y
  desde P10).
- **(e) Viabilidad.** **NO VIABLE — H1.** El server no autentica nada: no hay
  verificación de `id_token`, no hay sesión, no hay lista de cuentas
  permitidas. El OAuth que el repo ya tiene es de escritorio y sirve para
  **leer correos**, no para abrir sesión en una SPA.
- **(f) Con qué se alimenta.** `GET /api/health` como sonda de vida. La sesión
  la daría el login de Google que todavía no existe; H1 propone que
  `/api/health` pase a devolver `{status, auth_required}` para que la pantalla
  sepa si la puerta sirve o es decorativa.
- **(g) Datos ficticios.** Ninguna cifra. Sólo texto de ejemplo y la banda
  *"maqueta — el server todavía no valida sesión de Google"*.

### P1 — Alta y perfil · **NO VIABLE** (H2, H3, H4)

- **(a) Propósito y lugar en el flujo.** Convertir `npm run onboard` en
  formulario. Es entrada condicional: se muestra la primera vez, cuando el
  checklist está incompleto, y **nunca bloquea** — *Saltar por ahora* siempre
  está.
- **(b) Qué muestra.** `OnboardChecklist` con los pasos **que devuelva el
  motor** (no una lista escrita a mano — H4), `ProfileForm` (sueldo, día de
  pago, colchón objetivo, **titular**) y `SuggestionCard` con lo que el agente
  leyó del ledger, deshabilitada hasta que se acepte.
- **(c) Acciones.** *Sugerir desde mi historial*, *Aceptar* / *Editar* sobre
  cada sugerencia, *Guardar*, *Saltar por ahora*.
- **(d) Navegación clickeable.**

  ```
  P0 ──(checklist incompleto)──▶ P1        [no enlazado en el prototipo]
  P10 ──(Completar perfil)──▶ P1
  P2[C3 "Sin leer"] ──(Completar perfil)──▶ P1
  mapa de flujo ──▶ P1

  P1 ──(Guardar)──────────────▶ P2
     ├─(Saltar por ahora)──────▶ P2
     └─(Sugerir desde mi historial)──▶ P1 [estado: con sugerencia]
  ```
- **(e) Viabilidad.** **NO VIABLE — H2, H3, H4.** Las tres funciones que
  necesita (`onboardStatus`, `buildSuggestions`, `setStrategyConfig`) existen y
  están testeadas, pero **sólo se alcanzan por MCP o CLI**: no hay una sola
  ruta HTTP de onboarding. Además, el paso dibujado como *"Cuentas"* no
  corresponde a nada del motor y se renombra a **Titular** (H3).
- **(f) Con qué se alimentaría.** `GET /api/onboarding/status`,
  `GET /api/onboarding/suggestions`, `POST /api/onboarding/profile` (H2). En
  MCP ya existen como `onboarding_status`, `suggest_profile`, `set_profile`.
- **(g) Datos ficticios.** El formulario se dibuja **vacío**. La
  `SuggestionCard` de ejemplo propone: sueldo `1 200,00`, día de pago `30`,
  colchón objetivo `500,00`, titular *Persona 1* — todos rotulados *"propuesto
  por el agente, sin confirmar"*. Checklist de ejemplo: 4 de 6 pasos completos.

### P2 — Resumen · **VIABLE**

- **(a) Propósito y lugar en el flujo.** El hogar. Toda sesión abre acá y todo
  flujo vuelve acá. Qué pasa hoy, en diez segundos.
- **(b) Qué muestra.** Rejilla de seis `OverviewCard` (saldo, safe-to-spend,
  tarjeta, próximo pago, colchón, gasto del mes), `SpendingChart` por
  categoría, `BriefCard` con la narrativa del día, `SyncStatusChip` y
  `ReviewBadge` en la barra, y el calendario cobro · corte · vencimiento.
- **(c) Acciones.** Pulsar cualquier tarjeta (cada una navega), *Sincronizar
  ahora*, *Ver los N pendientes*, *Preguntarle al agente*.
- **(d) Navegación clickeable.**

  ```
  P0 ──(Continuar con Google)──▶ P2
  P1 ──(Guardar | Saltar)──────▶ P2
  P5[cola vacía] ──────────────▶ P2   (con el total ya actualizado)
  P6[aplicado] ────────────────▶ P2   (SpendingChart actualizado)
  P9[objetivo fijado] ─────────▶ P2   (colchón actualizado)
  barra ──(Resumen)────────────▶ P2

  P2 ├─[chip de sync]──────────▶ P3
     ├─[ReviewBadge N]─────────▶ P5
     ├─[C3 saldo]──────────────▶ P4
     ├─[C3 tarjeta]────────────▶ P8
     ├─[C3 colchón]────────────▶ P9
     ├─[C3 "Sin leer" → Completar perfil]──▶ P1
     ├─[barra del SpendingChart]──▶ P4 (filtrado por esa categoría)
     ├─[BriefCard → preguntar]──▶ C5 sobre P2
     └─[estado vacío → Sincronizar por primera vez]──▶ P3
  ```
- **(e) Viabilidad.** **VIABLE, sin huecos.** Cada elemento del preview se
  verificó contra un campo real de `/api/overview`. Nada se calcula en el
  cliente.
- **(f) Con qué se alimenta.** `GET /api/overview` (`balance`,
  `safe_to_spend_hoy`, `card` + `card_status`, `next_payday`, `buffer_status`,
  `spending_by_category`, `counts.needs_review`), `GET /api/brief` y
  `GET /api/sync/status`. En MCP: `get_overview`, `get_balance`,
  `get_spending_by_category`.
- **(g) Datos ficticios.** Saldo `2 480,00`; safe-to-spend `62,00`; tarjeta
  mínimo `120,00`, fecha máxima *día 18*; próximo pago **"Sin leer"** (para
  mostrar `null` ≠ 0); colchón objetivo `500,00` / reservado `320,00` / faltan
  `180,00`; gasto del mes por categoría: comida `210,00`, transporte `85,00`,
  servicios `140,00`; badge de revisión en **3**; nota *"3 en revisión,
  excluidas del total"*. La variante *tras resolver la cola* muestra el saldo
  en `2 525,00` y sin la nota — el cambio es el punto de §2.2.

### P3 — Sincronización · **PARCIAL** (H17, H18, H19)

- **(a) Propósito y lugar en el flujo.** Operar el sync y entender en qué
  estado está el buzón. Es la pantalla que hace visible la regla incómoda:
  **una llamada drena un lote, no el buzón entero.**
- **(b) Qué muestra.** El `SyncButton` (C1) en versión completa, la barra
  `procesados / total`, la etiqueta de frescura, el resumen del último lote y
  el registro de lotes de la sesión.
- **(c) Acciones.** *Sincronizar*, *Seguir*, *Detener*, *Reintentar*.
- **(d) Navegación clickeable.**

  ```
  P2[chip de sync] ────────────▶ P3
  P2[estado vacío] ────────────▶ P3
  P4[sin ledger] ──────────────▶ P3
  barra[≡ → Sincronización] ───▶ P3

  P3 ├─(Sincronizar | Seguir | Reintentar)──▶ P3 [corriendo]
     ├─(Detener)───────────────────────────▶ P3 [a medias, encadenado cortado]
     ├─(completo, N>0 → Revisarlos ahora)──▶ P5
     └─(503 → Ir a Configuración)──────────▶ P10
  ```
- **(e) Viabilidad.** **PARCIAL.** El ciclo entero y los ocho estados del botón
  salen de datos reales. Faltan: **H18** (no hay cancelación — *Detener* corta
  sólo el auto-encadenado, y la barra sólo avanza entre lotes porque el
  progreso se escribe al cerrar cada uno), **H17** (no se persiste ningún
  resumen por lote: el registro vive en memoria y se pierde al recargar) y
  **H19** (`batch_size` existe en la tool MCP, no en la ruta HTTP).
- **(f) Con qué se alimenta.** `POST /api/sync` (devuelve `{summary,
  progress}`) y `GET /api/sync/status` (`last_sync_ts` + `backlog`, para
  rehidratar al montar). En MCP: `sync`.
- **(g) Datos ficticios.** Barra en `1 240 de 3 800`; *"quedaron 2 560 por
  procesar"*; *"reintento 2 de 5"*; último lote: 84 correos vistos, 12 nuevos,
  3 a revisión; registro de tres lotes de la sesión, rotulado *"registro de
  esta sesión — se pierde al recargar"* (H17). El estado *nunca* dice
  literalmente **"nunca sincronizaste"**, no una fecha inventada.

### P4 — Movimientos · **PARCIAL** (H20, H21, H24, H26)

- **(a) Propósito y lugar en el flujo.** El ledger navegable, y el origen de
  dos flujos: el de reglas (§2.5) y el del chat con contexto (§2.3).
- **(b) Qué muestra.** `TransactionsTable` (C4) con fecha, contraparte, monto,
  tipo, dirección y categoría, más las marcas por fila (en revisión, reverso,
  interna, descartada); `FilterBar` (C6) en el encabezado; el drawer de detalle
  de una fila; el paginador.
- **(c) Acciones.** Filtrar por rango, tipo, dirección y contraparte; mostrar u
  ocultar reversados / internos / descartados; abrir el drawer de una fila;
  *Crear regla para este comercio*; *Preguntar sobre este movimiento*;
  *Resolver* en una fila en revisión.
- **(d) Navegación clickeable.**

  ```
  P2[C3 saldo] ────────────────▶ P4
  P2[barra del SpendingChart] ─▶ P4 (con el filtro de categoría puesto)
  barra[Movimientos] ──────────▶ P4
  C5[cerrar] ──────────────────▶ P4 (mismo scroll, mismos filtros)

  P4 ├─[fila → Crear regla para este comercio]──▶ P6 (editor precargado)
     ├─[fila → Preguntar sobre este movimiento]─▶ C5 sobre P4
     ├─[fila en revisión → Resolver]────────────▶ P5
     ├─[FilterBar → Limpiar filtros]────────────▶ P4 [sin filtros]
     └─[sin ledger → Sincronizar]───────────────▶ P3
  ```
- **(e) Viabilidad.** **PARCIAL.** La tabla entera es viable: las marcas vienen
  como columnas de la fila y no se recalculan. Faltan **H20** (la respuesta
  trae el tamaño de la página, no el total: sin eso no hay *"Mostrando 8 de N"*
  ni paginador), **H21** (no existe el filtro por categoría) y **H24**
  (`GET /api/review/resolutions` ignora los filtros, así que *"Ver por qué"* de
  una fila descartada no tiene de dónde salir). **H26**: *Mandar a revisión*
  **no se dibuja** — se recomienda no construirlo.
- **(f) Con qué se alimenta.** `GET /api/transactions` con `from`, `to`,
  `type`, `direction`, `counterparty`, `limit`, `offset`, `include_reversed`,
  `include_internal`, `include_discarded`. En MCP: `query_transactions`.
- **(g) Datos ficticios.** Ocho filas de ejemplo: *Comercio A* `−45,00` (12
  sep), *Comercio B* `−12,50`, *Persona 1* `+300,00` marcada **interna**, una
  fila con monto **"Sin leer"** y marca *en revisión*, y una marcada *reverso*.
  Pie: *"Mostrando 8 de 214"* con banda *"la API devuelve el tamaño de la
  página, no el total"* (H20).

### P5 — Revisión · **PARCIAL** (H9, H10, H24)

- **(a) Propósito y lugar en el flujo.** Vaciar la cola de lo que el agente no
  pudo afirmar. Es donde la invariante del proyecto se vuelve visible: si el
  parser y Claude no coincidieron, la fila cayó acá y **está fuera de todos los
  totales**. Resolver mueve el número de P2, y el prototipo tiene que mostrar
  ese antes y después.
- **(b) Qué muestra.** La cola como pila de `ReviewCard` (C2), el contador, y
  —tras vaciarla— el estado vacío celebrado y el `ResolutionsLog`.
- **(c) Acciones.** *Confirmar monto*, *Corregir monto* (campo dentro de la
  tarjeta, sin diálogo modal), *Descartar* (con nota opcional), *Ver el rastro
  de resoluciones*.
- **(d) Navegación clickeable.**

  ```
  P2[ReviewBadge N] ───────────▶ P5
  P3[aviso → Revisarlos ahora] ▶ P5
  P4[fila en revisión → Resolver] ▶ P5
  barra[Revisión (N)] ─────────▶ P5

  P5 ├─(Confirmar | Corregir | Descartar)──▶ P5 [cola N−1]
     ├─(resolver la última)────────────────▶ P5 [cola vacía]
     ├─(Ver el rastro de resoluciones)─────▶ P5 [con ResolutionsLog]
     ├─(el motor rechaza)──────────────────▶ P5 [C2 rechazada, la fila NO sale]
     └─(volver desde la cola vacía)────────▶ P2 [total actualizado]
  ```
- **(e) Viabilidad.** **PARCIAL, y el hueco es el corazón de la pantalla.** La
  cola, el conteo, las tres acciones, la traducción del error y el rastro
  auditable están completos y testeados. Lo que no existe: **H9** — el
  `review_reason` se calcula en `ingest/pipeline.ts` y **se pierde** (no hay
  columna, `insertTransaction` no la escribe) — y **H10** — el monto que leyó
  Claude tampoco se persiste, así que la comparación de dos columnas que
  define la tarjeta no tiene de dónde salir. **H24**: las resoluciones no se
  pueden filtrar por transacción desde la ruta.
- **(f) Con qué se alimenta.** `GET /api/review`,
  `POST /api/review/:id/resolve` (`confirm` / `correct` / `discard`),
  `GET /api/review/resolutions`. En MCP: `get_review_queue`, `resolve_review`.
- **(g) Datos ficticios.** Cola de **3**: *Comercio A* con monto **"Sin leer"**
  y asunto *"Notificación de consumo"*; *Comercio B* `−12,50` con asunto
  *"Compra aprobada"*; *Persona 1* `+300,00` con asunto *"Transferencia
  recibida"*. **El cuerpo del correo no se dibuja nunca** — es dato personal;
  en su lugar va un enlace por `gmail_msg_id`. El chip de motivo aparece sólo
  en la variante aparte, rotulada *"depende de persistir `review_reason` y
  `claude_amount`"*.

### P6 — Categorías y reglas · **NO VIABLE** (H5, H6, H7, H8, H25)

- **(a) Propósito y lugar en el flujo.** Enseñarle al agente cómo clasificar.
  Se llega casi siempre desde una acción (una fila sin categoría en P4, o una
  propuesta del chat), no desde el menú.
- **(b) Qué muestra.** `RulesTable` con las reglas vigentes y su columna
  *matchea N*, el `RuleEditor` con el **contador en vivo**, la lista de
  contrapartes sin categoría, y la previsualización de *Aplicar al historial*.
- **(c) Acciones.** *Crear regla*, *Editar*, *Borrar*, *Ver los N*, *Aplicar
  reglas al historial* (con previsualización antes), *Recuperar comercios
  faltantes*.
- **(d) Navegación clickeable.**

  ```
  P4[fila → Crear regla para este comercio] ──▶ P6 [editor precargado]
  C5[propuesta → Revisar y crear] ────────────▶ P6 [editor precargado]
  barra[≡ → Categorías y reglas] ─────────────▶ P6

  P6 ├─(escribir un patrón más largo)──▶ P6 [contador en 0 + advertencia]
     ├─(Ver los 7)────────────────────▶ P6 [C4 en miniatura]
     ├─(Guardar)──────────────────────▶ P6 [tabla con la regla nueva]
     ├─(Aplicar al historial)─────────▶ P6 [previsualización]
     │    ├─(Aplicar)─────────────────▶ P6 [aplicado] ──▶ P2 [chart actualizado]
     │    └─(Cancelar)────────────────▶ P6 [tabla]
     └─(Borrar)───────────────────────▶ rotulado pendiente de motor (H7)
  ```
- **(e) Viabilidad.** **NO VIABLE.** Todas las funciones existen y están
  testeadas, y **ninguna tiene ruta HTTP** (H5). Y aun con las rutas faltan
  tres cosas en el motor: **H6** — no existe función que cuente cuántas filas
  matchea un patrón, y ese contador es la defensa contra la trampa conocida
  (*un patrón más largo que la contraparte real nunca matchea*); tiene que usar
  exactamente la normalización de `toRulePattern` o el número miente. **H7** —
  no se puede borrar una regla. **H8** — `backfillCategories` escribe, no tiene
  modo dry-run, así que la previsualización no existe. **H25** — *Recuperar* es
  por lote (las N más caras), no por fila elegida.
- **(f) Con qué se alimentaría.** `GET/POST /api/rules`,
  `DELETE /api/rules/:pattern`, `POST /api/rules/apply {dry_run}`,
  `GET /api/rules/match-count?pattern=`,
  `GET /api/counterparties/uncategorized`, `POST /api/counterparties/heal`
  (H5–H8, H25). En MCP ya existen `set_rule`, `apply_rules`,
  `heal_counterparties`.
- **(g) Datos ficticios.** Regla de ejemplo *Comercio A → comida*, contador en
  **7**; al alargar el patrón, contador en **0** con la advertencia; tres
  reglas en la tabla; previsualización *"se reclasificarían 7 movimientos"*;
  tras aplicar, la nota *"reclasificar no mueve el gasto por categoría de las
  filas de tipo transferencia"*. Todo el bloque va con banda *"requiere rutas
  de reglas + `countMatchingTransactions`"*.

### P7 — Chat · **VIABLE**

- **(a) Propósito y lugar en el flujo.** Preguntarle al agente cualquier cosa
  sobre el historial. **Es un cajón, no un destino**: se abre encima de la
  pantalla donde estás, arrastra el contexto de origen, y al cerrarse devuelve
  ahí mismo. La ruta `/chat` existe para entrar directo y ver el historial.
- **(b) Qué muestra.** El `ChatPanel` (C5): la conversación con streaming por
  bloques, el `ContextChip` de origen, un chip por cada tool que el agente usa,
  la lista de conversaciones anteriores, y las tarjetas de propuesta.
- **(c) Acciones.** Escribir y enviar, *Detener*, *Nueva conversación*,
  *Retomar*, los tres atajos del estado vacío, y sobre una propuesta: *Revisar
  y crear* / *Descartar*.
- **(d) Navegación clickeable.**

  ```
  P2[BriefCard] ─┐
  P4[fila] ──────┤
  P5 ────────────┼──▶ C5 sobre esa pantalla (con ContextChip)
  P8[plan] ──────┤
  P9[colchón] ───┘
  barra[ícono de chat] ──▶ C5 sobre la pantalla actual
  barra[≡ → Chat] ───────▶ P7 (ruta propia, con el historial)

  C5 ├─(Revisar y crear)──────▶ P6 [precargado]
     ├─(Descartar)────────────▶ C5 [la conversación sigue]
     ├─(Detener)──────────────▶ C5 [detenido, lo escrito se conserva]
     ├─(503 → Ir a Configuración)──▶ P10
     └─(cerrar: Esc o ✕)──────▶ la pantalla de origen, mismo scroll
  ```
- **(e) Viabilidad.** **VIABLE, sin huecos.** El streaming, el historial, el
  contexto de origen, el 503 antes de abrir el stream y el *Detener* por corte
  de request están todos cableados. El chip de tool sale de los eventos `tool`
  del SSE.
- **(f) Con qué se alimenta.** `POST /api/chat/:conversationId?` en SSE
  (eventos `meta`, `text`, `tool`, `done`, `error`), `GET /api/conversations`,
  `GET /api/conversations/:id`. Es **el único endpoint del server que ya habla
  SSE**.
- **(g) Datos ficticios.** Pregunta de ejemplo *"¿en qué se me fue la plata
  este mes?"*; `ContextChip` *"Sobre: Comercio A · 12 sep · −45,00"*; chip de
  tool *"Leído de `query_transactions`"*; propuesta *"Crear la regla: Comercio
  A → comida — matchearía 7 movimientos"*. La respuesta del agente va rotulada
  **"respuesta del agente"**, nunca como cifra del sistema.

### P8 — Estrategia · **PARCIAL** (H11, H12, H13)

- **(a) Propósito y lugar en el flujo.** El plan: tarjeta, deudas, calendario,
  proyección. Se llega desde la tarjeta de crédito de P2 y sale al colchón.
- **(b) Qué muestra.** Cuatro `OverviewCard` (saldo de corte, mínimo, fecha
  máxima, requerido por quincena) con el indicador *a tiempo / atrasado*, la
  lista de deudas, el calendario de pagos y la `ProjectionChart`.
- **(c) Acciones.** Mover la perilla *Abono* (**simulación, no se guarda**),
  *Marcar deuda pagada* (**escritura, con confirmación**), *Ver el colchón*,
  *Preguntarle al agente sobre este plan*.
- **(d) Navegación clickeable.**

  ```
  P2[C3 tarjeta] ──────────────▶ P8
  barra[Estrategia] ───────────▶ P8

  P8 ├─(perilla Abono)─────────▶ P8 [proyección redibujada, sin escribir]
     ├─(Marcar deuda pagada)───▶ P8 [confirmación → recalculado]
     ├─(Ver el colchón)────────▶ P9
     └─(Preguntarle al agente sobre este plan)──▶ C5 sobre P8
  ```
- **(e) Viabilidad.** **PARCIAL.** Las cuatro tarjetas de arriba salen exactas
  de `card_status`. Faltan: **H11** — se puede marcar una deuda pagada por id,
  pero **no hay forma de listarlas** (`GET /api/debts` no existe), y la columna
  *Vence* no tiene columna en la tabla `debts`; tampoco hay *Deshacer*.
  **H12** — el calendario de pagos no está expuesto: del calendario dibujado,
  sólo el corte y el vencimiento de tarjeta son reales. **H13** — el simulador
  dibuja tres perillas y la proyección acepta **una** (`abono`); las otras dos
  serían aritmética nueva, y calcularlas en el cliente rompe la regla del panel.
- **(f) Con qué se alimenta.** `GET /api/overview` (`card_status`:
  `saldoCorte`, `minimo`, `fechaMaxima`, `requeridoPorQuincena`, `aTiempo`,
  `saldoActualEstimado`; más `next_payday`), `GET /api/strategy/projection?abono=`
  y `POST /api/debts/:id/paid`.
- **(g) Datos ficticios.** Saldo de corte `940,00`; mínimo `120,00`; fecha
  máxima *día 18*; requerido por quincena `470,00`; estado **a tiempo**. Lista
  de deudas de ejemplo: *Persona 1* `200,00`, *Persona 2* `75,00`, con banda
  *"no existe `GET /api/debts`"* y la columna *Vence* en gris. La perilla de
  abono va rotulada *"simulación, no se guarda"*; las otras dos, visibles y
  **deshabilitadas** (H13).

### P9 — Ahorro y colchón · **PARCIAL** (H14, H15, H16)

- **(a) Propósito y lugar en el flujo.** Lo que se guarda y cuánto falta.
  Cierra el flujo de estrategia (§2.4, pasos 6-10) y es la pantalla donde el
  impacto de un ajuste tiene que **verse**: el anillo antes y después.
- **(b) Qué muestra.** El anillo del colchón (objetivo, reservado, faltante,
  estado *financiado / falta*), el editor del objetivo, las metas y el
  histórico de aportes.
- **(c) Acciones.** *Fijar objetivo* (escribe **el perfil**, y la pantalla lo
  dice), *Registrar aporte* (deshabilitado), *Pedirle sugerencias al agente*.
- **(d) Navegación clickeable.**

  ```
  P2[C3 colchón] ──────────────▶ P9
  P8[Ver el colchón] ──────────▶ P9
  barra[Ahorro] ───────────────▶ P9

  P9 ├─(Fijar objetivo → Guardar)──▶ P9 [anillo después]
     │                                └──▶ P2 [C3 colchón actualizado]
     └─(Pedirle sugerencias al agente)──▶ C5 sobre P9
  ```
- **(e) Viabilidad.** **PARCIAL.** El anillo entero, con su porcentaje y su
  estado, es viable hoy. Los huecos: **H14** — y es la trampa fina —
  `POST /api/buffer` escribe `savings.reserved`, pero **el objetivo que el
  motor lee sale de `strategy_config.colchonObjetivo`**; o sea que el botón más
  visible de la pantalla escribiría una columna que el motor no lee. El
  objetivo tiene que ir por la ruta de perfil (H2). **H15** — *Registrar
  aporte* es un incremento y el endpoint fija un valor absoluto: **la suma la
  hace el server, no el cliente**. **H16** — `metas`, `metas_avance`,
  `flexiahorro` y `saldos` existen en el esquema y **ningún código las lee**.
- **(f) Con qué se alimenta.** `GET /api/overview` → `buffer_status` (objetivo,
  reservado, financiado, faltante) y `POST /api/buffer`. En MCP:
  `get_colchon_status`. Las "sugerencias de ahorro" **son el chat con un prompt
  específico**, no un motor propio: no existe `strategy/savings.ts`.
- **(g) Datos ficticios.** Anillo *antes*: objetivo `500,00`, reservado
  `320,00`, faltan `180,00`. Anillo *después*: objetivo `800,00`, reservado
  `320,00`, faltan `480,00`. Metas de ejemplo y tres aportes en el histórico,
  con banda *"tablas sin endpoint"* (H16).

### P10 — Configuración · **PARCIAL** (H1, H2, H26)

- **(a) Propósito y lugar en el flujo.** El estado de las conexiones y las
  llaves. Es **el destino de todo error de configuración**: cada 503 del server
  (`gmail_not_configured`, `claude_not_configured`) dibuja un enlace directo
  acá, desde donde haya ocurrido.
- **(b) Qué muestra.** El checklist de conexiones (Gmail, Claude, base de
  datos, sesión de acceso), el selector de backend, el estado del modo
  demostración, el bloque de publicación (fases 0/1/2) y el apartado *lo que
  esta pantalla no hace*.
- **(c) Acciones.** Cambiar backend, activar/desactivar demo, *Probar
  conexión*, *Volver a correr el checklist*, ver las instrucciones de
  `npm run gmail-auth`.
- **(d) Navegación clickeable.**

  ```
  P3[503 → Ir a Configuración] ─┐
  C5[503 → Ir a Configuración] ─┼──▶ P10
  barra[engranaje] ─────────────┘

  P10 ├─(Probar conexión)──────────▶ P10 [con resultado]
      ├─(Completar perfil)─────────▶ P1
      └─(Ver la pantalla de acceso)▶ P0 [rotulada decorativa]
  ```
- **(e) Viabilidad.** **PARCIAL.** Lo que ya se puede construir sin tocar el
  server es todo lo que vive en el navegador: selector de backend, modo demo,
  *Probar conexión* contra `GET /api/health`, el bloque de publicación y los
  textos. Falta **H2** — el checklist de conexiones es `onboarding_status`, que
  no tiene ruta HTTP, y es el contenido principal de la pantalla — y **H1** —
  el estado de la sesión de acceso, que todavía no existe. No hay endpoint que
  pruebe la credencial de Gmail sin disparar un sync: ese estado sale del
  checklist.
- **(f) Con qué se alimenta.** `GET /api/health` hoy;
  `GET /api/onboarding/status` cuando exista (H2). En MCP: `onboarding_status`.
- **(g) Datos ficticios.** Checklist de ejemplo: Gmail **conectado**, Claude
  **conectado**, base de datos **ok**, sesión de acceso **sin configurar**;
  backend apuntando a `demo`. **No se dibujan credenciales ni tokens**: los
  valores viven en `.env` y ahí se quedan. La zona de riesgo **no tiene botón**
  (H26): explica cómo se rehace el ledger desde la terminal, y nada más.

### P11 — Estado del sistema

**No es una tarjeta del design system y no entra en el prototipo.** Se lista
para que quede planificado: salud del pipeline, última corrida, errores
recientes y métricas de `db/telemetry.ts` — sólo claves, conteos e ids, nunca
valores personales. **NO VIABLE hoy**: la telemetría se emite a stdout/stderr y
no hay endpoint que la devuelva; necesitaría un colector, que es un ticket
propio.

---

## 6. Ficha de cada componente

Seis componentes. A diferencia de las páginas, un componente no tiene
navegación propia: **hereda la de la pantalla donde vive**. Por eso su ficha
contesta otras cinco preguntas: dónde aparece, qué estados tiene, qué se puede
pulsar dentro suyo, si se puede construir hoy, y con qué números se dibuja.

### C1 — SyncButton · **PARCIAL** (H17, H18, H19)

- **(a) Dónde aparece.** P2 (chip compacto en la barra de navegación), P3
  (control principal, versión completa) y P10 (estado de la conexión de Gmail).
  Es el mismo componente y el mismo estado en los tres lugares: cambia el
  envase, no la lógica.
- **(b) Estados visuales — los ocho, todos obligatorios en el prototipo.**

  | Estado | Se ve | Se llega ahí |
  |---|---|---|
  | *Al día* | verde, "sincronizado hace X" | `last_sync_ts` reciente, sin backlog |
  | *Atrasado* | ámbar, "última vez hace X" | `last_sync_ts` viejo |
  | *Nunca* | neutro, **"nunca sincronizaste"** | `last_sync_ts` es `null` — no una fecha inventada |
  | *A medias* | ámbar con barra, "quedaron N por procesar" | `backlog` no es `null` |
  | *Corriendo* | spinner + barra, botón bloqueado | `POST /api/sync` en vuelo |
  | *Otro lo está corriendo* | aviso **ámbar, no rojo** | 409 `sync_already_running` |
  | *Sin configurar* | enlace a P10 | 503 `gmail_not_configured` |
  | *Falló* | rojo, mensaje del server tal cual + *Reintentar* | 500 |

- **(c) Interacción clickeable.** El chip de P2 navega a **P3**. En P3:
  *Sincronizar* / *Seguir* / *Reintentar* → estado *corriendo*; *Detener* →
  *a medias*; el estado *sin configurar* → **P10**.
- **(d) Viabilidad.** **PARCIAL.** Siete de los ocho estados se derivan de
  datos reales. El octavo, *corriendo*, dibuja una barra que **sólo avanza
  entre lotes** (H18: `advanceSyncProgress` escribe una vez por lote, al final)
  y un *Detener* que **no cancela** (H18: lo único que se detiene es el
  auto-encadenado del cliente). El *"reintento 2 de 5"* es contador del cliente
  y está bien que lo sea. La rehidratación desde `GET /api/sync/status` al
  montar existe y funciona. H17: el registro de lotes no se persiste. H19:
  `batch_size` no está expuesto por HTTP.
- **(e) Datos ficticios.** *"sincronizado hace 4 min"*, *"última vez hace 3
  días"*, barra `1 240 de 3 800`, *"quedaron 2 560 por procesar"*, *"reintento
  2 de 5"*.

### C2 — ReviewCard · **NO VIABLE tal como está diseñada** (H9, H10)

- **(a) Dónde aparece.** P5 (la cola, una tarjeta por fila) y P4 (drawer de una
  fila marcada en revisión).
- **(b) Estados y variantes.** *pendiente*, *corrigiendo* (campo de monto
  abierto dentro de la tarjeta), *resolviendo* (en vuelo), *resuelta*
  (colapsando), *rechazada por el motor* (con el mensaje, y **la fila no sale
  de la cola**), y la variante **sin motivo disponible** — que es la
  **primaria** en el prototipo.
- **(c) Interacción clickeable.** *Confirmar monto* → *resuelta*. *Corregir
  monto* → *corrigiendo* → *Guardar* → *resuelta*. *Descartar* (nota opcional)
  → *resuelta*. Cada resolución baja el contador y dispara `refreshNow()`. El
  enlace del asunto abre el correo en Gmail por `gmail_msg_id`.
- **(d) Viabilidad.** **NO VIABLE tal como está diseñada** — y conviene decirlo
  sin rodeos: sus tres elementos distintivos no tienen respaldo persistido. El
  **motivo** (H9) se calcula en el pipeline y se pierde; **"lo que leyó
  Claude"** (H10) no se guarda en ninguna columna; **el correo original** sólo
  existe como `raw_subject`, y eso está bien — el cuerpo es dato personal y no
  debe guardarse. Lo que **sí** se construye hoy: contraparte, monto del ledger
  (con "Sin leer" para `null`), asunto, las tres acciones y el error del motor
  tal cual. Las variantes *"Motivo: monto no legible"* y *"Motivo: duplicado
  sospechado"* dependen enteras de `review_reason`; sus acciones alternativas
  (*"Son distintos"* / *"Es el mismo, descartar uno"*) no son acciones nuevas
  del motor: se mapean a `confirm` y `discard`.
- **(e) Datos ficticios.** *Comercio A · 12 sep · monto **Sin leer** · asunto
  "Notificación de consumo"*. La variante con motivo lleva el chip *"monto no
  legible"* y la banda *"depende de persistir `review_reason` y
  `claude_amount`"*. **Nunca se dibuja el cuerpo de un correo.**

### C3 — OverviewCard · **VIABLE**

- **(a) Dónde aparece.** P2 (la rejilla de seis), P8 (las cuatro tarjetas de la
  tarjeta de crédito) y P9 (el anillo del colchón es su variante grande).
- **(b) Estados visuales.** *con dato*, *cero* (que es una **cifra legítima**,
  no un faltante), *sin leer* (`null` → el texto "Sin leer" + enlace *Completar
  perfil*), *cargando* (esqueleto) y *sin conexión* (cifra atenuada).
- **(c) Interacción clickeable.** Cada tarjeta navega a su pantalla: saldo →
  P4, tarjeta → P8, colchón → P9, *Sin leer* → P1. Una `OverviewCard` que no
  navega a ningún lado se dibuja sin afordancia de click.
- **(d) Viabilidad.** **VIABLE, sin huecos.** Cifra + contexto + estado, sin
  cálculo propio: cada tarjeta lee un campo de `GET /api/overview`. Los estados
  *cargando* y *sin conexión* son de cliente. La distinción entre `0` y `null`
  **está en el dato**, no en la UI.
- **(e) Datos ficticios.** Saldo `2 480,00`; safe-to-spend `62,00`; gasto en
  transporte `0,00` (a propósito, para mostrar que el cero es una cifra);
  próximo pago **"Sin leer"**.

### C4 — TransactionsTable · **PARCIAL** (H20, H24, H25)

- **(a) Dónde aparece.** P4 (pantalla completa, con el `FilterBar` arriba y el
  paginador abajo) y P6 (en miniatura, para previsualizar las filas que matchea
  una regla).
- **(b) Estados visuales.** *con filas*, *cargando*, *vacía por filtros*
  (distinta de la siguiente), *vacía porque no hay ledger*; y las marcas por
  fila: **en revisión**, **reverso**, **interna**, **descartada**.
- **(c) Interacción clickeable.** Fila → drawer de detalle. Desde la fila:
  *Crear regla para este comercio* → **P6** precargado; *Preguntar sobre este
  movimiento* → **C5** sobre P4; *Resolver* (si está en revisión) → **P5**.
  Estado vacío por filtros → *Limpiar filtros*; estado sin ledger → **P3**.
- **(d) Viabilidad.** **PARCIAL.** Columnas y marcas están completas: vienen
  como columnas de la fila y no se recalculan. Faltan **H20** (*"Mostrando 8 de
  N"* y el paginador: la API devuelve el tamaño de la página, no el total),
  **H24** (*"Ver por qué"* de una fila descartada — el motor sabe filtrar por
  transacción, la ruta no lo expone) y **H25** (*Recuperar* una fila sin
  contraparte: el heal es por lote, no por fila).
- **(e) Datos ficticios.** Las mismas ocho filas de P4 (§5, P4-g). En la
  miniatura de P6, las **7** filas que matchea *Comercio A*.

### C5 — ChatPanel · **VIABLE**

- **(a) Dónde aparece.** Como ruta propia (P7) y como cajón lateral **encima**
  de P2, P4, P5, P8 y P9. Mismo componente, dos envases. La pantalla de fondo
  queda visible y atenuada.
- **(b) Estados visuales.** *conversación nueva* (con los tres atajos),
  *escribiendo* (streaming por bloques), *con chip de tool*, *detenido*, *con
  propuesta de acción*, *sin credencial* (503).
- **(c) Interacción clickeable.** *Detener* corta el stream y conserva lo
  escrito. En una propuesta: *Revisar y crear* → **P6** precargado (cerrando el
  cajón), *Descartar* → la conversación sigue. El 503 → **P10**. Cerrar (Esc o
  ✕) → la pantalla de origen, **mismo scroll y mismos filtros**. El
  `ContextChip` es **removible**.
- **(d) Viabilidad.** **VIABLE, sin huecos.** Streaming, historial, contexto de
  origen, 503 antes de abrir el stream, *Detener* por corte de request
  (`AbortController` cableado al `close`) y chips de tool desde los eventos
  `tool`: todo existe. **La regla que gobierna el componente**: el agente
  **propone, no ejecuta** — toda acción sugerida navega a la pantalla que la
  confirma, con los campos precargados. Es la invariante del onboarding
  aplicada al chat.
- **(e) Datos ficticios.** Los tres atajos del estado vacío; `ContextChip`
  *"Sobre: Comercio A · 12 sep · −45,00"*; chip *"Leído de
  `query_transactions`"*; propuesta *"Crear la regla: Comercio A → comida —
  matchearía 7 movimientos"*.

### C6 — FilterBar · **PARCIAL** (H20, H21, H22, H23)

- **(a) Dónde aparece.** P4 (encabezado de la tabla) y P6 (para filtrar las
  contrapartes sin categoría).
- **(b) Estados visuales.** *sin filtros*, *con filtros activos* (chips
  removibles), *sin coincidencias*, y **los controles sin respaldo,
  deshabilitados con su motivo al lado**.
- **(c) Interacción clickeable.** Cada control reescribe la consulta de P4 y
  vuelve a pedir las filas; cada chip activo se quita con un click; *Limpiar
  filtros* devuelve la tabla al estado sin filtros. El componente **no calcula
  nada**: traduce a los parámetros de `GET /api/transactions` y nada más.
- **(d) Viabilidad.** **PARCIAL**, y el preview dibuja cuatro cosas que la API
  no acepta: **filtro por categoría** (H21, no existe la cláusula),
  **tipo multi-selección** (H22, el schema acepta **un** `type`), **"Interna"
  como opción de Dirección** (H22 — `direction` es `in`/`out`; interna no es
  una dirección sino `include_internal`, y **sale** del selector para pasar a
  los toggles) y **sugerencias de contraparte** (H23, no hay endpoint que liste
  contrapartes distintas). El contador *"Coinciden N movimientos"* es el mismo
  total que falta en H20.
- **(e) Datos ficticios.** Rango *1–30 sep*; chip *tipo: consumo*; chip
  *dirección: salida*; contraparte *Comercio A*; contador *"Coinciden 214
  movimientos · 3 en revisión"*, con banda de H20. Los controles de categoría,
  tipo múltiple y autocompletar se dibujan **deshabilitados**, con el motivo
  visible.

### Fundamentos y mapa de flujo

Las dos tarjetas que **no son pantallas ni componentes**:

- **Fundamentos** (`00-fundamentos.html`) — color semántico, tipografía
  tabular, los nueve estados y las cuatro reglas de contenido. Es la referencia
  que gobierna todas las demás: si una pantalla y los fundamentos no coinciden,
  manda fundamentos. No consume datos y no navega a ningún lado.
- **Mapa de flujo** (`pf-mapa-de-flujo.html`) — el **índice navegable** del
  prototipo: todas las páginas, sus conexiones y el veredicto de viabilidad de
  cada una. Cada nodo abre su tarjeta. Es el punto de entrada recomendado, y el
  único camino a P0 y P1 una vez que la sesión ya existe.

---

## 7. Lo que este flujo deliberadamente no resuelve

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
pantalla, el veredicto por pieza y los 26 huecos), `tasks/TASK-045.json` (el
ticket), `docs/mcp.md` (las tools del agente).
