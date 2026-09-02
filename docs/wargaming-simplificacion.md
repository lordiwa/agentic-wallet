# Wargaming de simplificación — dejar el panel en lo mínimo que cumple

**Qué es esto, en una línea:** los dos wargamings anteriores atacaron para
**romper**. Este ataca para **simplificar**: para cada flujo del panel, qué paso
se puede eliminar, fusionar o posponer sin perder lo que Mato pidió.

**La regla que ordena todo el documento:** si un paso no aporta al valor que
Mato describe, se elimina o se pospone. **Los dos escenarios de Mato son
sagrados** y no se recortan; todo lo demás es negociable.

> **Escenario 1** — *"Entro al sitio ---> hay transferencias mias a desconocidos
> ---> se actualiza movimientos ---> me pregunta que son los movimientos --->
> respondo en alguna parte que categoria son"*
>
> **Escenario 2** — *"entro por primera vez ---> analiza 3-6 meses anteriores
> ---> crea patron de gastos fijos ---> pregunta gastos particulares?"*

**Método.** Nada se afirma de memoria. Se leyeron `panel-manejo-flujo.md`,
`panel-viabilidad.md`, `panel-roadmap-implementacion.md`,
`panel-prep-implementacion.md`, `flujo-wargaming.md`, `flujo-app-prototipo.md`
y los tickets `TASK-045..053`, y se verificó cada afirmación contra el código
con `archivo:línea`. Además se corrió un **forense nuevo sobre el ledger real**
(`bolsillo.sqlite`, sólo conteos — ningún dato personal entra acá) que corrige
dos números que el plan venía usando mal. **Este doc no implementa nada**: no
toca código, no despliega, no configura.

**Las tres partes.** La 1 es la simplificación flujo por flujo. La 2 es el
inventario de **todos** los cabos sueltos abiertos en la documentación, con su
tipo y su prioridad. La 3 es un **plan nuevo preliminar** — una base para
elaborar con Mato, no un plan sellado.

---

## 0. El forense nuevo: dos números que el plan venía usando mal

Antes de simplificar hay que saber contra qué. Todo esto se midió hoy sobre el
ledger real; sólo conteos y porcentajes.

| Medición | Valor |
|---|---:|
| Transacciones | **1.159** (2026-01-07 → 2026-09-01) |
| Filas en `needs_review` | **4** |
| Filas con `amount = 0` | **0** |
| Filas descartadas | **1** |
| Resoluciones de revisión registradas | **50** |
| Reglas de categoría escritas | **36** |
| **Cola de clasificación, categoría RECALCULADA** | **334** |
| — de ellas, `otros` | 118 |
| — de ellas, `transferencia_persona` | 216 |
| Contrapartes distintas en esa cola | **151** |
| Contrapartes con **una sola** fila | 90 |
| Contrapartes con 3 o más filas | 29 (cubren **180** de las 334 filas) |
| Top 10 contrapartes | **53 %** de la plata sin clasificar |
| Top 20 contrapartes | **72 %** |
| Top 30 contrapartes | **80 %** |
| Candidatas a gasto fijo (≥3 meses distintos, ventana de 6 meses) | **37** |
| — de ellas, presentes en 6 meses o más | **2** |

**Corrección 1 — la cola de clasificación es 334, no "~206".** El número que
circula en `panel-viabilidad.md`, `panel-manejo-flujo.md` y `flujo-wargaming.md`
sale de contar la **columna** `category` (`NULL`, vacío u `otros`), que hoy da
**130** sobre salidas. La cola que el Escenario 1 define es la de la categoría
**recalculada** con `categorize()` + reglas — la misma que lee el gráfico del
Resumen (`server/src/strategy/spending.ts:32-58`) — y esa da **334 filas, el
28,8 % del ledger**. La cola real es **más grande** de lo que el plan asumió, y
la mayor parte son transferencias a personas: exactamente el caso del
Escenario 1.

**Corrección 2 — preguntar por fila son 334 preguntas; preguntar por contraparte
son 151, y 30 respuestas cubren el 80 % de la plata.** Este es el dato que más
simplifica el panel entero, y está desarrollado en el flujo **F7**.

**Corrección 3 — el "patrón de gastos fijos" de este ledger es flaco.** Con la
regla que H30 propone (aparece en ≥3 meses distintos) salen **37 candidatas**, y
sólo **2** aparecen en 6 meses o más. Una pantalla que pide confirmar 37 tarjetas
una por una no es una pantalla de alta: es otra cola. Desarrollado en **F2**.

---

# PARTE 1 — Simplificación de flujos

Trece flujos. Cada uno trae: el flujo actual, la crítica (qué **eliminar**,
**fusionar** o **posponer**), el flujo simplificado, y qué se pierde y se gana.

---

## F1 · Entrada y acceso

### Flujo actual

```
Abro el panel  --->  ¿hay sesión de Google?  --->  NO  --->  Pantalla de acceso (P0)
     --->  Toco "Continuar con Google"  --->  Google me pregunta si autorizo
     --->  vuelvo  --->  ¿onboarding completo?  --->  NO  --->  Alta (P1)
     --->  SÍ  --->  Resumen (P2)
```

### Crítica de simplificación

- **ELIMINAR del MVP: la pantalla P0 entera.** Una pantalla de login en la SPA
  **no protege nada por sí sola** — el propio plan funcional ya lo dice
  (`panel-manejo-flujo.md:690-692`): la API se llama con `curl`. Lo que protege
  es el middleware del server. Con `WALLET_ACCESS_TOKEN` pegado una vez en el
  navegador, la puerta está cerrada y P0 sólo aporta **comodidad**.
- **ELIMINAR del MVP: Firebase.** El propio prep lo dice al revés y hay que
  leerlo entero: *"`WALLET_ACCESS_TOKEN` funciona solo, sin Firebase; si
  Firebase se complica, el MVP no se bloquea"* (`panel-prep-implementacion.md:477-478`).
  Si no bloquea, no entra: es un middleware más, una dependencia grande
  (`firebase-admin`), una cuenta de servicio y un uid que hoy nadie cargó (D14).
- **ELIMINAR: la bifurcación "¿onboarding completo?"**. Manda al usuario a un
  formulario antes de mostrarle nada. P1 nunca bloqueó a nadie
  (`panel-manejo-flujo.md:178-179`): si no bloquea, no va antes del hogar. Va
  **después**, como una tarjeta del Resumen.
- **NO SE ELIMINA, y sube de prioridad: la lista blanca de orígenes.** R1 es la
  única cosa crítica de este flujo: `web/src/api/base.ts:62-70` guarda el `?api=`
  de un enlace **sin preguntar**, y `client.ts` va a llevar el token en la
  cabecera. Sin lista blanca, un enlace se lleva la credencial. Esto no se
  pospone.

### Flujo simplificado

```
Abro el panel  --->  ¿tengo llave guardada?  --->  SÍ  --->  Resumen
                          |
                          NO
                          |
                          v
                  Un campo: "pegá tu llave"  --->  Resumen
```

```
Abro un enlace con ?api=  --->  "¿querés apuntar el panel a X?"
     --->  confirmo  --->  se guarda   |   no confirmo  --->  mi backend de siempre
```

```
Origen fuera de la lista blanca  --->  el panel llama SIN credencial
     --->  401  --->  "ese servidor no está autorizado"
```

### Qué se pierde y qué se gana

- **Se gana:** un día entero de trabajo (la fase 6 del roadmap y la mitad de B0
  del prep), cero dependencia nueva en el server, y el riesgo alto de "la única
  fase que toca OAuth de verdad" (`panel-roadmap-implementacion.md:296-297`)
  desaparece del MVP.
- **Se pierde:** Mato pega una frase larga una vez, en cada dispositivo. Es
  literalmente lo que el propio roadmap valora en la fase 6: *"P0 resuelve el
  problema de comodidad"* (`:290-291`).
- **No se pierde seguridad.** La puerta es el middleware, y sigue estando.

---

## F2 · Alta y análisis del historial — **Escenario 2 de Mato**

### Flujo actual

```
Veo el Resumen  --->  tarjeta "Sin leer"  --->  "Completar perfil"
     --->  Alta (P1): checklist de 6 pasos del motor
     --->  "Analizar mi historial"
     --->  el agente propone: 1) sueldo y días de pago
                              2) GASTOS FIJOS: lo que se repite todos los meses
                              3) colchón sugerido
     --->  reviso los gastos fijos UNO POR UNO: "es fijo" / "fue casual"
     --->  "Guardar"
     --->  "quedan M gastos que no se repiten, ¿qué son?"
     --->  "Decime cuáles"  --->  cola de clasificación
     --->  Resumen
```

### Crítica de simplificación

- **El paso 4 es una cola disfrazada de formulario.** Sobre el ledger real son
  **37 candidatas**. Treinta y siete tarjetas de "sí/no" en una pantalla de alta
  es exactamente el tipo de paso que hace que un usuario toque *Saltar por
  ahora*. **POSPONER el detalle: se muestran las 10 que más plata mueven**, y el
  resto **cae en la cola de clasificación**, que es donde ya iban a caer los
  "particulares" de todos modos. Esto es un hueco nuevo (**H34**).
- **FUSIONAR los pasos 5 y 7.** *"Guardar el perfil"* y *"¿qué son los M gastos
  particulares?"* son dos botones que llevan al mismo lugar: la cola. El
  análisis termina **en** la cola, no en una pantalla que ofrece ir a la cola.
- **ELIMINAR el checklist de 6 pasos del MVP.** El checklist es
  `onboarding_status`, que no tiene ruta HTTP (H2, H4) y cuyos seis pasos —`env`,
  `claude`, `gmail`, `sync`, `huso`, `profile`— son de **instalación**, no de
  perfil. Cinco de los seis se resuelven en la terminal de la máquina del server,
  donde el panel no llega. Del checklist entero, lo único que el panel puede
  cambiar es `profile`.
- **REDUCIR el formulario a dos campos.** De las cuatro claves que
  `strategy_config` acepta (`server/src/db/strategy-config.ts:12-20`), el Resumen
  sólo se rompe por dos: sin `diasPago` no hay safe-to-spend (R7) ni próximo
  cobro; sin `colchonObjetivo` el anillo miente (R25). `titular` lo propone el
  motor y `sueldo` viene con los días. Dos campos, no una pantalla.
- **NO SE ELIMINA: la mediana.** `suggestRecurringExpenses` (H30) tiene que usar
  **mediana y no promedio**, igual que `suggestSalary`. Un mes con dos pagos del
  mismo servicio no puede inflar la propuesta.
- **NO SE ELIMINA: el freno del Modelo D (R33).** Con menos de 3 meses de
  historial el análisis **no se dibuja activo**, y la pantalla dice cuánto lleva
  acumulado. `mesesDeHistorial` ya lo devuelve el motor
  (`server/src/onboard/suggest.ts:180-183`).

### Flujo simplificado

```
Resumen  --->  tarjeta "Todavía no leí tus gastos fijos"  --->  "Analizarlo"
     --->  ¿hay 3 meses o más de historial?
                |                                  |
               NO                                 SÍ
                |                                  |
                v                                  v
     "llevo 0,4 meses; se activa      el agente lee 3 a 6 meses y propone,
      a los 3"  --->  Sincronizar     sin guardar nada:
                                        · sueldo y día de pago
                                        · los 10 gastos que más plata mueven
                                          y se repiten (mediana + día típico)
                                        · colchón sugerido
                                             |
                                             v
                                   confirmo o descarto cada uno
                                             |
                                             v
                                   "Guardar y seguir"
                                             |
                                             v
                                   Cola de clasificación (F7),
                                   ordenada por plata
```

### Qué se pierde y qué se gana

- **Se gana:** el Escenario 2 se cumple **entero** con una tarjeta del Resumen y
  una lista de 10, en vez de una pantalla nueva con checklist, formulario de
  cuatro campos y dos salidas alternas. El paso "pregunta gastos particulares"
  deja de ser una promesa y pasa a ser **la misma cola** que el Escenario 1 —
  una sola pantalla cumple los dos escenarios.
- **Se pierde:** la lista completa de 37 candidatas (las otras 27 se responden
  en la cola, que es el mismo trabajo con otro orden); el checklist de
  instalación visible en el panel; y editar `titular` desde la UI.
- **Sigue sin poder cumplirse el primer día en el Modelo D** (R33). No es una
  pérdida de esta simplificación: es una propiedad del modelo de ingesta.

---

## F3 · El Resumen (el hogar)

### Flujo actual

```
Entro  --->  Resumen: saldo, safe-to-spend, tarjeta, próximo cobro, colchón,
             gasto del mes por categoría, brief del día, chip de sync,
             "N pendientes", "M sin clasificar"
     --->  toco una tarjeta  --->  su pantalla
```

Seis destinos: Saldo→Movimientos, Tarjeta→Estrategia, Colchón→Ahorro,
barra→Movimientos filtrado, chip→Sincronización, contador→Revisión.

### Crítica de simplificación

- **POSPONER dos de los seis destinos.** Estrategia (P8) y Ahorro (P9) no entran
  al MVP en ningún plan. Una tarjeta que navega a una pantalla que no existe es
  el problema de R4. Mientras no existan, esas dos tarjetas **muestran su cifra y
  no navegan**.
- **ELIMINAR el estado "Sin leer" como concepto general (R6).** El motor
  **nunca** devuelve `amount: null`: `server/src/db/schema.ts:13` declara
  `amount REAL NOT NULL` y `server/src/db/repository.ts:37,137` escribe
  `UNKNOWN_AMOUNT_PLACEHOLDER = 0`. Hay **dos** estados distintos y hoy comparten
  nombre: *Sin confirmar* (fila con `needs_review = 1`) y *Sin leer* (campo del
  resumen que sí puede ser nulo: `card` y `next_payday`,
  `server/src/api/routes.ts:70,76`).
- **ELIMINAR "podés gastar 0,00 hoy" cuando el dato es "todavía no sé" (R7).**
  `server/src/strategy/balance.ts:151-154` devuelve 0 sin día de pago conocido.
  La tarjeta deriva su estado de `next_payday`, que sí distingue. Es cliente
  puro, no necesita ruta nueva.
- **FUSIONAR el chip de sync con la operación de sync.** Ver F4.
- **NO SE DIBUJA el contador "M sin clasificar" hasta que exista H27/H32.** Es la
  regla del propio ticket paraguas (TASK-045, criterio 8): una pregunta no se
  dibuja antes de que exista la función que la responde.
- **POSPONER el brief.** `GET /api/brief` existe y funciona, pero el modo demo
  **no lo cubre** (R16), así que el andamio no se puede validar con él. Es una
  tarjeta narrativa: entra cuando el demo la cubra.

### Flujo simplificado

```
Entro  --->  Resumen:
               · Saldo                         --->  Movimientos
               · Safe-to-spend (o "falta tu día de pago")
               · Sync: "hace 3 días" + botón   --->  sincroniza acá mismo
               · "4 sin confirmar el monto"    --->  Revisión
               · "334 sin clasificar"          --->  Cola de clasificación
               · Gasto del mes por categoría   --->  Movimientos filtrado
               · Tarjeta y Colchón: cifra, sin navegación (todavía)
```

### Qué se pierde y qué se gana

- **Se gana:** el hogar deja de prometer destinos que el MVP no construye (R4),
  y deja de mostrar `0,00` como si fuera un dato (R7). Dos pantallas menos que
  construir.
- **Se pierde:** el brief del día y la navegación a Estrategia/Ahorro, que hoy
  tampoco existen. Nada que Mato tenga hoy y pierda.

---

## F4 · Sincronizar

### Flujo actual

```
Resumen  --->  toco el chip  --->  pantalla de Sincronización (P3)
     --->  "Sincronizar"  --->  barra "1 240 de 3 800"
     --->  terminó el lote, quedan 2 560  --->  "Seguir"
     --->  ... hasta "Al día"
     --->  ¿quedó algo sin confirmar?  --->  aviso  --->  Revisión
     --->  ¿entró algo que no sé qué es?  --->  aviso  --->  Cola de clasificación
```

Más: registro de lotes, *Detener*, ocho estados del botón.

### Crítica de simplificación

- **ELIMINAR la pantalla P3 del MVP y FUSIONARLA con el chip del Resumen.** El
  ciclo entero —disparar, ver el avance, *Seguir*, terminar— cabe en el chip.
  P3 sólo agrega el *registro de lotes*, que **no se persiste** (H17:
  `sync_progress` es una fila única, no un historial) y el *Detener*, que **no
  detiene** (H18: `server/src/sync/run-sync.ts:163` escribe el progreso una vez
  por lote, al final). Una pantalla entera para dos elementos que ya están
  rotulados como recortados.
- **ELIMINAR el registro de lotes (H17).** Es una tabla nueva con estado nuevo
  por comparar dos syncs seguidos. No aporta al Escenario 1 ni al 2.
- **ELIMINAR *Detener* (H18).** Sin endpoint de cancelación, el botón corta el
  auto-encadenado y hay que rotular *"se detiene al terminar este lote"*. Si el
  panel no auto-encadena —y no hace falta que lo haga: *Seguir* es un botón—
  **no hay nada que detener** y el botón desaparece con su rótulo incómodo.
- **NO SE ELIMINA: `running` en el estado del sync (R9).** La guarda es
  `let running = false` en memoria del proceso
  (`server/src/api/sync-route.ts:38`) y no se expone en ninguna ruta;
  `GET /api/sync/status` devuelve sólo `last_sync_ts` y `backlog`
  (`server/src/api/routes.ts:213-228`). Sin esto, un F5 en medio de un lote
  rehidrata en un estado falso y el 409 se auto-reintenta contra un lote de
  minutos. Son dos líneas en la misma ruta que ya se toca por `batch_size` (H19).
- **NO SE ELIMINAN los dos avisos, y siguen siendo dos.** Uno pregunta un
  **monto**, el otro una **categoría**. Mezclarlos haría que responder uno
  parezca haber respondido el otro.
- **Los ocho estados del botón bajan a cinco** en el MVP: al día, atrasado,
  nunca, corriendo, falló. *A medias* se fusiona con *corriendo* (es el mismo
  botón con el conteo pendiente al lado), *409* y *503* pasan a ser el mismo
  cartel con distinto texto.

### Flujo simplificado

```
Resumen  --->  chip "hace 3 días" + "Sincronizar"  --->  toco
     --->  el chip se vuelve barra: "1 240 de 3 800"
     --->  terminó el lote  --->  "quedan 2 560 · Seguir"
     --->  ... hasta  --->  "Al día"
```

```
Terminó  --->  4 sin confirmar el monto  --->  "Revisarlos"      --->  Revisión
         --->  3 nuevos que no sé qué son --->  "Decime qué son"  --->  Cola
```

```
F5 en medio de un lote  --->  el panel pregunta el estado  --->  "corriendo"
     --->  barra + botón bloqueado  --->  termina  --->  se refresca solo
```

### Qué se pierde y qué se gana

- **Se gana:** una pantalla completa menos, y dos elementos (H17, H18) que iban a
  dibujarse con un rótulo pidiendo disculpas.
- **Se pierde:** comparar dos syncs seguidos (nunca existió) y un *Detener* que
  no detenía. El auto-encadenado se cambia por un botón *Seguir*, que es más
  trabajo manual en un primer sync largo — y a la vez es el único que no puede
  entrar en un bucle de requests sin supervisión.

---

## F5 · Movimientos

### Flujo actual

```
Resumen  --->  tarjeta "Saldo"  --->  Movimientos
     --->  filtro por fecha, tipo, dirección, contraparte, categoría
     --->  "Mostrando 8 de N" + paginador
     --->  toco una fila  --->  detalle
     --->  desde el detalle: "¿Qué es esto?" / "Crear regla" / "Preguntar al
           agente" / "Resolver"
```

### Crítica de simplificación

- **ELIMINAR tres de las cuatro acciones del detalle en el MVP.** *Crear regla*
  lleva a P6, que se difiere; *Preguntar al agente* lleva al chat, que se
  difiere; *Resolver* lleva a Revisión, que sí existe. Queda **"¿Qué es esto?"**,
  que es la segunda puerta del Escenario 1 y **el mismo escritor** que la cola
  (H28). Una pantalla, una acción nueva.
- **ELIMINAR la FilterBar completa del MVP.** De sus seis controles, cuatro no
  tienen respaldo: categoría (H21), tipo multi-selección (H22), "Interna" como
  dirección (H22) y el autocompletar de contrapartes (H23). Queda: rango de
  fechas y dirección. **Con dos filtros no hace falta una barra**: son dos
  controles arriba de la tabla.
- **MANTENER el filtro por categoría — pero sólo el que llega desde el gráfico.**
  Es el destino de "toco una barra del Resumen", y H21 **está mal escrito**: no
  puede ser `WHERE category = ?`, porque el gráfico recalcula
  (`server/src/strategy/spending.ts:32-58`) y la lista devolvería un conjunto
  distinto del que la barra contó. Se filtra por la categoría **recalculada**,
  reusando la misma función que la cola de clasificación (H32).
- **POSPONER el total y el paginador (H20).** `offset` ya existe y ya se pasa
  (`server/src/api/queries.ts:19,74`); lo que falta es el `total`. Con "cargar
  más" no hace falta saber cuántas hay. Cuando el número importe, es un COUNT.
- **CONFIRMADO SIN CAMBIO: "Mandar a revisión" no se construye** (H26). Es la
  mejor decisión escrita de todo el roadmap y no se toca.

### Flujo simplificado

```
Resumen  --->  "Saldo" o una barra del gráfico  --->  Movimientos
     --->  rango de fechas + entrada/salida  (y la categoría, si vine del gráfico)
     --->  "cargar más" al final de la lista
     --->  toco una fila  --->  detalle
     --->  "¿Qué es esto?"  --->  elijo categoría  --->  se guarda la regla
```

### Qué se pierde y qué se gana

- **Se gana:** cuatro huecos (H20, H22, H23, y el H21 mal planteado) salen del
  camino crítico, y la tabla se construye sobre una ruta que ya funciona.
- **Se pierde:** buscar por comercio escribiendo (queda el filtro de contraparte
  que la API ya acepta, sin autocompletar) y saber cuántas coincidencias hay en
  total.

---

## F6 · Revisión del monto

### Flujo actual

```
Resumen  --->  "N pendientes"  --->  Revisión: N tarjetas
     --->  leo: comercio, monto, motivo, lo que leyó Claude, el correo
     --->  "Confirmar monto" / "Corregir monto" / "Descartar"
     --->  cola vacía  --->  Resumen  --->  el saldo cambió
```

### Crítica de simplificación

- **CONFIRMAR el recorte de `claude_amount` (H10), con el dato en la mano.** En
  8 meses hay **cero** filas donde Claude discrepó del parser
  (`panel-prep-implementacion.md:76`). Es una columna, una migración y un cambio
  en `insertTransaction` para dibujar dos números que serían idénticos siempre.
- **POSPONER `review_reason` (H9).** Es barato y útil, pero son **4 filas**. La
  tarjeta muestra el asunto y las tres acciones, y dice que el motivo no está
  disponible — que es lo que TASK-045 criterio 5 ya exige.
- **ELIMINAR la pantalla dedicada y FUSIONARLA con la cola de clasificación.**
  Las dos colas ya iban a vivir en P5 como dos pestañas. Con 4 filas contra 334,
  la de revisión es **la pestaña chica**. Una pantalla, dos pestañas, dos
  preguntas distintas — y el orden ya está decidido: **si una fila está en las
  dos, se pregunta el monto primero**, porque sin monto afirmado la fila no entra
  a ningún total y su categoría no movería ningún gráfico.
- **NO SE ELIMINA: decir qué hace cada acción con el total (R12).**
  `server/src/strategy/totals.ts:19-20` excluye `needs_review = 1` **y**
  `is_discarded = 1`, y `server/src/review/resolve.ts:177` marca
  `is_discarded = 1` al descartar: **descartar no mueve el saldo**, y la pantalla
  promete que sí. Es texto, no backend.
- **NO SE ELIMINA: ramificar por `changed` (R13).**
  `server/src/review/resolve.ts:150` devuelve `{ok:true, changed:false}` para una
  fila ya resuelta y sale **antes** del `INSERT` en `review_resolutions`; la ruta
  serializa eso como 200 (`server/src/api/routes.ts:184-188`). `changed: false`
  no es éxito.
- **NO SE ELIMINA: la variante de otra moneda (R14).**
  `server/src/review/resolve.ts:161-163` rechaza `confirm` cuando la moneda no es
  la del perfil. *Confirmar* deshabilitado con su motivo; la salida es *Corregir*
  o *Descartar*. La moneda ya viene en la respuesta: cero backend.
- **POSPONER el rastro de resoluciones.** Existe y funciona
  (50 resoluciones registradas), pero es una tabla de auditoría en una pantalla
  cuya cola tiene 4 filas. Entra cuando la cola crezca.

### Flujo simplificado

```
Resumen  --->  "4 sin confirmar"  --->  Preguntas, pestaña "Monto"
     --->  leo: contraparte, monto del ledger, asunto del correo
     --->  "Confirmar" (entra a tus totales)
           "Corregir"  (entra con el monto que pongas)
           "Descartar" (no era un movimiento: el saldo NO cambia)
     --->  cola vacía  --->  Resumen  --->  el saldo cambió, o se dice por qué no
```

```
Fila en otra moneda  --->  "Confirmar" deshabilitado con su motivo
     --->  "Corregir" con el equivalente, o "Descartar"
```

```
Ya la resolví en el teléfono  --->  respuesta con changed = false
     --->  "esto ya lo resolviste en otro lado"  --->  se refresca la cola
```

### Qué se pierde y qué se gana

- **Se gana:** el bloque de motor más caro del roadmap (fase 3, la única que
  tocaba el pipeline) sale del MVP entero, con evidencia. La pantalla se
  construye sobre tres rutas que ya existen y ya se usan.
- **Se pierde:** el motivo por el que cayó cada fila, y la comparación de las dos
  lecturas — que hoy no tiene datos que comparar. La ReviewCard del diseño queda
  reducida a su versión honesta.

---

## F7 · Decirle al agente qué son mis movimientos — **Escenario 1 de Mato**

Este es el corazón del encargo, y donde el forense cambia el diseño.

### Flujo actual

```
Entro  --->  Resumen: "12 movimientos que no sé qué son"
     --->  "Sincronizar"  --->  aviso: "3 nuevos que no sé qué son"
     --->  "Decime qué son"  --->  cola, pestaña "Sin clasificar"
     --->  leo la primera FILA: "Transferencia a <Persona 1>, −45,00, 12 sep"
     --->  elijo la categoría  --->  "Guardar"
     --->  se guarda una REGLA sobre <Persona 1>
     --->  "¿hay más de <Persona 1>?"  --->  "hay 6 más, ¿son todos salud?"
     --->  Sí  --->  la cola baja en 7    |    No  --->  baja en 1
     --->  ... hasta que no queda ninguna
```

### Crítica de simplificación

**La cola es por fila, y la respuesta es por contraparte. Ese desajuste es lo
que hace larga la pantalla.**

- La respuesta se guarda como **regla sobre la contraparte normalizada**
  (`upsertCategoryRule` + `toRulePattern`) — y tiene que ser así, porque
  `spendingByCategory` **ignora la columna** `category` y recalcula
  (`server/src/strategy/spending.ts:32-58`). Pintar la fila dejaría el gráfico
  igual: es el error que ya costó una ronda entera de trabajo en este proyecto.
- Entonces **una respuesta ya resuelve todas las filas de esa contraparte**. El
  paso *"hay 6 más de <Persona 1>, ¿son todos salud?"* es una pregunta que sólo
  existe porque la cola se dibujó por fila. Preguntando por contraparte, **la
  pregunta desaparece y la respuesta es la misma**.
- **Los números:** 334 filas contra **151 contrapartes**. Y la plata está
  concentrada: **top 10 = 53 %, top 20 = 72 %, top 30 = 80 %**. Noventa
  contrapartes tienen **una sola fila** y entre todas mueven la cola de plata.
- **FUSIONAR: la cola es de contrapartes, ordenada por plata, y muestra las
  filas de esa contraparte adentro de la tarjeta.** Esto cambia H27: la función
  nueva no devuelve filas, devuelve **grupos** (**H32**). Cuesta lo mismo: es el
  mismo recálculo con un `Map` en vez de una lista.
- **ELIMINAR H29 (la excepción por fila) del MVP — confirmado, y con la salida
  construida.** El caso real es la contraparte con dos verdades (la misma
  persona que un mes es salud y otro es un préstamo). El wargaming anterior
  propuso como salida *"no preguntarme más por esta"* y **no dijo dónde se
  guarda**: hoy no hay tabla, ni columna, ni categoría para eso (**H33**). Sin
  ese escritor, la cola **nunca llega a cero** y la pantalla miente cada vez que
  celebra el vacío.
- **AGREGAR una medida de progreso por plata (H35).** Con 151 preguntas, "quedan
  118" no le dice nada a nadie. "Respondiendo 30 cubrís el 80 % de tu plata sin
  clasificar" es la diferencia entre una tarea y una pared. Es el mismo cálculo
  que ya hace la cola, acumulado.
- **MANTENER las tres puertas, un solo escritor.** La cola, el detalle de un
  movimiento (F5) y —cuando exista— el chat, que **propone y navega, no escribe**.
- **MANTENER el estado vacío celebrado.** Es el estado normal y hay que poder
  confiar en él.

### Flujo simplificado

```
Resumen  --->  "334 movimientos sin clasificar, en 151 comercios"
     --->  "Decime qué son"  --->  Preguntas, pestaña "Qué es esto"
     --->  la primera tarjeta es LA CONTRAPARTE que más plata mueve:
              "<Comercio A> · 14 movimientos · 312,40 en 8 meses"
              "¿qué es esto?"
     --->  elijo la categoría  --->  se guarda UNA regla  --->  bajan 14 filas
     --->  "te queda el 47 % de tu plata sin clasificar · 30 respuestas más"
     --->  ... o toco "no preguntarme más por esta"  --->  sale de la cola
     --->  Resumen  --->  el gráfico del mes cambió (o se dice por qué no)
```

```
No sé qué es  --->  "Saltar"  --->  vuelve al final de la cola, no se pierde
```

```
Cola vacía  --->  "Sé qué es cada uno de tus movimientos"  --->  Resumen
```

### Qué se pierde y qué se gana

- **Se gana:** de **334 preguntas a 151**, y de 151 a **30 para el 80 % de la
  plata**. Desaparece el paso *"¿hay 6 más, son todos salud?"* (que era una
  pregunta sobre la mecánica interna, no sobre la plata). Y la pantalla puede
  decir cuánto falta en la unidad que le importa a Mato.
- **Se pierde:** responder una fila **distinto** que el resto de su contraparte.
  Eso es H29 y ya estaba fuera de la v1 por decisión escrita — pero ahora la
  salida honesta (*no preguntarme más*) sí se construye, así que la pérdida es
  menor que antes.
- **Se pierde también** el orden cronológico: la cola no es "lo último que
  entró", es "lo que más plata mueve". Los 3 movimientos nuevos de un sync no
  aparecen arriba salvo que sean caros. **Esto hay que decidirlo (D7-b):** el
  aviso post-sync puede llevar a la cola **filtrada por lo que entró en ese
  lote**, que resuelve las dos cosas.

---

## F8 · Reglas

### Flujo actual

```
Movimientos  --->  fila sin categoría  --->  "Crear regla para este comercio"
     --->  Reglas (P6), con el patrón precargado
     --->  veo en vivo "matchea 7 movimientos"
     --->  elijo categoría  --->  "Guardar"
     --->  "Aplicar al historial"  --->  "se reclasificarían 7"  --->  "Aplicar"
     --->  Resumen  --->  el gráfico cambió
```

### Crítica de simplificación

- **ELIMINAR P6 del MVP — y no se pierde la funcionalidad, porque F7 la
  absorbió.** El plan preparatorio subió P6 al MVP por las "206 filas sin
  categoría" (`panel-prep-implementacion.md:455`). Ese argumento sigue siendo
  correcto —y el número es peor: 334— pero **la conclusión ya no**: responder
  desde la cola escribe **exactamente la misma regla** que el editor escribiría a
  mano, con el patrón ya normalizado desde la contraparte real. El editor sólo
  agrega: escribir un patrón a mano, editarlo, y borrarlo.
- **Y esa diferencia es la que hace peligroso al editor.** La trampa conocida
  del proyecto —*un patrón más largo que la contraparte real nunca matchea*—
  **sólo existe si alguien escribe el patrón a mano**. Respondiendo desde la
  cola, `toRulePattern` lo deriva de la contraparte real y la trampa **no puede
  ocurrir**. Eliminando el editor se elimina el bug y su defensa (H6, el contador
  en vivo) al mismo tiempo.
- **POSPONER H7 (borrar una regla) y H8 (previsualizar el backfill).** Sin editor
  no hay dónde borrar, y sin patrones escritos a mano el backfill deja de dar
  miedo.
- **ELIMINAR "Aplicar al historial" como paso separado.** La regla ya afecta el
  gráfico en el próximo cálculo, porque el gráfico **recalcula**. El backfill de
  la columna `category` sólo se ve en listados crudos. Es un botón que promete un
  efecto que ya ocurrió.
- **NO SE ELIMINA: la honestidad de R19.** El gasto por categoría del Resumen se
  calcula con `localMonthRange(now)` — **sólo el mes en curso**
  (`server/src/api/routes.ts:91,111`). Si respondo sobre una contraparte que no
  tuvo movimientos este mes, **el gráfico no se mueve**. La pantalla tiene que
  decirlo: *"reclasificaste 14 movimientos, 2 de ellos de este mes"*.

### Flujo simplificado

```
(no hay pantalla de reglas en el MVP)

Cola de clasificación  --->  respondo  --->  se escribe la regla
     --->  "14 movimientos reclasificados, 2 de este mes"
     --->  Resumen  --->  el gráfico cambió en esos 2
```

```
Quiero ver o borrar mis 36 reglas  --->  npm run onboard / la tool MCP set_rule
```

### Qué se pierde y qué se gana

- **Se gana:** dos días del plan anterior (B3), cinco huecos (H5 parcial, H6, H7,
  H8, H25), y la trampa del patrón demasiado largo desaparece por construcción.
- **Se pierde:** ver la lista de reglas, editar un patrón y borrar una regla
  desde el navegador. Las tres se hacen hoy por MCP y por terminal, y van a
  seguir haciéndose igual.

---

## F9 · Chat

### Flujo actual

```
Cualquier pantalla  --->  ícono de chat  --->  cajón encima
     --->  escribo  --->  respuesta en streaming
     --->  si propone algo, NO lo hace: me lleva a confirmarlo
     --->  cierro  --->  vuelvo al mismo scroll y filtros
```

### Crítica de simplificación

- **POSPONER el chat entero, confirmado.** Ya está fuera por pedido de Mato
  (`panel-prep-implementacion.md:16-17`), y la simplificación lo confirma: el
  chat es la tercera puerta del Escenario 1, y las otras dos (la cola y el
  detalle) ya lo cumplen.
- **Cuando vuelva, partirlo en dos.** El motor (`spendingSummary`, las tres tools,
  `GET /api/spending/summary`) **no depende del panel** y mejora el chat que ya
  se usa hoy por `web/` y por MCP. Se puede entregar solo.
- **NO SE ELIMINA, cuando llegue: C1.** Hoy ninguna herramienta del chat suma
  gasto, así que el agente bien obedecido **no puede** contestar "cuánto gasté en
  X" sin violar la regla 1 del proyecto. Es el único elemento del chat que es
  motor y no pantalla.
- **R22 sigue en pie y es barato:** el chip de contexto es removible **antes** de
  enviar, no después — una vez enviado el contexto viajó dentro del texto
  (`server/src/api/chat-route.ts:64` acepta `{message}` y nada más).

### Flujo simplificado

```
(fuera del MVP)

Fase posterior, primero el motor:  spendingSummary + tools  --->  mejora el chat
     que ya existe hoy, sin panel
Fase posterior, después:  P7 en Vue, portando streamChat  --->  la tercera puerta
```

### Qué se pierde y qué se gana

- **Se gana:** 2–3 días fuera del MVP, y el motor del chat deja de bloquear
  pantalla.
- **Se pierde:** la única pantalla del panel donde se puede preguntar cualquier
  cosa. Sigue disponible por `web/` y por MCP, que es como se usa hoy.

---

## F10 · Estrategia

### Flujo actual

```
Resumen  --->  tarjeta "Tarjeta"  --->  Estrategia
     --->  saldo de corte, mínimo, fecha máxima, si voy a tiempo
     --->  perilla "Abono"  --->  la proyección se redibuja (no guarda)
     --->  "Marcar deuda pagada"  --->  confirmo  --->  se recalcula
     --->  "Ver el colchón"  --->  Ahorro
```

### Crítica de simplificación

- **POSPONER la pantalla entera.** No aparece en ningún MVP de ningún plan. La
  simplificación no la rescata: no aporta a los dos escenarios.
- **Cuando entre: `GET /api/debts` primero (H11).** Hoy existe el botón que marca
  una deuda pagada **por id** y ninguna forma de conocer los ids. Un botón sin
  su lista es peor que sin botón.
- **Confirmado el recorte de las tres perillas (H13).** La proyección acepta
  **una**, `abono`. Las otras dos son aritmética financiera nueva y van en
  `strategy/` con sus tests — **nunca en un `computed` del cliente**.
- **La columna "Vence" no se dibuja:** la tabla `debts` no tiene fecha de
  vencimiento.

### Flujo simplificado

```
(fuera del MVP)

Resumen  --->  tarjeta "Tarjeta": cifra, sin navegación
     --->  el detalle se sigue viendo por MCP y por la web actual
```

### Qué se pierde y qué se gana

- **Se gana:** 2–3 días, y tres huecos fuera del camino crítico.
- **Se pierde:** nada que exista hoy en el panel. La tarjeta del Resumen sigue
  mostrando el estado de la tarjeta de crédito, que es el dato que se mira.

---

## F11 · Ahorro y colchón

### Flujo actual

```
Resumen  --->  tarjeta "Colchón"  --->  Ahorro
     --->  anillo: objetivo 500, reservado 320, faltan 180
     --->  "Fijar objetivo"  --->  escribo 800  --->  Guardar
     --->  Resumen  --->  la tarjeta cambió
```

### Crítica de simplificación

- **POSPONER la pantalla, y FUSIONAR lo único que importa con F2.** *Fijar
  objetivo* escribe `strategy_config.colchonObjetivo`, que es **uno de los dos
  campos de perfil** que el flujo simplificado de alta ya pide. No necesita
  pantalla propia.
- **NO SE ELIMINA: R25.** Sin configuración,
  `server/src/strategy/balance.ts:66-83` calcula `financiado` como
  `reservado >= objetivo`, y **0 ≥ 0 es verdadero**: un usuario nuevo ve el
  anillo completo, en verde, "financiado". La respuesta de "no fijé objetivo" es
  idéntica campo por campo a la de "cumplí mi objetivo". El panel trata el
  objetivo en cero como **sin fijar**. Cliente puro.
- **CORREGIDO el diagnóstico de H14.** `POST /api/buffer` escribe
  `savings.reserved`, que **sí** es el `reservado` que lee `colchonStatus`
  (`panel-prep-implementacion.md:51`). No es un bug: lo que falta es escribir el
  **objetivo**, que va por la ruta de perfil. Los docs que lo llaman *"el botón
  más visible de la pantalla escribe una columna que el motor no lee"*
  (`panel-viabilidad.md:391-395`, `panel-manejo-flujo.md:477-480`) están
  desactualizados y hay que corregirlos.
- **ELIMINAR "Registrar aporte" (H15).** El endpoint fija un valor absoluto y un
  aporte es una suma; sumar en el cliente es aritmética de plata en la UI. Queda
  *fijar reservado*, o no queda nada.
- **ELIMINAR metas e histórico (H16).** `metas`, `metas_avance`, `flexiahorro` y
  `saldos` existen en el esquema y **ningún código las lee**.

### Flujo simplificado

```
(no hay pantalla de ahorro en el MVP)

Alta simplificada (F2)  --->  "colchón objetivo: ___"  --->  Guardar
Resumen  --->  tarjeta "Colchón": objetivo, reservado, faltante
     --->  si el objetivo es 0: "todavía no fijaste objetivo", en gris
```

### Qué se pierde y qué se gana

- **Se gana:** una pantalla, tres huecos, y el anillo deja de mentirle a un
  usuario nuevo.
- **Se pierde:** ajustar el reservado desde el panel (se hace por MCP), y los dos
  bloques (metas e histórico) que hoy no tienen ni lector.

---

## F12 · Configuración

### Flujo actual

```
Cualquier pantalla  --->  engranaje  --->  Configuración
     --->  veo qué está conectado y qué falta
     --->  "Probar conexión"  --->  me dice si el servidor responde
     --->  "Completar perfil"  --->  Alta
```

Y es, textualmente, *"el destino de todo error de configuración"*.

### Crítica de simplificación

- **ELIMINAR la pantalla del MVP, y con ella el destino prometido (R4).** El
  contenido principal de P10 es el checklist de `onboarding_status`, que no tiene
  ruta HTTP (H2) y cuyos pasos se resuelven **en la terminal de la máquina del
  server**, donde el panel no llega. Una pantalla cuyo contenido principal es una
  lista de cosas que no puede arreglar.
- **REEMPLAZAR el destino por texto.** Es la corrección de R4 y cuesta media
  hora: donde el flujo prometía navegar, se despliega el texto que dice qué
  comando lo resuelve. **Un destino que no existe no es un enlace, es texto.**
- **MANTENER lo que vive en el navegador**, que no necesita pantalla: el backend
  activo se muestra **siempre**, como un chip en la barra (es la tercera regla de
  R1), y el modo demo se rotula en el mismo lugar.
- **MANTENER "Probar conexión" — es el único diagnóstico posible (R27).** Servidor
  caído, origen no permitido por CORS y credencial rechazada producen **el mismo
  error de red** en el navegador. `GET /api/health` es la única ruta sin llave:
  si health responde y el resto no, la causa es credencial u origen, no red. Son
  dos líneas y evitan que Mato busque un problema de red donde hay uno de
  configuración.
- **NO SE CONSTRUYE la zona de riesgo** (H26): un endpoint que borra el ledger,
  en una API cuya única llave es un token compartido, no se expone. La pantalla
  puede explicar cómo se hace; no debe poder hacerlo.

### Flujo simplificado

```
Barra: chip con el backend activo  --->  toco  --->  se despliega:
     · a qué servidor apunta este navegador
     · "Probar conexión"  --->  "vivo pero rechaza tus credenciales" /
                                "no contesta"
     · "falta conectar Gmail" ---> el texto del comando, no un enlace
```

### Qué se pierde y qué se gana

- **Se gana:** una pantalla menos, y R4 (dos destinos obligatorios que el MVP no
  construye) queda cerrado sin construir nada.
- **Se pierde:** ver el checklist de instalación desde el navegador. Se sigue
  viendo con `npm run onboard --status`, que es donde se puede arreglar.

---

## F13 · Los retornos al hogar

### Flujo actual

```
Vacío la cola de revisión   --->  Resumen  --->  el saldo cambió
Aplico una regla nueva      --->  Resumen  --->  el gráfico cambió
Fijo un objetivo de colchón --->  Resumen  --->  la tarjeta del colchón cambió
Digo qué son mis movimientos--->  Resumen  --->  el gráfico y el contador cambiaron
```

### Crítica de simplificación

**Los cuatro fallan en al menos un caso**, y los cuatro tienen la misma
corrección. No es un flujo que se simplifique eliminando pasos: se simplifica
**eliminando la promesa**.

- Descartar **no** mueve el saldo (R12): la fila sale de la cola y sigue fuera de
  los totales.
- Aplicar una regla puede no mover el gráfico (R19): el gráfico es del **mes en
  curso** y la regla puede afectar otros meses.
- El colchón sólo cambia si existe la ruta de perfil (R25).
- Responder qué es un movimiento de hace cuatro meses no mueve el gráfico de este
  mes.

**El principio, escrito una sola vez y aplicado en los cuatro:** *si la pantalla
promete un efecto, tiene que poder decir cuándo el efecto es cero y por qué.*
"No cambió nada" es un resultado legítimo; "no cambió nada y la pantalla decía
que iba a cambiar" es un error de producto.

### Flujo simplificado

```
Termino cualquier acción  --->  la pantalla dice QUÉ cambió, con el número
     --->  si no cambió nada, dice POR QUÉ
     --->  Resumen
```

```
Respondí sobre 14 movimientos, 2 de este mes
     --->  "el gráfico de este mes cambió en 2; los otros 12 son de meses
            anteriores"
```

```
Descarté 3 filas
     --->  "3 descartados: no eran movimientos, el saldo no cambia"
```

### Qué se pierde y qué se gana

- **Se gana:** una regla en vez de cuatro casos especiales, y el panel deja de
  entrenar a Mato a desconfiar de lo que dice.
- **Se pierde:** la celebración simple. Un mensaje con un número y una salvedad
  es menos satisfactorio que "¡listo!" — y es cierto.

---

## Resumen de la Parte 1

| Flujo | Pantallas antes | Pantallas después | Qué se elimina |
|---|---|---|---|
| F1 Acceso | P0 + Firebase | un campo | P0, Firebase, la bifurcación de onboarding |
| F2 Alta | P1 completa | una tarjeta del Resumen | checklist, 2 de 4 campos, 27 de 37 candidatas |
| F3 Resumen | P2 | P2 | brief, 2 destinos, "Sin leer" |
| F4 Sync | P3 | el chip del Resumen | P3, registro de lotes, *Detener* |
| F5 Movimientos | P4 + FilterBar | P4 con 2 filtros | FilterBar, paginador, 3 de 4 acciones |
| F6 Revisión | P5 pestaña | pestaña chica | `claude_amount`, `review_reason`, el rastro |
| **F7 Clasificación** | **P5 pestaña, 334 filas** | **la misma, 151 grupos** | la pregunta "¿hay 6 más?" |
| F8 Reglas | P6 | — (absorbida por F7) | el editor entero y su trampa |
| F9 Chat | P7 | — | todo, ya estaba fuera |
| F10 Estrategia | P8 | — | todo |
| F11 Ahorro | P9 | — (2 campos en F2) | todo salvo el objetivo |
| F12 Configuración | P10 | un chip en la barra | la pantalla |
| F13 Retornos | 4 promesas | 1 regla | tres casos especiales |

**Once pantallas dibujadas ---> cuatro superficies en el MVP:** el Resumen (con
el sync adentro), Movimientos, Preguntas (dos pestañas) y el chip de backend.

---

# PARTE 2 — Inventario de cabos sueltos

**Ochenta y dos entradas**, de cinco tipos: 35 huecos técnicos, 15 decisiones de
Mato, 14 contradicciones entre documentos, 10 de deuda técnica y 8 que el
wargaming anterior dejó a medias. **Setenta y siete están abiertas**: cinco filas
(H10, H26, H29, H31, T9) están cerradas y se dejan escritas para no volver a
preguntar por ellas.

Prioridad: **P0** bloquea el MVP redefinido; **P1** hace falta para el MVP pero
no lo bloquea hoy; **P2** después del MVP; **P3** cuando moleste.

## 2.1 Huecos técnicos (H1..H35)

| id | Descripción | Tipo | Dónde vive | Qué lo resolvería | Prio |
|---|---|---|---|---|---|
| H1 | No hay autenticación en `/api/*` | hueco | `server/src/index.ts`, `api/cors.ts` | middleware Bearer + `auth_required` en `/api/health` | **P0** |
| H2 | Onboarding sin rutas HTTP | hueco | `server/src/onboard/` | `GET/POST /api/onboarding/profile` (los 2 campos, en el MVP) | **P0** |
| H3 | El paso "Cuentas" no corresponde a nada del motor | diseño | `flujo-app-prototipo.md` P1 | renombrar a **Titular** | P2 |
| H4 | El checklist dibujado ≠ los pasos del motor | diseño | P1, P10 | renderizar los pasos que devuelve el motor | P2 |
| H5 | Reglas sin rutas HTTP | hueco | `server/src/category/` | sólo `POST /api/classify` en el MVP (H28); el resto, después | P2 |
| H6 | "Matchea N filas" no existe | motor | `category/` | `countMatchingTransactions` con `toRulePattern` | P2 |
| H7 | No se puede borrar una regla | motor | `category/rules-repository.ts` | `deleteCategoryRule` + `DELETE /api/rules/:pattern` | P2 |
| H8 | `backfillCategories` no tiene dry-run | motor | `category/backfill.ts` | `{dryRun}` que cuente sin escribir | P3 |
| H9 | `review_reason` no se persiste | motor | `ingest/pipeline.ts`, `db/schema.ts` | columna `TEXT` por `addColumnIfMissing` | P2 |
| H10 | La lectura de Claude no se persiste | motor | `ingest/pipeline.ts` | **recortado con evidencia**: 0 discrepancias en 8 meses | — |
| H11 | No se pueden listar las deudas | motor+ruta | tabla `debts` | `GET /api/debts` (~10 líneas) | P2 |
| H12 | Calendario de pagos no expuesto | ruta | `strategy/calendar.ts` | `GET /api/strategy/calendar` | P2 |
| H13 | "Simular" dibuja 3 perillas, el motor acepta 1 | diseño | P8 | la simulación se limita a `abono` | P2 |
| H14 | "Fijar objetivo" escribe donde el motor no lee | ruta+diseño | `POST /api/buffer` | el objetivo va por la ruta de perfil (H2). **Diagnóstico corregido: `reserved` sí se lee** | P2 |
| H15 | "Registrar aporte" es incremento, la API es absoluta | motor+ruta | `POST /api/buffer` | se elimina el botón, o el server suma | P3 |
| H16 | `metas`/`flexiahorro`/`saldos` sin lector | motor | `db/schema.ts` | quedan fuera y la pantalla lo dice | P3 |
| H17 | No hay historial de lotes de sync | motor+ruta | `sync/run-sync.ts` | **se elimina del MVP** (F4) | P3 |
| H18 | No se puede detener un sync | motor+ruta | `sync/run-sync.ts` | **se elimina del MVP**: sin auto-encadenado no hay qué detener | P3 |
| H19 | `batch_size` no expuesto por HTTP | ruta | `api/sync-route.ts:40` | dos líneas; el runner ya lo acepta | P1 |
| H20 | No hay total de coincidencias | motor+ruta | `api/queries.ts` | "cargar más" en el MVP; el COUNT después | P2 |
| H21 | Filtro por categoría — **mal planteado** | motor+ruta | `api/schemas.ts:33-44` | filtrar por la categoría **recalculada**, no por la columna | **P0** |
| H22 | Tipo multi-selección e "Interna" como dirección | ruta+diseño | FilterBar | se elimina la FilterBar del MVP | P3 |
| H23 | No hay lista de contrapartes | motor+ruta | — | autocompletar fuera del MVP | P3 |
| H24 | `GET /api/review/resolutions` ignora los filtros | ruta | `api/routes.ts:193-196` | pasar `?transaction_id=` y `?limit=` | P3 |
| H25 | "Recuperar" es por lote, no por fila | motor+ruta | `ingest/heal-counterparty.ts` | fuera del MVP | P3 |
| H26 | Acciones que se recomienda **no** construir | diseño | P4, P10 | se sostiene sin cambios | — |
| H27 | **No existe la cola de clasificación** | motor+ruta | `category/` | **reemplazado por H32** (agrupada) | **P0** |
| H28 | **Responder "qué es" no tiene escritor** | ruta | `api/` | `POST /api/classify` sobre `upsertCategoryRule` | **P0** |
| H29 | Excepción de categoría por fila | diseño | — | **no se construye en la v1**; la salida es H33 | — |
| H30 | **No existe la detección de gastos fijos** | motor | `onboard/suggest.ts` | `suggestRecurringExpenses` con mediana | **P0** |
| H31 | El perfil no tiene dónde guardar los gastos fijos | diseño | `db/strategy-config.ts:12-20` | la v1 **no persiste la lista**; se guarda como reglas + colchón | — |
| **H32** | **La cola tiene que agruparse por CONTRAPARTE, no por fila** | motor+ruta | nuevo, en `category/` | 334 filas ---> 151 grupos; el mismo recálculo con un `Map` | **P0** |
| **H33** | **"No preguntarme más por esta" no tiene dónde guardarse** | motor | nuevo | tabla o marca de contraparte silenciada; sin esto la cola nunca llega a cero | **P0** |
| **H34** | **El análisis de gastos fijos no tiene tope: 37 candidatas** | diseño | P1 / F2 | top 10 por plata; el resto cae en la cola | **P1** |
| **H35** | **No hay medida de progreso por plata en la cola** | motor | `category/` | acumulado del mismo cálculo: "30 respuestas = 80 %" | **P1** |

## 2.2 Decisiones pendientes de Mato (D1..D14)

| id | Decisión | Tipo | Dónde vive | Qué la resolvería | Prio |
|---|---|---|---|---|---|
| D1 | ¿Se recorta `claude_amount` (H10)? | decisión | `prep §4` | **sí** — 0 discrepancias en 8 meses | P1 |
| D2 | ¿P5 entra al MVP en su versión simple? | decisión | `prep §4` | **sí** — sus 3 rutas existen y ya se usan | P1 |
| D3 | ¿P6 Reglas sube de prioridad? | decisión | `prep §4` | **ya no aplica**: F7 absorbe el escritor; el editor se difiere | **P0** |
| D4 | ¿Se confirma el camino C ---> D ---> (A opcional)? | decisión | `prep §3.3` | decide si el Escenario 2 se puede cumplir el primer día | P1 |
| D5 | La franja de revisión: ¿persistente o cerrable? | decisión | `prep §4` | **cerrable** — 4 filas de 1.159 | P2 |
| **D6** | R30: el teléfono, ¿opción A (diseño chico del Resumen) u opción B (el entregable se reescribe)? | decisión | `wargaming R30` | sin esto el criterio de terminado del bloque no se puede verificar | **P0** |
| **D7** | ¿La cola pregunta por **contraparte** (recomendado) o por fila? | decisión | este doc, F7 | 151 preguntas contra 334 | **P0** |
| **D7-b** | ¿La cola se ordena por plata, o el aviso post-sync la filtra por lo que entró en el lote? | decisión | este doc, F7 | **las dos**: por plata por defecto, filtrada desde el aviso | P1 |
| **D8** | ¿El Escenario 2 entra al MVP con P1 recortada a 2 campos, o se pospone entero? | decisión | este doc, F2 | recomendado: **entra recortado** — es escenario sagrado | **P0** |
| **D9** | ¿El MVP arranca con token solo y Firebase se difiere? | decisión | este doc, F1 | recomendado: **sí** — el propio prep dice que no bloquea | **P0** |
| **D10** | ¿Se construye el silenciador (H33) en la v1? | decisión | este doc, F7 | recomendado: **sí** — sin él la cola no cierra | **P0** |
| **D11** | ¿Cuál es el criterio de "cola terminada": cero filas, u 80 % de la plata? | decisión | este doc, F7 | define qué celebra la pantalla | P1 |
| **D12** | El umbral de 3 meses para ofrecer el análisis (R33), ¿fijo o configurable? | decisión | `wargaming R33` | con 8 meses de historial Mato nunca lo ve; un usuario nuevo sí | P2 |
| **D13** | ¿Se recorta el editor de reglas (P6) del MVP? | decisión | este doc, F8 | recomendado: **sí** — la cola escribe la misma regla, sin la trampa | **P0** |
| **D14** | El checklist de credenciales del prep §4 sigue **sin marcar**: uid de Firebase, `WALLET_ACCESS_TOKEN`, `WALLET_ALLOWED_ORIGINS`, `tailscale serve` probado, `firebase-admin` instalable, verificación de Google confirmada por escrito | decisión | `prep §4` | son de Mato, en su máquina, y ninguna está hecha | **P0** |

## 2.3 Contradicciones entre documentos (X1..X14)

| id | Contradicción | Tipo | Dónde vive | Qué la resolvería | Prio |
|---|---|---|---|---|---|
| **X1** | **El MVP probado (B0..B3) no contiene ninguno de los dos escenarios de Mato**, y la tabla de ROMPE del wargaming los manda a "B2, B3" y a "fase de perfil" | contradicción | `prep:450-456` vs `wargaming:1267-1268` | el plan nuevo de la Parte 3 | **P0** |
| X2 | TASK-045 tiene **28** criterios; el prep y el roadmap dicen "sus **25** criterios no se tocan" | contradicción | `prep:514`, `roadmap:574` | actualizar los dos docs | P2 |
| X3 | La cola de clasificación: los docs dicen "~206 filas"; el recálculo real da **334**, y la columna da **130** | contradicción | `prep:106`, `viabilidad:299`, `manejo-flujo:305` | corregir el número en los tres docs | **P0** |
| X4 | La tabla final del wargaming lista **15** ROMPE y el párrafo siguiente dice "diez de las **trece**" | contradicción | `flujo-wargaming.md:1270` | recontar | P3 |
| X5 | El encabezado dice "los **tres** retornos al hogar"; CU-12 ya declara **cuatro** | contradicción | `flujo-wargaming.md:1138` vs `:390-407` | renombrar la sección | P3 |
| X6 | "Lo que aguantó el ataque" lista **6** ítems; el veredicto dice "**5** caminos sólidos" | contradicción | `flujo-wargaming.md:484` vs `:1228-1245` | recontar | P3 |
| X7 | `flujo-app-prototipo.md` **no incorporó H27..H31**: sus fichas siguen diciendo P1 (H2,H3,H4), P4 (H20,H21,H24,H26), P5 (H9,H10,H24) | contradicción | `flujo-app-prototipo.md:689,809,851` | actualizar las tres fichas | **P1** |
| X8 | "Sin leer" contra "Sin confirmar": R6 pidió reescribir el criterio en los cuatro docs de flujo y **ninguno se reescribió** | contradicción | `manejo-flujo:222-223`, `viabilidad:245`, `flujo-app-prototipo` | reescribir sobre `needs_review` | **P1** |
| X9 | `panel-viabilidad.md` declara **P2 VIABLE sin huecos**; `panel-manejo-flujo.md` dice "VIABLE salvo el contador nuevo (H27)" | contradicción | `viabilidad:54` vs `manejo-flujo:216-221` | corregir la tabla de resumen | P2 |
| X10 | TASK-045 criterio 17 exige un aviso **persistente no cerrable**; D5 lo bajó a cerrable | contradicción | `TASK-045` AC17 vs `prep:408` | reescribir el criterio | P2 |
| X11 | TASK-045 criterio 22 exige `amount: null` ---> "sin leer"; el motor **nunca** devuelve null | contradicción | `TASK-045` AC22 vs `prep:46` | reescribir sobre `needs_review` | **P1** |
| X12 | El roadmap lista TASK-049 "con `review_reason` y `claude_amount` persistidos"; el prep recorta H10 con evidencia | contradicción | `roadmap:582` vs `prep:504` | actualizar el roadmap | P2 |
| X13 | Pinia es obligatoria en TASK-045 AC19 y en el plan funcional; el prep la declara evitable | contradicción | `TASK-045` AC19, `manejo-flujo:83` vs `prep:44` | decidir y escribirlo una vez | P2 |
| X14 | El roadmap §5 lista TASK-052 como ticket vivo; el ticket está **cerrado** como absorbido | contradicción | `roadmap:585` vs `tasks/TASK-052.json` | actualizar la tabla | P3 |

## 2.4 Deuda técnica (T1..T10)

| id | Deuda | Tipo | Dónde vive | Qué la resolvería | Prio |
|---|---|---|---|---|---|
| T1 | `web/` (React) y `panel/` (Vue) duplican la capa de API y el reloj mientras convivan; **el retiro de `web/` no tiene ticket** | deuda | `web/`, `panel/` | un ticket propio, con el panel probado en uso real | P2 |
| T2 | Los **19 previews** del design system viven fuera del repo (`/opt/data/home/wallet-panel-ds-previews/`), sin copia versionada | deuda | fuera del repo | decidir si se versionan o se aceptan como artefacto externo | **P1** |
| T3 | Los docs del panel **no se publican** en el sitio: `docs/_config.yml` sólo viste 7 documentos | deuda | `docs/_config.yml` | agregar los del panel al `defaults`, o decidir que son internos | P2 |
| T4 | El modo demo cubre **8 rutas**; faltan `resolve`, `resolutions` y `brief` (R16) | deuda | `web/src/demo/demoFetch.ts:163-191` | agregar objetos literales — pero **contarlo como trabajo** | **P1** |
| T5 | `vitest.config.ts` no incluye `panel/` y `environment: "node"` es global (los tests de Vue necesitan jsdom) | deuda | `vitest.config.ts:5-6` | dos líneas, antes de la primera prueba del panel | **P1** |
| T6 | **No hay CI**: no existe `.github/workflows`. "Build y test en verde" depende de que alguien lo corra a mano | deuda | — | un workflow que corra `npm run build` y `npm test` | **P1** |
| T7 | `conversations` no tiene `owner`; el prep recomendó una columna nullable ("quince minutos de seguro") y no se hizo | deuda | `db/schema.ts` | `addColumnIfMissing` cuando se toque el chat | P2 |
| T8 | **Dos bases de datos**: `./bolsillo.sqlite` (1.159 filas) y `./server/bolsillo.sqlite` (**0 filas**). La ruta por defecto es relativa (`config.ts:79`), así que correr un comando desde `server/` crea un ledger vacío que se ve igual | deuda | `server/src/config.ts:79-95` | ruta absoluta, o un aviso cuando la base está vacía | **P1** |
| T9 | El bundle MCP (`server/dist-mcp/mcp-server.cjs`): **verificado hoy — está versionado y sin cambios sin commitear**. No es deuda; se deja la fila para cerrar la pregunta | verificado | `server/dist-mcp/` | — | — |
| T10 | **36 reglas** de categoría contra **151 contrapartes** sin clasificar. El trabajo de datos que queda es clasificar, no revisar | deuda de datos | `category_rules` | es exactamente lo que F7 resuelve | **P0** |

## 2.5 Lo que el wargaming anterior dejó a medias (W1..W8)

| id | Qué quedó abierto | Tipo | Dónde vive | Qué lo resolvería | Prio |
|---|---|---|---|---|---|
| W1 | **R30 no tiene veredicto**: dice "hay que elegir A o B antes de empezar", y nadie eligió | sin veredicto | `flujo-wargaming.md:1208-1222` | D6 | **P0** |
| W2 | **R29**: el foco del cajón de chat queda "pendiente de definición" | sin veredicto | `flujo-wargaming.md:1179-1188` | se define al construir el chat | P3 |
| W3 | **R31, cuarta capa**: propone *"no preguntarme más por esta"* como salida y **no dice dónde se guarda** | a medias | `flujo-wargaming.md:978-983` | H33 | **P0** |
| W4 | **R33**: no dice qué pasa entre 1 y 3 meses de historial, ni si el umbral es configurable | a medias | `flujo-wargaming.md:662-688` | D12 | P2 |
| W5 | **R15**: se aceptó "el día que la cola pase de ~200 filas se pagina". **Ya pasó**: la cola de clasificación tiene 334 | condición cumplida | `flujo-wargaming.md:910-920` | paginar la cola de clasificación desde el día 1 | **P1** |
| W6 | **R16**: el trabajo de demo se aceptó *"pero hay que decirlo en el plan de B1/B2 como trabajo"* — y nunca se agregó a la tabla | a medias | `flujo-wargaming.md:922-931` | T4 | **P1** |
| W7 | **El chat se atacó "en concepto"**: C1..C5 (los cinco huecos de herramientas del chat) no tienen veredicto dentro del wargaming del flujo | a medias | `flujo-wargaming.md:34` | se ataca cuando el chat vuelva al alcance | P2 |
| W8 | **CU-2b** dibuja "reviso los gastos fijos uno por uno" **sin tope**; sobre este ledger son 37 | a medias | `flujo-wargaming.md:125-128` | H34 | **P1** |

## 2.6 Los cinco cabos sueltos más urgentes

1. **X1 — el MVP probado no contiene los dos escenarios de Mato.** El plan
   B0..B3 entrega puerta, Resumen, sync, movimientos, revisión y reglas: ninguno
   de los dos escenarios. La tabla de correcciones del wargaming los manda a
   "B2, B3" y a "fase de perfil", que es fuera del MVP. **Es la contradicción que
   obliga a reescribir el plan, y es la razón de este documento.**
2. **H32 + H28 + H33 — la cola, su escritor y su válvula de escape.** Es el
   Escenario 1 entero y no existe ni una de las tres piezas. Sin H33 la cola
   nunca llega a cero.
3. **H1 + R1 + R2 — la puerta.** El middleware no existe, `cors.ts:50-51` no
   acepta `Authorization` ni `DELETE` (el panel publicado no cargaría), y
   `base.ts:62-70` guarda el backend de un enlace sin preguntar — con el token en
   la cabecera, eso es la credencial viajando a un host ajeno.
4. **X3 + H35 — la cola real es 334, no 206, y no hay forma de medir el
   progreso.** El plan dimensionó el trabajo con un número que sale de la columna
   equivocada. Y con 151 preguntas, sin una medida por plata la pantalla es una
   pared.
5. **H30 + H34 — el Escenario 2 no tiene motor, y cuando lo tenga hay que
   acotarlo.** Nada en el repo detecta un gasto recurrente; y la regla propuesta,
   sobre este ledger, devuelve 37 candidatas para confirmar una por una.

---

# PARTE 3 — Plan nuevo preliminar

**Esto es una base para discutir con Mato, no un plan sellado.** Está construido
sobre la simplificación de la Parte 1 y los cabos sueltos de la Parte 2, y
depende de decisiones que Mato todavía no tomó (D6..D14).

## 3.1 El MVP redefinido, en una línea

> **Entro con una llave, veo mi saldo, sincronizo desde el mismo lugar, y el
> panel me pregunta —por comercio y empezando por el que más plata mueve— qué
> son mis movimientos; la primera vez me propone además mis gastos fijos leídos
> del historial.**

Lo que eso incluye, sin nada de más:

- **Los dos escenarios de Mato, completos.**
- Ver el saldo y el gasto del mes.
- Sincronizar y saber en qué estado está.
- Las 4 filas de revisión de monto, sobre rutas que ya existen.

Lo que **no** incluye: login con Google, Firebase, chat, estrategia, ahorro,
editor de reglas, configuración, registro de lotes, FilterBar, paginador,
`review_reason`, `claude_amount`.

## 3.2 Las fases nuevas

| # | Fase | Qué entrega | Cabos que resuelve | Días |
|---|---|---|---|---:|
| **N0** | **La puerta mínima** — `WALLET_ACCESS_TOKEN` + middleware; `cors.ts` suma `Authorization` y `DELETE`; lista blanca de orígenes en el cliente; `?api=` pide confirmación; chip del backend siempre visible; `tailscale serve` probado | El server se expone al tailnet con llave y la credencial no puede viajar a un host ajeno | H1, R1, R2, R27, D9, D14 | **0,5–1** |
| **N1** | **El motor de la pregunta** (sin pantalla) — cola de clasificación **agrupada por contraparte** con categoría recalculada; `POST /api/classify` que escribe la regla; silenciar una contraparte; progreso por plata | Se puede contestar por terminal y por MCP lo que la pantalla va a preguntar. **La pregunta se construye después de la función que la responde** | H32, H27, H28, H33, H35, H21 (bien planteado), W3, W5, T10 | **1,5** |
| **N2** | **Andamio + el hogar con el sync adentro** — workspace `panel/`, capa `api/` **copiada** (883 líneas sin React), reloj como composable, Resumen, chip de sync con barra y *Seguir*, `running` en el estado, `batch_size` | Mato ve su saldo real y sincroniza, desde el teléfono | R6, R7, R9, R30/D6, H19, T4, T5, T6, W6 | **2** |
| **N3** | **La cola de preguntas** — pantalla con dos pestañas: *Qué es esto* (151 grupos, por plata, con silenciar y saltar) y *Monto* (4 filas, con R12/R13/R14 corregidos) | **Escenario 1 cumplido, de punta a punta** | R12, R13, R14, R19 (honestidad), R31, D7, D11, F13 | **1,5** |
| **N4** | **El análisis del historial** — `suggestRecurringExpenses` con mediana, acotado al top 10; dos campos de perfil (día de pago + colchón) por `POST /api/onboarding/profile`; el freno de los 3 meses | **Escenario 2 cumplido**, y el Resumen deja de mostrar 0,00 como dato | H30, H34, H2 (mínimo), H31, R25, R32, R33, D8, W8 | **1,5** |
| **N5** | **Movimientos** — lista sobre la ruta que ya existe, 2 filtros + el de categoría recalculada desde el gráfico, "cargar más", detalle con *¿Qué es esto?* | La tercera puerta del Escenario 1, y el ledger navegable | H21, H28 (segunda puerta), R17, R18 | **1** |
| | **MVP** | | | **8–8,5** |

**Comparación honesta con el plan anterior:**

| | Plan probado (B0..B3) | Este plan (N0..N5) |
|---|---|---|
| Días | 6,5–8 | 8–8,5 |
| Escenario 1 | **no** | **sí** |
| Escenario 2 | **no** | **sí** |
| Pantallas | 5 (P2, P3, P4, P5, P6) | 3 superficies (Resumen+sync, Preguntas, Movimientos) |
| Editor de reglas | sí (2 días) | no (absorbido por la cola) |
| Login Google / Firebase | en B0 | fuera |
| Migración de esquema | ninguna | ninguna |
| Pipeline tocado | no | no |

**Día y medio más caro, y entrega los dos escenarios que el plan anterior no
entregaba.** Se paga eliminando el editor de reglas (2 días), P3 como pantalla
(~0,5) y Firebase (~0,5).

## 3.3 Qué se descarta y qué se difiere

**Se descarta (no se construye, con la razón escrita):**

- `claude_amount` (H10) — cero discrepancias en 8 meses de datos reales.
- El registro de lotes de sync (H17) y *Detener* (H18) — sin auto-encadenado no
  hay qué detener y no hay dos lotes que comparar.
- La excepción de categoría por fila (H29) — su salida honesta (H33) sí se
  construye.
- "Mandar a revisión" y "Rehacer el ledger" (H26) — se sostiene sin cambios.
- "Registrar aporte" (H15) — un aporte es una suma y la suma no se hace en el
  cliente.
- Metas e histórico de ahorro (H16) — las tablas existen y ningún código las lee.
- El simulador de tres perillas (H13) — aritmética financiera nueva.

**Se difiere (hace falta, después del MVP):**

- El chat (P7) y su motor (`spendingSummary`, C1..C5). **Partido en dos:** el
  motor no depende del panel y mejora el chat que ya se usa hoy.
- El editor de reglas (P6 completo): listar, editar y borrar (H5, H6, H7, H8).
- Estrategia (P8) y Ahorro (P9): `GET /api/debts` (H11) y el calendario (H12) son
  ~1 día sobre funciones que ya existen.
- Configuración (P10) y el checklist de onboarding completo (H2 completo, H4).
- Login con Google / Firebase (P0).
- `review_reason` (H9) — barato y útil, no urgente con 4 filas.
- El total y el paginador (H20), la FilterBar completa (H22, H23).
- El retiro de `web/` (T1).
- El Modelo D — después del MVP, y sólo si Mato quiere un segundo usuario.

## 3.4 Los riesgos que quedan

Sólo los que se pueden sostener con evidencia.

1. **La cola es larga y nadie midió cuánto tarda una respuesta** (riesgo **alto**,
   y es el nuevo riesgo principal). Son **151 preguntas**. Si Mato tarda 5
   segundos en cada una son 12 minutos; si duda en la mitad, es una tarde.
   *Mitigación:* ordenar por plata, mostrar el progreso por plata (H35), y que la
   pantalla diga explícitamente que con **30 respuestas cubre el 80 %**. El
   criterio de terminado no puede ser "cero filas" (D11).
2. **La regla es por nombre, y una contraparte puede tener dos verdades** (riesgo
   **medio**). Sin el silenciador (H33) esas contrapartes vuelven a la cola para
   siempre. *Mitigación:* H33 entra al MVP; es la única razón por la que sube de
   P2 a P0.
3. **El "patrón de gastos fijos" puede salir pobre** (riesgo **medio**). Sobre
   este ledger, sólo **2** contrapartes aparecen en 6 meses o más. La pantalla
   puede proponer una lista corta y poco impresionante. *Mitigación:* decir el
   tamaño de la muestra en voz alta, como ya hace `suggestSalary`, y no prometer
   más de lo que hay.
4. **En el Modelo D el Escenario 2 no se cumple el primer día** (riesgo
   **estructural**, ya aceptado en R33). No lo resuelve este plan: lo resuelve
   elegir el modelo (D4).
5. **La verificación de Google para scopes restringidos sigue sin confirmar por
   escrito** (riesgo **externo**). Es la única afirmación del prep que no se pudo
   comprobar contra el repo, y decide si el Modelo D es "recomendado" u
   "obligatorio".
6. **El copiado tiene que ser copiado** (riesgo **bajo**). Si alguien decide
   "aprovechar y mejorar" `base.ts` o `demoFetch.ts`, la estimación de N2 se va.
7. **Vue en un repo que hoy sólo tiene React** (riesgo **bajo**): `vitest.config.ts`
   no incluye `panel/` y `environment: "node"` es global (T5). Sin eso los tests
   del panel no corren y nadie se entera.
8. **Deriva de alcance** (riesgo **medio**, el más probable). El criterio sigue
   siendo el mismo y no cambió en tres documentos: **lo que no tiene backend no
   se dibuja.**

## 3.5 Lo que hay que decidir antes de escribir la primera línea

Seis decisiones, todas cortas, todas de Mato. **Sin ellas, el plan de arriba es
una propuesta y no una secuencia:**

```
D9  --->  ¿token solo, y Firebase después?           (recomendado: sí)
D7  --->  ¿la cola pregunta por contraparte?          (recomendado: sí)
D13 --->  ¿se recorta el editor de reglas del MVP?    (recomendado: sí)
D8  --->  ¿el Escenario 2 entra con P1 de 2 campos?   (recomendado: sí)
D10 --->  ¿se construye el silenciador (H33)?         (recomendado: sí)
D6  --->  el teléfono: ¿opción A u opción B?          (recomendado: A, sólo Resumen)
```

Y el checklist de credenciales del prep §4 (**D14**) sigue entero sin marcar:
`WALLET_ACCESS_TOKEN`, `WALLET_ALLOWED_ORIGINS`, `tailscale serve` probado con
`curl`, y —si Firebase entra alguna vez— el uid, la configuración web y la cuenta
de servicio.

---

Ver también: `docs/flujo-wargaming.md` (el wargaming adversario que este doc
simplifica), `docs/panel-viabilidad.md` (los huecos H1..H31 con su endpoint
propuesto), `docs/panel-prep-implementacion.md` (el plan probado B0..B3 que este
doc reemplaza), `docs/panel-manejo-flujo.md` (el plan funcional),
`docs/panel-roadmap-implementacion.md` (el roadmap de seis fases),
`docs/flujo-app-prototipo.md` (el recorrido clickeable),
`tasks/TASK-045.json` (el ticket paraguas, 28 criterios).
