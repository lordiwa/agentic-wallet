# Sobres

> Cuánta plata hay apartada, en qué, y cómo se crea un sobre nuevo.

## La pregunta que responde

*"No sé cuánto tengo en cada sobre — emergencia, corriente, flexiahorro — ni
cómo creo sobres."*

Antes de esto el motor sabía de **un** solo apartado, el colchón, y lo sabía
sin llamarlo así: un número reservado y un objetivo, dibujados en una barra del
Resumen. No había forma de decir "de estos 1.100, 900 son del FlexiAhorro", y
no había forma de crear nada.

## La decisión de fondo: el colchón YA ERA un sobre

Lo primero, porque es lo que evita duplicar plata: **el sobre de Emergencia no
es un sobre nuevo al lado del colchón. Es el colchón.** El mismo documento, los
mismos dos campos, leídos por otra ruta.

| Qué | Dónde vive | Quién lo lee |
|---|---|---|
| Lo reservado en el colchón | `users/{uid}/savings/colchon.reservedCents` (Firestore) · fila `savings WHERE label='colchon'` (SQLite) | `colchonStatus`, `safeToSpendHoy`, `GET /sobres` |
| Su objetivo | `users/{uid}/config/strategy.colchonObjetivo` · `strategy_config` | `colchonStatus`, `GET /onboarding/profile`, `GET /sobres` |

De ahí sale la única asimetría del modelo, y es una asimetría **del motor**, no
de la interfaz:

- **El colchón es el único sobre que baja el safe-to-spend.** `safeToSpendHoy`
  resta `colchonStatus(...).reservado` y ninguna otra cosa.
- **Un sobre nuevo no mueve una sola cifra del Resumen.** Es contabilidad —"de
  lo que tengo, esto es para el viaje"—. La pantalla lo dice en voz alta,
  porque si no la primera pregunta al ver el safe-to-spend quieto sería si algo
  se rompió.

Por eso `PATCH /sobres/colchon` se bifurca: el monto va a `setColchonReservado`
y el objetivo a `colchonObjetivo`. Un `targetCents` paralelo en
`savings/colchon` sería un objetivo que la pantalla muestra y el safe-to-spend
ignora.

Y por eso el colchón tampoco se renombra: su nombre es el token con el que el
motor lo busca. Un colchón llamado *Vacaciones* seguiría bajando el
safe-to-spend, y eso ya no lo entiende nadie.

## El modelo

Un sobre es un nombre y cuánta plata hay adentro. Nada más:

| Campo | Qué es |
|---|---|
| `id` | Derivado del nombre al crear (`Viaje a Perú` → `viaje-a-peru`) y **estable**: renombrar no lo mueve. |
| `nombre` | El que le puso su dueño. |
| `monto` | Lo que hay hoy. |
| `objetivo` | `null` es **sin fijar**, y no cero (R25). |
| `sistema` | Sólo el colchón. |
| `creado_en` / `actualizado_en` | |

El motor puro vive en `server/src/strategy/sobres.ts` y está copiado **byte a
byte** en `functions/src/ledger/sobres.ts`, con `ledger/sobres.parity.test.ts`
exigiendo la igualdad — la misma disciplina que el parser. Para poder ser una
copia literal el módulo **no importa nada**: habla en centavos enteros y quien
lo llama convierte.

## De dónde sale la plata

De lo que el usuario escribe, y de nada más. **No hay un sobre derivado de las
transferencias**: una transferencia entre cuentas propias no dice a qué sobre
fue —el banco no tiene sobres, los tiene la persona— y adivinarlo sería el
"monto plausible" que la regla 3 del `CLAUDE.md` prohíbe. Un sobre sin monto
nace en cero, y ese cero lo decide el motor, no un campo vacío del formulario.

`aporte` y `monto` responden a dos preguntas distintas y las dos se hacen:
*"metí 200"* y *"quedaron 900"*. Mandarlas juntas es una contradicción y se
rechaza (`monto_y_aporte`). Un retiro que dejaría el sobre en negativo también:
un sobre con menos que cero adentro no es un estado del mundo, es un error de
tipeo.

## Las rutas

| Ruta | Qué hace |
|---|---|
| `GET /api/sobres` | La lista con sus montos, el total y la moneda. **El colchón está siempre**, exista o no su documento: un tenant que nunca reservó nada tiene un colchón en cero, no un colchón que falta. |
| `POST /api/sobres` | `{nombre, monto?, objetivo?}`. |
| `PATCH /api/sobres/:id` | `{nombre?, monto?, aporte?, objetivo?}`. `objetivo: null` explícito lo borra. |

Los rechazos son códigos del motor, no textos: `nombre_vacio`, `nombre_largo`,
`nombre_sin_letras`, `sobre_reservado`, `sobre_duplicado`, `demasiados_sobres`,
`monto_negativo`, `sobre_no_existe`, `sobre_del_sistema`, `monto_y_aporte`,
`sin_cambios`. El panel los traduce en `panel/src/lib/sobres.ts`; un código que
ese mapa no conozca se muestra tal cual antes que como un "algo salió mal" que
no dice qué arreglar.

Un `409 sobre_duplicado` no es lo mismo que el `400` del mismo nombre: el 400 lo
decide el motor mirando la lista, el 409 lo decide la escritura atómica cuando
dos pestañas crean el mismo sobre a la vez.

## La pantalla

`panel/src/views/Sobres.vue`, cuarta de la barra lateral. Es
`p9-ahorro.html` del design system, con dos recortes escritos en el propio
archivo: el panel del agente (el chat no entra al MVP) y el histórico de
aportes, que la propia tarjeta del sistema marcaba como *"hoy no tiene endpoint
HTTP"* — y sigue sin tenerlo.

## Lo que quedó afuera, y por qué

- **El histórico de aportes.** Las tablas `flexiahorro` / `metas` existen en el
  esquema (vienen de la reconstrucción histórica) y no tienen ruta. Un sobre
  hoy guarda su saldo, no su extracto.
- **Un sobre para la cuenta corriente.** El "corriente" del usuario no es un
  apartado: es el saldo de la cuenta, que ya es el ancla del perfil
  (`balanceSnapshot`). Modelarlo como un sobre más dejaría la misma plata
  contada dos veces — una en el Saldo y otra en el total apartado.
