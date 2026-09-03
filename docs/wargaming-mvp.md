# Wargaming del MVP del panel

Ataque adversario a las seis fases entregadas (N0..N5, TASK-054..059). El
objetivo no era confirmar que funciona: era **probar que lo entregado está
mal**. Cinco frentes en paralelo, uno por fase, más un ataque con el ledger
real y un recorrido de los dos escenarios de flujo.

Método: cada criterio de aceptación se atacó con un caso hostil; cada hallazgo
se verificó contra el código (`archivo:línea`) o contra una reproducción; cada
`ROMPE` se corrigió con un test que falla antes y pasa después.

**Punto de partida:** `af8bf82`, 121 archivos / 1536 tests en verde.
**Punto de llegada:** 121 archivos / **1552 tests** en verde, `npm run build`
limpio. Ocho `ROMPE` corregidos.

> Sobre los datos: el ledger real (`bolsillo.sqlite`, 1159 filas) se usó en
> **sólo lectura** y sobre una copia. Todo lo que entra a este documento son
> conteos y proporciones. Ningún nombre, ningún monto de una fila concreta,
> ningún fixture con datos reales (CLAUDE.md, regla 2).

---

## 1. Veredicto por fase

| Fase | Ticket | Veredicto | Qué se cayó |
|---|---|---|---|
| N0 — la puerta mínima | TASK-054 | **SÓLIDO** | Nada. El montaje del middleware, la lista blanca y el `?api=` aguantaron todos los vectores. |
| N1 — el motor de la pregunta | TASK-055 | **ROMPE** | Los conteos que se le dicen al usuario contaban filas que ningún total cuenta (W1). `POST /api/classify` aceptaba los dos fallbacks con un 200 que no hace nada (W8). |
| N2 — el hogar y el sync | TASK-056 | **ROMPE** | Un saldo de tarjeta que no se pudo leer se dibujaba como `0,00` (W6) — el ataque exacto que pide el AC7. |
| N3 — la cola de preguntas | TASK-057 | **ROMPE** | El estado vacío celebraba con el backend caído (W5). La moneda que gobierna R14 era una constante (W7). |
| N4 — el análisis del historial | TASK-058 | **ROMPE** | "Suele caer el 15 de cada mes" sobre días en los que nunca pasó nada (W2). El colchón escrito se descartaba en silencio y la pantalla navegaba igual (W3). |
| N5 — movimientos | TASK-059 | **ROMPE** | 138 filas de reverso listadas como ingresos verdes, bajo un cartel que jura que no se listan (W4). |

Lo que **aguantó el ataque y merece decirse**: la coincidencia barra/lista
(N5 AC3) no es una promesa, es una propiedad estructural —`movementsByCategory`
llama a `categorizedSpendingRows`, la misma función que suma la barra— y se
verificó numéricamente contra el ledger real, categoría por categoría, con cero
discrepancias. El candado de la categoría recalculada (N1 AC2) se invirtió a
mano y falla como debe: es un candado real, no decorativo. Y el `running` del
sync se libera en un `finally` que cubre el rechazo (N2 AC9), que era el
candidato más fuerte a rotura.

---

## 2. Los hallazgos

### W1 — Los conteos de "qué es esto" contaban filas que el gráfico no dibuja

**ROMPE.** `server/src/classify/apply.ts:105-113` (`rowsMatching`) barría
`transactions` entera sin ninguna exclusión, así que `reclassified` y
`reclassified_this_month` incluían reversos, internas, descartadas, filas en
`needs_review` e ingresos.

`reclassified_this_month` **es** la promesa *"el gráfico se va a mover"* (R19):
existe para eso y para nada más. Contar ahí una fila que el gráfico nunca suma
convierte esa promesa en una mentira.

Reproducción (`server/src/classify/apply.test.ts`): una contraparte con un
movimiento contable y cinco que ningún total cuenta. La tarjeta de la cola
promete **1 movimiento**; la respuesta contestaba **"reclasificaste 5, 5 de
ellos de este mes"**. El gráfico se movía por uno.

Sobre el ledger real le pasa a 2 de los 147 grupos de la cola: en uno, la
tarjeta dice 2 y la respuesta decía 6.

**Corregido:** la consulta marca cada fila con `visible` (`direction = 'out'` +
`EXCLUDE_FROM_TOTALS_SQL`) y sólo las visibles entran en los conteos. La columna
`category` se sigue escribiendo en todas — dejar el ledger a medias sería peor
que el problema, y es lo que el doc del módulo promete.

### W2 — "Suele caer el 15 de cada mes" sobre un día en el que nunca pasó nada

**ROMPE.** `server/src/onboard/recurring.ts:195` calculaba el día típico como
`Math.round(median(días))`, y `panel/src/components/RecurringCard.vue:76` lo
dibujaba como afirmación literal. La mediana de una distribución dispersa cae
en el hueco: con cargos los días 2, 27, 3 y 26 la mediana da 15, y la pantalla
decía *"suele caer el 15 de cada mes"* sobre un día en el que no hubo nada.

No es un detalle de presentación: es un dato inventado con formato de lectura,
y la regla 3 del CLAUDE.md lo prohíbe igual que a un valor precargado.

Medido sobre el ledger real: de las 10 propuestas del top 10, **2 afirmaban un
día en el que el cargo no ocurrió ni una sola vez**, con los días observados
repartidos a lo largo de 22 días. Y **5 de las 10** tienen una dispersión tal
que la mediana no es una fecha: es el centro de un rango.

La causa de fondo: la mitad de las "candidatas a gasto fijo" del ledger real no
son débitos automáticos sino transferencias a una persona, con hasta 4,3
movimientos por mes repartidos por todo el calendario. Aparecer en tres meses
distintos no vuelve mensual a un gasto, y el criterio de recurrencia no tenía
nada que dijera lo contrario.

**Corregido:** `diaTipicoDe` devuelve `null` cuando la desviación absoluta
mediana pasa de 3 días, y la tarjeta dice *"no cae siempre el mismo día"*. La
propuesta sigue en pie —la plata es real y el usuario puede clasificarla—, pero
sin un día que prometer. Sobre el ledger real, 5 de las 10 propuestas dejaron de
afirmar una fecha.

### W3 — El colchón se descartaba en silencio y la pantalla navegaba igual

**ROMPE.** `panel/src/views/AltaPerfil.vue:155-159` hacía
`Number(texto.trim().replace(",", "."))` y, si no daba finito, **omitía el campo
del patch sin decir nada**. El botón navegaba a la cola de todos modos.

El caso que lo hace grave: `"1.234,00"` es exactamente el formato que el propio
panel imprime (`formatoPlata`, locale `es`), y está en pantalla dos bloques más
abajo. Copiarlo al campo daba `"1.234.00"` → `NaN` → el valor se perdía, sin
error, y el usuario aterrizaba en la cola creyendo que había guardado su
colchón. Un día de pago válido escrito al lado sí se guardaba: guardado parcial,
también en silencio.

**Corregido:** `parsePlata` en `panel/src/lib/formato.ts` —la inversa de
`formatoPlata`, con la semántica `es` (la coma manda; sin coma, el punto es
decimal, que es como llega la cifra ya guardada)— y forma estricta, así que
`0x10` y `1e5` dejan de colarse. Un campo escrito que no se entiende **frena el
guardado entero** y se dice; vacío sigue siendo "no lo toqué".

### W4 — 138 filas de reverso listadas como ingresos verdes

**ROMPE.** Un reverso se persiste como dos filas: el consumo original con
`is_reversed = 1` y una fila de auditoría `type = 'reverso'`, `direction = 'in'`,
con el mismo monto. `server/src/api/queries.ts` filtraba sólo la primera.

Resultado sobre el ledger real, filtro *Entrada*:

| | filas | de esas, reversos |
|---|---|---|
| antes | 172 | **138** |
| después | 34 | 0 |

El 80 % de esa pantalla era plata que `EXCLUDE_FROM_TOTALS_SQL` nunca cuenta,
dibujada en verde y sin ninguna marca — debajo de un cartel que dice
*"Reversos, transferencias internas y descartados no se listan: el motor ya los
excluyó de los totales"* (`panel/src/views/Movimientos.vue:300`).

**Corregido:** `includeReversed` tapa y destapa **las dos** filas del reverso,
que son un solo hecho.

### W5 — El estado vacío celebraba con el backend caído

**ROMPE.** `panel/src/views/Preguntas.vue` dejaba las listas vacías en el
`catch` y apagaba `cargando` en el `finally`, y los dos estados vacíos colgaban
de un `v-else`. Con el server apagado, la llave vencida o CORS mal puesto, la
pantalla dibujaba el cartel rojo de error **y debajo el tilde verde** diciendo
*"No queda nada por clasificar — Todas las contrapartes del ledger tienen su
categoría o están silenciadas"*: una afirmación sobre un ledger que nunca se
leyó. Peor, como no había filas de monto, la pestaña por defecto era justamente
la celebratoria.

El AC6 pide que el estado vacío sea **confiable**. Esto es lo contrario.

**Corregido:** los dos estados vacíos cuelgan de `ledgerLeido`
(`!cargando && errorCarga === null`).

### W6 — Un saldo de tarjeta que no se pudo leer se dibujaba como `0,00`

**ROMPE.** `server/src/strategy/card.ts:68-69` rellena con cero lo que no pudo
leer (`statement.balance ?? 0`), y el Resumen dibujaba ese cero con el peso de
una cifra de 26px, con la nota *"mínimo 0,00"*. Un resumen de tarjeta ilegible
quedaba **indistinguible de una tarjeta pagada**.

Es literalmente el ataque que pide el AC7 de N2, en el campo que el AC nombra
(`card`), y es lo que `ROTULO_SIN_LEER` existe para impedir: convertir "todavía
no sé" en "no hay nada". El estado es persistible — el ingestor sólo rechaza un
resumen si sus tres campos vienen nulos— y el dato honesto ya venía en la
respuesta: el calendario, dos bloques más abajo en la misma pantalla, lo usaba
bien.

**Corregido:** la tarjeta lee el resumen crudo (`overview.card.balance`), que sí
distingue `null` de `0`.

### W7 — La moneda que gobierna R14 era una constante

**ROMPE.** `server/src/api/queries.ts` devolvía `currency: "USD"` cableado, de
cuando la app era de una sola moneda. El panel usa ese campo para decidir si una
fila está "en otra moneda" y deshabilitar *Confirmar* (R14); el motor, en
cambio, compara contra `strategy_config.moneda` (`review/resolve.ts:161`), que
`npm run onboard` deja configurar.

Con un perfil en otra moneda los dos criterios quedaban **invertidos**: la UI
bloqueaba las filas que el motor acepta —con un motivo falso escrito al lado— y
ofrecía *Confirmar* en las que el motor rechaza.

**Corregido:** la moneda del saldo sale de `strategy_config.moneda`.

### W8 — Un 200 que no hace nada, y un bucle infinito de preguntas

**ROMPE.** `classifyBodySchema` aceptaba las 10 categorías del glosario,
incluidos `otros` y `transferencia_persona` — que son, exactamente, lo que
`categorize()` devuelve cuando **no** sabe, o sea la definición de la cola.
Responder con uno escribía la regla y devolvía `ok: true` con su conteo, pero el
grupo **seguía en la cola**, porque su categoría recalculada seguía siendo un
fallback. El progreso por plata no se movía nunca.

El selector del panel ya los excluía, así que por la UI no se alcanzaba; por la
API y por la tool MCP era un bucle infinito.

**Corregido:** el borde HTTP rechaza los dos fallbacks con un 400, así que la
garantía deja de depender de qué cliente llame.

---

## 3. Limitaciones aceptables (verificadas, no corregidas)

Cada una se atacó, se confirmó, y se deja documentada con su razón.

**Del motor, heredadas y consistentes:**

- **La cola y el gráfico suman monedas distintas en un mismo total.** El ledger
  real tiene 1 fila en otra moneda contra 1158, y esa única fila está
  descartada, así que hoy no muerde. Cuando muerda, muerde igual a la barra y a
  la lista, así que no introduce discrepancia entre pantallas. Es deuda del
  motor, no de una fase del panel.
- **Las filas sin contraparte quedan fuera del numerador y del denominador del
  progreso.** Son 38 sobre el ledger real. Está documentado en `queue.ts` y es
  deliberado: no hay pregunta que hacer sin un nombre contra el que escribir una
  regla, e incluirlas dejaría el criterio del 80 % fuera de alcance para
  siempre. La consecuencia honesta: *"te queda el X % de tu plata"* no es sobre
  el total del gráfico.
- **`covered_ratio` y `unclassified_ratio` tienen denominadores distintos**
  (`progress.ts:109-111`): el primero sobre la línea de base, el segundo sobre
  todo el gasto. La barra y el titular de la misma tarjeta pueden decir
  fracciones que no se corresponden. No es un número falso —cada uno es correcto
  sobre lo suyo— pero se leen como si fueran el mismo.
- **`suggestSpendBaseline` no excluye `is_discarded`**, a diferencia de
  `EXCLUDE_FROM_TOTALS_SQL`. Sobre el ledger real es 1 fila.
- **R33 mide el span de todo el ledger, no la ventana de la candidata.** Una
  fila vieja suelta habilita el análisis. Mitigado por la regla de los 3 meses
  distintos por contraparte, que un ledger de dos filas no cumple.

**Del alcance por substring:**

- **Responder por una contraparte arrastra a las que la contienen.** Las reglas
  matchean con `includes`, así que responder por un nombre corto reclasifica
  también los grupos cuyo nombre lo contiene, y esos grupos **desaparecen de la
  cola sin haber sido preguntados**. Sobre el ledger real hay 9 patrones en esa
  situación sobre 147. El conteo que se devuelve sí los incluye, así que el
  número no miente; lo que la pantalla no dice es *qué otras* contrapartes
  barrió. Silenciar, en cambio, usa igualdad exacta: dos acciones de la misma
  tarjeta con dos alcances distintos.
- **`toRulePattern` no colapsa espacios internos ni puntuación final**, así que
  el mismo comercio escrito con doble espacio genera dos grupos y dos reglas.

**Del panel:**

- **Silenciar es irreversible desde la UI.** El motor tiene
  `unsilenceCounterparty` y `DELETE /api/classify/silence`; el panel no los
  expone ni lista lo silenciado. Un toque equivocado sólo se deshace por CLI,
  MCP o sqlite.
- **El aviso post-sync cuenta global y navega filtrado.** El título usa el
  conteo de toda la cola y el botón lleva al lote. El cartel de filtro lo
  explica, pero no reconcilia los números.
- **Los filtros de fecha cortan por día UTC** (`T23:59:59.999Z` cableado)
  mientras el resto del motor corta por día local. Sobre el ledger real, 236 de
  1159 filas (20 %) caen en un día distinto del que el Resumen les asigna.
- **`Cargar más` sobre una lista que muta** puede duplicar una fila tras un
  sync, y una respuesta vieja en vuelo puede pegarse al final de una lista ya
  filtrada. Se cura solo en el próximo refresco.
- **El modo demo suma filas `needs_review` al gráfico por categoría**, que el
  motor excluye — y lo hace debajo de la nota impresa que dice lo contrario. La
  demo es internamente coherente, pero enseña una regla que el producto no
  tiene.
- **El candado de `tokens.css` es más chico que su AC:** detecta hex de 3 y 6
  dígitos y `rgb()`, pero no hex de 8, `hsl()`, `color-mix()` ni nombres de
  color. **No hay ninguna violación viva** — el grep manual da cero—, así que es
  un agujero de la guarda, no una deriva ya ocurrida.
- **`OPTIONS /api/*` pasa sin llave** y deja enumerar qué rutas existen. Sin
  datos, pero "protege todo `/api/*`" no es literal.
- **`parseAllowedOrigins` no baja a minúsculas**, así que un
  `WALLET_ALLOWED_ORIGINS` con mayúsculas nunca matchea y falla en silencio. El
  cliente sí canonicaliza: la asimetría es del server.
- **Sin tope al número de ids** en `GET /api/classify/queue` ni en la tool MCP.
  Por HTTP es inalcanzable (Node corta antes por tamaño de cabecera); por MCP,
  un lote de más de 32 766 ids es un error crudo de SQLite.

---

## 4. Lo que quedó pendiente

- **La verificación visual sigue siendo deuda manual.** No hay navegador
  headless en este entorno, así que ninguna de las réplicas exactas del design
  system (AC "UI EXACTA" de N0, N2, N3, N4 y N5) se comparó lado a lado con su
  preview. Lo que sí se verificó es lo verificable por código: cero hex fuera de
  `tokens.css`, las cifras tabulares, los componentes con su nombre, la
  navegación de tres y las pantallas que **no** se construyeron (P3, P6,
  "Mandar a revisión", "Recuperar contraparte").
- **El checklist D14 de TASK-054** (`WALLET_ACCESS_TOKEN` generado,
  `WALLET_ALLOWED_ORIGINS` definido, `tailscale serve` probado con `curl`
  contra el server real) sigue sin marcar: son tareas en la máquina de Mato y
  son el único bloqueo externo del MVP.
- **R25 sigue mintiendo fuera del panel.** `balance.ts` devuelve
  `financiado: true` con objetivo en cero, y la tool MCP lo describe como "si ya
  está financiado". El panel lo corrige en su capa; la superficie de agentes no.
- Las limitaciones de la sección 3 no se corrigieron: ninguna produce un número
  falso en pantalla hoy, y varias son deuda del motor que merece su propio
  ticket antes que un parche desde el panel.

---

# Wargaming del MVP — ronda 2

Segunda pasada, **más hostil que la primera y con otro objetivo**: no atacar lo
que la ronda 1 dejó sin mirar, sino atacar **lo que la ronda 1 declaró
resuelto**. Los ocho `ROMPE` corregidos (W1..W8), la fase que quedó `SÓLIDO`
(N0) y cada una de las limitaciones que se aceptaron por escrito.

El criterio de éxito no es "no encontré nada". Es dejar el sistema en un estado
donde romperlo sea difícil — y una corrección que arregla el caso del que se
enteró, y no la clase de la que ese caso era un ejemplar, no llega a eso.

**Punto de partida:** `386e6cb`, 121 archivos / 1552 tests.
**Punto de llegada:** 121 archivos / **1582 tests**, `npm run build` limpio.
**Siete `ROMPE` nuevos, y cuatro de ellos son correcciones de la ronda 1 que se
podían esquivar.**

> Sobre los datos: mismo criterio que la ronda 1. El ledger real se leyó sobre
> una **copia**, en sólo lectura para todo salvo las reproducciones, y de acá
> sólo salen conteos y proporciones. Ningún nombre, ningún monto de una fila.

---

## 1. Veredicto por fase

| Fase | Ticket | Ronda 1 | Ronda 2 | Qué se cayó ahora |
|---|---|---|---|---|
| N0 — la puerta mínima | TASK-054 | SÓLIDO | **ROMPE (leve)** | El chip que contesta *"¿a qué server le hablo?"* mostraba un nombre **vacío** para una base sin host, y ese cartel **es** la mitigación de R1 (W13). La lista blanca aguantó todos los vectores de imitación. |
| N1 — el motor de la pregunta | TASK-055 | ROMPE (corregido) | **ROMPE** | W1 esquivado por substring: la tarjeta decía 1 y la respuesta 7 (W12). W8 esquivado por MCP: la tool seguía aceptando los dos fallbacks (W14). |
| N2 — el hogar y el sync | TASK-056 | ROMPE (corregido) | **SÓLIDO** | Se atacó `null → 0,00` en todos los puntos donde se dibuja plata. No quedó ninguno. |
| N3 — la cola de preguntas | TASK-057 | ROMPE (corregido) | **ROMPE** | W5 esquivado sin backend caído: *"Cubriste el 100 % de tu plata"* sobre una billetera recién instalada (W11). |
| N4 — el análisis del historial | TASK-058 | ROMPE (corregido) | **ROMPE** | W2 esquivado por distribución bimodal: *"suele caer el 12"* con dispersión 2 y cero movimientos ese día (W9). W3 esquivado por el punto de miles: "1.500" entraba como 1,5 (W10). |
| N5 — movimientos | TASK-059 | ROMPE (corregido) | **ROMPE (leve)** | Una fila corregida desde otra moneda se listaba con el **rótulo viejo** sobre el monto ya convertido (W15). El arreglo de los reversos (W4) aguantó entero. |

**Las correcciones de la ronda 1, una por una:**

| | Sobrevivió | Cómo se la esquivó |
|---|---|---|
| W1 — conteos sobre filas visibles | **NO** | El filtro por visibles quedó bien; el alcance por substring reproduce el mismo síntoma (W12). |
| W2 — el día típico | **NO** | El guarda acota la dispersión, no exige que el día haya ocurrido (W9). |
| W3 — el colchón ilegible | **NO** | Cerró el `NaN` silencioso y dejó la cifra silenciosamente equivocada (W10). |
| W4 — las dos filas del reverso | **SÍ** | Se atacó con `type IS NULL`, reverso de reverso y las tres banderas. Aguanta. |
| W5 — el estado vacío | **PARCIAL** | `ledgerLeido` cubre el backend caído; el ledger **vacío** seguía celebrando (W11). |
| W6 — el saldo de tarjeta nulo | **SÍ** | Se auditaron los 20 puntos donde el panel escribe plata. Ninguno dibuja `null` como cifra. |
| W7 — la moneda del perfil | **SÍ** (con una nota) | No quedan constantes en el motor. El único `"USD"` cableado vivo es del modo demo, que es internamente coherente. |
| W8 — los dos fallbacks | **NO** | Se cerró el borde HTTP y **no** la tool MCP, que el propio hallazgo nombraba (W14). |

---

## 2. Los hallazgos

### W9 — "Suele caer el 12", con dispersión 2 y cero movimientos ese día

**ROMPE.** `server/src/onboard/recurring.ts` — `diaTipicoDe` acotaba la
**desviación absoluta mediana** a 3 días y devolvía `Math.round(median(dias))`.
El guarda mide cuánto se dispersan los días; no dice nada sobre el día que se
nombra. Con la mediana de un número par de observaciones cayendo entre dos,
alcanza una distribución bimodal apretada para volver a inventar la fecha:

| días observados | día que se afirmaba | ¿pasó algo ese día? |
|---|---|---|
| 10, 10, 14, 14 | 12 | nunca |
| 13, 14, 16, 17 | 15 | nunca |
| 5, 5, 5, 9, 9, 9 | 7 | nunca |
| 28, 28, 31, 31 | 30 | nunca |

Sobre el ledger real, **1 de las 10 propuestas** seguía afirmando un día que no
ocurrió jamás **después del arreglo de W2**: días observados 3, 20, 22 y 23, y
la pantalla decía *"suele caer el 21"*. La dispersión daba 1,5 — el guarda de W2
la deja pasar sin dudar.

**Corregido:** el día que se nombra tiene que ser un día **observado**. Se elige
el más cercano al centro; a igual distancia, el más frecuente, y después el más
temprano, para que dos corridas sobre el mismo ledger den la misma lista.
Verificado sobre el ledger real: 5 de 10 siguen diciendo un día, y **ninguna
afirma uno que no ocurrió**.

### W10 — "1.500" guardado como 1,5, sin un solo error

**ROMPE.** `panel/src/lib/formato.ts` — `parsePlata` cerró el `NaN` silencioso
de W3 y dejó abierta la otra mitad del mismo formato. En `es` el punto es
separador de miles, y el propio panel imprime "1.234,00"; escribir **"1.500"**
en el colchón —que es como se escribe mil quinientos— entraba como **1,5**.

Es peor que W3, no una variante menor: W3 perdía el dato y no decía nada; esto
**guarda un número mil veces más chico y tampoco dice nada**. Un colchón de mil
quinientos guardado como uno con cincuenta no se ve como un error: se ve como un
anillo verde y un objetivo cumplido que nadie fijó (R25).

Y la vuelta también fallaba: la pantalla precargaba con `String(valor)`, así que
un colchón de 12,345 se dibujaba `"12.345"` y volvía a guardarse como doce mil
trescientos cuarenta y cinco.

**Corregido:** `parsePlata` reconoce los grupos de exactamente tres dígitos como
miles (`1.234` → 1234, `1.234.567` → 1234567) y deja el resto como decimal
(`1234.5` → 1234,5; `0.500` → 0,5). La precarga se escribe con `formatoPlata`,
que siempre lleva coma: la ida y la vuelta dejan de tener dos lecturas.

### W11 — "Cubriste el 100 % de tu plata" sobre una billetera recién instalada

**ROMPE.** `server/src/classify/progress.ts:109,117` devuelve `covered_ratio: 1`
y `done: true` cuando `baseline_total` es cero — **es su guarda contra dividir
por cero, no una afirmación**. `panel/src/lib/cola.ts` la leía como un logro.

Reproducción, sin tocar nada: una base recién migrada, antes del primer sync.
`filasDeMonto` vacío hace que la pestaña por defecto sea *Qué es esto*, y lo
primero que la pantalla dice es *"Cubriste el 100 % de tu plata — No queda
ninguna contraparte por responder"*, en verde, con la barra llena.

Es W5 otra vez —celebrar un hecho que el ledger no dice— **sin que el backend
tenga que caerse**: `ledgerLeido` está en `true`, porque el ledger sí se leyó y
lo que dijo fue "no hay nada". El caso más incómodo no es el vacío sino el
segundo: un ledger cuyo gasto está **todo en filas sin contraparte** (38 sobre
el real) da la misma celebración con plata real dibujada dos pantallas más allá.

**Corregido:** sin línea de base la pantalla dice *"Todavía no hay nada que
clasificar"*, no celebra y la barra queda en cero. El 100 % de verdad —todo
respondido sobre una base real— se sigue celebrando igual.

### W12 — La tarjeta dice 1, la respuesta dice 7

**ROMPE.** W1 arregló *qué filas* se cuentan y no la otra mitad de la misma
frase. Una regla matchea con `includes`, así que responder por un nombre corto
mueve también los movimientos de las contrapartes que lo contienen — y ésas
**salen de la cola sin haber sido preguntadas**.

Reproducido sobre el ledger real, con el fix de W1 puesto:

| | |
|---|---|
| grupos donde la respuesta no coincide con la tarjeta | **10 de 147** |
| en el peor: la tarjeta prometía | **1 movimiento** |
| la respuesta contestaba | **"reclasificaste 7"** |
| grupos que desaparecieron de la cola | 2 (uno nunca fue preguntado) |
| patrones contenidos en otro patrón de la cola | 9 de 147 |

O sea el síntoma exacto de W1, por otra puerta. La ronda 1 lo tenía anotado como
limitación del alcance por substring — *"el conteo sí los incluye, así que el
número no miente"*— y eso sigue siendo cierto: el problema no es el número, es
que la pantalla **prometió otro** un segundo antes y no explica la diferencia.

**Corregido:** el motor devuelve `otras_contrapartes` —cuántas contrapartes
además de la preguntada movió la regla— y la pantalla lo dice: *"Incluye 1 otra
contraparte cuyo nombre contiene a ésta: la regla las alcanza a todas y salen de
la cola con ella"*. El conteo **no** se recorta: los 7 se movieron de verdad y el
gráfico se mueve por los 7. Lo que faltaba era el alcance. La tool MCP lo
declara en su descripción, que es lo único que un agente lee.

### W13 — El chip que contesta "¿a qué server le hablo?" contestaba con nada

**ROMPE (leve).** `panel/src/api/client.ts` — `etiquetaBackend` devolvía
`new URL(value).host`, y `new URL("data:…")` / `new URL("javascript:…")` parsean
feliz dejando `host` vacío. Un `?api=data:text/html,…` producía el cartel
*"Este enlace quiere cambiar tu backend a ``"* — con el `<code>` en blanco.

La llave nunca sale (la base cae en `foreign`, y eso el chip sí lo dice con
*Sin credencial*), así que no hay fuga. Lo que se rompe es la mitigación misma:
ese cartel **es** la defensa de R1, y un cartel que no dice a qué se está
cambiando pide una confirmación a ciegas.

**Corregido:** sin host, se muestra el valor tal cual.

### W14 — W8 se corrigió en el borde HTTP y no en la tool MCP

**ROMPE.** El hallazgo W8 decía, textual: *"El selector del panel ya los
excluía, así que por la UI no se alcanzaba; **por la API y por la tool MCP** era
un bucle infinito"*. La corrección tocó `api/schemas.ts` y dejó
`server/src/mcp/server.ts` con `z.enum(CATEGORIES)`, el glosario entero.

O sea que una de las dos superficies que el propio hallazgo nombraba siguió
aceptando `otros` y `transferencia_persona`: escribe la regla, devuelve `ok` con
su conteo, y el grupo sigue en la cola para siempre porque su categoría
recalculada sigue siendo un fallback.

La causa de fondo es de forma, no de olvido: la lista de categorías respondibles
vivía en el **borde HTTP**, y una regla del motor puesta en un transporte sólo
vale para ese transporte.

**Corregido:** `RESPONDABLE_CATEGORIES` se muda a `classify/queue.ts` —al lado de
`UNCLASSIFIED_CATEGORIES`, de la que se deriva— y las dos superficies la
importan. Es la definición de la cola dicha al revés, y ahora está escrita una
sola vez.

### W15 — Un monto convertido con la etiqueta de la moneda vieja

**ROMPE (leve).** `server/src/review/resolve.ts` rechaza `confirm` sobre una fila
en otra moneda y deja `correct` como la salida honesta, porque `correct` **es**
"una persona afirmando el equivalente convertido". El monto que queda guardado
está en la moneda base y suma en los totales como tal — pero la columna
`currency` seguía diciendo la moneda vieja.

Consecuencia en pantalla (`TransactionsTable.vue:149` dibuja `{{ monto }}
{{ moneda }}`): la tabla de movimientos muestra **"12,40 ARS"** sobre un número
que son dólares y que el motor suma como dólares. Es W6 al revés — ahí un dato
desconocido se dibujaba como cifra, acá una cifra real lleva el rótulo
equivocado.

**Corregido:** `correct` escribe `currency` junto con `amount` y `source`. En una
fila que ya estaba en la moneda base no cambia nada, y `discard` no lo toca: ahí
nadie afirmó ningún equivalente.

---

## 3. Lo que aguantó el ataque

**N0, la lista blanca del cliente.** Se probaron los vectores de imitación uno
por uno contra `panel/src/api/origins.ts`, y **ninguno consigue la llave**:

| vector | origen que resuelve | veredicto |
|---|---|---|
| `https://confiable@atacante` (userinfo) | el del atacante | `foreign` |
| `https://confiable.atacante` (sufijo) | el del atacante | `foreign` |
| `https://confiable:8443` (puerto) | con puerto | `foreign` |
| `//atacante` (relativo al protocolo) | no parsea | `foreign` |
| `javascript:` / `data:` | rechazado por protocolo | `foreign` |
| `https://CONFIABLE` (caja) | canonicalizado | `trusted` — correcto, los dos lados canonicalizan |
| `https://confiable\@atacante` (barra invertida) | el confiable | `trusted` — correcto, `fetch` también resuelve al confiable |

También aguantaron: el token **no** se acepta por query string en ninguna
superficie (`classifyRequestAuth` sólo mira la cabecera); `parseBearer` no se
deja pasar por cabeceras malformadas y la comparación corta por longitud antes
de `timingSafeEqual`; y el preflight no puede colar un método raro porque
`cors.ts` publica una lista fija que no refleja `Access-Control-Request-Method`,
y no hay ninguna ruta registrada con `.all()` ni con `.options()` que pudiera
devolver datos sin llave.

**El fix de los reversos (W4).** Se atacó con `type IS NULL` (0 filas en el
ledger real, y la columna es `NOT NULL` en el esquema), con el reverso de un
reverso y con las tres banderas cruzadas. Las dos filas del reverso se tapan y
se destapan juntas, que es lo que son: un solo hecho.

**El fix del saldo nulo (W6).** Se auditaron los 25 puntos del panel donde se
escribe una cifra de plata. Ninguno puede recibir un `null`: `OverviewCard` exige
`typeof valor === "number" && Number.isFinite`, y los tres campos opcionales del
resumen de tarjeta pasan por `ROTULO_SIN_LEER`.

**La paginación contra el silenciador.** Silenciar las últimas contrapartes de
la página 8 no deja la pantalla mirando la nada: `paginar` acota el número
pedido a las páginas que existen. Y la contraparte silenciada **deja** de contar
en el progreso, como debe: `silencedPatterns` la saca de `remaining` y su plata
pasa a `covered`.

**El mes en curso de `reclassified_this_month`.** Se atacó con una contraparte
con filas en tres meses distintos y en el borde del mes. `localMonthRange`
devuelve instantes UTC absolutos y `apply.ts` compara instantes: la cuenta es
correcta también con el desfase horario configurado.

**`Guardar y seguir` navega a la cola ENTERA**, no a una filtrada por lote — que
es lo correcto: el alta no es un sync, y no hay lote al que acotar.

---

## 4. Limitaciones aceptables (ronda 2)

Las de la ronda 1 siguen en pie salvo las que se convirtieron en `ROMPE` acá.
Se suman estas, todas atacadas y confirmadas:

- **`*.localhost` recibe la llave.** `isLoopbackOrigin` acepta cualquier
  subdominio de `.localhost`, así que un `?api=http://ajeno.localhost` —si el
  usuario **además** confirma la propuesta a mano— se clasifica como loopback.
  Se apoya en RFC 6761 y en que Chrome y Firefox resuelven `*.localhost` a
  loopback sin consultar DNS. La ventana es angosta y requiere una confirmación
  explícita, pero la suposición está fuera del código.
- **`covered_ratio` y `unclassified_ratio` siguen con denominadores distintos.**
  Sin cambios respecto de la ronda 1.
- **El progreso queda pegado cuando un refresco falla.** La tarjeta de avance no
  cuelga de `ledgerLeido`, así que después de una escritura seguida de un
  refresco fallido se dibuja el valor anterior al lado del cartel rojo. Es dato
  viejo, no dato inventado — pero es dato viejo sin decir que lo es.
- **Confirmar una propuesta del alta no refresca las demás.** Si la confirmada
  contiene a otra de la lista, esa otra queda en pantalla como propuesta viva
  aunque ya esté clasificada. Es el mismo substring de W12, en la otra pantalla.
- **Silenciar sigue sin vuelta atrás desde el panel.** Se verificó que la salida
  **existe** en las otras dos superficies: `DELETE /api/classify/silence`
  (`api/routes.ts:299`), `GET /api/classify/silenced` y la tool MCP
  `silence_counterparty` con `undo: true`. Lo que falta es la pantalla, y la
  copia del panel no promete lo contrario.
- **Los filtros de fecha siguen cortando por día UTC.** Vuelto a medir:
  **233 de 1140 filas (20 %)** caen en un día distinto del que el Resumen les
  asigna.
- **El modo demo cablea `"USD"`.** Es el único `"USD"` vivo fuera del parser y
  del default de la config. La demo es internamente coherente y no habla con
  ningún backend.
- **La descripción de una tool MCP dice "in USD".** `chat/engine-tools.ts:320`.
  Es texto para el modelo, no un cálculo; no gobierna ninguna guarda.

---

## 5. Lo que quedó pendiente

- **La verificación visual sigue siendo deuda manual.** Sin navegador headless
  en este entorno, ninguna de las réplicas del design system se comparó lado a
  lado con su preview. Sin cambios respecto de la ronda 1.
- **El checklist D14 de TASK-054** sigue sin marcar: son tareas en la máquina de
  Mato.
- **R25 sigue mintiendo fuera del panel.** `balance.ts` devuelve
  `financiado: true` con objetivo en cero. El panel lo corrige en su capa; la
  superficie de agentes, no. Merece su propio ticket en el motor.
- **El alcance por substring sigue siendo el alcance.** W12 lo hace **visible**,
  no lo cambia: responder por un nombre corto sigue barriendo los grupos que lo
  contienen. Cambiar el matcher a igualdad es una decisión de producto sobre
  `categorize()`, no un parche del panel.
- **El progreso pegado y la propuesta stale** (sección 4) no se corrigieron:
  ninguno produce un número falso, y los dos se curan en el próximo refresco.
