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
