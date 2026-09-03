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

---

# Wargaming del MVP — ronda 3

Tercera pasada. El objetivo de la ronda 2 era atacar lo que la ronda 1 declaró
resuelto; el de ésta es **atacar por CLASE**, porque la lección que la ronda 2
dejó escrita fue exactamente ésa:

> "cada fix arregló el caso del que se enteró, y no la clase de la que ese caso
> era un ejemplar."

Así que acá no se preguntó *"¿se puede esquivar W10?"* sino *"¿dónde más lee
este sistema una cifra escrita por una persona?"*; no *"¿se puede esquivar
W9?"* sino *"¿qué está afirmando esa frase, exactamente?"*. Cinco frentes por
clase, cuatro cruces entre fases que ninguna ronda anterior había tocado, y una
re-medición sobre el ledger real.

**Punto de partida:** `d43ac14`, 121 archivos / 1582 tests.
**Punto de llegada:** 121 archivos / **1631 tests**, `npm run build` limpio.
**Trece `ROMPE` nuevos.** Ninguno de los quince hallazgos de las rondas 1 y 2 se
pudo revivir tal cual; **siete de los trece son la clase de uno de ellos**,
viva en otra superficie.

> Sobre los datos: mismo criterio que las dos rondas anteriores. El ledger real
> se leyó sobre una **copia**, y de acá sólo salen conteos y proporciones.
> Ningún nombre, ningún monto de una fila, ningún fixture con datos reales.

---

## 1. Veredicto por fase

| Fase | Ticket | R1 | R2 | Ronda 3 | Qué se cayó ahora |
|---|---|---|---|---|---|
| N0 — la puerta mínima | TASK-054 | SÓLIDO | ROMPE (leve) | **ROMPE** | El botón *"Guardar sin darle la llave"* **daba la llave** para todo backend que ya entrara solo (W27). El comodín `*.localhost` se aceptó en la ronda 2 sobre una justificación que se cae al leerla (W13b). Y el cartel que dice "estos datos son inventados" era una foto que no se volvía a mirar (W25). |
| N1 — el motor de la pregunta | TASK-055 | ROMPE | ROMPE | **ROMPE** | W1 por una **tercera** puerta: en modo lote la tarjeta cuenta el lote y el escritor mueve el ledger entero — 2 arriba, 47 abajo (W23). El silenciador era el único escritor de patrones que no valida contra el ledger, y devolvía 200 `ok` por una fila inerte (W22). Y no decía `changed`, así que celebraba dos veces (W21). |
| N2 — el hogar y el sync | TASK-056 | ROMPE | SÓLIDO | **ROMPE (leve)** | `transaction_ids` no tenía tope en ninguna de sus dos superficies: 32767 ids son un 500 con el stack trace completo, porque el server no tenía manejador de errores (W24). |
| N3 — la cola de preguntas | TASK-057 | ROMPE | ROMPE | **ROMPE** | *"Cubriste el 80 % de tu plata"* cuando era el 24 %, y una tarjeta con un título del 76 %, una barra al 16 % y un pie que da 84 % (W19). El progreso celebraba en verde al lado del cartel rojo del backend caído (W20). |
| N4 — el análisis del historial | TASK-058 | ROMPE | ROMPE | **ROMPE** | *"Suele caer el 20"* sobre un día que ocurrió **una vez de cuatro**: W9 se cumplió al pie de la letra y la frase siguió siendo falsa (W18). Y el freno de R33 medía el ledger, no la candidata: tres cargos en 29 días eran un "gasto fijo" con la cabecera diciendo "sobre 10,9 meses de historial" (W28). |
| N5 — movimientos | TASK-059 | ROMPE | ROMPE (leve) | **ROMPE** | El único campo del panel que escribe `transactions.amount` seguía leyendo con `Number()`: "1.500" entraba como 1,5 (W16). `parsePlata` fallaba con los dos separadores a la vez (W17). Y el filtro de fechas cortaba por día UTC contra un motor que cuenta en día local (W26). |

**Las correcciones de las rondas 1 y 2, por clase:**

| | ¿Se pudo revivir el caso? | ¿Sobrevivió la CLASE? |
|---|---|---|
| W1/W12 — el conteo que la tarjeta prometió | no | **NO** — modo lote (W23) |
| W2/W9 — el día típico | no | **NO** — "suele" no es "ocurrió" (W18) |
| W3/W10 — la cifra escrita por una persona | no | **NO** — `ReviewCard` (W16), dos separadores (W17) |
| W4 — las dos filas del reverso | no | **SÍ** |
| W5/W11 — no afirmar sobre un ledger no leído | no | **NO** — el estado poblado no tenía la guarda (W20) |
| W6 — `null` dibujado como cifra | no | **SÍ** |
| W7 — la moneda del perfil | no | **SÍ** |
| W8/W14 — una regla del motor puesta en un transporte | no | **NO** — el tope de `transaction_ids` faltaba en las dos (W24) |
| W13 — el chip que no dice a qué se cambia | no | **NO** — el botón que no hace lo que dice (W27), la base de `*.localhost` (W13b) |
| W15 — la etiqueta de la moneda vieja | no | **SÍ** |
| R13 — `changed:false` no es éxito | — | **NO** — implementada para `resolve`, nunca para `silence` (W21) |

---

## 2. Los hallazgos

### W16 — El único campo que escribe un monto en el ledger leía con `Number()`

**ROMPE (el más grave de la ronda).** `panel/src/components/ReviewCard.vue:78-81`
tenía, textual, `Number(correccion.trim().replace(",", "."))`: **el mismo código
que W3 declaró insuficiente y W10 reemplazó**, sobreviviendo una pantalla más
allá. W10 arregló el campo del colchón, que es una meta; éste es el monto.

| lo que la persona escribe | lo que se guardaba | lo correcto |
|---|---|---|
| `1.500` | **1,5** | 1500 |
| `10.000` | **10** | 10000 |
| `1.500,00` (como la propia tarjeta lo imprime) | botón apagado, sin motivo | 1500 |
| `0x10` / `1e5` / `2.5e3` | 16 / 100000 / 2500 | rechazado |

Y es el peor lugar posible: es **la única puerta del sistema por la que un
humano pisa `transactions.amount`**. `review/resolve.ts` sólo valida la forma
(finito y no negativo), así que 1,5 pasa, la fila sale de `needs_review`, entra a
todos los totales y queda marcada `source = 'human'` —afirmada por una persona—
con el monto del parser ya sepultado en la auditoría. La invariante 1 del
CLAUDE.md dice que el monto sale del parser; la excepción no puede leer mal lo
que la persona escribió.

**Corregido:** lee con `parsePlata`, como el resto del panel.

### W17 — "1,234.56" entraba como 1,23

**ROMPE.** `panel/src/lib/formato.ts` — la rama de la coma asumía *"hay coma ⇒ la
coma es el decimal, los puntos son miles"*. Con los **dos separadores a la vez**
—coma de miles y punto decimal, que es como imprime la plata la plaza donde vive
el ledger de este proyecto— borraba el punto, que era el decimal de verdad, y
devolvía una cifra mil veces más chica sin un solo error.

Es W10 otra vez, por la otra mitad del mismo `if`, con el mismo factor de mil y
el mismo silencio: un colchón de 1234,56 guardado como 1,23 no se ve como un
error, se ve como un objetivo cumplido que nadie fijó (R25).

**Corregido:** con los dos presentes manda el **último** separador —la única
regla que las dos convenciones comparten— y el otro tiene que estar separando
grupos de exactamente tres. Lo que no cumple ninguna de las dos formas no es una
cifra ambigua: es `null`.

### W18 — "Suele caer el 20", con el 20 ocurriendo una vez de cuatro

**ROMPE.** W9 exigió que el día que se nombra sea un día **observado**, y eso se
cumplió al pie de la letra: sobre las 17 distribuciones de la batería, el día
devuelto siempre existía. La clase era otra. La pantalla no dice *"el 20 pasó
algo"*: dice **"suele caer el 20"**, que es una afirmación sobre la tendencia.

Medido sobre el ledger real **después del arreglo de W9**, de las 5 propuestas
que afirmaban un día, **4 lo afirmaban sobre un día que ocurrió una sola vez**:

| días observados | día que se afirmaba | veces que cayó ahí |
|---|---|---|
| 3, 20, 22, 23 | 20 | 1 de 4 |
| 18, 21, 25 | 21 | 1 de 3 |
| 7, 9, 11 | 9 | 1 de 3 |
| 3, 4, 5 | 4 | 1 de 3 (pero los tres a un día) |

La mediana se había puesto el disfraz de una observación. Y el guarda de la
desviación absoluta mediana no lo ve: con 3 observaciones la MAD **es la del
medio**, así que un outlier arbitrario es invisible — cargos el 1, el 2 y el 28
daban *"suele caer el 2"*.

**Corregido:** *suele* pide mayoría. Se exige que **más de la mitad** de los
cargos caigan en el día que se nombra o a un día de distancia (el corrimiento del
débito que cae en fin de semana y se procesa el lunes, que es para lo que existe
el margen). Dos días ya no son el mismo día nudgeado: son otra fecha. Un gasto
que cae 7, 9 y 11 no tiene un día, tiene una semana, y esta pantalla no sabe
decir una semana — entonces no dice nada.

Sobre el ledger real: **2 de 10** afirman un día, y las dos son honestas (una con
4 cargos de 4 en el mismo día, otra con los tres a un día de distancia). Tres
tests que codificaban la promesa vieja se actualizaron con su motivo escrito.

### W19 — "Cubriste el 80 % de tu plata" siendo el 24 %

**ROMPE.** `covered_ratio` es sobre `baseline_total` (la plata que alguna vez
tuvo una pregunta) y `unclassified_ratio` era sobre `spending_total` (todo el
gasto). La tarjeta llamaba **"tu plata"** a las dos.

Los dos síntomas, los dos reproducidos contra el motor real:

1. Con 240 de 300 respondidos sobre 1000 de gasto, la tarjeta celebraba
   *"Cubriste el 80 % de tu plata"* en verde con la barra llena. El usuario
   cubrió el **24 %** de su plata. Es W11 —celebrar un logro que el ledger no
   dice— sin que el ledger tenga que estar vacío.
2. Sobre el ledger real, la **misma tarjeta** imprimía al mismo tiempo: título
   *"Te queda el 76 %"*, barra al **16 %**, y un pie con *"2.629,46 de 16.616,02
   ya respondidos · quedan 13.986,56"* — cuyo cociente es **84 %**. Tres cifras
   visibles a la vez que no cierran entre sí.

Las dos rondas anteriores lo anotaron como *"denominadores distintos"* y lo
aceptaron. Los tres números son ciertos por separado; el defecto no es ninguno de
ellos, es **ponerlos juntos como si se complementaran**.

**Corregido:** el motor publica `remaining_ratio` (`remaining / baseline`), que
es el complemento exacto de `covered_ratio`, y la tarjeta usa ése. Y el texto
**nombra su denominador** en vez de decir "tu plata": *"Sigue sin clasificar el
84 % de la plata que había para clasificar"*. Barra + título = 100, siempre.
`unclassified_ratio` queda publicado con su doc diciendo que **no** es el
complemento de la barra.

### W20 — El progreso celebra en verde al lado del cartel rojo

**ROMPE.** W5 se cerró con *"el estado vacío sólo se dibuja cuando hubo
respuesta"* (`ledgerLeido`, `Preguntas.vue`), y la clase era más ancha: **no
afirmes un hecho sobre un ledger que no leíste**. `ledgerLeido` sólo guarda los
dos estados **vacíos**. El estado **poblado** afirma mucho más y no la tenía.

Reproducido montando el componente real: 151 grupos, página 3, escritura exitosa
seguida de un refresco que falla. En pantalla, simultáneamente:

- cartel rojo: *"El backend no respondió. Failed to fetch"*
- tarjeta de avance, clase `celebra`, en verde: *"Cubriste el 80 % — 640,00 de
  800,00 ya respondidos"*, con los montos **de antes de la escritura**
- la contraparte recién respondida, todavía listada

Dato viejo dibujado con cara de dato fresco.

**Corregido:** `vistaProgreso` acepta `{ vencido }` y la pantalla se lo pasa
cuando `errorCarga` no es `null`. No celebra, y lo dice: *"El backend no
respondió al refrescar, así que estos números son los de antes de tu última
respuesta"*.

### W21 — Silenciar dos veces celebra dos veces

**ROMPE.** `efectoDeResolver` sabe desde el principio que `changed:false` no es
éxito (R13). `efectoDeSilenciar` no podía saberlo: `POST /api/classify/silence`
devolvía `{ok, counterparty}` **sin `changed`**, así que la pantalla construía el
efecto con los números de la tarjeta que tenía en la mano. Encadenado con W20
—la tarjeta ya respondida sigue en pantalla tras el refresco fallido— el usuario
la vuelve a silenciar y recibe, en verde: *"6 movimientos por 960,00 salen de la
cola"*, con cero movimientos saliendo.

La asimetría estaba dentro del mismo archivo de rutas: **el `DELETE` sí devolvía
`changed`**.

**Corregido:** el motor devuelve `changed`, las tres superficies lo publican, y
`efectoDeSilenciar` lo ramifica con tono `neu`.

### W22 — El silenciador era el único escritor de patrones que no valida contra el ledger

**ROMPE.** La trampa fundacional del proyecto —un patrón que se guarda bien, se
lista bien y no matchea una sola fila— la cierra `apply.ts` por construcción:
deriva el patrón de la contraparte **real**. `silenceCounterparty` aceptaba
cualquier texto.

`toRulePattern` perdona la caja y los acentos pero **no el espaciado interno**.
Mismo string, dos superficies, sobre un ledger con `CAFE CENTRO`:

```
classify("  CAFE  centro ")  ->  400  counterparty_not_found
silence ("  CAFE  centro ")  ->  200  ok, patrón "cafe  centro" escrito
la cola después del silencio ->  ["cafe centro"]   ← SIGUE AHÍ
```

Un agente por MCP se lleva un `ok`, un contador que sube, y la contraparte
intacta en la cola. Es la trampa del proyecto reencarnada en el único módulo
donde nadie la buscó.

**Corregido:** `silenceCounterparty` resuelve contra el ledger con la misma
función que `classifyCounterparty` y devuelve `counterparty_not_found` si no
corresponde a una contraparte real. La grafía que guarda pasa a ser la del ledger,
por la misma razón que en `apply.ts`: es la que el usuario acaba de ver. La
descripción de la tool MCP lo declara.

### W23 — En modo lote la tarjeta cuenta el lote y el escritor mueve el ledger

**ROMPE.** El aviso post-sync (D7-b) lleva a la cola **acotada al lote**
(`classifyQueue` con `transactionIds`). Ahí `grupo.count` y `grupo.total` son del
lote, y `rowsMatching` (`classify/apply.ts`) barre **la tabla entera sin filtro de
ids**. El pie de la tarjeta afirmaba, textual, que la regla *"vale para los 2
movimientos de esta contraparte"* y la respuesta contestaba *"reclasificaste
47"*.

Es el síntoma exacto de W1 por una **tercera** puerta: las rondas 1 y 2
analizaron la cola **sin filtrar**, y ninguna miró el modo lote.

**Corregido:** con la misma salida que W12 —no recortar el número, decir el
alcance— pero para eso el motor tiene que publicarlo. `classifyQueue` en modo
lote agrupa dos veces (con filtro y sin él, con las mismas reglas, así que los
dos números salen de una sola definición) y agrega `count_en_ledger` /
`total_en_ledger`. La tarjeta lo dice antes de tocar el botón: *"Las cifras de
arriba son sólo las de este lote. De esta contraparte hay 47 movimientos por
900,00 en todo tu historial, y la regla los mueve a todos."*

### W24 — 32767 ids son un 500 con el stack trace completo

**ROMPE (leve).** Dos agujeros en la misma línea, y el segundo no es de esta
ruta:

1. `selectClassifiableRows` arma `id IN (?, …)` con un placeholder por id, y
   SQLite (3.49.2, el de este repo) corta en **32766 variables**. `transaction_ids`
   **no tenía tope** ni en `classifyQueueQuerySchema` ni en la tool MCP
   `get_classify_queue` — que además sí capa `limit` a 500. Es W14 otra vez: una
   guarda que existe en una superficie y no en la otra.
2. `createApp` **no montaba ningún manejador de errores**, y `npm start` es
   `node dist/index.js` sin `NODE_ENV=production`. O sea que **cualquier `throw`
   de cualquier ruta** devolvía la página HTML por defecto de express con el
   stack trace y rutas absolutas del filesystem.

Desde el panel hoy es inalcanzable —`insertedIds.length <= batch_size <= 500`—
pero ese acoplamiento no está escrito en ningún lado ni cubierto por un test:
subir el `batch_size` máximo rompía la cola post-sync sin que fallara nada.

**Corregido:** `MAX_TRANSACTION_IDS = 500` vive en `api/schemas.ts` y lo importan
las dos superficies; y `/api` tiene un manejador de errores que contesta
`{"error":"internal error"}` y manda sólo el mensaje —nunca el stack— a
`stderr`.

### W25 — El cartel de "datos inventados" era una foto

**ROMPE.** `AppShell.vue` tenía `const demo = isDemoMode()`: una foto tomada al
montar la barra lateral, y el único lugar donde el panel dice *"estos números son
ficción"*. Y el backend **se puede cambiar sin recargar** — `BackendChip` acepta
la propuesta de `?api=`, escribe `localStorage` y sigue; no hay un solo
`location.reload` en todo `panel/src`.

El ataque es un enlace: `https://<panel>/?api=demo`. El cartel decía *"Este
enlace quiere cambiar tu backend a `sin servidor`"* —un texto que no menciona
datos inventados—, el usuario aprieta el botón que parece prudente, y a partir
del siguiente tick del reloj el saldo, el *safe to spend*, las deudas y el
gráfico salen de `demoFetch`: **inventados, presentados como su ledger, sin un
solo cartel**. Al revés pasa lo mismo: el cartel de demostración queda puesto
sobre el ledger real.

Todo el aparato de "lo que no se leyó no se dibuja" (W5, W11, W20) no sirve de
nada si el rótulo que dice de dónde salen los datos es un `const`.

**Corregido:** `api/base.ts` publica `onBackendChange`, `setApiBase` notifica, y
`AppShell` se suscribe. Y el cartel de la propuesta ya no dice "sin servidor"
para la base demo: dice *"el modo demostración — datos inventados, no tu
ledger"*.

### W26 — Un día del filtro no era el mismo día que el del motor

**ROMPE.** `ts` se guarda en UTC y **todo el motor bucketea por día local**
(`strategy/dates.ts`, offset configurable). El filtro de Movimientos mandaba
`from=2026-09-01` pelado y `to=2026-09-30T23:59:59.999Z` — un instante **UTC**—
y `queryTransactions` compara strings. La ventana quedaba corrida las horas del
offset en los dos extremos: se perdían las compras de la noche del último día del
rango y se colaban las de la noche anterior al primero.

Ese `T23:59:59.999Z` es la corrección de un caso anterior: `to=2026-09-30` dejaba
afuera el día 30 entero. Arregló el corte y creó el otro — el patrón de la
ronda 2, otra vez.

Medido sobre el ledger real: **233 de 1140 filas (20 %)** caen en un día distinto
del que el Resumen les asigna; **3 filas (0,3 %)** caen en un **mes** distinto; y
filtrar "el mes" con los dos campos difiere del mes del motor en **6 filas**.

Es la clase de W17 en el otro eje: **el mismo dato con dos lecturas y ningún
error**.

**Corregido:** las dos fechas viajan como días pelados y **qué es un día lo
decide el motor**, como todo lo demás (regla 4 de §2.3). `api/routes.ts`
interpreta un `YYYY-MM-DD` como el día local completo; un instante ISO con hora
se respeta tal cual, porque quien manda una hora está pidiendo esa hora.

### W27 — El botón "Guardar sin darle la llave" daba la llave

**ROMPE.** El cartel de R1 ofrece dos botones y el primero **era un no-op**:
`trustBackendOrigin` cortaba en `if (verdict !== "foreign") return`, así que para
cualquier backend que ya entrara solo —`loopback`, `configured`— los dos botones
eran el mismo.

Vector: `?api=http://127.0.0.1:9999`, un proceso cualquiera escuchando en el
loopback del usuario. Verdict `loopback` ⇒ `mayReceiveCredential` ⇒ el
`WALLET_ACCESS_TOKEN` sale en la cabecera de la siguiente llamada. **El usuario
que hace exactamente lo prudente entrega la llave.** Ningún test lo cubría:
`base.test.ts` sólo probaba `trust: true` contra un origen ajeno.

Un botón que no puede cumplir su etiqueta es peor que no tenerlo: pide una
decisión y la descarta.

**Corregido:** hay un veredicto `denied` y una lista de negados en el navegador.
Gana sobre cualquier otro veredicto, incluido `loopback`. Autorizar después
levanta la negación y negar retira una autorización previa: **hay una sola
decisión por origen y es la última**. El chip dice *Sin credencial* para
`denied` igual que para `foreign`, y `client.ts` dejó de tener su propia copia
de la lista (`verdict !== "foreign"`), que habría mandado a `denied` al cartel
equivocado.

### W13b — La justificación de `*.localhost` no se sostiene

**ROMPE (de la justificación).** La ronda 2 aceptó como limitación que
`isLoopbackOrigin` diera por loopback a cualquier subdominio de `.localhost`,
*"apoyándose en RFC 6761 y en que Chrome y Firefox resuelven `*.localhost` a
loopback"*. Las dos mitades se caen al mirarlas, y con fuentes primarias:

- **RFC 6761 §6.3 dice SHOULD, no MUST**, y el intento de subirlo a requisito
  (`draft-ietf-dnsop-let-localhost-be-localhost`) **expiró sin llegar a RFC**.
- **WebKit lo declara no garantizado**: *"the system DNS resolver on Apple
  platforms does not necessarily guarantee that localhost maps to loopback"*
  (bug 171934, todavía abierto).
- **W3C Secure Contexts condiciona** la confianza a que el navegador cumpla ese
  draft, y advierte que los resolvers *"a menudo ignoran estas sugerencias, a
  veces mandando `localhost` a la red"*.

O sea: se nombraron los dos navegadores que sí lo garantizan y se omitió el que
sus propios mantenedores dicen que no. Con un sufijo de búsqueda DNS,
`ajeno.localhost` puede resolver a una IP pública — y ese origen recibía la llave
sin que el usuario autorizara nada, porque `loopback` entra solo. No se consiguió
un PoC de Safari mandando `evil.localhost` a DNS pública (no hay macOS en este
entorno), así que no se llama fuga demostrada: lo que se cae es la base sobre la
que la limitación se aceptó.

**Corregido:** la rama se va. Nadie hospeda su billetera en `panel.localhost`, y
quien lo haga la autoriza a mano como cualquier otro backend. El host exacto
`localhost` y `127.0.0.0/8` siguen entrando solos.

### W28 — Un "gasto fijo" de veintinueve días, avalado por once meses de ledger

**ROMPE.** El freno de R33 estaba puesto en el lugar equivocado.
`mesesDeHistorial` mide `MAX(ts) - MIN(ts)` del **ledger entero**; la regla de
recurrencia mide `porMes.size` de **la candidata**. Son dos poblaciones y el
código trataba a una como si protegiera a la otra.

El doc del módulo promete, textual, que *"cinco semanas pueden tocar tres meses
del calendario (31/1, 15/2, 1/3) y producir un 'gasto fijo' que es una casualidad
de almanaque"*. Con un ledger de once meses, el freno está abierto y esa
casualidad pasa entera. Verificado contra SQLite real: tres cargos en **29 días**
salen como propuesta, y la pantalla dice a la vez *"visto en 3 meses distintos"*,
*"suele caer el 28 de cada mes"* y, en la cabecera, *"sobre 10,9 meses de
historial"* — cierto del ledger, falso de la propuesta.

O sea que el freno **sólo cerraba en la primera instalación**. En cualquier
billetera con uso real llevaba abierto desde siempre.

**Corregido:** la candidata también tiene que durar. Los tres cargos mensuales
consecutivos que menos días abarcan en el calendario son 31/1, 28/2 y 31/3: 59
días. `DIAS_MINIMOS_DE_LA_CANDIDATA` son 56, que deja pasar a ésos y frena
cualquier racha más corta. Sobre el ledger real las candidatas bajan de 19 a 17.

---

## 3. Lo que aguantó el ataque

**`vistaProgreso`, cuatro vectores que resultaron ser teoremas.** Se derivó de
`progress.ts` qué puede tomar cada campo, y cuatro de los cinco ataques son
**inalcanzables por construcción**, no por guarda:

- `covered_ratio > 1` — `remaining ⊆ baseline` siempre: `categorize()` decide
  `retiro`/`servicio`/`recarga` por `type` antes de mirar reglas, y toda otra
  fila `out` arranca en un fallback, así que una regla sólo puede **sacar** filas
  del conjunto.
- `answers_to_target = 0` con `done = false` — `answers = 0` sólo si
  `neededCents == 0` (⟹ `covered >= 0,8·baseline` ⟹ `done`) o `remaining` vacío
  (⟹ `covered == baseline` ⟹ `done`).
- `groups = 0` con `unclassified_total > 0` — los dos se derivan del mismo array.
- `target_ratio ≠ 0,8` — es una constante devuelta literal.

**La lista blanca de orígenes, 31 vectores.** Todos los de *userinfo*
(`http://localhost@atacante.com`, `http://127.0.0.1%2f@atacante.com`), el
punycode, `data:`, `javascript:`, `//atacante.com`, `https:/atacante.com` y
`http:atacante.com` caen en `foreign` y **no reciben la llave**. Los
normalizadores de IPv4 de WHATWG (`127.1`, `0x7f.0.0.1`, `2130706433`, y hasta
`①②⑦.0.0.1`) resuelven todos a `127.0.0.1` real, así que darles la llave es
correcto. Los únicos dos casos donde el veredicto permitía credencial sin que el
host fuera la máquina del usuario eran los de `*.localhost` (W13b).

**La barra del gráfico y la lista de movimientos.** El rango no viaja del panel
al motor: `consultaDe` manda `{category, limit, offset}` y `movements.ts` cae en
`localMonthRange` — el **mismo** que usa el overview. Y la lista sale de
`categorizedSpendingRows`, literalmente la misma selección y el mismo recálculo
que dibuja la barra. La coincidencia no es una convención: es la misma función.

**El alta (N4) no puede dejar una contraparte en bucle.** `CATEGORIAS_ELEGIBLES`
del panel y `RESPONDABLE_CATEGORIES` del motor son la misma lista dicha dos
veces, y `categorize()` consulta las reglas **antes** de caer en
`transferencia_persona` — lo cual importa, porque la mitad de las propuestas del
ledger real son transferencias.

**El modo demo gana sobre `?api=`.** `getApiBase()` no lee el parámetro nunca; es
una propuesta pendiente. Con demo guardado y un `?api=<backend caído>` en la
URL, los datos son demo y el chip dice *Demostración*. Coherente. Y en demo no
se pide llave: `probeHealth` corta antes de mirar el token.

**Silenciar en el progreso y en la paginación.** Una contraparte silenciada deja
de contar en `groups` y en `answers_to_target`, y su plata pasa a `covered_total`.
Exactamente lo documentado, verificado ejecutando.

**Los días de pago (`dias_pago`).** Se atacó la clase entera: `"0"`, `"32"`,
`"-5"`, `"1.5"`, `"15;30"`, `"15 y 30"`, `"007"`, `"30-28"` (rango invertido),
vacío y sólo espacios. Todos rechazados con `dias_pago_invalidos`, el panel
muestra el motivo textual y **no navega**. `"15,15"` deduplica. Ningún día entra
silenciosamente mal.

**Responder dos veces la misma contraparte.** La segunda llamada devuelve
`reclassified: 0` y `efecto.ts` lo traduce a tono `neu`: *"La regla quedó
escrita, pero no movió ningún movimiento"*. Honesto. (Silenciar dos veces no lo
era: ver W21.)

**La ida y vuelta de `parsePlata` con `formatoPlata`** es exacta para 0, 1, 1,5,
999,99, 1000, 1500, 12345, 1234567 y −1500, y el separador de miles que produce
`Intl.NumberFormat("es")` es U+002E verificado por codepoint, no un espacio
angosto que su inversa no leería.

---

## 4. Limitaciones aceptables (ronda 3)

- **El alcance por substring sigue siendo el alcance.** Sin cambios: 9 de los 147
  patrones de la cola están contenidos en otro, y en el peor caso responder por
  el corto mueve 7 movimientos de 2 contrapartes cuando la tarjeta prometía 1.
  W12 lo hace visible y W23 lo hace visible también en modo lote; cambiar el
  matcher a igualdad sigue siendo una decisión de producto sobre `categorize()`.
  Medido: **0 ciclos** (A contenido en B y B en A es imposible con patrones
  distintos) y **0 cadenas de tres**.
- **Silenciar es igualdad exacta y responder es substring.** Dos botones de la
  misma tarjeta con dos alcances distintos: silenciar `Cafe Centro` deja
  `Cafe Centro Sur` en la cola, y clasificarlo la saca. Ninguno miente —el texto
  de cada uno es exacto para lo que hace— pero la asimetría no se explica.
- **El desfase UTC ya no afecta al filtro** (W26), y lo que queda es el
  `WALLET_UTC_OFFSET_HOURS` fijo contra zonas con DST, que `dates.ts` documenta
  desde siempre.
- **`diaTipico` puede ser 31.** Con cargos el 31 de meses de 31 días, la pantalla
  dice *"suele caer el 31 de cada mes"*, que es falso para febrero, abril, junio,
  septiembre y noviembre. Es **texto puro**: se verificó que no hay un solo
  consumidor de cálculo (`recurring.ts` → `onboarding-route.ts` →
  `RecurringCard.vue`, y nada más), así que no dispara el overflow de mes de
  `new Date(2026, 1, 31)` → 3 de marzo. Si alguien alguna vez lo engancha a un
  calendario, ahí sí hay una bomba y está medida.
- **El día típico se afirma sin calificador propio.** `sampleSize` se muestra en
  la columna del **monto** (*"mediana · visto en 3 meses distintos"*) y el día va
  en la otra columna, solo. El dato está en la tarjeta pero el día toma prestada
  la credibilidad de una línea redactada para otra cifra.
- **La precarga del colchón redondea a dos decimales.** Un colchón guardado con
  más precisión (vía `--set` o la tool MCP) se reescribe redondeado al pulsar
  *Guardar y seguir* sin tocar nada. Son centavos, no órdenes de magnitud, pero
  es una escritura de un valor que el usuario no confirmó.
- **`RecurringCard` no avisa de los `needs_review` de la contraparte** y
  `ClassifyCard` sí. La pantalla que pone una **cifra estimada** delante del
  usuario es justamente la que no avisa que hay plata de esa contraparte fuera de
  la cuenta.
- **El deep link a una categoría sin filas del mes** (`#/movimientos?categoria=…`
  escrito a mano o marcado) dibuja *"0 movimientos · es lo que contó la barra del
  gráfico"* sin que haya habido barra. El número no es falso, su procedencia sí.
- **En modo lote, `montosPendientes` es del ledger entero** mientras las cifras
  de la tarjeta son del lote. W23 dice el alcance de los conteos; este aviso
  concreto sigue mezclando dos poblaciones.
- **El progreso queda pegado con dato viejo tras un refresco fallido** — pero
  ahora **lo dice** (W20), que es lo que faltaba.
- **`covered_ratio` y `unclassified_ratio` siguen midiendo cosas distintas**, y
  eso está bien: lo que se corrigió es que la pantalla los mezclara (W19).
- **El modo demo cablea `"USD"`** y **la descripción de una tool MCP dice
  "in USD"**. Sin cambios respecto de la ronda 2.

---

## 5. Lo que quedó pendiente

- **La verificación visual sigue siendo deuda manual.** Sin navegador headless en
  este entorno, ninguna réplica del design system se comparó lado a lado con su
  preview. Sin cambios desde la ronda 1.
- **El checklist D14 de TASK-054** sigue sin marcar: son tareas en la máquina de
  Mato.
- **R25 sigue mintiendo fuera del panel.** `balance.ts` devuelve
  `financiado: true` con objetivo en cero. El panel lo corrige en su capa; la
  superficie de agentes, no. Merece su propio ticket en el motor.
- **Silenciar sigue sin vuelta atrás desde el panel.** La salida existe en las
  otras dos superficies (`DELETE /api/classify/silence` y la tool MCP con
  `undo: true`); falta la pantalla.
- **El acoplamiento `batch_size ≤ MAX_TRANSACTION_IDS` ahora está escrito pero no
  hay un test que falle si alguien sube el `batch_size` máximo por encima del
  tope de ids.** Los dos números viven en `api/schemas.ts` y valen 500; nada los
  ata.

---

# Wargaming del MVP — ronda 4 (FINAL)

Cuarta y última pasada. La ronda 3 atacó por clase dentro de las pantallas; ésta
mantiene el método y lo mueve a **las superficies que ninguna ronda había
tocado**: el servidor MCP, la CLI de onboarding, el escritor de configuración, el
modo demostración y el brief. La pregunta de la ronda no fue *"¿se puede esquivar
W26?"* sino:

> "¿qué otra superficie contesta esta misma pregunta, y contesta lo mismo?"

Porque las tres rondas anteriores dejaron el mismo saldo: el arreglo alcanzó la
superficie donde se encontró el caso, y la de al lado siguió con la versión
vieja de la regla.

**Punto de partida:** `966d799`, 121 archivos / 1631 tests.
**Punto de llegada:** 121 archivos / **1650 tests**, `npm run build` limpio.
**Seis `ROMPE` nuevos**, ninguno de ellos en el manejo del dinero: los seis son
de la misma familia —*el producto afirma algo más preciso de lo que sabe, o dos
superficies contestan distinto la misma pregunta*—. **Cinco de los seis son la
clase de un hallazgo anterior viva en una superficie nueva**, y los otros dos
cierran las dos deudas que la ronda 3 dejó abiertas por escrito (R25 en el motor,
el candado de `batch_size`).

> Sobre los datos: mismo criterio que las tres rondas anteriores. El ledger real
> se leyó sobre una **copia**, y de acá sólo salen conteos y proporciones.

---

## 1. Veredicto por fase

| Fase / superficie | R2 | R3 | Ronda 4 | Qué se cayó ahora |
|---|---|---|---|---|
| N0 — la puerta mínima | ROMPE (leve) | ROMPE | **SÓLIDO** | Único frente de esta ronda sin un solo hallazgo. El modo demostración no produjo ni una corrección (`panel/src/demo/` queda sin tocar), y de yapa **ejercita en vivo** el fallback de W32: `demoFetch.ts:106` no manda `fijado` y la barra se dibuja igual. |
| N1 — el motor de la pregunta | ROMPE | ROMPE | **SÓLIDO** | Sin hallazgos nuevos. Las asimetrías conocidas (substring vs igualdad, lote vs ledger) siguen documentadas como limitaciones, no como roturas. |
| N2 — el hogar y el sync | SÓLIDO | ROMPE (leve) | **ACEPTABLE** | El acoplamiento que la ronda 3 dejó escrito y sin candado ya no se puede romper con un cambio de una línea (W33). No es un `ROMPE` nuevo: es una deuda cerrada. |
| N3 — la cola de preguntas | ROMPE | ROMPE | **SÓLIDO** | Sin hallazgos nuevos. |
| N4 — el análisis del historial | ROMPE | ROMPE | **ROMPE** | El proponente leía el día de cobro en UTC y el calendario que después lo consume lo lee en día local: *"cobrás el 16"* sobre un depósito de las 23:00 del 15, confirmado de buena fe y con el calendario sin encontrar un solo cobro dentro de esa ventana (W34). |
| N5 — movimientos y el Resumen | ROMPE (leve) | ROMPE | **ROMPE (leve)** | El rótulo *"actualizado hace X"* colgaba del reloj compartido, que late con el backend caído: *"actualizado recién"* arriba del cartel rojo y de una tabla vacía (W31). |
| **MCP** (nunca atacado) | — | — | **ROMPE** | `query_transactions` cortaba el rango en UTC mientras `get_spending_by_category` cortaba en día local: la misma pregunta, dos ventanas, sin un solo error (W29). Y `set_profile` escribía días de pago que el calendario después no sabe leer (W30). |
| **CLI onboard** (nunca atacada) | — | — | **ROMPE** | `--set` no pasa por el validador del panel: entraba un `"15"` pelado, un `"99-99"` y un colchón negativo, y el paso del perfil se daba por cerrado sobre un `nextPayday` en `null` (W30). |
| **Motor / brief** | — | — | **ROMPE (leve)** | R25 vivía sólo en el panel: para el chat, el brief y cualquier agente por MCP, una billetera recién instalada tenía el colchón *financiado* (W32). |

**Las clases anteriores, en las superficies nuevas:**

| Clase | ¿Sobrevivió? |
|---|---|
| W26 — un día del filtro no es un día del motor | **NO** — viva en MCP (W29) y en el proponente de sueldo (W34) |
| W20/W5/W11 — no afirmar sobre una lectura que falló | **NO** — viva en el rótulo de frescura de las dos pantallas (W31) |
| W8/W14/W24 — una regla del motor puesta en un transporte | **NO** — viva en el escritor de configuración (W30) |
| R25 — "no fijé meta" no es "cumplí mi meta" | deuda abierta de la ronda 3, **cerrada** (W32) |
| `batch_size ≤ MAX_TRANSACTION_IDS` sin candado | deuda abierta de la ronda 3, **cerrada** (W33) |

---

## 2. Los hallazgos

### W29 — La misma pregunta, dos ventanas, según por qué puerta entre

**ROMPE.** `mcp/server.ts` traducía `from`/`to` a `T00:00:00.000Z` y
`T23:59:59.999Z`, mientras `get_spending_by_category` —la tool de al lado, con
los mismos dos argumentos— resuelve por `localMonthRange`/`parseLocalDay`, o sea
en día local. Un agente que pide *"los movimientos de septiembre"* y *"el gasto
por categoría de septiembre"* recibía **dos períodos distintos**, corridos las
horas del offset por los dos extremos, sin un solo error y con las dos listas
completas.

Es W26 otra vez, y es exactamente la lección de W8/W14: la corrección de la
ronda 3 se hizo en el borde HTTP (`api/routes.ts`) y ahí se quedó. Qué es un día
no lo decide un transporte.

**Corregido:** las dos traducciones se mudaron al motor —`instanteDesde` /
`instanteHasta` en `strategy/dates.ts:132-144`, con el porqué escrito ahí— y
ahora las comparten el borde HTTP (`api/routes.ts:58`) y la tool MCP
(`mcp/server.ts:218-228`). **Tests:** `mcp/server.test.ts:187` (la ventana es
local) y `:221` (las dos tools contestan por el mismo período con el mismo
argumento).

### W30 — Tres superficies escriben el perfil y sólo una validaba

**ROMPE (el más grave de la ronda).** `setStrategyConfig` es el borde que
comparten los tres escritores —el panel por `writeProfile`, la tool MCP
`set_profile` y `npm run onboard -- --set`— y hasta esta ronda validaba la
**forma** y no el **significado**. La regla de qué día de pago es válido vivía en
`writeProfile`, es decir en el camino del panel y en ninguno de los otros dos.

| lo que entraba por MCP o por `--set` | qué hacía el motor después |
|---|---|
| `diasPago: ["15"]` | `parseDiasPago` lo descarta en silencio: calendario mudo, perfil "configurado" |
| `diasPago: ["99-99"]` | `localCalendarDate` clampea al último día del mes: una fecha inventada con cara de configuración |
| `colchonObjetivo: -100` | `colchonStatus` responde `financiado: true` |

Y del lado de la lectura, el mismo error en espejo: `profileConfigured`
(`onboard/status.ts:83`) y `readProfile` (`onboard/profile.ts:140`) contaban
*"hay algo escrito"* en vez de *"el calendario lo puede leer"*, así que el paso
del onboarding se cerraba sobre el único cálculo por el que ese paso existe,
valiendo `null`.

**Corregido:** `esDiaDelMes`/`esVentanaDePago` en `strategy/calendar.ts:16-18` y
`:61` —qué día del mes existe lo decide la lectura, y así vale para todas las
superficies—, `writeSchemas` en `db/strategy-config.ts:65-77`, y las dos lecturas
pasando por `parseDiasPago`. El mensaje de error nombra el campo exacto
(`strategy_config.sueldo.diasPago`), porque *"valor inválido en sueldo"* no le
dice a un agente cuál de los cuatro corregir. **Lo que deliberadamente NO se
endureció es la lectura:** una base ya escrita con un `"15"` haría fallar el
schema entero de `sueldo` y se leería el default, perdiendo el monto y la fuente
que el usuario sí confirmó. **Tests:** `db/strategy-config.test.ts:193`,
`strategy/calendar.test.ts:61`, `onboard/status.test.ts:150`,
`onboard/cli.test.ts:192`, `onboard/profile.test.ts:93`, `mcp/server.test.ts:408`
— uno por cada superficie que podía escribirlo.

### W31 — "Actualizado recién", arriba del cartel rojo

**ROMPE (leve).** El rótulo de frescura de las dos pantallas principales salía de
`reloj.lastRefreshAt`, o sea del **tick compartido**, que late igual cuando el
backend está caído. El resultado: *"actualizado recién"* en la cabecera, el
cartel rojo de error abajo, y en Movimientos una tabla vacía entre los dos. La
única hora que ese rótulo puede decir con verdad es la de la última lectura que
salió bien.

Es la clase de W20 —celebrar al lado del cartel rojo— en la pieza que W20 no
miró.

**Corregido:** `ultimaLecturaOk` en `panel/src/views/Resumen.vue:66,83,165` y
`panel/src/views/Movimientos.vue:75,117,203`. El rótulo se sigue **recalculando**
con cada tick (envejece un minuto por minuto) pero ya no se **fecha** con él.
**Tests:** `Resumen.test.ts:461` y `Movimientos.test.ts:316` — diez minutos de
backend caído y el rótulo dice *"hace 10 minutos"*, no *"recién"*.

### W32 — El colchón financiado de una billetera recién instalada

**ROMPE (leve).** Deuda abierta y por escrito de la ronda 3. `colchonStatus`
devolvía `financiado: true, faltante: 0` con el objetivo en cero, porque
`0 >= 0`. El panel lo distinguía en su propia capa (`panel/src/lib/colchon.ts`),
así que la pantalla estaba bien; **el chat, el brief y cualquier agente por MCP
no**: para ellos una billetera sin configurar tenía el fondo de emergencia
cumplido.

**Corregido:** el motor publica `fijado` (`strategy/balance.ts:76,98`), la tool
MCP lo dice en su descripción para que el agente mire ese campo antes que
`financiado` (`mcp/server.ts:171-174`), y el panel pasó de deducirlo a
**consumirlo**, con el objetivo como fallback para un server anterior
(`panel/src/lib/colchon.ts:51`, `panel/src/api/types.ts:80`; ausente **no es**
`false`, es *"no sé"*). **Por qué se agrega un campo en vez de invertir
`financiado`:** `financiado` es la fórmula de la especificación §9.3 y el brief
dispara su alerta con ella (`brief/build-brief.ts:204`); invertirla haría sonar
*"colchón no financiado"* en toda billetera que todavía no fijó objetivo, que es
justo el usuario al que no hay que alarmar. **Test:**
`strategy/balance.test.ts:152`.

### W33 — El acoplamiento escrito y sin candado

**ROMPE (leve).** La otra deuda por escrito de la ronda 3. El lote de un sync es
el único productor legítimo de `?transaction_ids=` (D7-b), así que un
`batch_size` por encima del tope de ids produce un lote **cuya propia cola no se
puede pedir**: el aviso post-sync del Resumen lleva a un 400. Los dos números
vivían en `api/schemas.ts` valiendo 500 y nada los ataba: subir uno solo era un
cambio de una línea que ningún test veía.

**Corregido:** `MAX_SYNC_BATCH_SIZE` exportada (`api/schemas.ts:84`) y dos tests
que fallan si alguien la sube por encima de `MAX_TRANSACTION_IDS`
(`api/sync-route.test.ts:183`). Es la clase de W24 tratada como corresponde: no
alcanza con escribir la regla en un comentario.

### W34 — "Cobrás el 16", sobre un cobro del 15

**ROMPE.** El día del mes de la propuesta de sueldo salía de `getUTCDate()`, y el
motor que después lee esa ventana bucketea por **día local**
(`historicalPaydayDays` usa `localDayKey`, `strategy/calendar.ts:91`). Un
depósito de las 23:00 del 15 es el 16 en UTC: la propuesta decía *"cobrás el
16"*, el usuario la confirmaba tal cual vía `--set` —la sugerencia sale ya en el
formato que el motor consume, ése es su contrato— y `refineWindowDay` no
encontraba **ningún** cobro histórico dentro de la ventana que el propio producto
acababa de proponer.

Es W26/W29 una tercera vez, ahora en el proponente. Afecta a cualquiera cuyo
sueldo caiga de noche, que con acreditaciones bancarias no es un caso raro.

**Corregido:** `onboard/suggest.ts:131` lee el día con `localParts`. **Test:**
`onboard/suggest.test.ts:142`.

---

## 3. Lo que aguantó el ataque

**El modo demostración, sin una sola corrección.** Es el único frente de esta
ronda que no produjo un hallazgo: `panel/src/demo/` queda sin tocar. Y de paso
resultó ser la prueba en vivo del fallback de W32 — `demoFetch.ts:106` y
`:574-580` no emiten `fijado`, exactamente como un server anterior al arreglo, y
la barra del colchón se sigue leyendo bien.

**El brief, por la razón correcta.** `build-brief.ts:204` dispara
`colchon_no_financiado` con `!colchon.financiado`, y con objetivo en cero la
alerta **no** suena. Eso es lo correcto —no se alarma a quien no fijó una meta— y
es precisamente por eso que W32 se resolvió agregando un campo en lugar de
invertir la fórmula: invertirla habría convertido este acierto en un falso
positivo para todo usuario nuevo.

**La idempotencia del ledger.** La persistencia es idempotente por
`gmail_msg_id` (`ingest/pipeline.ts:131`, AC4), con sus tests. Importa para el
veredicto final: ninguna de las seis roturas de esta ronda toca el ledger, y el
ledger además se reconstruye desde Gmail.

---

## 4. Limitaciones aceptables (ronda 4)

- **`WALLET_UTC_OFFSET_HOURS` es un offset fijo, no una zona IANA.** Los tres
  arreglos de día local de este proyecto (W26, W29, W34) descansan sobre él.
  Para Ecuador el default (`-5`) ya es correcto y no hay DST, así que el piloto
  funciona sin configurarlo; en una zona con DST los bordes de día quedan
  corridos una hora parte del año. `strategy/dates.ts:13-24` lo documenta y el
  onboarding tiene su propio paso (`huso`, `onboard/status.ts:19`).
- **Lo que se escribe se valida más duro que lo que se lee** (W30), a propósito:
  una base vieja con un día de pago que no parsea se sigue leyendo, y el producto
  lo reporta honestamente en vez de perder el monto y la fuente que el usuario sí
  confirmó.
- **`financiado` sigue siendo `reservado >= objetivo`**, incluso con objetivo en
  cero. Quien lea ese campo solo, sin mirar `fijado`, sigue pudiendo sacar la
  conclusión equivocada; lo que cambió es que ahora **existe** con qué
  distinguirlo y las tres superficies pueden hacerlo.
- **Todas las limitaciones de la ronda 3 siguen vigentes** salvo las dos que esta
  ronda cerró: el alcance por substring, la asimetría entre silenciar y
  responder, `diaTipico` pudiendo ser 31, la precarga del colchón redondeando a
  dos decimales, el aviso de `montosPendientes` en modo lote, el deep link a una
  categoría sin filas, y el `"USD"` cableado en la demo y en una descripción de
  tool.

---

## 5. Veredicto final del MVP

**Qué tan difícil es romperlo hoy, sin adornos.** Cuatro rondas, 34 hallazgos.
La curva de gravedad bajó de forma clara: la ronda 3 encontró trece, entre ellos
montos guardados mal (`"1.500"` entrando como 1,5); la ronda 4 encontró seis y
**ninguno toca el dinero**. Los seis son de una sola familia: *el producto afirma
algo más preciso de lo que sabe, o dos superficies contestan distinto la misma
pregunta*. La invariante dura del proyecto —el monto sale del parser, Claude es
verificación cruzada, el desacuerdo va a `needs_review`— no fue rota por ninguna
de las cuatro rondas.

**Lo que también hay que decir:** cinco de los seis hallazgos de esta ronda son
la clase de un hallazgo anterior, viva en una superficie que no se había mirado.
Es el cuarto resultado consecutivo con ese patrón. La conclusión honesta no es
*"ya no quedan roturas"*, es: **quedan, y son de esta forma** — una regla del
motor que una superficie nueva no heredó. Una ronda 5 sobre otra superficie
encontraría más. Lo que sí cambió es el costo de cada una: hoy son roturas de
afirmación y de consistencia, no de datos.

**¿Listo para el piloto con datos reales? Sí, con condiciones.** El riesgo
residual es que el producto diga algo impreciso, no que corrompa o pierda plata:
el ledger es local, la ingesta es idempotente por `gmail_msg_id`, y se
reconstruye desde Gmail. Ese es el argumento entero, y es suficiente para un
piloto de un usuario. **No** lo es para varios usuarios ni para exponerlo fuera
de la máquina.

Condiciones, todas fuera del código:

1. **Tailscale + `WALLET_ACCESS_TOKEN`.** El server no se expone de otra forma.
2. **El checklist D14 de TASK-054**, que sigue sin marcar: son tareas en la
   máquina de Mato y nadie más las puede hacer.
3. **Una pasada visual manual** por las pantallas principales. Sin navegador
   headless en este entorno, ninguna réplica del design system se comparó con su
   preview en ninguna de las cuatro rondas. Es la deuda más vieja del proyecto y
   se cierra mirando, no testeando.
4. **Confirmar el huso** en el onboarding aunque el default ya sirva para
   Ecuador: es el parámetro del que cuelgan tres de los arreglos.

**Deudas que quedan abiertas al cierre del wargaming:**

- La verificación visual (arriba).
- El checklist D14 (arriba).
- **Silenciar sigue sin vuelta atrás desde el panel.** La salida existe en las
  otras dos superficies (`DELETE /api/classify/silence` y la tool MCP con
  `undo: true`); falta la pantalla. Es la única deuda de funcionalidad que
  sobrevive a las cuatro rondas.
- Las limitaciones aceptables de §4, que están documentadas porque son
  decisiones, no olvidos.

R25 y el candado de `batch_size` —las dos deudas que la ronda 3 dejó por
escrito— quedan cerradas acá (W32, W33).
